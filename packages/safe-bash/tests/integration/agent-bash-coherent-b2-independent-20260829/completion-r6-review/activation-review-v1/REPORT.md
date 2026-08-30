# B2-r6 final-slot review — ACCEPT, not actual GO

Binding source: `f9534894b19085108ac042ff0f48805499d5c1dd`.
Binding receipt: `32ecaf2ebdde79e196ccbaaed3d23732b617af9eb29367f55928b2f3e4ac83bf`.
The prior independent preexecution receipt remains
`7d4e01900cd8630d2331a237283c7e6e43bfad5e00080d8099f3cbddca67a897`.

One presealed PURE helper freshly authenticates all 30 packet members, ten
consumed pins, four tools, the package, prior receipt, and both grant copies.
It checks identities again after the timing controls. It imports only the
authenticated support/owner helper definitions and their common helper; it
does not call the supervisor, loader, compiler, installer, or product.
No prior functional tests were replayed. Raw helper stdout/stderr are separate
files opened before helper startup; the helper exits naturally with status 0.
Source-inspection tool display truncation is not used as test evidence;
RESULT.json and the direct helper captures contain the actual checks.

## Exact anchored window

All times below are August 29, 2026 UTC. Issued 14:55:12.109; earliest launch
15:15:12.109; ROOT's external latest launch 15:20:12.109; active end
15:42:12.109; absolute end 15:45:12.109. The validator rejects anchor-minus-one
and active-end exactly. At the anchor, the tested clock has 1620 active plus
180 reserve seconds. At the external latest start it has **1320 active plus
180 reserve = 1500 total seconds**, not a fresh 1800. The production helper's
backdated monotonic start is forwarded by coordinator into the supervisor;
per-child admission/timers consume that same remaining active clock.
ROOT must enforce the external latest start: it is not a validator field.

Installed grant `/private/tmp/B2-R6-ROOT-GO.json` is regular, 1009 bytes,
mode0600, SHA256 `c002da2a04caa6486b7c60fe4ece42a81fe9b28115ef35585ab19d3e998bd7b7`.
Work root `/private/tmp/safe-bash-b2-runtime-r6` and outer capture
`/private/tmp/safe-bash-b2-runtime-r6.outer.raw` are absent at both checks.
These are observations, not reservations; recheck before actual launch.

## Pending command and limits

From `/Users/kjopek/Workspace/safe-bash`, login=false:

```sh
/bin/zsh /Users/kjopek/Workspace/safe-bash/tests/integration/agent-bash-coherent-b2-preflight-20260829/completion-r6/staged/new/launch.sh /private/tmp/B2-R6-ROOT-GO.json 6222
```

The unchanged packet is 6222 bytes, SHA256
`a2a5a6a23f4c30bd490b3a1db29f0cdc6e4e57a4f179ba0368489af7652fb554`.
Prospective actual limits: 64 known OS starts = owner + 41 sequential children
+ up to 22 administration starts, peak3, 96MiB capture, 512MiB logical work.
34 async-loader admissions are the approved functional per-role hash/builtin
profile, not an OS fence, Regex/guest Workers, or observed thread retirement.
Initial trusted host/zsh startup remains outside generated capture. Historical
STOPs and all actual test/mutant/type counts remain unchanged and unexecuted.

**Fresh ROOT actual GO remains necessary. No launch is authorized by this
review, and no launch before 15:15:12.109 is valid.**

Publication-only correction: the first publisher closed its own event log before
attempting to log Git-add, producing EBADF before Git-add launched. Its metadata
authentication and receipt were already written. The finite successor only
publishes these unchanged results; it does not rerun the PURE helper. This is a
review-publisher error, not a candidate or timing-test failure.
