# Temporal transport reconciliation

## Scope

Commit the existing working-tree Temporal data-boundary integration as a distinct
layer: private-field accounting; ordinary data copying/import/export for all
eight Temporal value types; structured-clone rejection; and host-binding/result
admission through the host bridge. The host Instant clone defect was already
fixed separately in 17d7706dc. This reconciliation introduces no additional
runtime algorithm change beyond that tested working-tree implementation.

Preserve exact private fields independently of public shadowing properties,
aliases, cycles, descriptor flags, frozen state and explicitly tracked null
prototypes. Recognize host brands without invoking arbitrary getters or Proxy
traps. Host-bridge symbol properties remain rejected unless separately admitted
through a capability path; ordinary explicit data copies retain their existing
symbol policy. Do not silently make these different trust boundaries equivalent.

The selected values.ts patch excludes weak structured-clone guards and Intl
requested-options accounting. Snapshot/replay wiring, public Temporal globals,
locale implementations and other uncommitted changes remain outside this commit.
Some integration tests exercise that still-uncommitted public/replay wiring;
their working-tree passes do not prove a standalone committed release.

## Verification

The existing transport tests were inspected and rerun before reconciliation:

- Node 22.23.2: 155 tests pass with host-bridge coverage; four native Instant
  tests skip because native Temporal is unavailable (67dcac).
- Node 26.8.1: all 122 Temporal transport tests pass with no skips (0215dd).
- Private Instant/Duration/PlainTime accounting and clone-boundary selection:
  53 pass, seven native-only Instant cases skip on Node 22 (86fc03). Native
  clone cases were separately qualified in the host Instant fix.

Coverage includes all eight value types, private versus shadow fields,
non-ISO calendars, nanosecond precision, alias deduplication, cycles,
descriptor/accessor admission, forged brands and tracked null prototypes.
This is not exhaustive Temporal conformance, arbitrary native implementation
equivalence, a green full suite, or proof that locale limitations are resolved.

Scoped ESLint passed (97467b). The maintained selected-workspace build completed
all 23 declared dependency-closure builds, including SafeJS compilation and all
five fresh native-ESM import checks (3fe310). No local publication was attempted.
The previous full suite remains failing, with results in
safejs-post-weak-accounting-full-gate.md. Releases and pushes remain on hold.
