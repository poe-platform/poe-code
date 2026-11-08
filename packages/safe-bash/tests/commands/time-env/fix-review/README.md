# Time-env fixes following independent review75d4e0c

Author fix/handoff, August27,2026. **Not independent acceptance of these fixes.**
Curie's unchanged fixtures remain in `tests/commands/time-env-stress/` and were
read from commit75d4e0c, never edited. Root/default integration remains blocked
pending the different reviewer's replay. No full-product gate or parity claim.

## Frozen inputs and commits

- Base: `d904ca986fa945df8aef6e11b4165e2c2a63f814`, including its actual65-command
  default registry. The three time-env commands remain opt-in and absent there.
- Date fix: `5b0cb48`, only format.ts and new author format-regressions.test.ts.
- Sleep fix: `94bb4c9`, only sleep.ts and new author sleep-regressions.test.ts.
- Replay harness/documentation: `db369ef`; selected after-source overlay.
- The runner archives base product/package/config/old author tests, then overlays
  only committed `src/commands/time-env/` and two new author regression files.
  Moving HEAD, other authors' runtime/FS/root/default/manifest changes are excluded.
  Regular-file copies of development dependencies; no worktrees, symlinks,
  source fallback, private checkout changes, runtime dependencies or host product
  processes. Actual Shell/MemoryFileSystem holdouts import the isolated compiled
  root and leaf, not the live checkout. This is compiled-leaf, not a newly packed
  public export test: no time-env package export has been integrated by this work.

Frozen200 source-file hashsets (algorithm in evidence/SUMMARY.json):

- Before: `0ee06393ab74374e14163c2748f5acce5c6f71de6e19d70b62596f06ee56b247`.
- After: `d2ef50d79de1c5c65356fc683e4dfde7870484e7c0efd15636495349e20cd825`.

Both source/build/dependency/native hash manifests and all commands/raw output
are retained in evidence/before and evidence/after. The earlier direct original
reviewer-run replay remains in evidence/original-replay, not overwritten.
The existing read-only process supervisor is imported outside the snapshot;
runner-check.json separately verifies its bytes equal the frozen base helper.
That is a post-run helper check, not an original snapshot-manifest entry.
Old AUTHOR_HANDOFF/evidence/MANIFEST files outside this new folder are untouched;
their original seals describe their historical revisions, not these new sources.

## Results (zero skips)

| Cohort | Before | After |
| --- | --- | --- |
| Unchanged author |223/223|223/223|
| Unchanged independent |296/305;9 strict failures|304/305;1 strict failure|
| Independent GNU date |233/239|239/239|
| Independent sleep arithmetic |4/6|6/6|
| Independent public sleep lifecycle/isolation |8/8|8/8|
| New author regressions, same fixtures on both sources |11/83|83/83|
| Scoped author types / frozen complete-source build / compiled consumer types |all exit0|all exit0|
| Negative consumer types |exit2; exactly2 TS2322 +1 TS2741|same|

The83 include native parent/subtests;72 before failures are not72 distinct bugs.
Combined author total after is306/306 (223 unchanged plus83 new). Local live
scoped types and306 checks also passed, separately retained in development.
Independent runner remains exit1 after because the Apple comparison is retained;
capture-script exit0 means capture completion, **not305/305**.

Remaining original row: `Apple BSD printenv separate profile`, arguments
`EMPTY UNICODE`. Apple stdout hex `0a`; virtual/GNU stdout hex `0ae99baa0a`
(empty value then 雪), all status0/stderr empty. No printenv source change or
expected-output adjustment. This is the pre-existing separately labeled Apple
multi-operand profile difference, not another GNU-target product failure.

## Root fixes and new neighbors

Date reproductions all use `-d@1704164645.123456789`, virtual UTC/C:

| Format | Before | GNU and after (before LF) |
| --- | --- | --- |
| `%12F` | two spaces then2024-01-02 |002024-01-02|
| `%#c` |TUE JAN  2 03:04:05 2024|Tue Jan  2 03:04:05 2024|
| `%-z` |+0000|+0|
| `%_z` |+0000|three spaces then+0|
| `%_12z` |seven spaces then+0000|ten spaces then+0|
| `%^P` |AM|am|

