# Independent declaration design review provenance

Review date: Friday, August 28, 2026, America/Chicago. Scope: independent leaf,
design/source/data review only; ownership is this new directory alone. No product,
native shell, prepared script, build, test, private engine, or gate execution.

## Question freeze (before author-body inspection)

This question list was written after the root's detailed assignment and proposal
summary and after inspecting commit metadata, but before reading the author design
bodies. It is not blind, pre-author, or asserted pre-implementation. Implementation
start time is unknown. The later concrete holdouts are post-source-review proposals.

1. Which finite option grammar makes `-a/-p/-r/-x`, scalar `+x`, and `typeset` genuine?
2. What distinguishes absent, declared-unset, empty scalar, and empty indexed array?
3. Which attribute/value histories restore through dynamic local scope and exits?
4. Which export, readonly, temporary-environment, and control-variable behaviors stay stable?
5. Which operand failures are partial, and which syntax failures prevent all effects?
6. Which literal/expanded/prefixed declaration contexts admit compound assignment?
7. Do public AST and script-file whole-tree admission enforce the same policy?
8. Can every printed supported value be re-read without executing interpolated code?
9. What happens to NUL, lone UTF-16 surrogates, malformed UTF-8, and sparse indices?
10. What bounds discovery, scan work, output allocation, repeated calls, and local history?
11. What ledger accounting, rollback, cancellation, ownership, and cleanup are actually promised?
12. Can two stages each deliver an honest useful profile without certifying unaccepted arrays?

## Immutable inputs

- Author packet: `2832fdf1b6fb790995e2fcfcb9b203c71a13680e`.
- Attribution correction: `bd5a3d34205b41b3d49d71fb805ff0f6282e62a7`.
- Indexed-array candidate: `c7dae6e884d1a144266dfc1bb80785bf007a667f`, **UNACCEPTED**;
  any interface read from it is proposed, not certified.
- Initial observed HEAD: `55d9bb1aa98c9006cf8461a47fabc455acd817e2`.
- Initial tracked working-tree and index diffs: empty. Numerous foreign untracked
  paths existed; the overall worktree was **not clean**. Those paths are not review
  inputs and are neither inspected nor altered. This is not a gate interaction.

Applicable parent/root instructions were read in place; no instruction snapshots
are created. In particular, own-data validation must reject accessors, holes,
extras, and coercion across realms without using prototype identity as admission.

## Author data authentication (static only)

Read Git blobs, never executed their contents. At bd5a3d34 the 40 distinct M01–M40
table rows and eight D01–D08 prepared files total **2455 raw bytes**, including
final newlines. All13 HASHES.json input entries and all8 manifest script entries
matched byte lengths/SHA256. All native semantic expected stdout/stderr/status
fields were null. These are metadata checks, not semantic passes. Native
observations for the declaration D cohort: **NONE**. Author SOURCES cites older
array observations; no receipt, binary, external manual, supervisor or gate was
reauthenticated or rerun here. PRESEAL remains preparation, not ROOT GO.

| Corrected author relative path | Raw bytes | SHA256 |
| --- | ---: | --- |
| DESIGN.md | 26099 | c8648fa2679d27eee04ff8d28ea49acfdff3ce34d1888b916075782e0bfd65f8 |
| MATRIX.md | 8172 | ec91be2f19ce5a01121fa9062cc619a1883f6f2ff4c79e00474dcd5d00d01a58 |
| PRESEAL.md | 9149 | dd4c54a616be87e2028ddd8ab82a920db22b065b215af1ed3d034d997b7a7372 |
| SOURCES.md | 8703 | 8df0a0c244420ec3965a0375f20f2cd59fb458942d927b34ffac365f076d3102 |
| MANIFEST.json | 8092 | c590980a8da12b2c5670e8482ee46b6680f447e3454dc7a99e51c35d5adc3a83 |
| HASHES.json | 2582 | 2857f207f19e8fe0ec2fab34b60b84685bc57407af732602b65d06b7ae161ab9 |
| native-prepared/D01.txt | 271 | 850aea6f90b33903471043479c5584c68acf42e1ad39ad766c000e888e4e6b0a |
| native-prepared/D02.txt | 302 | 8ace73a4859c6d4e6e16aa3a46e099b99359c18e635543fbc155d5b25e4177db |
| native-prepared/D03.txt | 302 | 6f3ec84c8061414631b1b33bce9893dcbccf2665e7da6642a7b0cb5317c75f3c |
| native-prepared/D04.txt | 304 | 86e623828720bf4040d0355923ae39cb04dcc442626b966f984048c3204b22fd |
| native-prepared/D05.txt | 295 | 8174c225c19512c8c20ef3fd01febbfd0acc98bef697ce0eb854d407be66f040 |
| native-prepared/D06.txt | 345 | 274b9f1847ddee45b82261b7c2ca4858006d0104f149c46891263ad3b6889c8b |
| native-prepared/D07.txt | 290 | 31565b7d7a75403c57d6bb10c547dc45583a45d5f1222503edab1c6dea98ced5 |
| native-prepared/D08.txt | 346 | dde7aba929f822976c66288047510754f8550f191adc48e50b32b77f4afcd67b |

