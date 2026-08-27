# Independent time-env fix review — 2026-08-27

## Decision and source boundary

**Accept the eight original fixes, not full date/GNU parity or default integration.**
Independent re-execution of the unchanged305 assertions at75d4e0c confirms all
six formatting failures fixed by5b0cb48e49c4c62dd1aaf11ccdda2af6b119d599 and both
exact-duration failures fixed by94bb4c974b17cd01477eff1c92e41619e0ebf465.
Sleep's two defects were conservative over-waiting, not early return or undercharge.
The new packed holdout finds one pre-existing GNU-profile issue in two year-zero
ISO-week observations; it is **not** an introduced regression or an accepted gap.
Production, author fixtures, manifests, root exports and private repos were read-only.

Controlled original replay freezes d904ca986fa945df8aef6e11b4165e2c2a63f814,
overlaying only the committed time-env source at94bb4c9 and author regression
fixtures atdb369efca5cab0385e195ae7f7f0b8fa680c00a3. Only format.ts and sleep.ts
change in production. The original305 consumer/guard hashes match75d4e0c exactly.
The author replay runner is reused read-only; results are newly executed by this
reviewer, not copied from author acceptance. The added holdout/pack/import-guard
runner is independently authored here. Whole-package packed tests separately
freeze the complete d904ca9 and94bb4c9 commits, without source overlays.

| Cohort | Before | Fixed after | Interpretation |
|---|---:|---:|---|
| Original independent305 |296 pass /9 fail|304 pass /1 fail|8 fixes; Apple printenv disagreement retained|
| Unchanged author223 |223/223|223/223|Separate scoped suite|
| New author83, same assertions |11 pass /72 fail|83/83|Grouped regressions, not72 independent bugs|
| New compiled packed304 |265 pass /39 fail|291 pass /13 fail|2 existing `%g` observations;11 unsupported N comparisons remain|
| Author raw native36 groups |0 GNU /0 Apple exact|31 GNU /0 Apple exact|Five ICU zone-label disagreements retained|

No skips or TODOs were converted to passes. The mixed-profile runners deliberately
exit1 on retained differences; process capture completion exits0 independently.
Read per-command statuses and row categories, not the capture runner exit alone.
`evidence/CHECKPOINT.json` and raw capture files preserve streams, exit status,
inputs, source/dependency hashes, versions, process identities and failures.
Harness/docs whitespace checks pass. The full evidence whitespace check flags
the original failing TAP output's indented blank lines; these captured bytes are
retained rather than edited to satisfy a formatting check.

## New holdout and remaining issue

The packed required-format matrix passes24/24 groups:6840 individual directives,
15 flag/width combinations over19 directives, six instants and four zones.
It includes repeated/ordered flags, widths2/5/7/8/10/17, years0000/0099/0100/9999,
negative fractional epochs, UTC and signed sub-hour/second offsets. Ten supported
nanosecond-precision observations also pass. No native clock-setting call runs.

Two additional ISO-calendar observations remain red **both before and after**:

```text
TZ=UTC LC_ALL=C date -d '0000-01-01T12:00:00Z' '+%Y|%G|%g|%V|%07G|%_7G|%-g'
GNU9.7 Darwin: 0000|-001|01|52|-000001|     -1|1
virtual:      0000|-001|99|52|-000001|     -1|99
```

The same discrepancy occurs on0000-01-02;0099-01-01 is a passing neighbor.
Only `%g`/`%-g` differ. Current format.ts uses nonnegative modulo100; pinned
GNU's negative ISO-year branch uses the absolute remainder. The official9.7
archive's `lib/strftime.c:1997` and observed native bytes agree. This is a precise
target-profile mismatch in advertised year/ISO formatting, not a universal ISO
calendar theorem or a GNU/Linux result. Root can route a minimal `%g` profile
fix to the author; this reviewer does not change source or expected bytes.

The eleven separately measured N-format forms (`%10N`, `%17N`, and nine decorated
forms) are explicitly rejected in the existing documented subset. They remain
**0/11 native parity**, not successful support. Broader grammar, fold selection,
ICU labels and infinite/hex sleep forms remain outside parity claims.

Sleep passes240 independent seeded common-denominator rational comparisons,
seven exact cap/carry/unit boundary rows and one sparse-exponent row. The rational
oracle does not reuse the production sparse-column algorithm. The old source
fails two new exact1ms carry neighbors; fixed source passes. Huge durations use
injected timers with cancellation, never long real sleeps. All observed timer
queues and abort listeners are empty after settlement. The eight unchanged
public sleep lifecycle/isolation checks also pass; five new packed in-flight
abort checks preserve reason identity and release timers/listeners.

## Packed consumer, types and resources

