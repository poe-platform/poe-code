# Mapfile callback eval argument ownership — September 10, 2026

## Validated regression

The unchanged mapfile suite reproduces 16 failures out of 38 tests in
`/tmp/issue683-mapfile-red-v1.log`. Mapfile builds three synthetic eval arguments
but spreads the original context, retaining the original `argumentValues`
carrier. Raw-aware eval correctly rejects this mismatched argument identity.
The root separately preserves a native raw-byte callback and consumer red.

## Narrow fix

Construct a fresh carrier with `createCommandArguments` for callback source,
decimal index, and the existing shell-quoted record. Publish both its `args` and
`argumentValues` together. Charge carrier allocation to the existing callback
value scope, after the existing expansion-byte check, and keep that scope open
through awaited eval and closed in the existing finally path. Do not weaken
carrier identity validation or change raw eval, quoting, parser, or getopt.

Only two evalBuiltin callers exist: ordinary eval receives its original matched
command context; mapfile is the sole synthetic caller. No other caller changes
are needed.

## TDD and validation

- Preserve the unchanged 38-test baseline red and all existing assertions.
- Add memory-only tests for both builtin names, raw distinct bytes, quotes and
  empty records, yielding callbacks, cancellation reasons, and callback reuse.
- Run new tests red before the runtime edit, then mapfile and unchanged raw,
  getopt, and xargs focused suites green; run focused types.
- Root owns consumer canaries, literal discovery, builds, Git, and broad gates.
- Freeze changed paths with SHA256 receipts and report exact test counts.

The independent iconv scratch report remains preserved and paused; this work
does not change its snapshot or qualify later iconv fixes.

## Results

- Unchanged mapfile: 22 pass / 16 fail before the fix; all 38 pass afterward.
- New callback regressions: 0 pass / 10 fail before the fix, recorded in
  `/tmp/issue683-mapfile-new-red-v2.log`. The earlier sandbox run reported only
  one file-level failure and is not an individual-case count.
- Initial post-fix run: 42 pass / 6 fail, preserved in
  `/tmp/issue683-mapfile-green-v1.log`. Those six failures were an invalid test
  assumption that a function defined in one `exec` persists into the next.
  The reuse fixture now defines its callback in each execution; no production
  change was made for those failures, and raw-byte assertions remain unchanged.
- Final focused mapfile/raw/getopt/xargs cohort: 688 pass, zero failures/skips,
  `/tmp/issue683-mapfile-focused-green-v1.log`.
- Focused strict TypeScript check of both mapfile test files and their imported
  source closure: exit 0, `/tmp/issue683-mapfile-types-v1.log`.
- This is source-level focused qualification, not a full build, packed consumer,
  release, or whole-native-parity result.
