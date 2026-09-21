# Hidden workbook resize QA

Product: TypeScript ESM `@poe-code/ssconvert`, shared SDK and virtual `ssconvert`
command. Native Gnumeric is a separately invoked QA oracle only. No fallback,
host command capability, README edit, push or publication is authorized.

## Procedure

1. Read root and safe-bash instructions. Preserve existing changes. Acquire
   primary source only in `out`; require Gnumeric 1.12.61 archive SHA-256
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Use `src/ssconvert.c:1443`, `src/sheet.c:1208` through `1538`, and
   `test/t9001-ssconvert-resize.pl` as source guidance. Create original sparse
   fixtures rather than copying upstream samples into tests.
2. Reuse the isolated `ssconvert-statistics-qa` container in Docker context
   `colima`. Its native prefix is `/out/ssconvert-statistics-oracle/prefix`.
   All scratch belongs to `out/ssconvert-resize`. Apply the exact environment
   in `docs/ssconvert/resize-reference-profile.json`; capture each status,
   stdout and stderr independently. Record source hash, binary hash, runtime
   package versions, locale and listed exporter plugin profile. The retained
   statistics profile supplies the separate existing dependency/plugin census.
3. Probe signed decimal syntax, case-sensitive literal `x`, whitespace before
   each integer, forbidden whitespace before `x`, incomplete scans and trailing
   suffixes. Probe invalid negative, zero, non-power-of-two and undersized
   dimensions. Separate stable sscanf behavior from undefined C overflow.
4. Probe shrinking rows, columns and both; expanding rows, columns and both;
   reverse iteration through multiple hidden/visible sheets; unchanged sizes;
   sparse content loss; array deletion and split rollback; merge split refusal;
   reference/range/name relocation; print names; retained object anchors and
   style rectangles. Compare parsed workbook effects separately from XML byte
   canonicalization and native GLib process/timestamp diagnostics.
5. Before repair, reproduce a failing original in-memory regression. Unit tests
   use memfs for virtual file effects and injected bytes/cancellation, never
   native processes or disk writes. Verify cancellation/work limits fail rather
   than returning reference success. Independently stress/fix with another agent;
   root retains exports, integration and Git ownership.
6. Run the selected uncached maintained workspace build closure and package
   unit/lint routes, plus focused safe-bash command tests and lint. Rebuild
   declarations before export-backed integration tests. Capture and inspect
   CLI diagnostic screenshots in `out`. Record unsupported and unmeasured
   cases explicitly. Reduce evidence before removing only owned scratch.

## Measured behavior

- Official archive hash freshly matches the required hash. Native 1.12.61
   binary/dependency/exporter/locale capture is retained in the linked profile.
- `128x128tail`, `+128x +128`, and `0x128x256` scan successfully; the last is
   decimal row zero, column 128 and trailing `x256`. `128X128`, `128 x128` and
   incomplete scans silently skip resize. Parsed invalid sizes return status
   zero with unchanged dimensions and GLib critical diagnostics.
- Original disappearing arrays are deleted. Split arrays preserve dimensions
   and content, return status zero, and do not print the resize-failed warning.
   Split merges preserve dimensions/content and print
   `Resizing of sheet S failed`, also with status zero.
- Removed cross-sheet cells become bare `#REF!`. Crossing ranges shorten.
   Object anchors wholly in the deleted zone disappear; a crossing
   `A120:B200` object survives unchanged. Uniform retained style regions clip.
   Local `Print_Area` referring to `S!$A$1:$IV$256` becomes
   `S!$A$1:$DX$128` when resized to 128 by 128.
- With print defaults loaded by a Margins element, native repeat ranges
  `A120:A200` and `D1:IV1` survive shrink unchanged. A minimal PrintInformation
  without defaults loaded is overwritten by native defaults; that import
  difference is outside the measured resize transformation.
- Columns are deleted before rows. An array crossing columns 126..129 at
  rows 199..200 blocks resize to 128 by 128; swapping axes removes the array
  during column deletion and succeeds. Named-expression base positions in
  removed rows remain unchanged.
