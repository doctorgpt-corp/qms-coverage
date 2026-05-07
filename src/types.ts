// Module augmentation: attach `acSlugs` to vitest's TaskMeta so the
// reporter can read what each test covered. The wrapper in ./index.ts
// writes this; QmsCoverageReporter reads it back via testCase.meta().

declare module "@vitest/runner" {
  interface TaskMeta {
    acSlugs?: readonly string[];
  }
}

export {};
