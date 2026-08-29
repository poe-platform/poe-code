# B35 v4 S01 correction — review ready, no actual GO

Source commit 18e4c9a717809edd10230e3e5187111d9ed304b1.
PRESEAL.json 9470bytes SHA256 b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3.
CONTROL-SEAL.json 1336bytes SHA256 ef0764d2efbeeb56af3fa329a460e90b0b2b5033d8290c85f677e9f70d589ced.

Eight fixed injected-operation groups passed. One Node helper; zero actual OS capture faults/child dispatches/readiness/product/Workers/compiler/native runs. Falsey primary and cleanup reasons plus frozen Error pairs retain original rejection identity; supplied ledger records secondary cleanup separately, closes are attempted once, failed closes stay unresolved/not qualified, and no child/start credit occurs. First-open/no-close and normal fd0/fd1 controls also pass.

Only helper behavior change: openCapturePair inside direct-child.mjs and its callsite. The reverse patch reproduces the exact old module. All other code is byte-identical except necessary absolute new-namespace/work bindings. Collector/time/finalization/parser/package code unchanged. DELTA.json lists every file. The supplied ledger is the owned failure receipt; no claim of successful durable publication under arbitrary filesystem failure is added.

Prospective profile remains65runtime+7admin=72starts/peak3/25min/96MiBcapture/512MiB logicalwork. No new role.54primary+24legacy+5mutant calls,3mutantchildren,2bindingrefusals and3types areUNRUN. Old0of54STOP, S01SOURCEhold, F01/F02 and N02/N03 remain recorded, not rescored.

Exact pending launch:

```text
exec /bin/zsh -f '/Users/kjopek/Workspace/safe-bash/tests/compatibility/bash-function-keyword-author-20260829/preexec-v4/launch.sh' '9470' 'b4b562d5ce6673aea3f9d91c50b6697ebaf01f9b92ca8107265a84ff652edfa3' 'ROOT_APPROVED_GRANT_SHA256' 'INDEPENDENT_REVIEW_SHA256'
```

Grant schema/review admission strings remain the accepted v3 schema; only new preseal/path bindings and pending fresh review/grant digests differ. No actual timestamps or GO.json. Different-agent review and ROOT activation required. Initial trustedhost/bootstrap-preopen qualification remains as recorded; no OS-containment/RSS/full-census claim.
