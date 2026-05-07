import { test as vitestTest, type TestContext } from "vitest";

declare module "@vitest/runner" {
  interface TaskMeta {
    acSlugs?: readonly string[];
  }
}

export type CoversOptions = {
  /**
   * Globally unique acceptance-criterion slugs this test covers.
   * The QMS uses these to link runtime evidence back to a specific AC.
   */
  covers: readonly string[];
};

type TestFn = (ctx: TestContext) => unknown | Promise<unknown>;

/**
 * Wrapped `test` that records which acceptance-criteria the test covers.
 *
 * Slugs are written to `task.meta.acSlugs` BEFORE the body runs, so
 * failing tests still register their AC linkage — the reporter then
 * derives per-AC pass/fail state from the run.
 *
 * @example
 *   import { test } from "@aletta/qms-coverage";
 *
 *   test(
 *     "accept invite",
 *     { covers: ["org-002-accept-calls-accept-endpoint"] },
 *     async () => {
 *       // ...
 *     },
 *   );
 */
export function test(name: string, options: CoversOptions, fn: TestFn): void {
  if (!options.covers || options.covers.length === 0) {
    throw new Error(
      `qms-coverage: test("${name}") declared with empty 'covers'. ` +
        `Pass at least one AC slug, or use vitest's plain test()/it() instead.`,
    );
  }
  return vitestTest(name, async (ctx) => {
    ctx.task.meta.acSlugs = [...options.covers];
    return fn(ctx);
  });
}

export const it = test;
