import type { AggregatedResult, TestContext } from "@jest/test-result";
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
export default class QmsCoverageReporter {
    private readonly sidecarPath;
    constructor();
    onRunStart(): void;
    onRunComplete(_contexts: Set<TestContext>, results: AggregatedResult): Promise<void>;
    getLastError(): Error | undefined;
}
//# sourceMappingURL=reporter.d.ts.map