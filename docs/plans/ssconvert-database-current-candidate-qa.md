# Database codecs current candidate QA

Preserve the existing implementation, reference records and unrelated edits.
Do not edit README files, commit pre-existing files, push or publish.

1. Hash `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz`; require
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
2. Audit released xBase/Paradox plugins and their GOffice/pxlib dependencies.
   Confirm import-only DBF registration and binary Paradox read/write providers.
   Retain the earlier dependency/plugin/locale profile as historical evidence.
3. Run original failing DBF numeric and independent Paradox coercion cases before
   repairs. Unit cases use injected bytes/memfs; never run native tools there.
4. Execute the maintained uncached ssconvert unit route and lint, then the
   selected safe-bash build closure. Exercise the actual command cohort after
   building, including SDK byte equivalence, replay, destination preservation,
   cancellation, encrypted input refusal and no companion-file effects.
5. Capture the virtual importer listing and a real binary `.db` save/reimport
   using the screenshot route with output below `out`; inspect the image.
6. Independently recheck the final changed source hashes and run the database
   edge cohort. Distinguish current passes from checks predating final edits.
7. Attempt native optional-profile access separately; an unavailable oracle is
   unverified. Record omissions: unmodified pxlib profile, exhaustive versions,
   corrupt companion corpus, non-C locales, full realm/checkpoint qualification,
   allocator-dependent native behavior and deterministic runtime budgets.

No finite test cohort establishes complete Gnumeric parity. Retain the explicit
mismatches in the existing database source audit and independent-review QA.

## Current execution record

The primary archive hash matched. Existing providers are declarative;
DBF remains import-only and Paradox emits binary header/record/block data.
Source was reused exclusively beneath `out`; no native product dependency or
fallback was introduced. Historical native evidence was read, not rerun.

Original numeric tests reproduced four failures before repair: Latin-1 NBSP
was incorrectly skipped, and `inf`, `-INFINITYtail`, and `nan` became zero.
The database parser now follows GOffice's ASCII whitespace, hex rejection and
nonfinite prefix behavior. Native `value_new_float` maps nonfinite values to
`#NUM!`. The original hexadecimal-six hypothesis was withdrawn after auditing
GOffice's `strtod_helper`; hexadecimal input is a passing rejection control.
The different agent's Paradox failures/repairs are recorded in
[current independent review](ssconvert-database-current-review-qa.md).

Passing maintained checks after final runtime edits:

- `npm test --workspace=@poe-code/ssconvert -- --no-cache`: 227 files,
  5194 tests passed. Two signed-zero controls were added afterward; the fresh
  final database cohort below includes them. This is a workspace gate, not
  the root `npm test` gate.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  selected maintained dependency closure and postbuild passed.
- `npm run lint --workspace=@poe-code/ssconvert`: ESLint and source/test strict
  TypeScript checks passed after final test edits.
- `node --import tsx --test packages/safe-bash/tests/commands/ssconvert*.test.ts`:
  all 79 tests passed. After the final build, the database command test passed
  again, checking SDK bytes, repeated execution, ordered failures, NBSP numeric
  conversion, original destination preservation and exact namespace effects.
- Fresh final four-file database cohort: 45 tests passed, including the
  independent raw-byte coercion controls, cyclic-chain cancellation, primary
  index, output-byte budget, encrypted-input refusal and signed-zero controls.
- Guarded `npm run lint:eslint` completed with exit 0: 16908 configured files
  linted, 0 errors and 4 warnings in unrelated existing files. Its large
  provenance receipt was truncated in tool display; the completion record and
  process exit are observed, without claiming the whole receipt was inspected.
  Package lint separately verifies the final source and tests.
- Manual screenshot captured the actual virtual importer listing and binary
  save/reimport; inspected aligned provider IDs, Café and -12.5, with status 0
  on each of the three commands. Screenshot artifacts remain task-owned scratch
  beneath `out` and are removed after inspection.

Final runtime SHA-256:

- xbase.ts: `5f6f81f963989ca8803f3ba57ec6327f6692564d7349e74dbf7c4df83616dfe5`
- paradox.ts: `11aabe334be2aba83d6de13d7dbca95c0a3cfdc9c1eced8863611d7fcb759b8e`
- database-support.ts: `58ae7383a6b32a70d11c33151a381f35f9a3f1125907b248ffeca9dd532df9a2`

The different agent independently reread the final numeric helper against the
mapped GOffice source and executed 23 additional in-memory controls: malformed
sign/point/exponent prefixes, NBSP after signs, signed hexadecimal rejection,
case-varied infinity/NaN payload prefixes, decimal/D suffixes, NUL and signed
zero. All passed, with no source changes. It independently reran the final
45-test cohort and confirmed the three product hashes above. These are source
semantic checks, not a fresh native differential or a performance measurement.

Intentional initial failing regressions were investigated and repaired. No final
focused failure or timeout is counted as a pass. Fresh optional native QA is
unavailable: Docker cannot connect to its daemon. The earlier patched pxlib
profile cannot certify unmodified pxlib behavior. No generated-case performance
measurements were performed. Full repository test/build, complete lint chain,
realm/checkpoint qualification and exhaustive upstream matrix cells were not
run by this focused codec continuation. Unsupported encrypted tables, unsupported
field types, encoding-loss boundaries and native unsafe-memory mismatches retain
their existing explicit limits; see the original database QA and current
independent review. No local commit, remote delivery, push, release or publication
was performed; pre-existing untracked implementation edits were preserved.
