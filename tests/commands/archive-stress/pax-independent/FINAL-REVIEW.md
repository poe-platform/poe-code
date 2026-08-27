# Subsequent independent PAX / B02 disposition

This appends to, and does not replace, immutable `REPORT.md` and `runs/run-0N6uc7`.
**Main177 passes; the complete driver remains OPEN (exit1)** because its separate
no-tar control assumed the historical MemoryFS identity-omission profile. No
production or sibling expectation has been changed by this verifier.

## Fresh gate

Command from repository root:

```sh
node tests/commands/archive-stress/pax-independent/run.mjs --ready /tmp/safe-bash-pax-independent-ready-03.json
```

Run `runs/run-x0G87j`, 2026-08-27T02:34:32.195Z–02:34:51.130Z. Evidence SHA256:
`b7cbe9c7eccd5a8fd09fbfb33ae7fe9df9a0fca1f6892fcb66599fba736898d6`.
READY SHA256: `a2b8c1e23e325f04be7eda15220311606dd87269675a8b4f8457022ea6548687`.
Actual argv, environment, exact names, hashes and raw stdout/stderr are retained.

| Cohort | Pass / tests | Fail / skip / TODO / cancel |
| --- | --- | --- |
| Original author | 128/128 | 0/0/0/0 |
| Original wiring | 1/1 | 0/0/0/0 |
| Native-profile AND B02-observation-refactored stress | 30/30 | 0/0/0/0 |
| Author targeted | 12/12 | 0/0/0/0 |
| Independent | 6/6 | 0/0/0/0 |
| Unique main total | 177/177 | 0/0/0/0 |

All five stress files execute with `ARCHIVE_LONG_LINK_NATIVE=1`; exact identities
match the retained original cohorts and author12. P12 is native-only within12;
I05 mixes independent virtual/native assertions within6. Neither is added again.
Scoped types, actual global `npm run typecheck`, actual global `npm run build`
all exit0; fresh built-package checks are separately **4/4**. The typecheck
stderr contains an npm update notice, not a compiler error. No other suites run.

## Fixture review and separate failed control

Approved `limits-effects.test.ts` SHA256:
`7bedea0eddefcf40feb216fe41a600d2af429ff10813ed8a64df2e2d63329efe`.
The only assertion delta saves the original unbound method, keeps the forwarding
counter throughout execution and all count assertions, restores that reference
only for over-limit observation, and adds full-stat equality before reads.
Existing scope/dev/inode, iterator, byte, namespace and sentinel checks remain.
Positive exact-limit publication checks remain. No product assertion is lost.

The independent separate control fails at `observation-control.mjs:25`, before
tar import: current stat **retains** `identityScope`, whereas the control expects
its omission. Raw error is `runs/run-x0G87j/independent-observation-control/stderr.log`.
This is not a failed main test, a skip, or evidence of tar publication. Its later
operation/witness phases did not run in this current-profile invocation.

Current frozen MemoryFS SHA256 is
`2ece749f3f22be6a0da76dcd964feb9b1055e742a05c727c43f672e9bc7ec8b4`.
Pre-freeze commit `d82cca909ae3019e47f85a7eb57cf7f0a207220a` removes method-reference
eligibility from MemoryFS's intact-store check. This independently explains the
different no-tar observation; it is not a PAX delta or during-run source drift.
No broader FS review or claim follows.

To verify the actual historical diagnosis, the identical independent assertion
code was separately relocated to the already sealed historical snapshot, without
changing assertions or that snapshot. Pinned MemoryFS SHA256:
`57a6148aec90c7a1db058e59bd2586e7c162c74498309e7173443096cb8906ad`.
All1,629 old input hashes match before/after. This diagnostic exits0: no tar
imported before the scope-omission observation; original-reference restoration
returns identical fullstat and scope reference with zero publications; over-limit
tar reads one header, closes once, publishes zero times, preserves fullstat,
bytes and namespaces; a separate valid archive invokes the retained forwarding
counter exactly once and publishes exact bytes. Thus restoration does not mask
publications. These are historical-profile diagnostics, not extra main tests or
a replacement for the failed current-profile control. Raw result, exact command,
script/result hashes and final historical audit are retained in `final-audit.json`.

