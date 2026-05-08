import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
/**
 * Vitest reporter that writes per-AC test evidence to a JSON manifest
 * for a separate publish step to upload to the Aletta QMS.
 *
 * Wiring (vitest.config.ts):
 *   import QmsCoverageReporter from "@aletta/qms-coverage/reporter";
 *   export default defineConfig({
 *     test: { reporters: ["default", new QmsCoverageReporter()] },
 *   });
 *
 * Activation: set QMS_EVIDENCE_OUT to the manifest path. When unset
 * the reporter no-ops, so `bun test` locally never produces a file.
 *
 * Run context (filled from GitHub Actions env first, then `git` as a
 * fallback for non-GH CI):
 *   - GITHUB_REF_NAME    → branch
 *   - GITHUB_SHA         → sha
 *   - GITHUB_RUN_ID      → runId
 *   - GITHUB_SERVER_URL + GITHUB_REPOSITORY + GITHUB_RUN_ID → runUrl
 *
 * If branch or SHA can't be determined, the reporter throws — better
 * to fail CI loudly than to silently lose evidence.
 */
export default class QmsCoverageReporter {
    async onTestRunEnd(testModules, _unhandledErrors, _reason) {
        const outPath = process.env.QMS_EVIDENCE_OUT;
        if (!outPath)
            return;
        const branch = process.env.GITHUB_REF_NAME ?? safeGit("rev-parse --abbrev-ref HEAD");
        if (!branch) {
            throw new Error("qms-coverage: cannot determine git branch (GITHUB_REF_NAME unset and `git rev-parse --abbrev-ref HEAD` failed).");
        }
        const sha = process.env.GITHUB_SHA ?? safeGit("rev-parse HEAD");
        if (!sha) {
            throw new Error("qms-coverage: cannot determine git SHA (GITHUB_SHA unset and `git rev-parse HEAD` failed).");
        }
        const runId = process.env.GITHUB_RUN_ID;
        const runUrl = process.env.GITHUB_SERVER_URL &&
            process.env.GITHUB_REPOSITORY &&
            runId
            ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${runId}`
            : undefined;
        const results = [];
        for (const module_ of testModules) {
            for (const testCase of module_.children.allTests()) {
                const slugs = testCase.meta().acSlugs;
                if (!slugs || slugs.length === 0)
                    continue;
                const status = mapStatus(testCase);
                if (status === null)
                    continue;
                results.push({
                    testId: testCase.fullName,
                    testFile: module_.relativeModuleId,
                    status,
                    durationMs: testCase.diagnostic()?.duration,
                    acSlugs: [...slugs],
                });
            }
        }
        const manifest = { branch, sha, runId, runUrl, results };
        const dir = dirname(outPath);
        if (dir && dir !== ".")
            mkdirSync(dir, { recursive: true });
        writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        // eslint-disable-next-line no-console
        console.log(`[qms-coverage] wrote ${results.length} evidence row(s) to ${outPath} on ${branch}@${sha.slice(0, 7)}.`);
    }
}
function mapStatus(testCase) {
    const state = testCase.result().state;
    if (state === "passed")
        return "passed";
    if (state === "failed")
        return "failed";
    if (state === "skipped")
        return "skipped";
    return null;
}
function safeGit(args) {
    try {
        return execSync(`git ${args}`, {
            stdio: ["ignore", "pipe", "ignore"],
        })
            .toString()
            .trim() || null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=reporter.js.map