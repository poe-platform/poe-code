# PPTX deterministic comparison

## Scope and ownership

Implement the original F59 `diff` operation in `packages/pptx`, sharing its SDK
behavior with the command dispatcher. The safe-bash adapter stays under
`packages/safe-bash/src/commands/pptx`. Root only wires existing public APIs.
The engine, command integration and research/review have separate owners. No
README edits, product network, native runtime, implicit host I/O or full pipeline
execution. Commit named owned files only on main after maintained checks; do not
push or release.

## Acceptance and TDD

Start with original small in-memory package cases and independent literal
expectations. Exercise ordered slide, text, property, geometry, media and
relationship differences; stable slide/object identity; reorder versus
replacement; identical media under different part names; opaque unsupported
changes; bounded results; invalid options and cancellation. Formatting mode must
be explicit. Raw package bytes and effective formatting are separate comparison
domains; the latter is explicitly rejected in this bounded implementation. No
rendering claim is made. A successful comparison
returns equality as data. CLI exits are 0 equal, 1 different, 2 comparison trouble
and 130 cancelled, with `ok: true` for a successful difference.

## Verification procedure

1. Run focused original engine and dispatcher cases with the maintained package
   unit command. Confirm the new cases fail before implementation and pass after.
2. Run the pptx package lint/type checks and the explicitly selected pptx build
   closure if build output is required by adapter checks. Run the narrow maintained
   safe-bash test/type route covering its pptx adapter.
3. Inspect schema/capabilities for the real supported modes and output contract.
   Confirm both SDK and CLI use the same comparison implementation.
4. Use only already present entries from `docs/pptx/corpus-manifest.json` as
   disposable manual QA inputs. Verify recorded SHA-256 before admission; compare
   an admitted presentation with itself in applicable modes. Missing binaries
   are unavailable cases, not passes. Do not download unit fixtures or commit
   corpus bytes. Reduce any meaningful defect into an original small regression.
5. Inspect an adhoc screenshot of the supported CLI help/comparison presentation
   when the maintained screenshot route can exercise this command. Record route
   limitations honestly; do not add screenshot tests.
6. Review the exact diff and stage only owned implementation/tests and this plan
   with relevant evidence. Report local commit hashes separately; no push/release.

## Evidence

The bounded provenance and language/security receipt is
`docs/pptx/diff-evidence.md`. Whole-public-model coverage and upstream test
adaptation are separate obligations; this original comparison extension cannot
close those by hashing parts.

Execution receipts will be recorded by the coordinating owner after validation.

## Disposable QA selection

The coordinating owner verified manifest sizes and SHA-256 for the existing
`IXPE-Presentation-Template.pptx`, `CERN-job-opp-250925.pptx` and
`WWL-template-1slide.pptx` cache entries (each under 1.3 MB). Self-compare each in
structural, raw and media modes through explicit admitted bytes; expect equality,
zero changes and no writes. This selection does not require downloads. Keep
these publisher identities and fixture references in this plan/research only.

## Independent review receipt

Review found that text-mode keyed values missed reading-order changes. The engine
owner reproduced an original failing shape-order case, added an explicit stable
`text/order` record, and reported 8/8 focused engine tests passing. A renamed-slide
case now checks unchanged slide/text/geometry observations and different raw
parts. Default structural comparison remains deliberately conservative: its raw
nonmedia fallback detects reserialization/renaming alongside semantic records.

## Final validation receipt

- Focused Vitest run: 21/21 tests pass (8 domain, 13 command), 1.49 seconds.
  An accidental Node-test invocation of the Vitest file failed runner admission;
  the corrected Vitest invocation above passed without changing tests.
- `npm run lint --workspace=pptx`: passes ESLint, source TypeScript and test
  TypeScript. An initial test tuple inference error was fixed by the command
  owner before this final pass.
- `npm run build:workspaces -- --workspace=pptx`: passes the declared three-build
  dependency closure. No full pipeline, root build or publication was run.
- Maintained safe-bash reporter, `node scripts/test-reporting.mjs --import tsx
  tests/commands/pptx/diff.test.ts`: 1/1 passes against the final built public
  exports, no skipped cases, about 0.73 seconds.
- Safe-bash focused guarded lint passes with zero messages and all 25 receipts.
  The final 5,293-byte adapter test SHA-256 is
  `ebd31885d91999e324b0fd8796d164e2795eea5029c0c239f6de697e771f7bad`;
  the guard recorded 2,009 matched opens/closes. The runner-discovery file also
  passed its focused guard, SHA-256
  `98b1a3a4bd6edd37b0fcdeefac1d81a322314a25348ff44a6cbd2f7284d68d5f`.
- All nine selected corpus self-comparisons passed: structural/raw/media for
  each of the three hash-verified entries above, equality true, zero changes.
  No downloaded bytes were changed or added to Git. No visual fidelity claim.
- The maintained generic screenshot command captured actual Shell `pptx help
  diff` using built public exports. `.cache/pptx-diff-help.png` was inspected:
  legible complete usage, modes, limits and comparison exit statuses. The first
  capture incorrectly passed Shell's string stdout to TextDecoder; the corrected
  capture uses the documented string result and exits successfully. No product
  defect or screenshot unit test resulted.
- The spec and research register DiffData schemas were parsed and compared for
  exact equality. Nonempty command results validate against executable schema.

The wider package test run is **not a pass**: 4,432 passed and three failed in
the existing uncommitted sanitization tests (ZIP fixture version expectation,
property part-URI expectation and retained-property category expectation).
Those files are outside this task's ownership and remain unchanged by this task.
The runner-discovery assertion also references an absent uncommitted
`sanitization.test.ts`; its new diff inclusion passes, but the whole discovery
test does not. No package-wide or whole-public-API acceptance is claimed.

Only diff implementation, original tests, exact wiring hunks, schema alignment
and this task's documentation are staged. Existing image/media/sanitization
changes remain outside the local commit. No push or release is authorized.
