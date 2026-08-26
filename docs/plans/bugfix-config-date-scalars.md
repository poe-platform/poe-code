# Fix config date scalar corruption

## Scope

Limit changes to `packages/config-mutations/src/types.ts`, the JSON/TOML/YAML
format modules, `execution/apply-mutation.ts`, `config-mutations.test.ts`, and
this plan. The parent handles individual commit, push, and release.

## Root cause

The shared object predicate and four private copies classify `Date` instances
as configuration tables. Recursive merge and prune then enumerate those scalar
values, producing empty tables, retaining obsolete table entries, or dropping
nested timestamps. Prefix-pruning merges bypass the format merger and therefore
need the same corrected predicate.

## Implementation

- [x] Add parameterized regression tests before changing production code.
- [x] Exclude `Date` instances, including `TomlDate` subclasses, from the shared predicate.
- [x] Replace the four private predicates with imports of the existing predicate.
- [x] Retain original date objects rather than reconstructing dates or losing TOML metadata.
- [x] Run the complete config-mutations tests and targeted lint/typecheck.

## Regression coverage

All filesystem operations in the new tests use memfs. Cases cover TOML offset-Z,
numeric-offset, local datetime, local date, and local time values; native Dates
in every format; and YAML explicit timestamps. Assertions cover scalar
classification, replacement identity, timestamp updates, both table/scalar
replacement directions, prefix-pruning merges, exact temporal serialization,
and nested timestamps surviving table-shaped pruning while siblings are removed.
The public mutation tests call `configMutation.merge` or `configMutation.prune`
through `runMutations`.

## Validation

- Red: focused temporal regressions produced **52 failures and 20 passes** before
  the production patch; 185 existing tests were skipped. Test execution: 92 ms.
- Green: all **72 temporal regressions passed** after the production patch.
- Package suite: `node_modules/.bin/vitest run packages/config-mutations/src --reporter=dot`
  passed **260 tests across two files**; test execution took 108 ms.
- Targeted ESLint on the six changed TypeScript files passed without diagnostics.
- Package typecheck: `node_modules/.bin/tsc -p packages/config-mutations/tsconfig.json --noEmit`
  passed.
- An additional strict standalone typecheck including the entire test file
  reported TS2722 on the unchanged optional `fs.chmod` calls at
  `config-mutations.test.ts:1928` and `config-mutations.test.ts:1933`.
  No diagnostics referenced the new regressions; unrelated tests remain untouched.
- Scoped `git diff --check` passed. No global formatting, commit, push, or release.
- No CLI visuals change; screenshots are not applicable.