## Frozen closure and immutable history

Snapshot `/tmp/safe-bash-pax-independent-SC2fLX/tree`, sealed HEAD
`1b0cbb96bebadb915809014207999799f4e9aa0c`, includes current dirty inputs:
1,741 regular files / 69,721,445 copied bytes. Complete actual compiler lists
match live/frozen before/after: **966 = 130 src + 663 tests + 6 other project +
167 dependency/type inputs**. List SHA256:
`6cde54485064ac20c093593562a881e9b12178497d1af845212980bbe27a8f03`.
Selected-input SHA256:
`f3d5a0b6ca78034cffdfce2df12217505183cd796493839796860042aed5aab3`.
Frozen before/after SHA256:
`db8633b8fd444d63aa2df1342a8ed90f34d23dbdefc980f349280c4e841ab9af`.
Root locked deps are regular verified copies once; only required historical
artifacts/exact GNU binary are included. Per-path output exclusions/rationale,
regular bin shims and offline dependency verification limits remain recorded.
No recursive historical snapshots, live import aliases or partial global tree.

Selected live inputs remain equal during the gate. The later final audit records
21 subsequently changed inputs and HEAD `d506d040024bf6d47e6dd0946a2a183f8e18bb70`;
these are not newly validated. Frozen success is not a clean/current-HEAD claim.
Author167 manifest remains `269d72a73614985f1f16257fa1951dd6eeb4d474230724be13db9c608780b06f`;
all167 entries, historical90 files and prior88 checkpoint files reverify unchanged.
Original raw158/159, raw29/30, prior176/177 and earlier failures remain immutable.
Old REPORT SHA256 remains `aad80f8f9e48068b29b64877521c7608c3b2e4eda3116db7a60358690bde811a`.
Owned runner cleanup has no errors; diagnostic child exits normally and creates
no native filesystem fixture. Snapshots/logs are intentionally retained.

## PAX and native disposition

Archive format remains `4e3c6fe95a6b967cf45bfd7b6903fd2e8b568233de33182e2e5af4424b79cfe0`;
archive README remains `ec814681a5fc5c5a341b4a7fb15cb8afe460378df9a905c849254fe73cf92ef1`;
native fixture remains `8637e372c0955286bbec9fc1aa9b9465740e212fdbdabb4e31cb272154a10431`.
The narrow opaque allowlist still follows strict framing/key checks; unknown
essential/sparse/layout metadata stays rejected. N-in's native mtime assertion
is retained in P12 with direct product expectations separately asserted; no
blanket ignore, Apple-only patch, or product `._` filtering is accepted.

Fresh I05 again gives exact local1700123401123456789ns on both natives, but
following GNU1700123400000000000ns versus BSD1700123456000000000ns. This fixed 56-second
global-semantics conflict remains separate from product acceptance, not tolerance
or clock calibration. Exact argv/environment/native binary hashes remain in
the raw I05 diagnostics; default BSD lists only `literal`, GNU lists `._literal`
and `literal`. Product checks preserve ordinary sidecars. H01–H03/I06 again pass
actual shared-write hardlinks and explicit unsupported rejection without copying.

**Disposition:** substantive evidence supports the narrow PAX fix and, separately,
the intentional B02 observation-fixture integration. An unconditional all-gate
ready-to-commit recommendation remains blocked by the verifier's obsolete
current-profile scope-omission assertion. Root must explicitly disposition that
control (historical-profile-only versus an authorized current-profile invariant);
this verifier did not silently alter its expectation. No new PAX source defect
is demonstrated. Empty-value/deletion semantics remain OPEN; no full metadata,
universal tar/native parity, remote hardlink or superiority claim. No staging or
commits performed.
