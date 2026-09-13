# PPTX shapes implementation and verification

Scope: documented preset shapes and text boxes; local IDs and names; geometry,
locks, title/description and basic fill/line. Apply the PPTX and shared office
contracts. The model belongs to `packages/pptx`, adapters to
`packages/safe-bash/src/commands/pptx`; root only exposes public entry points.
No whole pipeline, push, release, README changes or downloaded unit fixtures.

## Ownership and sequence

1. The model owner writes fast original in-memory regressions before model edits.
2. The command owner writes paired SDK/CLI memfs regressions before command edits.
3. The accounting owner maintains the focused research ledger and independently
   compares each relevant parameter variant, BDD example and public API row.
4. Root integrates explicit owned files, runs maintained focused checks and
   commits atomic improvements on main only after checks pass.

## Independent expectations

Use literal XML attributes, QName child ordering and expected unit constants;
never derive expectations from the implementation's preset or conversion table.
Distinguish absent/unsupported/inherited properties and explicit zero/false/empty.
Exercise XML-sensitive Unicode names, duplicate sparse placeholder keys, repeated
local IDs on different slides, invalid extents, unsafe/nonfinite units and unknown
preset preservation. Reject a failed mutation before publication.

The focused ledger selects every case from its named source files, retains exact
unit parameter bindings and expanded BDD examples, and records neighboring public
APIs as gaps when beyond this bounded change. Proposed assertions are not passing
tests. Do not infer all enum mappings from one representative rectangle case.

## Disposable corpus QA procedure

1. Read `docs/pptx/corpus-manifest.json`; use already admitted cache entries only.
   Confirm each selected fixture's SHA-256 against the manifest. Do not download
   documents as part of unit tests or include fixture bytes in commits.
2. Prefer one small presentation containing ordinary shapes and one containing
   placeholders. Use a disposable output location and explicit filesystem
   capability for CLI/SDK operations; never modify the cached input.
3. Inspect shape names, IDs, preset types and explicit versus inherited geometry.
   Apply a basic shape-property update and add a text box/preset with explicit
   placement. Independently inspect emitted XML for schema child order and exact
   unit values; compare all unrelated parts and relationships.
4. Exercise unknown preset/unsupported fill preservation and rejection. Reduce
   any meaningful failure to the smallest independently authored memfs regression
   before changing product code; rerun the affected checks.
5. Run the maintained screenshot command for any changed visible CLI help/output,
   inspect the resulting image, and record the exact invocation and result.
6. Record actual receipts below. Missing cache entries, absent visual tooling or
   an unexecuted step remain visible limitations, never reported as passed.

## Receipts

- Pre-change root receipt: `npm run test --workspace=pptx` passed 72 files and
  1,897 cases in 21.39 seconds. This is baseline evidence only.
- Final maintained checks and focused tests passed as recorded below.
  Corpus inspection and screenshot receipts are recorded by the command owner
  in [the companion shape QA plan](pptx-shapes-cli-qa.md).

- Independent regression receipt: `npx vitest run packages/pptx/src/shapes-regressions.test.ts`
  passed 196 cases in 139 ms. Four text/namespace cases failed before the fix;
  enum table and model placeholder checks include independent literal expectations.

- Final independent focused receipt: `npx vitest run packages/pptx/src/shapes-regressions.test.ts --reporter=dot`
  passed all 226 cases in 164 ms, including width clearing and choice-only solid
  fill regressions. The earlier 196 count preceded those additions.

- Final root maintained receipts: selected pptx build closure passed 3 builds;
  package lint passed; package tests passed 75 files / 2,178 cases in 24.42 seconds;
  3 compiled safe-bash consumer files passed 89 cases.
- Subsequent test-only enum closure added 47 cases: all 20 placeholder symbols,
  all 26 category symbols and alias/helper assertions. The final focused
  regression file passed 273 cases in 151 ms. No product code changed for this
  final test-only addition.

- Root repeated package lint after the final enum-only addition; it passed.
