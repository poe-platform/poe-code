# Preparation HARD_STOP: absolute expiry

The single DATA helper stopped at prepare.mjs:12 with AssertionError:
`absolute expiry STOP`. The required fresh issuedAt+1200000ms would exceed
2026-08-29T18:15:00.000Z. Thus a compliant fresh binding required the helper's
issued sample at or before17:55:00.000Z; the guard rejected this preparation.
The exact helper wall/monotonic samples were not persisted before the assertion,
so no exact issuedAt or outerStarted is invented. PUBLICATION-UTC.txt records
the separate later publication clock, not a replacement binding clock.

The guard ran before profile reads, authentication, draft generation, controls
or binding writes. All5 proposed controls are UNRUN, not passed. No new cell,
profile, operational owner, grant or command was generated/sealed. The committed
prepare.mjs is a failed preparation draft, not an approved executable packet.
Its later normalization/profile/authentication assertions were not reached.

No product import/evaluation, package resolution child, npm install, coordinator,
case process or Worker was launched. All24 prospective cells remain UNRUN in
this new cohort. There is no actual public-import-target qualification. The
conditional actual GO was not eligible after this HARD_STOP; it is consumed,
with no automatic retry, shorter span, origin reset or deadline extension.

Historical5c29ace33 remains0 PASS/1 opaque R01 nonpass/23 UNRUN, public entry
UNKNOWN. No thrown cause is retroactively attributed. That result and all
earlier8317555c/f28462050/DATA-size failures and broader/private holds remain
unchanged. No engine defect or full-compatibility conclusion follows here.

Raw preparation.stderr precedes this metadata; preparation.stdout is empty.
Publication includes the failed source draft, both raw captures, explicit STOP
receipt, publication clock and finite size/hash manifests. No runtime root,
cache, old raw file or production source was changed by this preparation.

Named preparation/publication roles: five command shells, three search/read
tools (two rg, one sed), two apply_patch, one Node DATA helper, one date, one wc,
one shasum and two Git =16/16. Known local peak<=3. Zero actual runtime roles.
Capture/work is limited to this small owned evidence packet; no OS quota,
native peak, or whole-filesystem census claim. Git physical storage excluded.
