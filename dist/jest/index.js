import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const SIDECAR_ENV = "QMS_EVIDENCE_SIDECAR";
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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
export function test(name, options, fn) {
    validate(name, options.covers);
    it(name, async () => {
        recordSlugs(getCurrentFullName(name), options.covers);
        return fn();
    });
}
function getCurrentFullName(fallback) {
    try {
        const state = expect.getState?.();
        return state?.currentTestName ?? fallback;
    }
    catch {
        return fallback;
    }
}
function recordSlugs(fullName, slugs) {
    const path = process.env[SIDECAR_ENV];
    if (!path)
        return;
    const dir = dirname(path);
    if (dir && dir !== ".")
        mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify({ fullName, slugs: [...slugs] })}\n`, "utf8");
}
function validate(name, slugs) {
    if (!slugs || slugs.length === 0) {
        throw new Error(`qms-coverage: test("${name}") declared with empty 'covers'. ` +
            `Pass at least one AC slug, or use jest's plain test()/it() instead.`);
    }
    for (const s of slugs) {
        if (typeof s !== "string" || !SLUG_RE.test(s)) {
            throw new Error(`qms-coverage: test("${name}") has invalid slug ${JSON.stringify(s)}. ` +
                `Slugs must be kebab-case (lowercase letters, digits, single hyphens).`);
        }
    }
}
//# sourceMappingURL=index.js.map