Paths above are relative to `tests/shell/declare-design-20260828/`.
DESIGN/MATRIX/PRESEAL bytes equal their original2832 packet versions. Original
SOURCES was8473 bytes, SHA256
`7031b098e2ef218f1c44ad1c1c21007d8ad13f7d712c2fa14d41bcc80e6d65bc`;
original HASHES was2582 bytes, SHA256
`0a4d2964661ae28390f2169526bb5a41717fd881161e29c6dbe0f235ca4ecbd1`.
Neither original nor corrected evidence was edited.

## Inspected source binding

The following live bytes matched both initial HEAD55d9bb1a and pinned c7dae6e8
in the metadata check. This authenticates these selected reads only, not a
candidate archive, all build inputs, or an accepted foundation. Line references
in REVIEW use these blobs. Full Git commits above resolve the abbreviated labels.

| Repository path | Git blob |
| --- | --- |
| src/shell/runtime.ts | 83df58832d537d2a4b1833af2c368665d9877567 |
| src/shell/parser.ts | 998a1471af0649ffb400adcfcc7ac8105bf4ef5b |
| src/shell/shell.ts | 220d6c28a6e50f459a48aaee2030f24a841f4ab7 |
| src/shell/types.ts | 763d2ee0ad2b15c7ed7af31e7c6171f739c98486 |
| src/shell/index.ts | 0110bd9d5c0388dc6fe15abc27f27a18dd7a6b38 |
| src/shell/arrays/syntax.ts | 8faad2d7757c68156d24f7aa5a07ab77c411a14d |
| src/shell/arrays/state.ts | 021459790e7aa5d03b6cac2d786a77643fa2f2aa |
| src/shell/arrays/bindings.ts | c686048897bbd7fa797ba6982a255a543afbe6a3 |
| src/shell/arrays/ledger.ts | c0c1a4ba292e26696b792b024019a79ce241cb89 |
| src/contracts/command.md | ef94adf238122441a66c2232fb3055aaee62d290 |
| src/contracts/io.ts | 6dc0efb87132376763228a845b2e62638898268a |
| src/contracts/output.ts | 3b1fe9536352a5e13c94ff231ce20ead354aabc8 |
| src/shell/input.ts | 3eec71b72f87dd48ddac572d6e7feb9097d32be4 |
| src/shell/cleanup.ts | eae04650a553e4820da9c7b08b0255a6b20fc01c |
| src/commands/basic.ts (printf q branch only) | 4180a22e83a6246287b5a2d169cfbf039f6e4b37 |
| tests/shell/indexed-arrays-author-20260828/CONTINUATION-G4A.md | 8fea531f426713ee43ea41142e7434f36c266abc |

During documentation work HEAD advanced to
`4270e2341dd60acce830a7b7828237ac776a71c5`; tracked/index diffs were still empty
at that checkpoint. Foreign untracked artifacts remain outside scope. The review
stays bound to the specified commits, not an assertion that moving HEAD is clean
or accepted. No branch/worktree/stash/reset, package edits, dependency installs,
native probes, tests, builds, or implementation imports were used.

## Own-document validation

Node standard-library reads/counts verified exactly four owned Markdown files,
48 unique ordered H01–H48 rows, 12 families with four rows each, and five R1–R5
decisions. Files have final LF, no NUL, and no trailing horizontal whitespace.
The first count-check expression omitted descriptive family labels and matched
no rows; the corrected expression matched48, without changing the row inventory.
This is a metadata-check correction, not a failed or passed runtime experiment.
Git whitespace checks apply only to the four owned files. The eventual explicit
four-path documentation commit binds their final bytes; no recursive self-hash
or whole-tree/append-proof integrity claim is made.