- First failing regression preceded implementation: invalid dimensions threw
   `Invalid sheet size`; arrays wholly in disappearing rows threw unsupported
   formula-group failure. Both are repaired. Independent review additionally
   reproduced qualifier retention and stale dependency-cache failures.

## Remaining compatibility limits

- Exact native GLib diagnostics include process IDs, wall-clock timestamps,
   NULL command-context assertions and unref assertions. Product diagnostics
   retain stable invalid-size assertion text and the resize-failed warning;
   these are not exact native stderr bytes. Invalid-size `err` is uninitialized
   in the release and is not claimed portable across dependency/compiler profiles.
- Native XML serialization canonicalizes function spelling and sheet quoting;
   the existing expression rewriter preserves other source text and quotes
   rewritten surviving qualifiers. Semantic relocation is measured; universal
   XML byte equality is not claimed. Native dependency-bucket shrink can emit
   `Hash table size: N`, which is not currently reproduced by the sparse model.
- Overflowing scanf integer conversion is undefined C behavior and explicitly
   unsupported rather than certified as a successful ignored resize.
- Native most-common-style ties depend on hash traversal. Tie behavior is
   unqualified. Conditional-format expression relocation, solver/filter/scenario
   relocation, selection/frozen-pane/viewport changes, all object anchor modes,
   foreign-format preserved style records, print page-break adjustment and
   other repeat-range serialization remain unmeasured unless recorded separately.
   These are not passes, nor is a passing package test universal Gnumeric parity.

## Verification

Fresh final verification after independent fixes:

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`:
  passed the declared three-build dependency closure.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`:
  passed the declared 18-build dependency closure. Subsequent ssconvert-only
  fixes were freshly rebuilt before final export-backed integration checks.
- `npm run lint --workspace=@poe-code/ssconvert`: passed source ESLint,
  source TypeScript and test TypeScript with no cache enabled.
- `npm test --workspace=@poe-code/ssconvert`: 241 files, 5,356 tests passed.
  This maintained package route directly runs uncached Vitest over the package.
- Focused maintained Node test files executed with
  `node --import tsx --test packages/safe-bash/tests/commands/ssconvert.test.ts`:
  58 tests passed. New memfs resize case compares command/SDK bytes, diagnostics,
  statuses, hidden-sheet data loss, split-merge continuation and replay effects.
- From safe-bash, `npm exec -- eslint tests/commands/ssconvert.test.ts`: passed.
- Original resize regression/guidance/parser/independent-review/codec-wrapper
  focused set: 32 tests passed. Independent reviewer recorded separate native
  observations and repairs in `ssconvert-resize-independent-qa.md`.
- `npm run screenshot -- --output out/ssconvert-resize/visual.png node
  out/ssconvert-resize/visual.mjs`: captured and inspected actual virtual resize
  success, invalid-size warning/status zero and silent malformed-scan behavior.
  `npm run screenshot-poe-code -- --help --output
  out/ssconvert-resize/poe-help.png`: captured and inspected, including its fresh
  normal repository build/bootstrap. Screenshot scratch removed after inspection.
- `git diff --check`: passed for tracked changes; source/test lint covers edited
  ssconvert files, which reside in a pre-existing untracked package tree.

Earlier failures were retained as regression evidence and repaired. A broad
safe-bash discovery run was intentionally interrupted before results because its
environment selector did not narrow discovery; it is not a passing full-package
test. Full safe-bash tests, full root tests/lint, packed-consumer release gates
and native parity outside the measured cases were not qualified by this task.
No local commit, remote delivery, push, publication or release was performed.

Native channel/status captures and original fixtures are retained in
`docs/ssconvert/resize-native-observations.json`, with the separate profile in
`docs/ssconvert/resize-reference-profile.json`. The inspected source files were
compared byte-for-byte to members of the authenticated official archive.
Only the root-owned resize scratch was purged; existing oracle/source scratch
and all unrelated edits were preserved.
