# One corrected G2 execution — August 27, 2026

ROOT explicitly authorizes exactly ONE additional execution of the same mandatory
G2 probe. No G1 replay, new third case, full25 replay, retry after nonpass or source
edit. Prior evidence6133b271 (historical1/2) and review2dcefd4f are immutable.
This is a fixture correction, not a new component decision or runtime profile.

Read-only inspection BEFORE this freeze confirms candidate runtime.ts:1739-1776:
bare export iterates the exported set, sorted, printing `declare -x NAME=VALUE`
under the Bash profile; VALUE is JSON.stringify. Only readonly handles -p.
Thus the existing absence checks for `OPTIND=`/`OPTERR=` remain meaningful. The
sole guest change is replacing both `export -p` occurrences with bare `export`.
G2-CORRECTION.diff and frozen source hashes bind the exact correction. All seven
guest assertions, original expected state strings, both shell.exec calls and
outer parent checks remain unchanged. No assertion or diagnostic check is waived.

Use byte-identical previous child-v2.mjs and witness-loader.mjs, original loader,
private and capability guards, actual63-import/264-record engine profile, public
makeSafeJsShellModule and real declareHostOperation. Existing guest API remains
`shell.exec(sourceString)` with read-side-effect; no guest capability or ownership
is added. The host owns both Shells and standardCommands registration.

Expected: G2_GUEST_ASSERTIONS_COMPLETE with7 assertions,2 bridge calls and5 actual
getoptsBuiltin entries (four in bridge0, one in bridge1). Fresh OPTIND/OPTERR1/1
are not exported; child changes do not change parent scan state; parent resumes
the clustered b; reset sibling scans a; second bridge exec is fresh and scans a
to OPTIND2. Parent outer state remains7/0/parent and args parent/sentinel.

Prior authenticated scratch was removed as required by the previous final seal.
It cannot be reused in place. Recreate the SAME exact regular engine copies via
the unchanged approved private copy/guard workflow, with no private writes. Reuse
the sealed full candidate source archive and npm tarball; actual offline install
with scripts disabled, no build/live overlays. All copies/caches remain here.

Both earlier complete seals are checked against their exact commits and the
entire prior phase tree against6133b271, with ONLY this new sibling excluded.
Unknown additions are rejected; neither old verifier or manifest changes. This
own append has separate executable freeze and final evidence membership seals.
Live243 protected paths plus runtime/shell are a current before/after preservation
baseline, never a requirement that unrelated live edits equal historical candidate.

Original compiled runtime SHA256:
d37b761457b45ef523546cdad614981c7b5e3ac7665cc486721878195fb3a04a.
Unchanged read-only witness transformation SHA256:
de5ef818085c83e5fbbd209e9ed08740211663116209b05b01e4d295c1e60631.
Witness records actual builtin entry plus active bridge index/script hash. Product
disk bytes are unchanged. Expected exports from the configured bridge are PWD
and TAG only; no engine module/capability, host/native fallback or query is added.

Freeze and commit all executable dependencies BEFORE the one child. Require
natural closure, both Shell disposals, no active timers/workers/subprocesses/
sockets; retain256MiB old-space,20s watchdog,256KiB process output,2s SafeJS and
existing shell/guest budgets. Snapshot private HEAD/tree/index/status/staged/six
metadata/264 eligible files plus eligible path shape before/after, including new
entries. Original private excluded build/cache/module directories remain excluded.
Stop after settlement even on failure; preserve raw outcomes, run final guards,
seal compact hash-only evidence and remove only authenticated owned scratch.

Harness relocation changes only owned paths, one-G2 selection and current-live
preservation binding. Supervisor additionally checks the two frozen bridge script
hashes, exact4+1 builtin correlation and both fixed witness hashes. A guest throw
after an observed bridge call is classified as guest nonpass rather than the old
null-engine infrastructure label; no guest assertion changes. Diff inspection's
first wrapper treated Git's normal no-index difference status1 as an exception;
stdout is exactly G2-CORRECTION.diff, stderr empty, no preparation/guest ran. A
status-aware invocation preserved that same diff; it is not a product failure.
