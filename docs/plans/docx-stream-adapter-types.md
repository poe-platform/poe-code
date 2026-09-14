# Document stream adapter declaration prerequisite

The maintained `virtual-bash` typecheck build rejects three inferred exported
declarations with TS2742: `decodeZipEntry` in the archive adapter and `codec` /
`CodecReader` in the compression adapter. Their inferred byte-source types refer
to an internal declaration path instead of the imported codec factory surface.
The failure was reproduced twice, including after rebuilding the shared codec
and filesystem dependencies.

Use explicit `ReturnType<typeof factory>["member"]` annotations on individual
exports. Annotating only the destructuring declaration still reproduced all
three TS2742 failures, so bind the single factory result and type each exported
member. This preserves the factory's types and runtime
behavior without adding another API, wrapper or dependency. The failing
maintained declaration build is the regression evidence for this type-only
correction; no runtime test can establish declaration portability.

Validation completed on 2026-09-14:

- `npm run typecheck:all --workspace=virtual-bash` passed the production
  declaration build, source/tests, historical and current consumers, and expected
  negative-binding controls; 26 current consumer groups passed.
- Direct focused Node/tsx tests passed 91 cases across `zip-format.test.ts`,
  `zip-codec.test.ts`, and compression `bounded-codec`, `streaming`, `ownership`
  and `safety` suites. These original runtime cases remain separate from the
  declaration portability evidence.
- `npm run lint:eslint` completed with exit 0, no errors or scope gaps, and
  12 unused-import/variable warnings in the disposable
  `.cache/pptx-usage-review/example.mts` QA file. All 12,393 configured subjects
  were linted; no owned-source diagnostic was reported. The QA file was neither
  changed nor staged.

This prerequisite correction is separate from the document stream adapter
feature commit. Only its two annotations and this plan belong in that atomic
commit. No push or release is authorized.
