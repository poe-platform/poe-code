# Template repetition CLI acceptance

Owned files: this plan and `packages/safe-bash/tests/commands/pptx/template-repeat.test.ts`.
The integration owner maintains the exact test registry and public engine exports.

Use original in-memory slides and memfs publication through the real virtual Shell.
Cover zero, one and many records under both explicit media policies; bind original
slide positions and assert record-first, explicit-slide ordering against literal text.
Compare public SDK and CLI bytes and repeated invocations for deterministic output.
Cover data-file input, dry-run, and a later invalid binding with both forced existing
output and in-place publication. No source or destination may change on failure.
Check executable schema acceptance and closed JSON validation. Graph preservation
and aggregate resource admission are covered by the separately owned domain tests.

No corpus download or native runtime is needed for these unit tests. The research
audits and inventories inform the graph obligations; no reference assets or test
wording are used here. No README, release, or complete pipeline execution is involved.

Initial RED: `node --import tsx --test packages/safe-bash/tests/commands/pptx/template-repeat.test.ts`
failed all nine cases in 1.17 seconds. Repeat objects received usage exit 2 from
the existing array-only binding parser; the existing binding schema rejected them.
This is concrete pre-implementation evidence, not an inferred defect.
The new file was formatted with the repository Prettier installation.
After the maintained selected `pptx` build, focused GREEN passed all nine cases
(7.04 seconds after scheduler acceleration, down from 15.99 seconds). The fixture now uses four slides, preserving a prefix and a
noncontiguous unselected middle slide while avoiding a redundant closing slide.
The longest cases perform three complete SDK/CLI graph transformations; the
zero-delay cooperative scheduler uses `queueMicrotask` without mocking product behavior.
All nine cases retain their assertions; the slowest case took 1.075 seconds.
The focused strict TypeScript check passed:

```sh
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --types node packages/safe-bash/tests/commands/pptx/template-repeat.test.ts
```

No commit or push was made by this worker. The integration owner owns maintained
scope checks and the final commit.

Final JSON-effect regression: the six repeat success variants initially failed
because every effect was labeled replace. They now independently require removed
prototype effects for zero records and added slide effects followed by replaced
binding-object effects for one/many records. Final 9/9 GREEN took 4.88 seconds;
strict TypeScript passed again.