These are directive-family rules, not six format-string cases: compound `%F`
width belongs to its year; numeric offsets pad the signed raw number while
colon-separated minutes/seconds remain two digits; case behavior is selective
and lowercase wins for `%P` and case-swapped `%p`/`%Z`. C-locale composites do not
recursively inherit case swapping. Fresh short-year input also exposed `%D`
year-padding inheritance: `%-D` for0008-01-02 must be01/02/8, not01/02/08;
the same component rule is fixed without changing opaque `%x` profile behavior.

Fresh native author matrix:54 subtests,7410 directive comparisons,19 flag/width
combinations, six zones (including positive/negative sub-hour/second offsets,
New York and Paris), year0008, leap day2024 and negative fractional epoch.
The raw separate36-row native matrix preserves complete stdout/stderr hex and
status for product, GNU and Apple on all inputs; grouped rows are not36 isolated
single directives. After: required formatting18/18 GNU row matches; explicit
zone-label profile13/18 GNU matches, with five retained ICU-vs-native naming
differences. Apple strict whole-format row matches0/36; GNU extensions are not
presented as portable BSD formatting. No Apple expectations are rewritten.

The first new-test run70/82 is retained: six genuine `%D` failures, five already
documented IANA `%Z` label differences, and one aggregate parent failure. The
final83 add a direct `%D` vector and keep IANA labels out of required formatting
assertions, **not out of the raw strict profile matrix**. Fixed-zone `%Z` and
case/width rules remain native required checks. IANA numeric offsets remain
required; ICU label differences are neither successful parity nor new scope
rejections. Existing fold/grammar/precision limitations are unchanged.

Sleep exact counterexamples:

- `0.0009999999 0.0000000001` and `0.0004999999 0.0005000001` both total1ms;
  before scheduled2ms, after schedules1ms.
- Sparse base-billion decimal columns sum exact quantities before one final
  upward millisecond rounding. Carries cross arbitrarily distant finite decimal
  positions without exponent-sized allocation; no epsilon, float sum or
  per-operand nanosecond rounding. Any positive excess beyond1ms still yields2ms.
- Added reversed order, just-above/below boundaries, mixed s/m/h/d,300 seeded
  independent common-denominator rational comparisons,18000-digit mantissas and
  exponents,4000 operand carries, MAX_SAFE_INTEGER boundary, chunking and abort
  cleanup. Huge durations are inspected with deterministic timers then aborted,
  never actually slept. Submillisecond inputs still have millisecond timer
  resolution; native wall-time jitter is not a1ms arithmetic oracle.

## Native authority and cleanup

Pinned official GNU coreutils9.7 source archive SHA256
`e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`, from the
existing metadata-stress tooling, is unchanged. Local lib/strftime.c equals the
archive member byte-for-byte. Primary implementation inspected: subformat
handling around1488, `%D`1633/year inheritance1660, signed-number padding1733,
`%F`1757, `%P`1841, `%Z`2083, numeric zone generation2189. Rules were implemented
from those semantics and measured neighbors; source was not vendored.
The GNU manual's “Padding and other flags” is additional context, not a claim
that its current online version is the pinned9.7 oracle.

Native binaries separately hashed in each manifest: GNU9.7 compiled on Darwin
versus Apple `/bin/date`, `/bin/sleep`, `/usr/bin/printenv`. Minimal C locale,
explicit per-case TZ, test-owned temp cwd; no host clock setting. Host Node22.22.2,
ICU78.2/tzdb2025c. No GNU/Linux control or platform-independent libc behavior is
claimed. Original weird standalone sleep `--` Darwin-build profile is unchanged.

Each before/after run supervised8 outer children and observed50 process/birth
identities; all closed, no survivors, no output/time-bound overrun. Both scratch
trees removed, input/dependency hashes unchanged. Public8 sleep checks retain
zero pending timers/listeners and sibling isolation. Captures are sealed here;
only exact owned temporary captures/logs are cleaned. No broad process cleanup.

## Reproduction and handoff

Run from repository root with existing pinned native tooling and dev dependencies:

```sh
node tests/commands/time-env/fix-review/replay.mjs d904ca9 db369ef /tmp/time-env-before-unique
node tests/commands/time-env/fix-review/replay.mjs db369ef db369ef /tmp/time-env-after-unique
shasum -a256 -c tests/commands/time-env/fix-review/MANIFEST.sha256
```

The runner fails if the output directory exists; snapshots are always independent
regular copies. Replay reads the reviewer consumer/guard at75d4e0c exactly.
Manifest includes the fix source, new regression/harness inputs and retained
evidence. Different-reviewer holdouts remain required. This source owner is
closed at this checkpoint; root can resume Curie. No integration approval implied.
