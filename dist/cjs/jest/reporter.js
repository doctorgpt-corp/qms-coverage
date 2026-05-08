"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const SIDECAR_ENV = "QMS_EVIDENCE_SIDECAR";
/**
 * Jest reporter that writes per-AC test evidence to a JSON manifest
 * for a separate publish step to upload to the Aletta QMS.
 *
 * Wiring (jest.config.ts):
 *   export default {
 *     reporters: [
 *       "default",
 *       "@aletta/qms-coverage/jest/reporter",
 *     ],
 *   };
 *
 * Activation: set ``QMS_EVIDENCE_OUT`` to the manifest path. When
 * unset the reporter no-ops, so ``jest`` locally never produces a
 * file. The reporter also pre-populates ``QMS_EVIDENCE_SIDECAR`` so
 * the test wrappers in ``@aletta/qms-coverage/jest`` know where to
 * append slug records during the run.
 *
 * Run context (filled from GitHub Actions env first, then ``git`` as
 * a fallback for non-GH CI):
 *   - GITHUB_REF_NAME    → branch
 *   - GITHUB_SHA         → sha
 *   - GITHUB_RUN_ID      → runId
 *   - GITHUB_SERVER_URL + GITHUB_REPOSITORY + GITHUB_RUN_ID → runUrl
 */
class QmsCoverageReporter {
    sidecarPath;
    constructor() {
        const out = process.env.QMS_EVIDENCE_OUT;
        this.sidecarPath =
            process.env[SIDECAR_ENV] ?? (out ? `${out}.slugs.jsonl` : "");
        // Propagate to test workers via env. Jest forks workers from this
        // process, so the var is inherited.
        if (this.sidecarPath && !process.env[SIDECAR_ENV]) {
            process.env[SIDECAR_ENV] = this.sidecarPath;
        }
    }
    onRunStart() {
        if (!this.sidecarPath)
            return;
        const dir = (0, node_path_1.dirname)(this.sidecarPath);
        if (dir && dir !== ".")
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        // Start each run from a clean sidecar so stale entries from a
        // prior run don't bleed into this manifest.
        (0, node_fs_1.writeFileSync)(this.sidecarPath, "", "utf8");
    }
    async onRunComplete(_contexts, results) {
        const outPath = process.env.QMS_EVIDENCE_OUT;
        if (!outPath)
            return;
        const slugMap = readSidecar(this.sidecarPath);
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
        const cwd = process.cwd();
        const evidence = [];
        for (const fileResult of results.testResults) {
            const relFile = (0, node_path_1.relative)(cwd, fileResult.testFilePath);
            for (const ac of fileResult.testResults) {
                const slugs = slugMap.get(ac.fullName);
                if (!slugs || slugs.length === 0)
                    continue;
                const status = mapStatus(ac);
                if (status === null)
                    continue;
                evidence.push({
                    testId: ac.fullName,
                    testFile: relFile,
                    status,
                    durationMs: ac.duration ?? undefined,
                    acSlugs: [...slugs],
                });
            }
        }
        const manifest = { branch, sha, runId, runUrl, results: evidence };
        const dir = (0, node_path_1.dirname)(outPath);
        if (dir && dir !== ".")
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        (0, node_fs_1.writeFileSync)(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        // eslint-disable-next-line no-console
        console.log(`[qms-coverage] wrote ${evidence.length} evidence row(s) to ${outPath} on ${branch}@${sha.slice(0, 7)}.`);
    }
    // Jest's Reporter interface also wants this; it gates whether Jest
    // exits with a non-zero code on reporter errors. We never want a
    // QMS-side failure to fail the test run, so always return undefined.
    getLastError() {
        return undefined;
    }
}
exports.default = QmsCoverageReporter;
function readSidecar(path) {
    const map = new Map();
    if (!path || !(0, node_fs_1.existsSync)(path))
        return map;
    const raw = (0, node_fs_1.readFileSync)(path, "utf8");
    for (const line of raw.split("\n")) {
        if (!line)
            continue;
        try {
            const { fullName, slugs } = JSON.parse(line);
            // Last write wins — slugs should be deterministic per test.
            map.set(fullName, slugs);
        }
        catch {
            // Ignore malformed lines rather than poisoning the whole run.
        }
    }
    return map;
}
function mapStatus(ac) {
    if (ac.status === "passed")
        return "passed";
    if (ac.status === "failed")
        return "failed";
    if (ac.status === "skipped" || ac.status === "pending" || ac.status === "todo") {
        return "skipped";
    }
    return null;
}
function safeGit(args) {
    try {
        return (0, node_child_process_1.execSync)(`git ${args}`, {
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