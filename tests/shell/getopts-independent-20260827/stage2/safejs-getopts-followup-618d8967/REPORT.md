# Bounded SafeJS getopts followup — August 27, 2026

**1/2 distinct requested probes fully passed. G2 is incomplete, not a pass.**
Exactly three real engine executions occurred for two distinct guest programs;
execution stops here. This NONBLOCKING followup changes neither the accepted
component nor ROOT's runtime decision. No confirmed getopts source defect.

Candidate: `618d8967009117547ab476256bc6eb0a9463309a`.
Accepted independent evidence: `2dcefd4f26588f6dc662148e3713e41b09537333`.
Initial executable freeze: `5b3c6c08ecb21a05db47fb4c191f693d32e1dc78`.
Correction freeze: `09a08165f2576b1cf6eb61577cec235688e5ae92`.
API/implementation inspection preceded both freezes; no preimplementation claim.

## Denominators and qualifications

| Cohort | Complete passes | Other outcomes |
| --- | --- | --- |
| Initial frozen cohort | 0/2 | G1 host-setup failure; G2 not launched |
| Corrected frozen cohort | 1/2 | G1 passes; G2 real guest assertion rejection |
| Distinct requested probes | 1/2 | G2 export-state/fresh-exec proof incomplete |
| All actual execution attempts | 1/3 | Two preserved nonpasses; not three distinct cases |

Preparation additionally preserves three non-execution errors: historical live
package binding, missing npm locator and v2 preparer syntax. See the correction
documents/logs. None is a tested product or loader outcome. No full25 replay,
new native cohort, extra ASCII-refusal probe or broad suite ran. Historical25
remain qualified25, not getopts proofs.

## Actual API, assertions and observations

The unchanged existing API is guest `import * as shell from "shell"` and
`await shell.exec(sourceString)` returning `{stdout, stderr, exitCode}`. The host
uses the public makeSafeJsShellModule with the real declareHostOperation,
read-side-effect policy and a separately host-owned Shell. No argv signature,
guest cleanup/child capability or ownership propagation is invented. The v2
correction adds only standardCommands setup already used by original surface04.

G1 completed **4 in-guest assertions** and returned G1_GUEST_ASSERTIONS_COMPLETE.
Script status0/stderr empty; expected bytes equal observed bytes exactly:

```text
G1|step|0|a|unset|1|3|-ab|λ value|tail
G1|step|0|b|λ value|3|3|-ab|λ value|tail
G1|end|1|?|unset|3|3|-ab|λ value|tail
```

This checks clustered options, required Unicode argument, successful/terminal
statuses, OPTARG removal, OPTIND and preserved arguments. The host independently
asserted outer state `OUTER|0|7|0|parent|2|parent|sentinel` and empty stderr.

G2's first bridge script produced these expected state lines verbatim:

```text
G2|fresh|1|1
G2|parent-first|0|a|1|1
G2|child|0|b|2|0
G2|parent-unchanged|a|1|1
G2|parent-resume|0|b|2|1
G2|sibling|0|a|1|1
G2|parent-final|b|2|1|1|-ab
```

But it also emitted `shell: line 3: export: \`-p': not a valid identifier`.
The actual guest then threw `parent status diagnostics`, before its state-line
assertion, export-absence check or second shell.exec. No seven-assertion completion
marker exists. Raw state agreement is **not** promoted to a guest proof. Fresh
unexported defaults inside the bridge and a fresh second bridge execution remain
unverified. Outer observed state is `OUTER|1|7|0|parent|2|parent|sentinel`: failure
status differs as expected; parent values/arguments remain unchanged in the raw
capture, but the host's later equality assertion was not reached.

The reviewer assumed unsupported `export -p`. Post-run read-only inspection of
candidate runtime.ts:1744-1774 confirms bare `export` lists exported variables,
whereas `-p` reaches identifier validation. The bridge can express the requested
probe; this is **not an API impossibility claim**. No corrected guest or fourth
execution is introduced. ROOT is notified of the general-shell limitation and
incomplete evidence, without a getopts acceptance blocker or source edit.

The frozen supervisor labels G2 INFRASTRUCTURE_NONPASS because thrown run errors
leave its `engine` field null. Preserve that raw record, but do not misread it as
a loader failure or zero guest execution: runtimeCalls=1, actual bridge output,
the guest-specific thrown label and authenticated builtin entries prove otherwise.
ASSESSMENT.json supplies the explicit post-run classification without rewriting it.

## Builtin execution identity

All three children authenticate exactly63 approved real-engine source imports
and252 total loaded files, including the installed public root and getopts module.
An unchanged original loader authenticates disk bytes; the separate test witness
adds one read-only callback at compiled Runtime.getoptsBuiltin entry in memory.
Every entry is linked to an active guest bridge call and distinctive script hash.

Compiled runtime SHA256:
`d37b761457b45ef523546cdad614981c7b5e3ac7665cc486721878195fb3a04a`.
Witness-transformed SHA256:
`de5ef818085c83e5fbbd209e9ed08740211663116209b05b01e4d295c1e60631`.
Expected/actual calls: corrected G1 **4/4**, G2 **5/4** (its second exec is not
reached). Initial failed G1 adds4 entries; total12 entries across3 attempts,
not12 successful assertions. No production file on disk was modified.

## Preservation, closure and limits

Exact candidate source archive988 files and full installed package830 files are
reused from the accepted seal; no build/live overlay. Original offline tarball:
`08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3`.
Original loader/private/capability guards remain byte-identical. Private
HEAD/tree/index/status/staged metadata, six metadata records and264 eligible
engine records match the approved profile before/after, including eligible new
files and empty-directory shape. Excluded private build/cache/module directories
are not claimed guarded. Only hashes/import evidence, never engine source, commit.

All243 protected candidate hashes and two runtime/shell paths remain preserved;
the current live243-path digest is separately stable, not confused with historical
package bytes. Source/package/compiler/driver inventories detect additions.
All257 older phase/stage/policy/review files and265 entries match accepted evidence,
excluding ONLY the explicitly authorized new sibling. Own appends seal separately.

All three children closed naturally, no watchdog kill, signal or output overflow;
both Shells disposed per child. Each capability guard reports zero active timers,
workers, subprocesses, sockets and refusals. Limits:256MiB old-space,20s child
watchdog,256KiB process output,2s SafeJS budget and bounded shell/guest work.
Execution intervals were22:16:15–22:16:39Z and22:20:53–22:21:44Z on August27;
these are recorded runs, not a72-hour duration or performance claim.

Final capture retains both failed and successful raw observations; enumerated
scratch is hash-authenticated then removed after child settlement. No product,
AGENTS, package, exports, private checkout or foreign staging edits. No global
green, parity, superiority, default-count growth or new runtime authorization.
