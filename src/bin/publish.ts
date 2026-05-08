#!/usr/bin/env node
/**
 * Publishes a qms-coverage evidence manifest to the Aletta QMS and,
 * when running inside GitHub Actions, appends a markdown summary to
 * the job summary so reviewers see AC coverage on the PR's Checks tab.
 *
 * Usage:
 *   qms-coverage-publish [path-to-manifest]   # default: qms-evidence.json
 *
 * Required env:
 *   QMS_URL, QMS_CI_TOKEN
 *
 * Optional env (auto-set by GitHub Actions):
 *   GITHUB_STEP_SUMMARY  — markdown summary appended here when set.
 */
import { appendFileSync, readFileSync } from "node:fs";

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

async function main(): Promise<void> {
  const path = process.argv[2] ?? "qms-evidence.json";
  const url = (process.env.QMS_URL ?? "").replace(/\/$/, "");
  const token = process.env.QMS_CI_TOKEN ?? "";
  if (!url || !token) {
    throw new Error("qms-coverage publish: QMS_URL and QMS_CI_TOKEN are required.");
  }

  const raw = readFileSync(path, "utf8");
  const manifest = JSON.parse(raw) as Manifest;

  const summary = renderSummary(manifest);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    appendFileSync(summaryPath, summary);
  } else {
    process.stdout.write(summary);
  }

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
      `qms-coverage publish: POST ${url}/api/evidence ${response.status}: ${body}`,
    );
  }
  const ok = (await response.json().catch(() => null)) as
    | { recorded?: number; skipped?: string[] }
    | null;
  const recorded = ok?.recorded ?? manifest.results.length;
  const skipped = ok?.skipped ?? [];
  // eslint-disable-next-line no-console
  console.log(
    `[qms-coverage] pushed ${recorded} evidence row(s) across ${manifest.results.length} test(s) on ${manifest.branch}@${manifest.sha.slice(0, 7)}.`,
  );
  if (skipped.length > 0) {
    process.stderr.write(
      `[qms-coverage] WARN: ${skipped.length} unknown slug(s) skipped (author them in QMS to start tracking):\n` +
        skipped.map((s) => `  - ${s}\n`).join(""),
    );
  }
}

function renderSummary(manifest: Manifest): string {
  const counts: Record<EvidenceStatus, number> = { passed: 0, failed: 0, skipped: 0 };
  const slugs = new Set<string>();
  const failed: EvidenceResult[] = [];
  for (const r of manifest.results) {
    counts[r.status]++;
    for (const s of r.acSlugs) slugs.add(s);
    if (r.status === "failed") failed.push(r);
  }
  const shortSha = manifest.sha.slice(0, 7);
  const out: string[] = [];
  out.push(`## QMS Evidence — \`${manifest.branch}\`@\`${shortSha}\`\n\n`);
  out.push(`**${manifest.results.length} test(s)** covering **${slugs.size} AC slug(s)**.\n\n`);
  out.push(`| Status | Count |\n|--------|------:|\n`);
  out.push(`| Passed | ${counts.passed} |\n`);
  out.push(`| Failed | ${counts.failed} |\n`);
  out.push(`| Skipped | ${counts.skipped} |\n\n`);
  if (failed.length > 0) {
    out.push(`<details>\n<summary>Failed tests (${failed.length})</summary>\n\n`);
    for (const f of failed) {
      out.push(`- \`${f.testFile}\` — ${f.testId} (${f.acSlugs.join(", ")})\n`);
    }
    out.push(`\n</details>\n\n`);
  }
  return out.join("");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err.message ?? err);
  process.exit(1);
});
