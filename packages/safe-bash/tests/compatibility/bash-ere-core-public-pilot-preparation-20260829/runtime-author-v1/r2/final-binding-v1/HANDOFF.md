# Final binding preparation — BLOCKED, not an issued grant

The exact reviewed 18-field schema and requested timestamps are preserved.
**The pending candidate cannot pass the reviewed validator:**

- issuedAt: `2026-08-29T17:10:00.000Z`
- latestStart: `2026-08-29T17:25:00.000Z`
- expiresAt: `2026-08-29T17:45:00.000Z`
- Issued-to-expiry span: **2100000 ms**, versus the accepted **1200000 ms** maximum.

The exact clause in r2/core.mjs is
`assert(times[2] - times[0] <= 1200000 && wallNow < times[2]);`.
No timestamp or validator was silently changed. ROOT must revise the assigned
window, or authorize/review a validator delta, before an executable grant exists.
The independent review's prose says19 keys; its authenticated source and actual
template contain18. No nineteenth key was invented.

## Frozen byte candidates

`PENDING-GRANT.json`: **667 bytes**, SHA256
`113c7c2d8334710bc114ae5225dbd1876ae149e75e61362b5e36f26d55434256`.
Its authorized=true is prospective candidate content only, NOT ROOT issuance.
The command consumes `ROOT-GRANT.json`, which remains absent. Do not promote the
pending bytes: the assigned date span is still invalid, even after final approval.

`RESOLVED-COMMAND.txt`: **995 bytes**, SHA256
`e7ccc9891438f326b12829b2664a27612d8010d26d0f7f11211daecfe5bd0bc5`.
It is inert text; `RESOLVED-LAUNCH.json` binds exact executable, argument vector,
cwd, explicit environment and future capture paths. No command was launched.

Profile: `bacc21fb126bb6e0b5441bee560cb0bad1f7ffda01d129b996c1cdd3e6312e05`.
Source: `0f8684d8eea2042cef6ab194ad2f9be165b31698`.
SOURCE/PURE: `f17d8dec11190ef40ecac6c175b208a2e29c7fbf`.
Producer DATA: `5c2ef0795ca402344b5b0d28869b64db46d73b86`.
Pilot delta review: `fc188075658ef573da605bf11055460ca0b85112`.
Review receipt: `f5499bbffd18ef06483b26c256bd989d2124abe0fa8afb261d00aa7936becd7b`.

## Monotonic origin and ownership

The file-based helper sampled `Number(process.hrtime.bigint() / 1000000n)`:
**outerStarted=267256708**. This is not wall time or process-relative
performance.now. It precedes this helper's artifact/tool admission and any future
coordinator bootstrap; earlier source inspection is separate preparation, not
falsely claimed to be covered by that prospective runtime origin.

At **2026-08-29T17:17:25.538Z**, monotonic267257666, binding had consumed958 ms.
The candidate retained **1199042 ms**, including180000 ms publication, leaving
1019042 ms for setup/cases after that reservation. These are timestamped samples,
not a claim about remaining time at later publication/activation. Time continues
to run; ROOT must resample without resetting this origin if retaining these bytes.

Observed helper PID90963, parentPID79787; the command shell declared PID90963
(exec replacement). FD1/FD2 were distinct regular shell-opened capture files before
helper startup; inode/device details are in `BINDING-RECEIPT.json`. They are current
DATA-prep ownership observations, not invented future coordinator PIDs. Future
owner/coordinator PIDs remain unset because no activation process exists.

The inherited outer8 MiB/inner56 MiB capture split remains. Managed child/stream
capture needs prewrite enforcement and independent exit/close/EOF observation.
Trusted initial startup remains reserved/postchecked under ROOT's explicit
qualification; neither current shell redirection nor the entire bootstrap is
misrepresented as prewrite OS enforcement. UNKNOWN must retain actual ownership;
process close cannot prove Worker retirement. Count the publication verifier and
six Git roles, with the same startup/Git physical-storage exceptions.

## Admission and scope

One DATA helper reauthenticated5370 file bindings, including8 runtime assets,
2028 regular tool pins and complete1305/1002/1002 existing product-file sets.
The archive was type/size/hash admitted, never decoded. All24 inherited cells
were checked. The76 prospective root/grant/config/output slots remain unused;
no consumed activation path or actual capture was created. Regular npm pins do
not become an append-proof tool-directory/symlink guarantee.

The40-role/peak4/24-Worker/one-live,1200000 ms including180000 publication,
64 MiB capture and256 MiB sampled/quiescent work limits are unchanged. Conditional
work254938146 and headroom13497310 remain; sampled native work is not peak/atomic/
prewrite work proof or an OS quota, and observed excess STOP. Capture caps remain.
No full/private/fault-gate acceptance is transferred; actual24 remain UNRUN.

Current final-binding work uses one DATA helper, no product/Worker/compiler/npm/
install/native-oracle execution. The finite publication plan is15 launched roles
plus one outer-owner allowance =16/16, known peak<=3; six command shells, seven
Git commands, two apply_patch and one Node helper would count16 launched roles,
so the actual sequence instead uses six shells, six Git commands, two apply_patch
and one helper =15. Existing input storage is not new work. One MiB current
publication/admin output is reserved within16 MiB capture/64 MiB work. Only this
new binding subtree is committed, with all historical failures/STOPs unchanged.
