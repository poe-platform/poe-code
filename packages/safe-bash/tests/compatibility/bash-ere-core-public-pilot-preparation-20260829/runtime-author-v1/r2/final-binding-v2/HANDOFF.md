# Fresh final binding — READY PENDING ROOT FINAL GO

No runtime was launched and no consumed activation path was created. The old
invalid35-minute binding in commit9a0e025ca remains unchanged and never issued.
This is a new pending byte candidate, not an issued ROOT grant.

## Exact window and bytes

- issuedAt: **2026-08-29T17:21:59.169Z** (actual helper wall-clock capture).
- latestStart: **2026-08-29T17:26:59.169Z** (issued+300000 ms).
- expiresAt: **2026-08-29T17:41:59.169Z** (issued+1200000 ms exactly).
- Expiry is before ROOT's absolute17:50 UTC limit.
- `PENDING-GRANT.json`: **667 bytes**, SHA256
  `1bef3edb200f9a67c7c27260d33ff850e0d1f85fff0f80022cda2636c6ac3adf`.
- `RESOLVED-COMMAND.txt`: **995 bytes**, SHA256
  `47a843889d997ee006b3f66c03015eb88bc477cee98ad1accb1d47e36851e721`.

The grant retains the exact18 existing fields/types. Its prospective authorized
value is true, but only future explicit ROOT promotion may create the command's
`ROOT-GRANT.json`. That consumed path is still absent. `RESOLVED-LAUNCH.json`
also records exact executable/argv/cwd/environment and proposed capture paths.
The995-byte command template changed only grant path/hash and monotonic argument.

Profile: `bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05`.
Source: `0f8684d8eea2042cef6ab194ad2f9be165b31698`.
SOURCE/PURE: `f17d8dec11190ef40ecac6c175b208a2e29c7fbf`.
Producer DATA: `5c2ef0795ca402344b5b0d28869b64db46d73b86`.
Pilot review: `fc188075658ef573da605bf11055460ca0b85112`.
Pilot receipt: `f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b`.

## Existing predicate, shrinking runtime

The reviewed validator limits issued-to-expiry to1200000 ms and requires wall time
inside the start window. It does **not** require a fresh full1200 seconds after
every delayed start. The runtime clock remains `started + 1200000`; case admission
requires case + cleanup +180000 publication to fit, otherwise remaining cells
are UNRUN. No validator or other harness code changed.

Fresh **outerStarted=267531292**, sampled from
`Number(process.hrtime.bigint() / 1000000n)`, not performance.now or wall time.
At **17:22:00.267 UTC**, monotonic267532390, preparation had consumed1098 ms:
**1198902 ms remained**, including180000 publication; setup/case allowance after
that reservation was1018902 ms. These are timestamped samples, not remaining-time
claims at later publication. **Do not reset/extend the origin on actual GO.**
Binding/review/publication delay consumes this same20-minute runtime budget.

## Reauthentication and ownership

One DATA helper checked5378 file bindings, including2028 regular tool pins,
8 runtime assets, complete1305/1002/1002 existing product-file sets and24 inherited
cells, followed by profile/review/source postguards. All76 prospective activation
root/grant/config/output slots were checked absent before and after binding.
No archive decode, product import, Worker, compiler, npm/install or runtime child.

Observed helperPID94487, parentPID79787; shell declaredPID94487 (exec replacement).
Distinct regular FD1/FD2 captures were established by the shell before helper
startup; inode/device observations are in `BINDING-RECEIPT.json`. These are DATA
prep identities, not invented future coordinator PIDs. Future owner/coordinator
PIDs remain unset because neither is launched by this packet.

ROOT's accepted trusted-startup reservation/postcheck, sampled/quiescent dev-npm
work and Git physical-storage exceptions remain unchanged. Managed capture
prewrite limits remain56 MiB inner plus8 MiB outer/admin within64 MiB. Native
ownership requires independent exit/close/both EOF; UNKNOWN stays owned and
process close does not prove Worker retirement. Regular npm pins do not become
an append-proof tool-directory/symlink guarantee. Actual final GO still requires
ROOT's qualified outer owner, exact command and counted publication/admin roles.

The40-role/peak4/24-Worker-one-live and256 MiB sampled-work proposal is unchanged:
conditional254938146 bytes, headroom13497310. All24 ordinary cells remain UNRUN;
no fault/private/full-CORE acceptance transfers.

Current4-minute binding grant: one DATA helper,14 known-role allowance including
publication, known peak<=3,16 MiB capture/64 MiB work. Finite planned count:
five command shells + five Git commands + two apply_patch + one Node helper =13,
plus one outer-owner allowance =14/14. Polling the existing helper added no OS
launch. Current publication/admin capture reserves1 MiB. Only this new subtree
is committed; the old invalid grant and all prior evidence remain untouched.
