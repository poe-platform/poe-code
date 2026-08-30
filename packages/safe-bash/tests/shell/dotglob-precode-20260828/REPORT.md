# Dotglob-only shopt precode — 2026-08-28

**Delivered design/reference evidence only.** No product/runtime/parser/FS/public
API/config changes, tests, comparator reruns or implementation acceptance.
Current mixed HEAD is not a certified base. Raman LET review then Poincare stack
coordination precede a different freeze and runtime window.

## Reference and capture

Primary GNU Reference Manual edition5.3 (updated May18,2025) was checked through
GNU web search; direct page opens returned no body. Full semantics were read
from the already qualified local distribution manual, with its published hash
verified before execution. BINDINGS-v1.json records sources, exact receipt,
version, binary/manual/source hashes, source lines and inspected project hashes.
No PATH oracle selection, install, download, build or new --version call.

Qualified oracle: GNU Bash5.3.0(1)-release, aarch64-apple-darwin25.4.0;
`/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
Inherited publication: `tests/shell/let-design-20260828/BINDINGS.json`.

Protocol commit `f01b393b32cf624f6a832c591a6a84f1c5e7a407` preceded readiness
receipt and all Bash execution. Capture ran once, 08:11:03.063–08:11:03.440 UTC:
**24 calls, 72 probe observations; statuses0/1/2 =43/27/2**. All24 wrapper
processes exited0; this is marker printf status, not a pass count. Expected
errors remain errors in exact tuples. Peak combined capture3076bytes/call;
source10337bytes; 32 fixture entries including root/rowdirs, 10 content bytes.
All row-directory pre/post censuses unchanged, including new-entry detection;
all owned process groups absent after close. No retry or golden replacement.

RESULTS.json retains raw bytes/base64/censuses; EXACT-NATIVE-TUPLES.json has
exact per-probe stdout/stderr/status/poststate. DECISIONS.md compares the restricted
proposal, not native whole-option parity. Observations commit: `47b1bc5c`.

## Proposal and blocker

PROFILE.md specifies only dotglob, defaultoff; expand_aliases explicitly fails.
It defines grammar, listing bytes, repeated/order flags, status precedence and
left-to-right valid-name changes despite unknown names. Named mutation outranks
p/q; s+u conflicts; q never hides diagnostics. Native full listings are evidence,
not our supported inventory. Dotglob takes effect at command execution, including
later commands in the same read unit; row24 and primary manual support this.

**Root must resolve an actual overlap:** wildcard . and .. exclusion under fixed
Bash5.3 globskipdots conflicts with preserving current off-state `.*`/`.?` results
when custom VFS readdir supplies those entries. Approve that narrow correction
explicitly or keep implementation blocked; no silent preservation relaxation.

Future likely writes: runtime.ts internal State/cloneState/processState/glob and
builtin paths, shell.ts State initializer. Keep provider iteration/final sort,
bounds, signals, literal invoke and lifecycle sharing/cloning. No parser
prerequisite found. FUTURE-CASES.md is an inventory, not a normative freeze.

Prior alias report cc8eac10 and pinned17735 shopt-positive only anchor the
historical gap; unchanged, not rerun or rescored. XAN0ec remains unaccepted and
unregistered; no blocked checks or accounting probes were attempted. Alias engine
stays DESIGN-only: preserve future opt-in read-unit/file-entrypoint comparison
and deferred substitution representation; whole-script preflight remains default.

Readiness: `/tmp/dotglob-precode-20260828-ready.txt`; final candidate receipt is
separate. This bounded phase is not a 72-hour work or superiority claim.