Node22.22.2 / TypeScript5.9.3, Darwin arm64, ICU78.2/tzdb2025c. Native oracle is
official GNU coreutils9.7 **built on Darwin**, C locale, explicit per-case TZ;
Apple is a separate measured profile, not expected GNU/Linux behavior. Primary
manual inspected at `coreutils/coreutils` tagv9.7, `doc/coreutils.texi`; official
archive and local strftime implementation are hash-matched in the checkpoint.

Each packed freeze builds clean regular-file source copies, uses cached regular
dev-dependency copies with matching package-lock, then runs offline
`npm pack --ignore-scripts` with task-owned HOME/cache. All installed dist hashes
match the clean build; original package.json bytes are unchanged and runtime
dependencies remain empty. No service or private package is involved.

The final consumer is strict-typechecked **and emitted to JavaScript**, then run
by Node without tsx. Its import guard requires every product dist import to come
from the extracted package, rejecting repo/build-tree fallback. Three invalid
type controls yield exactly2 TS2322 and1 TS2741, not positive API support.
Both frozen builds and scoped consumer types pass. No live/global TS gate ran.

Public root `Shell`, `MemoryFileSystem`, `agentCommands` and registry APIs are
imported by package name. **Time-env is still not exported at the root or a
package subpath.** The consumer imports its actual packed internal leaf path and
registers through public `.use(timeEnvCommands())`; this is not public-leaf
import-map acceptance. An explicit negative check confirms
`virtual-bash/commands/time-env` rejects with ERR_PACKAGE_PATH_NOT_EXPORTED.
An explicit literal65-name registry set excludes date/sleep/printenv. No default
integration was made; a later root owner must wire and test public imports.

Packed workflows check date pipe/VFS effects, negative-millisecond clock output,
own `__proto__`/constructor/toString/empty/Unicode environment values with NUL
bytes, missing-variable status, optional real Date.now clock, and virtual UTC
despite host TZ=Pacific/Honolulu. Host process.env is unchanged. Public sleep
clears timers in its abort handler; this does not certify unrelated worker
cleanup, universal disposal or uncooperative host preemption.

Fixed packed SHA256:
`841faa4e09e4ffaa973b69f54d1a2f8165a04e944dddec2b4b5c051d86ff944b`.
Before packed SHA256:
`cc8a776923d429db81bb2fe2752474fe1f746abebf35483f15c37b5a9f22ade5`.
Final compiled captures:2026-08-27T08:33:23.761Z–08:33:38.699Z.
Every supervised child closed with no survivors, timeout or output overrun;
every owned source/build/dependency/temp consumer tree was removed. Captured
evidence directories contain regular logs only. No broad process cleanup ran.

## Harness history, not product fixes

All initial attempts remain archived separately:

- First packed attempt omitted the consumer's own package.json. Node/TS resolved
  a package self-reference to the outer temporary build, producing three nominal
  type errors. The strict import guard rejected it before any product assertions.
  A distinct consumer package boundary and canonical `/private/tmp` guard path
  fix the harness; the product manifest is never altered. This is evidence that
  fallback detection works, not three product typing defects.
- The first native hidden matrix combined supported directives with explicitly
  unsupported decorated/>9-width `%N`, making24 whole-format rows fail. That
 283-row attempt remains257 pass /26 fail, including the two real `%g` rows.
  The final matrix separates N into10 supported and11 unsupported comparisons,
  preserving all unsupported inputs and failures rather than rewriting native
  expected output. The new304 denominator is not called an unchanged283 pass.
- A following tsx-driven packed capture and final compiled capture agree on
 291/304. Only the latter supplies emitted-consumer proof. Historical original
 305 failures and the earlier author/reviewer fixture defects remain untouched.

## Reproduce and handoff

Use existing cached dev tools and pinned native oracle; no install is required.
Each output directory must be new. Run from repository root:

```sh
node tests/commands/time-env/fix-review/replay.mjs d904ca9 db369ef /tmp/review-time-env-before-unique
node tests/commands/time-env/fix-review/replay.mjs 94bb4c9 db369ef /tmp/review-time-env-after-unique
node tests/commands/time-env-stress/fix-review/packed.mjs /tmp/review-time-env-packed-after-unique
node tests/commands/time-env-stress/fix-review/packed.mjs /tmp/review-time-env-packed-before-unique d904ca986fa945df8aef6e11b4165e2c2a63f814
node tests/commands/time-env-stress/fix-review/seal.mjs --check
node tests/commands/time-env-stress/seal.mjs --check
```

The eight requested fixes have independent scoped acceptance. The year-zero
GNU-profile mismatch needs a separate author decision/fix and replay; existing
unsupported/profile differences and missing public exports remain explicit.
No whole-product, all-platform, full-tool or superiority acceptance follows.
