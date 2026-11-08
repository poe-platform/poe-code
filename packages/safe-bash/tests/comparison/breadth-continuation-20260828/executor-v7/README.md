# V7 successor: unavailable bootstrap and bounded report protocol

Prepared August 28, 2026, after source appearance and independent reviews
f97477ac and c6975254. This is not a pre-source freeze. Current permission is
implementation plus one presealed data/stub execution only. No target/comparator
staging/import, actual admission/C11, native, network, private repository or
99-case semantic run is authorized. Different review and a fresh root grant are
required. All V4/V5/V6 and report-v1 failures remain immutable.

## Source conclusion and deliberately narrow capability profile

The pinned just-bash 3.4.2 main bundle accesses `process.getBuiltinModule` at
byte 503546. Byte 503554 is the property token, not the call. Its detached
`e("module")` call occupies [503594,503605); the following
`e("worker_threads")` occupies [503704,503723). The bootstrap spans
[503524,503786), line 808. Returning undefined to both selects its unavailable
branches; the crypto conditional is false. This is source inference, not a new
comparator execution. Exact source/file/entry hashes are in bootstrap.mjs.

The temporary function accepts exactly one primitive string, first `module`,
then `worker_threads`, returning undefined with zero native delegation. Every
captured function is permanently revoked at slot two and on either import
outcome, before the factory/setup/workflow boundary. Detached calls are valid;
the wrapper does not authenticate its caller. Same-valued computed strings are
not distinguishable from literals. Wrong order, aliases, repeats, arity/type
drift and later calls deny; caught violations invalidate import/final closure.
Restoring the ordinary denial descriptor does not restore a captured wrapper.

This is NOT stock-Node capability behavior or a guarantee that the comparator
has no Module APIs. The separate bound chunk-ZBUZKIPX.js imports node:module;
existing Module/CJS/asset/process/network guards remain unchanged. Any subsequent
denial is a real admission stop, not permission to add an alternate entry or
broaden raw Module access. V6 loader worker→consumer and consumer→bare-library
edge checks remain byte-identical through forwarding imports.

## Report and resource discipline

All new files, including claims, authority lock and control fixtures outside the
record store, are registered in one coordinator evidence budget BEFORE writes.
The unchanged 256 MiB total is partitioned into 248 MiB coordinator and 8 MiB
outer collector, not raised. Exact authenticated stage payloads are a separately
enumerated projection, not an unbounded exclusion; moved-origin aliases cannot
double the stage byte cap. Fresh namespace census rejects unlisted files,
directories, mode/hash drift and symlinks. Instruction plaintext is not admitted.

Logical documents are bounded to 32 MiB (configs/STAGED to 2 MiB); every actual
record is at most 262144 bytes. Multipart readers authenticate descriptor and
every part before JSON parsing. Stream output is one small terminal record, not
nested RESULT; stdout/stderr each remain at most 65536 bytes. The concrete
launch.mjs collector authenticates the coordinator's actual FD3 envelope,
exit/close/reap/natural disposition, observed-versus-retained byte counts and
multipart RESULT before qualifying it. FD3 is mandatory. Heap bound is not RSS;
checked elapsed/Node timers are not hard preemption.

Primary selection uses explicit presence (including null/undefined); cleanup,
pre-report/tail and publication failures remain nonzero/unsafe. PID/group is
enrolled before fallible receipt persistence. Clean children are required even
when reporting fails. Synthetic body drivers cannot authorize production CLI;
their artifacts carry SYNTHETIC_ONLY and fail the default production assessor.

## Complete packet and execution boundaries

INTERFACE.json declares the future command, grant additions, output roots and
full collector/body bounds. SEAL.json binds concrete executable bodies, tools,
inherited projection/adapter/controls/schedule/fixtures and original evidence.
The old operation-plan bytes are unchanged: 14 planned admission workers within
27, two C11 empty setups, zero semantic calls. Authority-metadata Git children
and the coordinator/collector roles are separately recorded, not hidden in the
14 worker count. The 99 semantic cohort requires separate authorization later.

SYNTHETIC-PLAN.json freezes 33 data/stub families, including whole-body setup,
spawn/persistence/tail/serialization/quota/output failures and both actual
reviewer counterexamples. The synthetic topology is 16 outer children and at
most 11 nested own-stub children, not real engine admission. Stub control rows
are explicitly not the real twelve admission controls. The single runner
continues ordinary assertions only after closure and immutable-file guards.

Historical V6 RESULT is 531954 bytes; STAGED 979544, comparator config 685153,
and receipts 318162/317978 also exceeded the old record cap. Those immutable
inputs are not relabeled as compliant new records. V6 stdout was 359581 observed,
65536 retained, **294045 irrecoverable**. No reconstruction from RESULT. Original
report review 19/20 and corrected 18 qualified/2 defects remain separate; no
rescoring. W07 comparator nonexecution remains UNQUALIFIED/UNCREDITED. No stock
Node capability, production authority, public behavior, native or full-gate
acceptance follows from passing synthetic cases.
