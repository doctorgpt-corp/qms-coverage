export type CoversOptions = {
    /**
     * Globally unique acceptance-criterion slugs this test covers.
     * The QMS uses these to link runtime evidence back to a specific AC.
     */
    covers: readonly string[];
};
type TestFn = () => unknown | Promise<unknown>;
/**
 * Wrapped `it`/`test` for Jest that records which acceptance-criteria
 * the test covers.
 *
 * Jest workers run in isolated processes, so we can't share an
 * in-memory map with the reporter. Instead, the wrapper appends a
 * single JSONL line to the sidecar file at ``QMS_EVIDENCE_SIDECAR``
 * during the test body — atomic O_APPEND writes survive worker
 * boundaries — and the reporter joins those records to test results
 * in ``onRunComplete`` by ``fullName``.
 *
 * Caveat: skipped tests don't execute their body, so their slugs
 * won't be recorded in Jest. (Vitest and pytest record skipped-test
 * evidence too.) If skip-coverage matters for your AC, switch the
 * project to Vitest or assert ``test.failing`` instead.
 *
 * @example
 *   import { test } from "@aletta/qms-coverage/jest";
 *   // or, for `it`-flavoured tests:
 *   //   import { test as it } from "@aletta/qms-coverage/jest";
 *
 *   test(
 *     "accept invite",
 *     { covers: ["org-002-accept-calls-accept-endpoint"] },
 *     async () => {
 *       // ...
 *     },
 *   );
 */
export declare function test(name: string, options: CoversOptions, fn: TestFn): void;
export {};
//# sourceMappingURL=index.d.ts.map