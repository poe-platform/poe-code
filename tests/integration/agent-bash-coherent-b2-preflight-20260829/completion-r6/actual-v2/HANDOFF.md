# B2-r6 actual-v2: first-child loader bootstrap STOP

One exact runtime attempt was dispatched under ROOT's new authorization, after
the earlier scheduler STOP was explicitly adjudicated. No retry, grant renewal,
runtime/source/fixture change or expectation reduction occurred.

## Actual failure

Dispatch admission: August29,2026 **15:18:01.141UTC**, inside the unchanged
15:15:12.109–15:20:12.109 external window. The exact approved launch command ran
with repository cwd and login=false. Tool session7195 returned78 after one bounded
same-session observation; no long transport wait occurred in this phase.

The first supervised role, `retained-source-built-redirections-v3`, PID84566,
exited and closed naturally with **status1**, no signal, unknown=false. Its stderr
contains the exact failure:

```text
Error [ERR_ACCESS_DENIED]: fsync API is disabled when Permission Model is enabled.
```

It occurs at frozen `staged/new/loader.mjs:17`, `trace()` calling `fs.fsyncSync`,
under the consumer's existing `--experimental-permission` flags. The trace write
itself succeeded; this is not evidence of a missing write-path allowance. Node's
error preserves `permission: ''` and `resource: ''`. This is a demonstrated
**harness loader/profile incompatibility**, not a demonstrated virtual Bash
semantic defect. No repair or alternative flags were attempted.

The supervisor correctly stopped dependent roles. Its partial receipt has
`completed: []`, `successSchema: false`, `automaticRetry: false` and no secondary
cleanup failure. The runtime's success `RESULT.json` does not exist. This
namespace's `RESULT.json` is separately labeled audit/STOP evidence, not a runtime
success receipt.

## Exact result matrix

| Obligation | Actual observation |
| --- | --- |
| 672 retained identities | 0 executed, 0 assertion passes/failures; all UNRUN |
| 41 supervised roles | first role bootstrap-failed; remaining40 UNRUN |
| 6 type processes / 24 negative identities | UNRUN; the Node error is not a TS diagnostic |
| 7 loaded mutants / 7 restores | UNRUN; no mutation applied |
| 2 binding-refusal controls | UNRUN |
| Frozen offline install | UNRUN |
| Main async loader | one consumer admitted; hook ran on Node internal ESM-worker stack |
| Regex/guest Workers | no entries observed; no additional runtime Worker instrumentation claim |

The one trace entry names `harness/redirections.mjs`, SHA256
`5d22e251da75541bc23a5b786dca6340586cf7bc426801f219f539b73a3e2561`.
Its original kind is `authenticated-source-supplied`; **do not treat that label as
completed supply/evaluation**. The source body logs the entry, then calls fsync,
then would return source. Here it threw before the return. No product-module trace
or first retained JSON case was produced. Individual loader-thread exit and native
helper-thread totals remain unobserved; child exit is not a universal thread census.

The actual per-role binding has263 members,68731 bytes, SHA256
`7ce0075be20ceb12eb218d8a7b187f9b6f57299d8fdfc1f2d64dccdffe17b414`.
`SOURCE-PACKAGE-POSTGUARD.json` verifies all1014 materialized source-package paths,
byte counts and hashes against the frozen package membership after failure; modes
were not rechecked by that supplemental DATA comparison. All30 executable packet
members also passed postguards. No current HEAD, ERE/B35/K08/PIPE source was added.

## Capture, cleanup and limits

Child attempted/stored capture is **1748/1748 bytes**, stdout0/stderr1748. Outer
raw capture is473 bytes. Seven exact raw artifacts totaling74675 bytes are retained
under `raw/`, including events, binding, trace and original partial failure.
The DATA publication helper copied them using awaited regular-file operations,
complete writes and fsync. Its bounded inventory records runtime+stage+selected
copies at7773088 logical bytes; it is not a whole-host/RSS/disk-quota measurement.

Child exit/close and capture flush/close are evidenced by the owner; event cleanup
reported no secondary failure. The outer session exit78 is a tool observation,
not a separately instrumented outer Node exit/close pair. No known child remains
active. The runtime root and original captures remain retained for review and to
prevent treating the consumed work root as unused; they were not deleted/reset.

Owner elapsed178721.748584ms is measured from the **anchored notBefore**, not the
wall duration of this attempt. No full1800-second-at-launch claim is made. Active
end15:42:12.109 and publication expiry15:45:12.109 are unchanged.

New-phase conservative known-role accounting is11: one runtime owner, one
supervised child, one possible outer tool shell, one DATA preservation process,
four editing-tool roles, and three final Git publication/status roles. Final Git
roles are prospective at this document's write and must retire before handoff.
Earlier actual-v1/prelaunch starts remain separately preserved in `ae4deaf7738595e19be6d70b809b369fc46280e9`;
they are neither reused nor erased. No full transitive process census is claimed.

## Next decision, not implementation

ROOT must authorize any new versioned harness repair and fresh actual attempt.
The smallest demonstrated concern is permission-compatible trace durability:
loader fsync cannot run under these exact flags. Merely dropping durability or
loosening permissions is not approved by this report. Any future repair needs
actual same-profile validation and must distinguish trace intent from completed
source supply. The current runtime/code/fixture bytes stay frozen.
