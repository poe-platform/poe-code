# Pre-handoff static observations

These observations concern an in-progress author file, not the eventual
committed handoff. No dynamic reproduction was run before author-ready.

## R1: Missing actual-close cleanup branch has no settlement bound

Observed `native-delivery.ts` SHA256
`99b21733e0051df6bf2581814446262c1f364eb08d582251e4155f1909afb554`.
Its lines 70–75 handle `actualClose=false` at the cleanup deadline by issuing
another SIGKILL without finishing or rearming a timer. Suppressing the tested
close notification after a readiness timeout leaves the promise pending.
The initial `suppress-cleanup` control does not enter this branch: it records
`actualClose=true` first. A kill request is not evidence of child retirement.

Required independent negative remains bounded: a tiny controlled child,
real close retained by the independent owner, with only the tested close
acknowledgement suppressed. No unkillable real process or broad cleanup.
This is an existing required cleanup-failure negative, not new suite breadth.

Also observed: phase timer code did not yet record explicit timer arm/due
and actual-fire timestamps. Author may change both before freeze; preserve
this observation and do not falsely label the later source unchanged.

## C1: Count wrapper descendants in the stress cap

The in-progress author run plan allows four descendants. This verifier's
assignment caps children at two to three, so concurrent jq + wrapper + child
+ rg is excluded. Proposal sent to root: canonical files serial, then jq
+ direct canonical six-case child concurrently, maximum three descendants.
Serial wrapper coverage is not concurrent wrapper coverage.

Communicated in `/tmp/harness-timing-review-findings.txt` before handoff.
