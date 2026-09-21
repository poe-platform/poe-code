# Clipboard candidate QA procedure

Use the released Gnumeric 1.12.61 primary source only under `out`. Verify
`out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Native execution is a separate QA oracle, never a product dependency.
Preserve all existing edits; do not edit READMEs, push, or publish.

1. Capture the isolated Docker oracle's binary, dependencies, plugins, locale
   and environment. Use the recorded memory GSettings profile, no DISPLAY,
   explicit prefix library/schema/data paths and invocation-owned HOME/XDG paths.
2. Execute the full hidden atom whitelist and unknown/case/parameter variants on
   original small CSV; capture bytes, status and diagnostics. Compare real SDK
   engine output using injected byte streams. Keep dynamic GLib prefixes distinct
   from deterministic diagnostics.
3. Execute original merged XML with partial overlap, negative translated origin,
   disjoint selection and HTML table paste. Add failing memfs regressions before
   repairs. Exercise SDK and virtual-command namespace and cancellation controls.
4. Have a separate agent stress/fix implementation, with root retaining export,
   integration and Git ownership. Review minimized cases and repairs.
5. Run uncached maintained ssconvert workspace build/test and workspace lint;
   run safe-bash command-family tests and maintained build/typecheck where needed.
   Record every failed or incomplete gate separately from focused verification.
6. Capture and inspect an actual virtual-command CLI screenshot. Fingerprint the
   final candidate files after repairs; rerun affected gates on those bytes.
7. Transcribe verified results and remaining mismatches here, then remove only
   invocation-owned temporary evidence. Retain primary source and unrelated out
   files. Unsupported/unmeasured cells are not passes.

## Executed candidate and reference

Base HEAD: `b97c4938a469ee70e09bd08a0e5fcf7e868ca04c`; this is an edited,
uncommitted candidate, not a delivery revision. The SHA-256 of a sorted manifest
covering 532 ssconvert source/test files and relevant integration/manifests is
`bb883af19dc89dbfeac5fd59a20acdf22e1b5f62abe93089b4d85a0b6467846f`.
No source edits followed its capture. Existing edits were preserved.

The source archive matched the required hash. Reference binary SHA-256 remained
`104f1e5500432c95ac3d46a679d476d05d2bf84e7483e991d212703cb0ed131c`.
Fresh profile capture SHA-256:
`f811c16f0ac8eea0ed59d8e4526c9d4a874eea9b15b95b8bdea2b55c30880aa8`.
It recorded successful version, Debian package, linked-library, all 47 installed
plugin-manifest and locale queries. It used the earlier explicit memory GSettings
environment with invocation-owned `ssconvert-clipboard-current` HOME/XDG paths,
LC_ALL/LANG=C and TZ=UTC, without DISPLAY. See the durable dependency/manifest
transcription in `ssconvert-clipboard-export-qa.md`; installed plugin manifests
do not establish every service's activation. A supplemental prior-profile
comparison initially used the wrong JSON key (`dependencies` instead of
`packages`); after correction, the fresh package query succeeded and matched
the durable prior package inventory exactly. Product runtime: macOS arm64,
Node 22.22.2; native oracle: isolated Linux arm64. Other runtime/locale cells are
unverified. A direct compiled ESM engine/command invocation also passed.

## Passes

- Final maintained uncached safe-bash build closure: all 18 declared builds,
  including ssconvert and native npm postbuild stages, completed successfully.
- Final `npm run test --workspace=@poe-code/ssconvert -- --no-cache`: 275 files,
  5,757 tests passed, none skipped. Earlier runs preceded independent repairs
  and are supplemental only.
- Final `npm run lint --workspace=@poe-code/ssconvert`: ESLint and source/test
  TypeScript checks passed. Integration test ESLint also passed.
- Postbuild virtual-command family run: 91 tests passed, zero failures,
  cancellations or skips. The new partial-merge fixture passes original,
  checkpoint and replay execution and preserves input/sentinel/namespace on an
  unsupported MIME failure. SDK/CLI, cancellation, budgets, focus, encoding,
  ignored ordinary flags and error ordering are covered by maintained tests.
- Independent stress: 50 focused semantic tests passed after three concrete
  red-before-green repairs; see `ssconvert-clipboard-current-stress.md`.
- Fresh native differential census: 26 accepted atoms and six unknown/case/
  parameter/empty negative controls. All 32 exit statuses match; 21 accepted
  no-object payloads match exactly. All six rejected controls match diagnostics
  and publish nothing. Four native generic text targets intentionally emit zero
  bytes because the hidden released test leaves the GTK selection target unset.
  There is no accepted RTF target. No desktop clipboard or GUI display is needed.
- Six independent merge XML/HTML differential cases match full bytes: partial
  overlap (957/1081), negative translated origin (874/986), disjoint (792/986).
  Native range XML preserves negative column notation `[C-1]` and row `0`;
  table paste drops merges with negative translated corners.
- Actual virtual-command screenshot generated with `npm run screenshot` and
  inspected: native XML, empty UTF8_STRING and rejected RTF are readable, with
  correct statuses. This is manual visual evidence, not a screenshot unit test.

## Failures and remaining compatibility limits

- Five accepted BIFF aliases all return successful native/product status but
  differ in payload bytes: native 4,608; product shared writer 5,632. These are
  five differential failures, not byte passes.
- Seven no-object graph/image cases preserve output/status and stable assertions
  but do not reproduce native GLib process/time diagnostic prefixes. Exact
  stderr matches for the other 25 census cases; dynamic diagnostics are separate.
- Nonempty general graph images, complex graph object XML and component exports
  remain unsupported or unmeasured; these are accepted native targets, so their
  product unsupported status is a compatibility gap. JPEG fidelity, arbitrary
  malformed image codecs and all source-image transcodings are not established.
- Arbitrary relative conditional/validation/style expressions, rich-text and
  hyperlink variants, overlapping style mosaics, explicit shared-expression
  groups, axis defaults/outlines and plugin-dependent saver failures remain
  unqualified. Existing measured simple-style/formula/array/object cases do not
  establish universal fidelity. See both independent QA documents for details.
- Maintained safe-bash typecheck failed its precompilation public export guard:
  root SafeFS export is absent, expected `./packages/safe-js/dist/safe-fs.js`.
  Investigation confirms this is a root API identity check, not a clipboard
  compiler result. The check reported cleanup complete and zero builds/runtime
  cells. No unrelated public API change was made to bypass it; it remains failed.

## Skips and incomplete runs

No final selected test run was incomplete and no selected test was skipped.
Repository-wide npm test/lint/build were not run: source behavior changes are
confined to ssconvert clipboard serialization, with the maintained downstream
build closure and focused actual virtual-command integration checks covering
safe-bash. Workflow checks were not applicable. Other host/realm/runtime/locale
matrix cells, arbitrary hostile JavaScript and noncooperative host cancellation
are unverified. No performance qualification or generated-fuzz coverage is
claimed. Native write-close failures beyond the measured opener errors remain
unmeasured. Full compatibility and the failed public typecheck gate are incomplete.

Temporary invocation evidence was inspected and purged after transcription;
primary source and unrelated out files were retained. No README edits, commits,
pushes or publication were performed.
