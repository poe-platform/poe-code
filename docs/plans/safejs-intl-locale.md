# Intl.Locale implementation work

Intl namespace methods are delivered as 99b55d90d. Locale construction is still
missing at the start of this work. The initial 23-case Locale suite produced 19 failures and four coincident
TypeError controls; those four passes do not demonstrate any Locale support.
The implementation is now local and undergoing verification; it is not delivered yet.

## Compatibility evidence

Native probes on Node 18.18.0 and 24.14.0 show different prototype surfaces:
18 has legacy information getters; 24 also has getCalendars/getCollations/
getHourCycles/getNumberingSystems/getTimeZones/getTextInfo/getWeekInfo. Node 18
ignores the firstDayOfWeek constructor option; Node 24 stores its canonical fw
extension. Both understand an already-encoded en-US-u-fw-mon tag for week data.

The current [Locale constructor algorithm](https://402.ecma-international.org/#sec-Intl.Locale)
is the source of truth where older native implementations differ. Node 22 reads
collation after a malformed calendar option; the current algorithm rejects the
calendar first. The explicit regression uses the current ordering instead of
blindly copying that older native behavior.

[Current getWeekInfo](https://402.ecma-international.org/#sec-Intl.Locale.prototype.getWeekInfo)
returns firstDay and weekend, not the older minimalDays field present in Node 18
and 22 getters. The modern method's expected value projects those two fields
from native locale data. Do not expose native version-dependent output shapes.
The current spec also includes a variants accessor absent in both probed Node
versions; read its algorithm and add explicit standards-based coverage.

## Implementation

- Private WeakMap brand retains a native locale constructed only from converted
  primitive tags. Native objects never enter guest values. Snapshot state stores
  the canonical tag, not native objects; memory accounting includes that string.
- Constructor reads the derived prototype before tag coercion, boxes non-null
  primitive options, and validates each option before reading later options.
- Language/script/region validation uses native ICU with one primitive option;
  variants and Unicode extensions are parsed explicitly without regexes.
- Shared canonicalizeGuestLocales recognizes the private brand and bypasses
  guest toString overrides for existing Locale instances.
- Prototype methods/getters cover current standard semantics; old native
  information getters supply data where modern methods are unavailable.
- New guest-locale heap nodes preserve descriptors, aliases and custom prototypes.
  Validation rejects malformed and noncanonical serialized tags.
- Constructor/method identities are registered below Intl, before tracking their
  mutable state. Legacy checkpoint expectations enumerate the added constructor;
  historical captures and graph/hash assertions remain unchanged.

## Verification in progress

- Expanded missing-API baseline: 26 failures / four coincident passes (31247).
- Constructor/prototype implementation: 29 passes, one private-state restore
  failure (90937); dedicated heap support fixed that failure.
- Additional TDD found and fixed inherited host-property lookup for the valid
  firstDayOfWeek string "toString", and a writable constructor prototype.
- Latest focused run 11079: 121 passes / one existing skip across Locale, Intl
  namespace and both legacy checkpoint suites. This includes private-state data
  accounting, public pending/completed replay, repeated low-level restoration,
  forged receivers, malformed serialized tags and derived prototype ordering.
- Typecheck 90446 passed before the intrinsic-registration-order correction;
  maintained build 48800 is checking the final runtime state.
- Broad SafeJS and downstream checks, final lint, and Node 18/24 built probes
  remain required before delivery.
- The prior namespace change published SafeJS 0.1.446 in run 34211319237;
  CLI run 34211319323 was still active at the latest check.

Build 48800 passed all 23 selected workspace builds and four native import tests.
Lint 76827 passed. Downstream 65222 passed 163 tests in 13 files (27.27 s).
Built probes on Node 18.18.0 and 24.14.0 passed firstDayOfWeek, variants, week info
and canonical locale-list brand handling. An initial shell-quoted probe was
malformed; the correctly quoted reruns, not that invocation, provide the evidence.

Full SafeJS run 56589 is active, with source/tests frozen; log:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safejs-locale.Eb4L1U6fFr`.
Only the two earlier experimental promise-import/weak-collection files are excluded.
All three camera cases passed so far (4161/3303/2705 ms).

## Validated correction pending the full-run boundary

A separate native differential probe found that constructing `und`, with no
language override, throws RangeError in the candidate. Native Node 22 and 24
Locale.language return undefined for und, so rebuilding a tag from that getter
incorrectly drops the required language subtag. Current ECMA-402
[GetLocaleLanguage](https://402.ecma-international.org/#sec-getlocalelanguage)
returns the first base-name subtag, including und. Add explicit und/und-Latn/
und-419/und-1994 tests and derive the language from the canonical tag both in
construction and the getter. Do not use the older native undefined result as
the desired language-getter oracle. No source change for this correction has
been made while run 56589 is active.

## Final local verification

Run 56589 completed successfully: 20,318 passes, 37 existing skips, 685 passing
files and one skipped file, 430.89 s. After it finished, five und regressions
failed in run 84153. Deriving construction/getter language from the canonical
first subtag fixed them. Focused gate 42092 then passed 126 tests with one
existing skip across Locale, namespace and both legacy checkpoint files.
This is a broad green run followed by a narrowly verified two-line runtime
correction, not a fresh full-suite run after that correction.

Final maintained build 82639 passed 23 builds and all four fresh import tests;
final lint 45358 passed. Thirty-six built differential cases each on Node 18.18.0
and 24.14.0 passed aliases, option combinations, extension preservation and
maximize/minimize. Their language expectation uses the current standard's
first-subtag rule, explicitly correcting the older native und getter behavior.
The previously passing 163-test downstream run covers the new API/snapshot wiring.

Prior CLI release 34211319323 failed two existing camera tests at the unchanged
5000 ms limit (37,072 other tests passed). SafeJS 0.1.446 publication remains
verified. Camera CI performance remains unresolved; do not claim release success
for that CLI run or relax timeout/fixture coverage. Locale delivery will trigger
fresh release workflows and does not wait for them before continuing other work.
