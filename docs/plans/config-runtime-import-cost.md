# Compiler-free configuration imports

## Problem and boundaries

Runtime environment and credential reads import the configuration package barrel,
which eagerly loads the build-time schema compiler, ts-morph, and its TypeScript
dependency. Keep every existing root export and synchronous runtime contract while
letting runtime consumers avoid that compiler dependency. Do not change test
concurrency, mocks' behavior, assertions, or release gates.

## Implementation

1. Add the `@poe-code/poe-code-config/core` subpath with the existing non-compiler
   exports. Preserve the root barrel as core plus the original compiler exports.
2. Move runtime imports and matching test mocks to core, without changing imported
   identifiers or implementations. Keep build-time compiler consumers supported.
3. Teach static scope collection to recognize both supported defineScope import
   paths, including aliased imports through the existing parser.
4. Verify compiler-free credential loading, root/core function identity, static
   schema generation, package exports, complete root tests, and builds.

## TDD evidence

- A throwing ts-morph mock in the existing SDK credential tests fails all 14 cases
  before the runtime import change. No case or credential assertion is removed.
- The existing static-scope fixture is parameterized over root and core imports.
  Before teaching the compiler about core, only that new variant fails; the other
  ten compiler/API compatibility cases pass.
- After implementation, 207 configuration and credential tests pass across eleven
  files. Root exports retain the same function identities as the core exports;
  the two compiler functions remain available from the root.

## Local measurement

September 1, 2026, Darwin arm64, Node 22.22.2. Eight fresh Node subprocess imports
alternate core/root/root/core twice against the same built package. No result or
module cache crosses subprocesses and neither variant changes concurrency.

| Import | Median complete subprocess wall time | Observed RSS |
| --- | ---: | ---: |
| Existing root barrel | 422.308 ms | 146–156 MiB |
| Compiler-free core | 211.089 ms | 68–69 MiB |

This is an import microbenchmark on a concurrently used workstation, not a claim
that the whole test suite or release has reached its target. The original root
barrel remains deliberately heavier for backwards compatibility.

## Validation

- Package build passes with the new JavaScript and declaration entrypoints.
- All seventeen package-lint rules pass, including subpath resolution and bundled
  dependency checks.
- Plan and harness schema generation pass without changing generated documents.
- The complete root command passes 11,151 tests with one existing skip across
  460 files, with no failures. JSON start-to-last-result time is 150.204 seconds
  on the shared workstation; this is not a controlled full-suite comparison.
- All seven affected workspace-owned unit tasks pass: 1,854 tests across 151
  files. Root-owned plan-browser and configuration tests are included above.
- The full 71-workspace build and root bundle pass. Packed CLI/SDK smoke tests
  pass, including public config imports, credentials, standalone filesystem
  identity, and portable declarations. Generated files remain unchanged.
- The API compatibility regression also compares the public `poe-code/config`
  entrypoint with the original package root; neither drops compiler exports.
