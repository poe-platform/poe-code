# Current independent split/template review

The root requested a different-agent review after implementing native template
expansion and changing `splitOutput` to use `conversionUri`. The reviewer owns
only `split-current-review.test.ts` and this Markdown procedure/evidence. Root
retains product, integration and Git ownership. No README was changed.

## Procedure

1. Read root instructions, `packages/safe-bash/AGENTS.md`, current split/output
   code, public resource I/O and prior independent evidence.
2. Inspect authenticated Gnumeric 1.12.61 `resolve_template` and `do_split_save`
   plus goffice `go_shell_arg_to_uri`, held under `out/ssconvert-lifecycle`.
   Gnumeric source archive SHA-256 is
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
3. Run `npx vitest run packages/ssconvert/src/conversion/split-current-review.test.ts`.
   The fixture is an original two-sheet workbook, uses injected public byte I/O
   and memfs, and never spawns native utilities, queries LLMs or writes fixture
   files to disk.
4. Preserve failing cases before any root repair. Repeat the unchanged cases
   after repair, then run maintained package lint and root-selected gates.

## Validated failure before repair

The 12-case reviewed suite passed 10 and failed 2. Both failures erase an existing
public I/O refusal: `file://user@localhost/result-%n` and
`file://localhost:42/result-%n` become `file:///result-0` and `file:///result-1`
and publish both files. The negative controls prove public resource I/O rejects
the identical expanded URI before conversion with error code `io`. Thus this
is a concrete new namespace effect, independent of guessed native malformed-URI
behavior. Root was notified to preserve the malformed-authority refusal during
canonicalization; no product repair is owned by this reviewer.

An initial exploratory foreign-host refusal assertion failed its negative
control: existing public I/O maps `file://remote.invalid/path` to the injected
local VFS path. The assertion was removed as an invalid premise after inspecting
the maintained foreign-host policy. This is not a product regression and is not
counted as a pass or a repaired defect.

## Verified deterministic coverage

- URI encoded slash `%2F`, NUL `%00` and malformed escape `%ZZ` are refused after
  template expansion, with no writes or added file effects; direct public I/O
  negative controls independently require the same refusal.
- Explicit file URI percent escaping expands once: `%%20` and `%%25` become URI
  escapes and publish actual space and percent filename bytes. Caller workbook
  remains unchanged.
- CLI `-S -T review` runs the shared public SDK engine; a directory at the second
  destination causes status 1, retains the first saved file, preserves the
  directory and creates no later file.
- Templates without percent append `.0` after the complete extension; trailing
  percent drops; absent object name contributes empty text; Unicode and slash
  sheet names retain their filename meaning; inserted sheet percent text does
  not recursively expand; local-path `%%2F` remains a literal percent filename,
  unlike `%2F` within an explicit URI.

## Limits

Native ssconvert and its runtime dependency/plugin/locale cells are unavailable
to this review; source inspection plus deterministic public API checks do not
establish those runtime cells. Malformed-authority refusal is an existing
capability bound whose native outcome remains unmeasured, and must be reported
as such. No native executable is a product dependency or fallback.

This review does not qualify graph rendering order/raster bytes, cross-realm
objects, host adapters, real provider containment, checkpoint/replay execution,
CLI screenshots or performance. Cancellation and output budgets are exercised
by the preserved earlier independent review suite, not newly measured here.
The reviewer has not run a broad gate or claimed a focused rerun as one.

## Execution record

- Initial exploratory 10-case run: 7 passes, 2 genuine regressions, 1 invalid
  foreign-host negative-control premise.
- Corrected pre-repair 12-case run: 10 passes, 2 failures, 26 ms aggregate test
  execution. Both regressions remain red with the original candidate.
- Root repaired only split expansion's malformed file authority handling, keeping
  authorities containing `@` or `:` intact for public I/O refusal. Foreign-host
  policy remains unchanged. The unchanged regression now passes.
- Post-repair focused command includes current, prior independent and original
  split tests: 3/3 files and 30/30 cases pass, including all 12 new cases (22 ms
  new suite; 60 ms aggregate reported test execution).
- `npx eslint packages/ssconvert/src/conversion/split-current-review.test.ts`:
  exit 0. Maintained build/package test/type/lint gates remain root-owned.
- Exact reviewed live-file SHA-256 after the passing rerun:
  `split.ts` = `fc377cbe0517a0d7dff9b61af99867237556e0ef9e314b64782cf4293ede4d2a`;
  `split-current-review.test.ts` =
  `faaff881a44f78092123d0e33a2cabc4187f3508f7a9331608b05e9554232200`.
  These identify reviewed dirty-worktree bytes, not a committed revision.
