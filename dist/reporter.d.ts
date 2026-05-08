import type { Reporter, TestRunEndReason } from "vitest/reporters";
import type { TestModule } from "vitest/node";
import type { SerializedError } from "@vitest/utils";
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
export default class QmsCoverageReporter implements Reporter {
    onTestRunEnd(testModules: ReadonlyArray<TestModule>, _unhandledErrors: ReadonlyArray<SerializedError>, _reason: TestRunEndReason): Promise<void>;
}
//# sourceMappingURL=reporter.d.ts.map