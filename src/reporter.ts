import { execSync } from "node:child_process";
import type { Reporter, TestRunEndReason } from "vitest/reporters";
import type { TestCase, TestModule } from "vitest/node";
import type { SerializedError } from "@vitest/utils";

type EvidenceStatus = "passed" | "failed" | "skipped";

type EvidenceResult = {
  testId: string;
  testFile: string;
  status: EvidenceStatus;
  durationMs?: number;
  acSlugs: string[];
};

type Manifest = {
  branch: string;
  sha: string;
  runId?: string;
  runUrl?: string;
  results: EvidenceResult[];
};

/**
 * Vitest reporter that pushes per-AC test evidence to the Aletta QMS.
 *
 * Wiring (vitest.config.ts):
 *   import QmsCoverageReporter from "@aletta/qms-coverage/reporter";
 *   export default defineConfig({
 *     test: { reporters: ["default", new QmsCoverageReporter()] },
 *   });
 *
 * Required env at push time:
 *   - QMS_CI_TOKEN  Bearer token minted in the QMS at /admin/ci-tokens.
 *                   When unset, the reporter no-ops (so `bun test`
 *                   locally never tries to publish).
 *   - QMS_URL       Base URL of the QMS (e.g. https://qms.brainshelf.org).
 *
 * Run context (filled from GitHub Actions env first, then `git` as a
 * fallback for non-GH CI):
 *   - GITHUB_REF_NAME    → branch
 *   - GITHUB_SHA         → sha
 *   - GITHUB_RUN_ID      → runId
 *   - GITHUB_SERVER_URL + GITHUB_REPOSITORY + GITHUB_RUN_ID → runUrl
 *
 * If the token is set but branch or SHA can't be determined, the
 * reporter throws — better to fail CI loudly than to silently lose
 * evidence.
 */
export default class QmsCoverageReporter implements Reporter {
  async onTestRunEnd(
    testModules: ReadonlyArray<TestModule>,
    _unhandledErrors: ReadonlyArray<SerializedError>,
    _reason: TestRunEndReason,
  ): Promise<void> {
    const token = process.env.QMS_CI_TOKEN;
    if (!token) return;

    const url = (process.env.QMS_URL ?? "").replace(/\/$/, "");
    if (!url) {
      throw new Error(
        "qms-coverage: QMS_CI_TOKEN is set but QMS_URL is not.",
      );
    }

    const branch = process.env.GITHUB_REF_NAME ?? safeGit("rev-parse --abbrev-ref HEAD");
    if (!branch) {
      throw new Error(
        "qms-coverage: cannot determine git branch (GITHUB_REF_NAME unset and `git rev-parse --abbrev-ref HEAD` failed).",
      );
    }

    const sha = process.env.GITHUB_SHA ?? safeGit("rev-parse HEAD");
    if (!sha) {
      throw new Error(
        "qms-coverage: cannot determine git SHA (GITHUB_SHA unset and `git rev-parse HEAD` failed).",
      );
    }

    const runId = process.env.GITHUB_RUN_ID;
    const runUrl =
      process.env.GITHUB_SERVER_URL &&
      process.env.GITHUB_REPOSITORY &&
      runId
        ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
        : undefined;

    const results: EvidenceResult[] = [];
    for (const module_ of testModules) {
      for (const testCase of module_.children.allTests()) {
        const slugs = testCase.meta().acSlugs;
        if (!slugs || slugs.length === 0) continue;
        const status = mapStatus(testCase);
        if (status === null) continue;
        results.push({
          testId: testCase.fullName,
          testFile: module_.relativeModuleId,
          status,
          durationMs: testCase.diagnostic()?.duration,
          acSlugs: [...slugs],
        });
      }
    }

    if (results.length === 0) return;

    const manifest: Manifest = { branch, sha, runId, runUrl, results };
    const response = await fetch(`${url}/api/evidence`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(manifest),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `qms-coverage: POST ${url}/api/evidence ${response.status}: ${body}`,
      );
    }
    const ok = (await response.json().catch(() => null)) as
      | { recorded?: number }
      | null;
    const count = ok?.recorded ?? results.length;
    // eslint-disable-next-line no-console
    console.log(
      `[qms-coverage] pushed ${count} evidence row(s) across ${results.length} test(s) on ${branch}@${sha.slice(0, 7)}.`,
    );
  }
}

function mapStatus(testCase: TestCase): EvidenceStatus | null {
  const state = testCase.result().state;
  if (state === "passed") return "passed";
  if (state === "failed") return "failed";
  if (state === "skipped") return "skipped";
  return null;
}

function safeGit(args: string): string | null {
  try {
    return execSync(`git ${args}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}
