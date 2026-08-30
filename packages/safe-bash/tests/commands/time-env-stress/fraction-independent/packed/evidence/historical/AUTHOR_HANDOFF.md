# Fraction/ISO-year expansion author handoff — 2026-08-27

**New source requires a different verifier.** Prior independent2542cfa accepted
the original eight fixes, not this capability expansion or these author replays.

- f6406cd: bounded `%N` precision/padding/case-flag support; new v1 native fixtures.
- c7823633ee99f711f1319ace59d4cf2b7f622ecc: general GNU-profile `%g` magnitude rule.
- API, root exports, default aggregate, package metadata and dependencies unchanged.
  Root integration remains deferred; exact packed snapshot still has65 defaults.

## Semantics and authority

Read SEMANTICS.md for primary GNU9.7 source/manual and POSIX reasoning. The source
delta is limited to two branches in format.ts. `%3N`/`%6N` truncate; wider fields
right-pad without inventing clock precision. `-`, `_`, `0` and ordered combinations
work generally; numeric case flags are harmless. Width/output budgets precede
padding allocation. Explicit input nanoseconds remain exact; an integer-ms clock
has zero lower digits and is sampled once. No new dependency, grammar or clock API.

The ISO decision follows a dedicated GNU formatter branch, not a host-library
accident: `%g` represents the magnitude's last two digits for negative ISO years.
`%G` retains its sign and the ISO week/year calculation is unchanged. Thirty
native input/zone groups include year0000 boundary and year/century neighbors.
The change is a qualified chosen-GNU-profile compatibility fix, not a claim that
every calendar platform must display negative two-digit years identically.

**Bare `%-N` is explicitly qualified.** Native GNU date rewrites that exact token
using host clock resolution (six digits on this measured Darwin build), even for
explicit input. Our general no-padding rule retains available significant digits,
like GNU's ordinary formatter path (`%--N` control). We do not infer a machine
resolution for virtual timestamps. Strict bare-token profile rows remain1/12
native matches; these eleven differences are not the original eleven explicit-
width failures, which now match. No extra configuration API hides this distinction.

## Exact evidence cohorts

| Cohort | Before expansion | After expansion |
|---|---:|---:|
| Immutable original305 |304 pass /1 Apple difference|304 pass /1 Apple difference|
| Immutable original author223 |223/223|221 pass /2 legacy rejection assertions fail|
| Existing83 fix regressions |83/83|83/83|
| Immutable new independent304 |291 pass /13 fail|304/304 in **author** replay|
| New v1 native fraction groups |0/12|12/12,1548 directive comparisons|
| New v1 ISO input/zone groups |27/30|30/30|
| New frozen author feature suite |not a pre-existing cohort|54/54, then restored54/54|
| Three isolated source mutants |not product results|all3 detected:4/14/4 failed assertions|

The two old223 assertions explicitly demand rejection for `%12N` and `%-N`.
They are preserved unchanged, including old evidence. Supporting these requested
forms and keeping those two rejection assertions passing are contradictory;
there is no claimed unchanged223/223 result. New v1 positives supply expansion
expectations, not a rewrite of old native output. Root can assign the narrowly
documented retirement/versioning of those assertions separately after review.
No tests are skipped or changed to TODO. The first new22 test run had one harness
arithmetic error: an8-byte argument sequence was expected to exceed limit8.
Changing only that new test's limit to7 establishes the intended boundary; the
final22/22 and combined54/54 are recorded. It was not a product fix.

The immutable304 capture retains its old category names, including
`declared-N-format-gap-not-parity`; the eleven rows now pass their **unchanged**
native assertions because of source capability expansion. Historical291/304 and
all original raw failures remain at2542cfa, not relabeled as past successes.
Five ICU zone-label differences remain in the separate36-group native matrix.
The57-row fresh capture is43 exact GNU matches and14 nonmatches:11 qualified
bare-N clock-resolution differences plus3 native negative-calendar inputs outside
the supported input domain. Those3 refusals are not claimed native parity.
Apple raw results remain separate; mixed GNU-specific format groups are not
portable BSD expectations. GNU9.7 here is built on Darwin, not GNU/Linux proof.

## Frozen build, package and controls

The original305/223/83 replay uses the original d904ca9 source/config base with
only committed time-env source atc782363 overlaid; original assertion inputs
are unchanged. The packed replay separately freezes the entire c782363 commit,
builds, packs offline with zero runtime dependencies, and runs the unchanged
2542cfa holdout through strict types and emitted JavaScript. The adapter script
changes only pinned candidate/path constants; its provenance is captured.
All product imports must resolve into the installed packed dist tree.

Build, scoped types, strict consumer types/emission pass. Three invalid type
controls still produce exactly2 TS2322 plus1 TS2741. Public root Shell/FS APIs and
internal packed time-env registration work; **no public leaf export exists yet**.
Packed package SHA256:
`d4b92cf564a96caeac3ee88dea0afe79458a592fe462c9765aa13127257f80d5`.
Final format.ts SHA256:
`ddbabf9ac2918869ed32a641fb9e2c290ee71b9bbf07ccaab64f9fc3b29b22b0`.

Eight original public sleep lifecycle/isolation checks remain passing. Packed
VFS/pipes, byte effects, quotas, five in-flight timer-cleanup checks and host-env
isolation remain passing. Source mutants run only in a frozen regular-file temp
copy: removing N output preflight, left-padding fractions, restoring ISO modulo.
Every source mutation is restored and54/54 replayed. All supervised processes
closed, with no survivors/timeouts/output overruns; exact temp runtime trees and
native working dirs are removed. No private checkout or other worker's state is
modified. No live full-suite/current-worktree gate is inferred.

## Reproduction and independent reviewer scope

```sh
node --import tsx --test tests/commands/time-env/fraction-expansion/*.test.ts
node node_modules/typescript/bin/tsc -p tests/commands/time-env/fraction-expansion/tsconfig.json --noEmit
node tests/commands/time-env/fraction-expansion/verify.mjs /tmp/fraction-controls-unique
node tests/commands/time-env/fraction-expansion/packed-replay.mjs /tmp/fraction-packed-unique
node tests/commands/time-env/fix-review/replay.mjs c782363 db369ef /tmp/fraction-original-unique
node tests/commands/time-env/fraction-expansion/archive.mjs --check
node tests/commands/time-env-stress/fix-review/seal.mjs --check
node tests/commands/time-env-stress/seal.mjs --check
```

Suggested independent checks: all eleven old explicit-width N rows unchanged;
right-padding/last-padding-flag order; zero/leading-zero/truncation boundaries;
large width admission before allocation; actual ms-clock vs explicit-ns precision;
the bare-N qualification; year-zero `%G/%g/%V` consistency and adjacent years;
all original eight fixes/83 regressions/sleep controls. Do not rewrite old oracles,
touch root integration prematurely, or turn this author's proof into independent
acceptance. Broad GNU/date/whole-product parity remains unproved.
