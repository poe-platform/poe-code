# SOURCE-EXCEPTION-COERCION — AW-001 / AW-002

## Scope and isolation

Worker-only remediation, not overall audit completion or publication approval.
Clone: `/Users/kjopek/Workspace/poe-code-safejs-source-exceptions`; branch: `main`.
Fresh single-branch main clone followed by successful `git -c pull.rebase=false pull --ff-only` before inspection/setup. Base: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`. Initial status clean.
Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and clone root `AGENTS.md`; no deeper SafeJS/docs/plans instruction files.
No original/shared/publisher/other fix clone writes; no feature branch, stash, reset, commit, staging, or push.
Pinned setup: `SKIP_SYNC_SKILLS=1 npm ci` (548 installed; exit 0); explicit agent-spawn/frontmatter/tiny-mcp-client Turbo dependency build (21/21; exit 0). No lock/manifest changes.
No README edits, inline comments, standalone QA executable, LLM, guest real IO, security probes, or replay fixes. Unit tests use pure in-memory stubs; no filesystem writes.

## Procedure

1. Record native outputs for all thirteen exact ordinary AW sources before SafeJS.
2. Add original-workflow and minimal ordinary-record regressions plus controls; observe RED.
3. Preserve source exception values internally without weakening host/public error conversion.
4. Validate focused/broad relevant tests, types, lint, and formatting; retain full evidence.
5. Independent validator follows. Publisher must serially three-way-integrate and separately validate on its own base.

## Audit access boundary

Bootstrap read only inventory-verification metadata after a root filename-only listing. The verification establishes exactly 38 excluded paths plus the entire security directory. No excluded payload bytes read, hashed, displayed, or executed.
After bootstrap, explicitly allowed reads: root REPORT.md, async-workflows/REPORT.md, async-value-review/REVIEW.md, and the thirteen sources listed below. No broad audit/family search or other result/attempt archive reads.

Exact inherited exclusion paths:

```text
out/safejs-audit-2026-08-27/objects/reductions/special-own.ajs
out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.native.json
out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.repeat.json
out/safejs-audit-2026-08-27/strings/evidence/c07-string-budget.safejs.safejs.json
out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.native.json
out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.repeat.json
out/safejs-audit-2026-08-27/strings/evidence/c08-array-budget.safejs.safejs.json
out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.native.json
out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.repeat.json
out/safejs-audit-2026-08-27/strings/evidence/c09-regex-budget.safejs.safejs.json
out/safejs-audit-2026-08-27/strings/reductions/c07-string-budget.safejs
out/safejs-audit-2026-08-27/strings/reductions/c08-array-budget.safejs
out/safejs-audit-2026-08-27/strings/reductions/c09-regex-budget.safejs
out/safejs-audit-2026-08-27/security/REPORT.md
out/safejs-audit-2026-08-27/security/evidence/batch-1.json
out/safejs-audit-2026-08-27/security/evidence/report-command.json
out/safejs-audit-2026-08-27/security/evidence/verification.json
out/safejs-audit-2026-08-27/security/examples/callback-failures.safejs
out/safejs-audit-2026-08-27/security/examples/capability-isolation-acyclic.safejs
out/safejs-audit-2026-08-27/security/examples/capability-isolation.safejs
out/safejs-audit-2026-08-27/security/examples/constructor-rejection.safejs
out/safejs-audit-2026-08-27/security/examples/deadline-capability.safejs
out/safejs-audit-2026-08-27/security/examples/deadline-minimal.safejs
out/safejs-audit-2026-08-27/security/examples/edit-distance.safejs
out/safejs-audit-2026-08-27/security/examples/host-fixtures.mjs
out/safejs-audit-2026-08-27/security/examples/native-transforms.safejs
out/safejs-audit-2026-08-27/security/examples/nested-transforms.safejs
out/safejs-audit-2026-08-27/security/examples/permutations.safejs
out/safejs-audit-2026-08-27/security/examples/prototype-api-rejection.safejs
out/safejs-audit-2026-08-27/security/expectations.json
out/safejs-audit-2026-08-27/security/followup-expectations.json
out/safejs-audit-2026-08-27/security/licenses/endojs.txt
out/safejs-audit-2026-08-27/security/licenses/lodash.txt
out/safejs-audit-2026-08-27/security/licenses/quickjs-ng.txt
out/safejs-audit-2026-08-27/security/licenses/trekhleb.txt
out/safejs-audit-2026-08-27/security/results.json
out/safejs-audit-2026-08-27/security/source-inventory.json
out/safejs-audit-2026-08-27/security/sources.md
```

Also exclude `out/safejs-audit-2026-08-27/security/` recursively.

## Preimage manifest

SHA-256 values captured before any production edit:

| Path                                        | Base preimage SHA-256                                              |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/exceptions.ts`  | `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf` |
| `packages/safejs/src/interp/interpreter.ts` | `bcf749b3e19160ac30d7448fc03f2b65e85bef9b2cb217952badea504a161e61` |

New test and this plan have no base preimage.

## Exact original sources

Sources are embedded byte-for-byte in the regression tests, not replaced by reductions or Error rewrites. Every source runs a pure bounded tick stub that logs its label and awaits Promise.resolve; reductions/combinators with no tick retain empty logs. No checkpoint scenario is introduced by these workflows.

| Source                                                                                   | SHA-256                                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `out/safejs-audit-2026-08-27/async-workflows/examples/01-waterfall-identity.js`          | `ebad28958264b8a06774ee9358f83e7ca228d8faef66ebeea866f4073be94e10` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/02-auto-dependency-closures.js`    | `6077f3c3188366f56fc83f565e23c9a390b3e189a79cb6bdd9fe85adece97eec` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/03-maplimit-lexical-state.js`      | `0dc1377c893052a74fe3bb5a8003a2baf3e879ad53a9a782d7da4829d4ca32b4` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/04-nested-finally-precedence.js`   | `ab59bab7459aac520728a431bf647e82fadd8fb026a701117aff68194c20ae20` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/05-saga-delegation-cleanup.js`     | `3f33639877da271d3ee65523dd9859c9c2e78dadb75d80e732463582a81c4612` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/06-scan-reduce-state.js`           | `49a7fed1388eee6d59fbf52e12b4823532dd5629a4b2ece1e1c1256d8d99ea22` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/07-forkjoin-last-values.js`        | `fc800f5b29ba9af6ad5baa2435639003e761a9b953a9bb55998dce45559ecfaa` |
| `out/safejs-audit-2026-08-27/async-workflows/examples/08-plain-thenable-combinators.js`  | `1c9a14b8bccfd9e9fb00e5a855d17391f585c05c4ec194611a97745a3b84e3ab` |
| `out/safejs-audit-2026-08-27/async-workflows/reductions/09-rejection-identity-matrix.js` | `a2831685cdf96c2c904126c28483a5bbc8453715df789316d7aba8cd92a1255f` |
| `out/safejs-audit-2026-08-27/async-workflows/reductions/10-recovery-annotation.js`       | `892a23449b717778dddc9953ac304496c072268bb1c7cc6d8c0895d1ae432da1` |
| `out/safejs-audit-2026-08-27/async-workflows/rewrites/11-waterfall-error-instance.js`    | `fb22a8bc4b514f0b82ca889c5fd34a1d4cfd0160573984328792a4bc5610b891` |
| `out/safejs-audit-2026-08-27/async-workflows/rewrites/12-finally-domain-records.js`      | `4ab166ed50bce8a58d3ecbd41b30bd374b11112a29a08fca801d68bcc01535aa` |
| `out/safejs-audit-2026-08-27/async-workflows/reductions/13-domain-error-metadata.js`     | `f1fb10e7e5a568a3041c843ae8a19190805cc1b3d53fa2ed550c2de6fa816e03` |

## Native expected — before production/SafeJS execution

Node native async function evaluation; 192 MiB child heap cap, 10-second parent timeout; all thirteen complete successfully. Full output objects and full tick-call logs follow. JSON marker `{"$undefined":true}` represents undefined, not application data.

```json
{"id":"01-waterfall-identity","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":true,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"]}
{"id":"02-auto-dependency-closures","execution":{"ok":true,"returnValue":{"result":{"summary":{"identity":true,"values":[13,13],"labels":[2,4,7],"owner":true},"finished":7,"peak":2},"origin":{"name":"catalog","revision":3},"trace":[["start","seed"],["start","weights"],["done","seed"],["start","left"],["done","weights"],["start","right"],["done","left"],["start","labels"],["done","right"],["start","combine"],["done","labels"],["done","combine"],["start","summary"],["done","summary"]]}},"calls":["seed","weights:a","weights:b","left","right","labels","summary"]}
{"id":"03-maplimit-lexical-state","execution":{"ok":true,"returnValue":{"checks":[{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[0,0,105,0],[0,1,105,0],[0,2,105,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[1,0,110,1],[1,1,110,1],[1,2,110,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[2,0,116,2],[2,1,116,2],[2,2,116,2]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[3,0,122,0],[3,1,122,0],[3,2,122,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[4,0,130,1],[4,1,130,1],[4,2,130,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[5,0,136,2],[5,1,136,2],[5,2,136,2]]}],"completed":6,"trace":[["finish",0,0],["finish",1,1],["finish",2,2],["finish",3,0],["finish",4,1],["finish",5,2]]}},"calls":["map:0:0","map:1:0","map:2:0","map:0:1","map:1:1","map:2:1","map:0:2","map:1:2","map:2:2","map:3:0","map:4:0","map:5:0","map:3:1","map:4:1","map:5:1","map:3:2","map:4:2","map:5:2","verify:0","verify:1","verify:2","verify:3","verify:4","verify:5"]}
{"id":"04-nested-finally-precedence","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":"body","body":true,"inner":false,"outer":false,"chain":false},{"name":"inner","error":"inner-cleanup","body":false,"inner":true,"outer":false,"chain":false},{"name":"outer","error":"outer-cleanup","body":false,"inner":false,"outer":true,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":"promise-finally","body":false,"inner":false,"outer":false,"chain":true}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"]}
{"id":"05-saga-delegation-cleanup","execution":{"ok":true,"returnValue":{"results":[{"result":{"label":"normal","value":12},"effects":4},{"result":{"label":"recover","value":17},"effects":4},{"result":{"label":"cancel","value":"cancelled"},"effects":3}],"trace":[["normal","leaf-enter"],["normal","leaf-exit"],["normal","branch-result",12],["normal","branch-enter"],["normal","branch-exit"],["recover","caught",true],["recover","leaf-enter"],["recover","leaf-exit"],["recover","branch-result",17],["recover","branch-enter"],["recover","branch-exit"],["cancel","leaf-enter"],["cancel","leaf-exit"],["cancel","branch-result","cancelled"],["cancel","branch-enter"],["cancel","branch-exit"]]}},"calls":["normal:initial","normal:left","normal:right","normal:leaf-close","normal:branch-close","recover:initial","recover:left","recover:right","recover:recover","recover:leaf-close","recover:branch-close","cancel:initial","cancel:leaf-close","cancel:branch-close"]}
{"id":"06-scan-reduce-state","execution":{"ok":true,"returnValue":{"balance":13,"names":["open:0","credit:1","replace:2","settle:3"],"initialBalance":8,"aliases":[true,false,true,true],"numeric":[16],"numericIndexes":[1,2],"empty":[[19],[],false],"caughtIdentity":true,"trace":[["closed",4,true],["closed",3,false],["closed",0,false],["closed",0,false],["closed",3,false]]}},"calls":["scan:0","scan:1","scan:2","scan:3","scan:0","scan:1","scan:2","scan:0","scan:1"]}
{"id":"07-forkjoin-last-values","execution":{"ok":true,"returnValue":{"success":{"emitted":true,"values":[{"id":"shared-last","value":23},{"id":"shared-last","value":23},7],"alias":true,"original":true},"empty":{"emitted":false,"values":[]},"noStreams":{"emitted":false,"values":[]},"rejectedIdentity":true,"trace":[["first","next"],["second","next"],["third","next"],["second","complete"],["first","next"],["third","next"],["first","complete"],["third","next"],["third","complete"],["empty","complete"],["drained","next"],["drained","next"],["drained","complete"],["failing","next"],["joined","next"],["failing","complete"],["joined","next"],["joined","complete"]]}},"calls":["first","second","third","first","third","third","drained","drained","failing","joined","joined"]}
{"id":"08-plain-thenable-combinators","execution":{"ok":true,"returnValue":{"winnerIdentity":[true,true,true],"settled":[["fulfilled",true],["fulfilled",true],["rejected",true]],"rejectionIdentity":true,"aggregate":{"name":"AggregateError","count":2,"first":true,"second":true},"empty":[[],[]],"trace":[["caller"],["assimilate","slow"],["assimilate","fast"],["settle","fast"],["assimilate","rejected"],["settle","rejected"],["settle","slow"],["assimilate","all-error"],["settle","all-error"],["assimilate","any-first"],["assimilate","any-second"],["settle","any-second"],["settle","any-first"]]}},"calls":[]}
{"id":"09-rejection-identity-matrix","execution":{"ok":true,"returnValue":[["direct-throw",true],["function-throw",true],["await-reject",true],["async-immediate",true],["async-delayed",true],["await-thenable",true],["promise-catch",true],["allSettled-reason",true],["catch-return-value",true],["array-rejection",true],["error-rejection",true]]},"calls":[]}
{"id":"10-recovery-annotation","execution":{"ok":true,"returnValue":{"sameReason":true,"sameAnnotations":true,"original":{"attempt":1,"annotations":["recovered"]},"caught":{"attempt":1,"annotations":["recovered"]},"nextAttempt":2}},"calls":[]}
{"id":"11-waterfall-error-instance","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":true,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"]}
{"id":"12-finally-domain-records","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":"body","body":true,"inner":false,"outer":false,"chain":false},{"name":"inner","error":"inner-cleanup","body":false,"inner":true,"outer":false,"chain":false},{"name":"outer","error":"outer-cleanup","body":false,"inner":false,"outer":true,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":"promise-finally","body":false,"inner":false,"outer":false,"chain":true}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"]}
{"id":"13-domain-error-metadata","execution":{"ok":true,"returnValue":{"plain":{"same":true,"name":"DomainFailure","message":"try again","code":"RETRY","retryable":true,"context":{"job":"alpha"},"contextSame":true},"allocated":{"same":true,"name":"Error","message":"try again","code":"RETRY","retryable":true,"context":{"job":"alpha"},"contextSame":true},"catchContinuationSame":true}},"calls":[]}
```

## Original workflow RED — unmodified production

All thirteen run calls resolve ok:true. Ten semantic mismatches, three complete matches (02, 03, 11). All thirteen complete host-call logs match native. Current clone TypeScript source only, fixed small inputs, budgets 150000 steps/100 call depth/32768 string/2048 array/2000000 data; 8-second per-case deadline, 256 MiB child heap, 30-second outer timeout. No budget approached. Full actuals:

```json
{"id":"01-waterfall-identity","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":false,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"],"steps":365}
{"id":"02-auto-dependency-closures","execution":{"ok":true,"returnValue":{"result":{"summary":{"identity":true,"values":[13,13],"labels":[2,4,7],"owner":true},"finished":7,"peak":2},"origin":{"name":"catalog","revision":3},"trace":[["start","seed"],["start","weights"],["done","seed"],["start","left"],["done","weights"],["start","right"],["done","left"],["start","labels"],["done","right"],["start","combine"],["done","labels"],["done","combine"],["start","summary"],["done","summary"]]}},"calls":["seed","weights:a","weights:b","left","right","labels","summary"],"steps":1496}
{"id":"03-maplimit-lexical-state","execution":{"ok":true,"returnValue":{"checks":[{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[0,0,105,0],[0,1,105,0],[0,2,105,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[1,0,110,1],[1,1,110,1],[1,2,110,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[2,0,116,2],[2,1,116,2],[2,2,116,2]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[3,0,122,0],[3,1,122,0],[3,2,122,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[4,0,130,1],[4,1,130,1],[4,2,130,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[5,0,136,2],[5,1,136,2],[5,2,136,2]]}],"completed":6,"trace":[["finish",0,0],["finish",1,1],["finish",2,2],["finish",3,0],["finish",4,1],["finish",5,2]]}},"calls":["map:0:0","map:1:0","map:2:0","map:0:1","map:1:1","map:2:1","map:0:2","map:1:2","map:2:2","map:3:0","map:4:0","map:5:0","map:3:1","map:4:1","map:5:1","map:3:2","map:4:2","map:5:2","verify:0","verify:1","verify:2","verify:3","verify:4","verify:5"],"steps":1439}
{"id":"04-nested-finally-precedence","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":"body","body":false,"inner":false,"outer":false,"chain":false},{"name":"inner","error":"inner-cleanup","body":false,"inner":false,"outer":false,"chain":false},{"name":"outer","error":"outer-cleanup","body":false,"inner":false,"outer":false,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":"promise-finally","body":false,"inner":false,"outer":false,"chain":false}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"],"steps":818}
{"id":"05-saga-delegation-cleanup","execution":{"ok":true,"returnValue":{"results":[{"result":{"label":"normal","value":12},"effects":4},{"result":{"label":"recover","value":17},"effects":4},{"result":{"label":"cancel","value":"cancelled"},"effects":3}],"trace":[["normal","leaf-enter"],["normal","leaf-exit"],["normal","branch-result",12],["normal","branch-enter"],["normal","branch-exit"],["recover","caught",false],["recover","leaf-enter"],["recover","leaf-exit"],["recover","branch-result",17],["recover","branch-enter"],["recover","branch-exit"],["cancel","leaf-enter"],["cancel","leaf-exit"],["cancel","branch-result","cancelled"],["cancel","branch-enter"],["cancel","branch-exit"]]}},"calls":["normal:initial","normal:left","normal:right","normal:leaf-close","normal:branch-close","recover:initial","recover:left","recover:right","recover:recover","recover:leaf-close","recover:branch-close","cancel:initial","cancel:leaf-close","cancel:branch-close"],"steps":1145}
{"id":"06-scan-reduce-state","execution":{"ok":true,"returnValue":{"balance":13,"names":["open:0","credit:1","replace:2","settle:3"],"initialBalance":8,"aliases":[true,false,true,true],"numeric":[16],"numericIndexes":[1,2],"empty":[[19],[],false],"caughtIdentity":false,"trace":[["closed",4,true],["closed",3,false],["closed",0,false],["closed",0,false],["closed",3,false]]}},"calls":["scan:0","scan:1","scan:2","scan:3","scan:0","scan:1","scan:2","scan:0","scan:1"],"steps":760}
{"id":"07-forkjoin-last-values","execution":{"ok":true,"returnValue":{"success":{"emitted":true,"values":[{"id":"shared-last","value":23},{"id":"shared-last","value":23},7],"alias":true,"original":true},"empty":{"emitted":false,"values":[]},"noStreams":{"emitted":false,"values":[]},"rejectedIdentity":false,"trace":[["first","next"],["second","next"],["third","next"],["second","complete"],["first","next"],["third","next"],["first","complete"],["third","next"],["third","complete"],["empty","complete"],["drained","next"],["drained","next"],["drained","complete"],["failing","next"],["joined","next"],["failing","complete"],["joined","next"],["joined","complete"]]}},"calls":["first","second","third","first","third","third","drained","drained","failing","joined","joined"],"steps":763}
{"id":"08-plain-thenable-combinators","execution":{"ok":true,"returnValue":{"winnerIdentity":[true,true,true],"settled":[["fulfilled",true],["fulfilled",true],["rejected",true]],"rejectionIdentity":false,"aggregate":{"name":"AggregateError","count":2,"first":true,"second":true},"empty":[[],[]],"trace":[["caller"],["assimilate","slow"],["assimilate","fast"],["settle","fast"],["assimilate","rejected"],["settle","rejected"],["settle","slow"],["assimilate","all-error"],["settle","all-error"],["assimilate","any-first"],["assimilate","any-second"],["settle","any-second"],["settle","any-first"]]}},"calls":[],"steps":539}
{"id":"09-rejection-identity-matrix","execution":{"ok":true,"returnValue":[["direct-throw",true],["function-throw",false],["await-reject",false],["async-immediate",false],["async-delayed",false],["await-thenable",false],["promise-catch",true],["allSettled-reason",true],["catch-return-value",true],["array-rejection",false],["error-rejection",true]]},"calls":[],"steps":211}
{"id":"10-recovery-annotation","execution":{"ok":true,"returnValue":{"sameReason":false,"sameAnnotations":false,"original":{"attempt":0,"annotations":[]},"caught":{"attempt":1,"annotations":["recovered"]},"nextAttempt":1}},"calls":[],"steps":41}
{"id":"11-waterfall-error-instance","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":true,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"],"steps":366}
{"id":"12-finally-domain-records","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":{"$undefined":true},"body":false,"inner":false,"outer":false,"chain":false},{"name":"inner","error":{"$undefined":true},"body":false,"inner":false,"outer":false,"chain":false},{"name":"outer","error":{"$undefined":true},"body":false,"inner":false,"outer":false,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":{"$undefined":true},"body":false,"inner":false,"outer":false,"chain":false}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"],"steps":830}
{"id":"13-domain-error-metadata","execution":{"ok":true,"returnValue":{"plain":{"same":false,"name":"DomainFailure","message":"try again","code":{"$undefined":true},"retryable":{"$undefined":true},"context":{"$undefined":true},"contextSame":false},"allocated":{"same":true,"name":"Error","message":"try again","code":"RETRY","retryable":true,"context":{"job":"alpha"},"contextSame":true},"catchContinuationSame":true}},"calls":[],"steps":107}
```

## Focused regression RED

Before production edits: 97 tests, 29 failed, 68 passed, exit 1. Eighteen minimal ordinary-record/plain-object propagation failures, ten full archived source failures, and one already-copied host input alias failure. All Error/string/number/null/undefined, host conversion/copy, and public error envelope controls pass.

Initial test authoring had three incorrect public-envelope expectations (97 tests, 32 failed/65 passed): unknown DomainFailure names normalize to Error and plain objects serialize as JSON. Read existing surfaceThrownValue/normalizeSurfacedSubsetError and executed the unmodified API to correct those test-only assumptions before the confirmed RED run. Production/classification remained unchanged.

```json
{"name":"source exception value controls ordinary record preserves direct propagation","status":"passed"}
{"name":"source exception value controls ordinary record preserves function propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves async propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves rejection propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves thenable propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves rethrow propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves callback propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves constructor propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves default propagation","status":"failed"}
{"name":"source exception value controls ordinary record preserves generator propagation","status":"failed"}
{"name":"source exception value controls plain object preserves direct propagation","status":"passed"}
{"name":"source exception value controls plain object preserves function propagation","status":"failed"}
{"name":"source exception value controls plain object preserves async propagation","status":"failed"}
{"name":"source exception value controls plain object preserves rejection propagation","status":"failed"}
{"name":"source exception value controls plain object preserves thenable propagation","status":"failed"}
{"name":"source exception value controls plain object preserves rethrow propagation","status":"failed"}
{"name":"source exception value controls plain object preserves callback propagation","status":"failed"}
{"name":"source exception value controls plain object preserves constructor propagation","status":"failed"}
{"name":"source exception value controls plain object preserves default propagation","status":"failed"}
{"name":"source exception value controls plain object preserves generator propagation","status":"failed"}
{"name":"source exception value controls Error preserves direct propagation","status":"passed"}
{"name":"source exception value controls Error preserves function propagation","status":"passed"}
{"name":"source exception value controls Error preserves async propagation","status":"passed"}
{"name":"source exception value controls Error preserves rejection propagation","status":"passed"}
{"name":"source exception value controls Error preserves thenable propagation","status":"passed"}
{"name":"source exception value controls Error preserves rethrow propagation","status":"passed"}
{"name":"source exception value controls Error preserves callback propagation","status":"passed"}
{"name":"source exception value controls Error preserves constructor propagation","status":"passed"}
{"name":"source exception value controls Error preserves default propagation","status":"passed"}
{"name":"source exception value controls Error preserves generator propagation","status":"passed"}
{"name":"source exception value controls string preserves direct propagation","status":"passed"}
{"name":"source exception value controls string preserves function propagation","status":"passed"}
{"name":"source exception value controls string preserves async propagation","status":"passed"}
{"name":"source exception value controls string preserves rejection propagation","status":"passed"}
{"name":"source exception value controls string preserves thenable propagation","status":"passed"}
{"name":"source exception value controls string preserves rethrow propagation","status":"passed"}
{"name":"source exception value controls string preserves callback propagation","status":"passed"}
{"name":"source exception value controls string preserves constructor propagation","status":"passed"}
{"name":"source exception value controls string preserves default propagation","status":"passed"}
{"name":"source exception value controls string preserves generator propagation","status":"passed"}
{"name":"source exception value controls number preserves direct propagation","status":"passed"}
{"name":"source exception value controls number preserves function propagation","status":"passed"}
{"name":"source exception value controls number preserves async propagation","status":"passed"}
{"name":"source exception value controls number preserves rejection propagation","status":"passed"}
{"name":"source exception value controls number preserves thenable propagation","status":"passed"}
{"name":"source exception value controls number preserves rethrow propagation","status":"passed"}
{"name":"source exception value controls number preserves callback propagation","status":"passed"}
{"name":"source exception value controls number preserves constructor propagation","status":"passed"}
{"name":"source exception value controls number preserves default propagation","status":"passed"}
{"name":"source exception value controls number preserves generator propagation","status":"passed"}
{"name":"source exception value controls null preserves direct propagation","status":"passed"}
{"name":"source exception value controls null preserves function propagation","status":"passed"}
{"name":"source exception value controls null preserves async propagation","status":"passed"}
{"name":"source exception value controls null preserves rejection propagation","status":"passed"}
{"name":"source exception value controls null preserves thenable propagation","status":"passed"}
{"name":"source exception value controls null preserves rethrow propagation","status":"passed"}
{"name":"source exception value controls null preserves callback propagation","status":"passed"}
{"name":"source exception value controls null preserves constructor propagation","status":"passed"}
{"name":"source exception value controls null preserves default propagation","status":"passed"}
{"name":"source exception value controls null preserves generator propagation","status":"passed"}
{"name":"source exception value controls undefined preserves direct propagation","status":"passed"}
{"name":"source exception value controls undefined preserves function propagation","status":"passed"}
{"name":"source exception value controls undefined preserves async propagation","status":"passed"}
{"name":"source exception value controls undefined preserves rejection propagation","status":"passed"}
{"name":"source exception value controls undefined preserves thenable propagation","status":"passed"}
{"name":"source exception value controls undefined preserves rethrow propagation","status":"passed"}
{"name":"source exception value controls undefined preserves callback propagation","status":"passed"}
{"name":"source exception value controls undefined preserves constructor propagation","status":"passed"}
{"name":"source exception value controls undefined preserves default propagation","status":"passed"}
{"name":"source exception value controls undefined preserves generator propagation","status":"passed"}
{"name":"exception boundaries remain intentional converts host Error and copies registered metadata (async=false)","status":"passed"}
{"name":"exception boundaries remain intentional converts host Error and copies registered metadata (async=true)","status":"passed"}
{"name":"exception boundaries remain intentional normalizes host ordinary thrown records (async=false)","status":"passed"}
{"name":"exception boundaries remain intentional normalizes host ordinary thrown records (async=true)","status":"passed"}
{"name":"exception boundaries remain intentional keeps host input/output copies separate from source aliases","status":"failed"}
{"name":"exception boundaries remain intentional keeps low-level untrusted closure exception copies (async=false)","status":"passed"}
{"name":"exception boundaries remain intentional keeps low-level untrusted closure exception copies (async=true)","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: throw \"retry\";","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: throw 42;","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: throw { name: \"DomainFailure\", message: \"retry\", code: \"RETRY\" };","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: await (async () => { throw { name: \"DomainFailure\", message: \"retry\", code: \"RETRY\" }; })();","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: throw Error(\"retry\");","status":"passed"}
{"name":"exception boundaries remain intentional rejects unhandled source errors at the public boundary: throw { code: \"RETRY\" };","status":"passed"}
{"name":"exception boundaries remain intentional retains the ok:false interpreter diagnostic envelope","status":"passed"}
{"name":"source exception propagation preserves the complete 01-waterfall-identity workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 02-auto-dependency-closures workflow","status":"passed"}
{"name":"source exception propagation preserves the complete 03-maplimit-lexical-state workflow","status":"passed"}
{"name":"source exception propagation preserves the complete 04-nested-finally-precedence workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 05-saga-delegation-cleanup workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 06-scan-reduce-state workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 07-forkjoin-last-values workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 08-plain-thenable-combinators workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 09-rejection-identity-matrix workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 10-recovery-annotation workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 11-waterfall-error-instance workflow","status":"passed"}
{"name":"source exception propagation preserves the complete 12-finally-domain-records workflow","status":"failed"}
{"name":"source exception propagation preserves the complete 13-domain-error-metadata workflow","status":"failed"}
```

## Original workflow GREEN

After the provenance-aware dispatch fix: 13/13 exact original outputs and complete call logs match native; 13/13 resolve ok:true. Same bounded child command and source bytes as RED. Full actuals:

```json
{"id":"01-waterfall-identity","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":true,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"],"steps":365}
{"id":"02-auto-dependency-closures","execution":{"ok":true,"returnValue":{"result":{"summary":{"identity":true,"values":[13,13],"labels":[2,4,7],"owner":true},"finished":7,"peak":2},"origin":{"name":"catalog","revision":3},"trace":[["start","seed"],["start","weights"],["done","seed"],["start","left"],["done","weights"],["start","right"],["done","left"],["start","labels"],["done","right"],["start","combine"],["done","labels"],["done","combine"],["start","summary"],["done","summary"]]}},"calls":["seed","weights:a","weights:b","left","right","labels","summary"],"steps":1496}
{"id":"03-maplimit-lexical-state","execution":{"ok":true,"returnValue":{"checks":[{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[0,0,105,0],[0,1,105,0],[0,2,105,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[1,0,110,1],[1,1,110,1],[1,2,110,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[2,0,116,2],[2,1,116,2],[2,2,116,2]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[3,0,122,0],[3,1,122,0],[3,2,122,0]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[4,0,130,1],[4,1,130,1],[4,2,130,1]]},{"sameLocal":true,"sameFunction":true,"sameSession":true,"readers":[[5,0,136,2],[5,1,136,2],[5,2,136,2]]}],"completed":6,"trace":[["finish",0,0],["finish",1,1],["finish",2,2],["finish",3,0],["finish",4,1],["finish",5,2]]}},"calls":["map:0:0","map:1:0","map:2:0","map:0:1","map:1:1","map:2:1","map:0:2","map:1:2","map:2:2","map:3:0","map:4:0","map:5:0","map:3:1","map:4:1","map:5:1","map:3:2","map:4:2","map:5:2","verify:0","verify:1","verify:2","verify:3","verify:4","verify:5"],"steps":1439}
{"id":"04-nested-finally-precedence","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":"body","body":true,"inner":false,"outer":false,"chain":false},{"name":"inner","error":"inner-cleanup","body":false,"inner":true,"outer":false,"chain":false},{"name":"outer","error":"outer-cleanup","body":false,"inner":false,"outer":true,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":"promise-finally","body":false,"inner":false,"outer":false,"chain":true}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"],"steps":818}
{"id":"05-saga-delegation-cleanup","execution":{"ok":true,"returnValue":{"results":[{"result":{"label":"normal","value":12},"effects":4},{"result":{"label":"recover","value":17},"effects":4},{"result":{"label":"cancel","value":"cancelled"},"effects":3}],"trace":[["normal","leaf-enter"],["normal","leaf-exit"],["normal","branch-result",12],["normal","branch-enter"],["normal","branch-exit"],["recover","caught",true],["recover","leaf-enter"],["recover","leaf-exit"],["recover","branch-result",17],["recover","branch-enter"],["recover","branch-exit"],["cancel","leaf-enter"],["cancel","leaf-exit"],["cancel","branch-result","cancelled"],["cancel","branch-enter"],["cancel","branch-exit"]]}},"calls":["normal:initial","normal:left","normal:right","normal:leaf-close","normal:branch-close","recover:initial","recover:left","recover:right","recover:recover","recover:leaf-close","recover:branch-close","cancel:initial","cancel:leaf-close","cancel:branch-close"],"steps":1145}
{"id":"06-scan-reduce-state","execution":{"ok":true,"returnValue":{"balance":13,"names":["open:0","credit:1","replace:2","settle:3"],"initialBalance":8,"aliases":[true,false,true,true],"numeric":[16],"numericIndexes":[1,2],"empty":[[19],[],false],"caughtIdentity":true,"trace":[["closed",4,true],["closed",3,false],["closed",0,false],["closed",0,false],["closed",3,false]]}},"calls":["scan:0","scan:1","scan:2","scan:3","scan:0","scan:1","scan:2","scan:0","scan:1"],"steps":760}
{"id":"07-forkjoin-last-values","execution":{"ok":true,"returnValue":{"success":{"emitted":true,"values":[{"id":"shared-last","value":23},{"id":"shared-last","value":23},7],"alias":true,"original":true},"empty":{"emitted":false,"values":[]},"noStreams":{"emitted":false,"values":[]},"rejectedIdentity":true,"trace":[["first","next"],["second","next"],["third","next"],["second","complete"],["first","next"],["third","next"],["first","complete"],["third","next"],["third","complete"],["empty","complete"],["drained","next"],["drained","next"],["drained","complete"],["failing","next"],["joined","next"],["failing","complete"],["joined","next"],["joined","complete"]]}},"calls":["first","second","third","first","third","third","drained","drained","failing","joined","joined"],"steps":763}
{"id":"08-plain-thenable-combinators","execution":{"ok":true,"returnValue":{"winnerIdentity":[true,true,true],"settled":[["fulfilled",true],["fulfilled",true],["rejected",true]],"rejectionIdentity":true,"aggregate":{"name":"AggregateError","count":2,"first":true,"second":true},"empty":[[],[]],"trace":[["caller"],["assimilate","slow"],["assimilate","fast"],["settle","fast"],["assimilate","rejected"],["settle","rejected"],["settle","slow"],["assimilate","all-error"],["settle","all-error"],["assimilate","any-first"],["assimilate","any-second"],["settle","any-second"],["settle","any-first"]]}},"calls":[],"steps":539}
{"id":"09-rejection-identity-matrix","execution":{"ok":true,"returnValue":[["direct-throw",true],["function-throw",true],["await-reject",true],["async-immediate",true],["async-delayed",true],["await-thenable",true],["promise-catch",true],["allSettled-reason",true],["catch-return-value",true],["array-rejection",true],["error-rejection",true]]},"calls":[],"steps":211}
{"id":"10-recovery-annotation","execution":{"ok":true,"returnValue":{"sameReason":true,"sameAnnotations":true,"original":{"attempt":1,"annotations":["recovered"]},"caught":{"attempt":1,"annotations":["recovered"]},"nextAttempt":2}},"calls":[],"steps":41}
{"id":"11-waterfall-error-instance","execution":{"ok":true,"returnValue":{"success":[true,true,true],"caughtIdentity":true,"shared":{"name":"ledger","entries":[2,5,11],"total":10},"trace":[["stage",0],["stage",1],["identity",true,true,true,true],["stage",2],["stage",3],["stage",0],["stage",1],["closed",10]]}},"calls":["waterfall:load","waterfall:commit","waterfall:fail"],"steps":366}
{"id":"12-finally-domain-records","execution":{"ok":true,"returnValue":{"results":[{"name":"success","value":"body-value","original":true,"overridden":false},{"name":"body","error":"body","body":true,"inner":false,"outer":false,"chain":false},{"name":"inner","error":"inner-cleanup","body":false,"inner":true,"outer":false,"chain":false},{"name":"outer","error":"outer-cleanup","body":false,"inner":false,"outer":true,"chain":false},{"name":"override","value":"outer-value","original":false,"overridden":true},{"name":"chain","error":"promise-finally","body":false,"inner":false,"outer":false,"chain":true}],"trace":[["success","inner-enter"],["body","inner-enter"],["inner","inner-enter"],["outer","inner-enter"],["override","inner-enter"],["chain","inner-enter"],["success","inner-exit"],["success","outer-enter"],["body","inner-exit"],["body","outer-enter"],["inner","outer-enter"],["outer","outer-enter"],["override","outer-enter"],["chain","inner-exit"],["chain","outer-enter"],["success","outer-exit"],["body","outer-exit"],["inner","outer-exit"],["outer","outer-exit"],["override","outer-exit"],["chain","outer-exit"],["success","promise-finally"],["body","promise-finally"],["inner","promise-finally"],["outer","promise-finally"],["override","promise-finally"],["chain","promise-finally"]]}},"calls":["success:body","body:body","inner:body","outer:body","override:body","chain:body","success:inner","body:inner","inner:inner","outer:inner","override:inner","chain:inner","success:outer","body:outer","inner:outer","outer:outer","override:outer","chain:outer","success:promise-finally","body:promise-finally","inner:promise-finally","outer:promise-finally","override:promise-finally","chain:promise-finally"],"steps":830}
{"id":"13-domain-error-metadata","execution":{"ok":true,"returnValue":{"plain":{"same":true,"name":"DomainFailure","message":"try again","code":"RETRY","retryable":true,"context":{"job":"alpha"},"contextSame":true},"allocated":{"same":true,"name":"Error","message":"try again","code":"RETRY","retryable":true,"context":{"job":"alpha"},"contextSame":true},"catchContinuationSame":true}},"calls":[],"steps":107}
```

## Root cause and patch scope

Source throw completions carry the original SandboxValue until a function/await crosses a native JavaScript rejection channel. The interpreter dispatch catch then previously applied host-style coerceThrownValue universally: name/message records became newly allocated subset errors (AW-001); remaining plain records/arrays were deep-copied (AW-002).

CapturedException now retains the existing callee.sandbox provenance through synchronous and asynchronous call captures. Internal builtin method captures are sandbox-originated. Uncaptured dispatch exceptions are internal runtime/await values. coerceThrownValue preserves sandbox-originated non-native-Error values; native Error conversion and existing subset-error span attachment stay first. Untrusted low-level closures still receive the old coercion/copy path. Public surfaceThrownValue, isErrorLikeValue/isInterpreterError classification, host bridge copying, native Error conversion, stack framing, fatal error handling, and run rejection versus ok:false envelopes are not changed.

This is an internal provenance flag, not a new source-visible wrapper. Source records are not decorated, globally reclassified, or copied, and no Promise/generator/checkpoint/replay implementation is modified. No CBI/PPR/AR remediation is bundled.

## Focused GREEN

97/97 tests pass across both added test files; exit 0, 964 ms total test invocation (413 ms tests). All original/reduction cases, 70 value/path combinations, host conversion/copy controls, and public rejection/diagnostic envelope controls pass.

## Final validation

All commands run in the owned clone against current TypeScript source.

| Command / check                                                                                                                   | Result                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `vitest run packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts` | RED 29 failed / 68 passed; GREEN 97 passed                                     |
| Focused existing exception/interpreter/async/generator/promise/host-bridge and error-shape tests, plus new regressions            | 11 files / 749 tests passed, exit 0                                            |
| `vitest run packages/safejs/src packages/agent-harness/src packages/toolcraft-codemode/src --reporter=dot`                        | 152 files passed / 1 skipped; 4136 tests passed / 34 skipped; exit 0           |
| Same broad command with `--reporter=json`, after final test typing correction                                                     | 4170 total, 4136 passed, 34 skipped, 0 failed, 153 files; exit 0; empty stderr |
| `tsc -p packages/safejs/tsconfig.json --noEmit`                                                                                   | PASS                                                                           |
| Explicit strict NodeNext typecheck of both new test files (command below)                                                         | PASS                                                                           |
| ESLint on all four changed TypeScript files                                                                                       | PASS, no diagnostics                                                           |
| Prettier check on all five changed files                                                                                          | PASS after normal repository formatting                                        |
| `git diff --check`                                                                                                                | PASS                                                                           |
| Parse embedded workflow templates with TypeScript AST and compare SHA-256 to original allowlisted inputs                          | All 13 source strings byte-exact, including final newline                      |

The 34 skips were already declared in the existing tests: 33 recorded node/memfs conformance gaps and one opt-in parser fuzz case. No skips were introduced or test classifications weakened. No adversarial suite, archived security payload, real guest IO, or malicious probe was executed. The broad relevant command does not include the separate toolcraft Ctrl-D suite; the reported five release-agent failures were not encountered or edited. No all-repository test/full build result is claimed.

The added tests' independent strict typecheck initially found one missing union narrowing on InterpreterResult.returnValue; the test now checks result.ok before that assertion. No production behavior changed for this correction. Broad tests were rerun afterward.

Reproduction/verification commands (use the clone's pinned node_modules binaries):

```sh
cd /Users/kjopek/Workspace/poe-code-safejs-source-exceptions
./node_modules/.bin/vitest run packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts
./node_modules/.bin/vitest run packages/safejs/src/interp/exceptions.test.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/async.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/interp/promise.test.ts packages/safejs/src/interp/host-bridge.test.ts packages/safejs/src/error
./node_modules/.bin/vitest run packages/safejs/src packages/agent-harness/src packages/toolcraft-codemode/src
./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --esModuleInterop --resolveJsonModule --types node,vitest/globals packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts
./node_modules/.bin/eslint packages/safejs/src/interp/exceptions.ts packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts
./node_modules/.bin/prettier --check packages/safejs/src/interp/exceptions.ts packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts docs/plans/safejs-fix-source-exceptions.md
git diff --check
```

## Controls and envelope contract

| Control                                                                                 | Native or established boundary expectation                                                                 | RED                                                | GREEN        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------ |
| Original 02/03/11 full workflows                                                        | All values, function/object aliases and tick order unchanged                                               | PASS                                               | PASS         |
| Original 09 identity matrix                                                             | Eleven true identities                                                                                     | Six false; five controls pass                      | Eleven true  |
| Original 10 recovery                                                                    | Same record/annotations, attempt 1, nextAttempt 2                                                          | False aliases, original attempt 0, nextAttempt 1   | Exact native |
| Original 13 ordinary error-shaped record                                                | RETRY / true / context.job alpha; same record and context                                                  | Metadata undefined; false aliases                  | Exact native |
| Original 13 actual source Error and fulfilled catch continuation                        | Metadata and aliases retained                                                                              | PASS                                               | PASS         |
| Ten propagation paths with ordinary records and plain objects                           | Same reason/context and original attempts mutated to recovered                                             | Direct pass; other nine paths fail for each shape  | All 20 pass  |
| Ten propagation paths with Error/string/42/null/undefined                               | Same source value, no accidental wrapping                                                                  | All 50 pass                                        | All 50 pass  |
| Host TypeError, synchronous and async                                                   | TypeError brand/message/code retained; registered detail copied, host attempts unchanged                   | PASS                                               | PASS         |
| Host ordinary thrown record, synchronous and async                                      | Error / retry / undefined code / instanceof Error true                                                     | PASS                                               | PASS         |
| Already-copied host return thrown inside source                                         | Internal catch retains source alias; original host record unmodified                                       | Source alias fails; host unchanged                 | PASS         |
| Raw low-level untrusted closures, sync and async                                        | Plain thrown graph still copied before source catch mutations                                              | PASS                                               | PASS         |
| Public unhandled string, number, error-shaped record, async record, Error, plain object | run rejects; valid name/message/stack/span. Unknown names normalize to Error; plain-object message is JSON | PASS after documented initial test-only correction | PASS         |
| Unbound identifier                                                                      | run resolves ok:false with UNBOUND_IDENTIFIER / ReferenceError diagnostic                                  | PASS                                               | PASS         |

## Final path and hash manifest

Base SHA: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`. Only the following four TypeScript paths and this plan are authored changes. New test files and plan are absent at base. Hashes are SHA-256, not git blob IDs.

| Path                                                              | Base preimage SHA-256                                              | Final SHA-256                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/exceptions.ts`                        | `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf` | `079e267b3c55d4f3dac843c3d70faea15e2fe7cb352ba734b532b8bdbbf89127` |
| `packages/safejs/src/interp/interpreter.ts`                       | `bcf749b3e19160ac30d7448fc03f2b65e85bef9b2cb217952badea504a161e61` | `4543a54c54ddc1a94f8c1a8a389360ed0bc89d1fb6ef714b2503f57ab2fdd196` |
| `packages/safejs/src/interp/source-exceptions.test.ts`            | `ABSENT`                                                           | `e0de4f1e1532ac2b43ff8776b234fb1ca9f4be95629baebd2725b7adaa423075` |
| `packages/safejs/src/interp/source-exceptions.boundaries.test.ts` | `ABSENT`                                                           | `1bda65290bc33a760febf4976df4fb3bb4aa107eed169c588ae930d67d21e99a` |
| `docs/plans/safejs-fix-source-exceptions.md`                      | ABSENT                                                             | Reported externally at handoff to avoid a self-referential digest  |

Unchanged root dependency manifests, verified against git show at the base:

```text
a3e5638abe5f1df44298e105db2a25c93ad6d0d26ef1d8ab2f93cfa466f11b99  package.json
297af2f85db1eeedaca7a33f64a4ec95bed39754d42a1e787a236c4af55c29c7  package-lock.json
```

## Risks and handoff limits

- The changed decision is confined to trusted sandbox propagation. Internal runtime errors still convert from actual native Error, and untrusted low-level closure exceptions retain coercion/copying. Future new host ingress paths must retain this distinction rather than treating arbitrary foreign reasons as sandbox values.
- Existing source capture, fatal/unhandled rejection, error-shape, checkpoint/dump/restore, cancellation and host replay tests in the selected source suite pass. This does not certify every historical snapshot, external retained-callback lifetime, CBI/PPR/AR case, or historical error-record serialization/migration. No replay repair or execution-semantics version change is included.
- Native oracle comparisons are restricted to these fixed ordinary programs and pure bounded tick stubs. They establish local exception metadata/alias behavior, not general security or whole-upstream compatibility.
- No visual CLI code or layout changed; no CLI screenshot was taken. Error formatting is covered by the existing source error-shape/format suites.
- Independent validator must recheck exact paths/hashes and reproduce this evidence. Publisher must serially three-way-integrate these paths with other isolated core changes, then separately validate the integrated candidate. Never overwrite another clone's work or assume this base equals the publisher's latest base.
- No commit, push, release, other-clone mutation, README addition, or overall-goal completion. The working tree intentionally retains this uncommitted fix for review.

## Integration proof — August 29, 2026

This section is appended by the AW integration author. Every byte of the historical plan above, both validator plans, and every author/validator assertion remains unchanged. This is an integration-author handoff, not fresh Nash independent validation or publication approval.

### Base and publication order

- New owned clone: `/Users/kjopek/Workspace/poe-code-safejs-source-exceptions-integrated`. Source and publisher clones remain read-only.
- Origin: `git@github.com:poe-platform/poe-code.git`; single-branch main clone followed immediately by successful `git -c pull.rebase=false pull --ff-only`. Frozen base: `87f65dc26cdbdf28500e836204d2b205caaf8b80`.
- Base includes ARRAY `7fec2826bac2933483c2579ff47d2264f8e1f422`, COLL, OBJ/MC, TREE/HI, STR-03, and later keyword/async-computed-method parser changes. No later pull or base substitution.
- Approved publication sequence: NUM-001 prerequisite first; AW-001/AW-002 delta second. Both are staged only in the owned working tree and exported separately; the Git index is unchanged.
- NUM readiness points to candidate manifest SHA-256 `d3e8d605c2a93ee2db22c16c6cc1acc66db373927aafbb23a25b7e7396fc234e`. This is the referenced manifest digest, not readiness.json's own digest. Eleven exact publishables: five production, four tests, two plans; seven base preimages, including two existing tests. All seven match this current base.
- AW candidate manifest SHA-256 `a0be77cddd4493eccf24e3054488cc382ea8a53739501daa2e06bae376cda8fe`: seven publishables only. Its 37 evidence entries are not publishable files. Two original production preimages verified against the old base; current post-NUM preimages captured separately.
- Installed pinned dependencies with `SKIP_SYNC_SKILLS=1 npm ci`; 21/21 narrow dependency builds succeeded. The requested audit guard was re-established from inventory-verification metadata: exact 38 excluded paths plus all security/. No original-audit payload was read, hashed, searched recursively, or executed. Original programs came from verified frozen nonexcluded regression sources.

### Three-way preservation

NUM merged without conflicts and all eleven postimages remain byte-exact to the approved candidate. AW was merged from its two old-base preimages into the actual post-NUM files, never by replacing the current interpreter with the old whole file. No textual conflicts or semantic repairs were necessary.

| AW production file                          | Current post-NUM preimage SHA-256                                  | Integrated SHA-256                                                 |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/exceptions.ts`  | `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf` | `079e267b3c55d4f3dac843c3d70faea15e2fe7cb352ba734b532b8bdbbf89127` |
| `packages/safejs/src/interp/interpreter.ts` | `50175cb793ecf85ce80cf0e7f0d2667680090eed8c70c20c1f9158e6cab8cbdb` | `f3b7c19f4ef98ec757e40d8a8c8a6d372329f80c5a12f8617b41ea198b01b132` |

The interpreter retains ARRAY argument/callee evaluation order while adding AW's exception provenance at the current capture sites. Inverse three-way application of the old AW delta reproduces both current post-NUM preimages exactly. All 296 other tracked SafeJS paths retain their base bytes; protected control tests verify collection cursors, array own metadata/call order, object aliases, numeric globals/constants, parser/tree handling, Markdown offsets and string replacement. NUM arity and restoration changes are not part of the AW delta.

### Current RED and GREEN

Native expectations were generated first using the unchanged original source strings and pure bounded stubs. All child execution uses TERM unset, a 192 MiB heap limit and a 10-second parent timeout; workflow tick calls are capped at 100. Captures use the validator's finite deferred stubs and 10000-step budgets. No LLM or real guest IO.

| Gate                                                    | Actual result                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Post-NUM, before AW: four NUM test files, no exclusions | 122/122 pass                                                                                       |
| Post-NUM AW tests                                       | 47 fail / 148 pass (author: 29 failures; independent: 18 failures)                                 |
| Post-NUM thirteen originals                             | 10 semantic mismatches, 3 matches; all full tick logs match native                                 |
| Post-NUM forty finite captures                          | Four plain-record cases differ in both uninterrupted and restored outputs; other 36 match          |
| Merged AW author suite                                  | 97/97 pass                                                                                         |
| Merged AW independent suite                             | 98/98 pass, assertions byte-exact                                                                  |
| Merged thirteen unchanged originals                     | All complete native values and tick logs match                                                     |
| Merged forty fresh captures/restores                    | All complete native, uninterrupted and restored values match; snapshot markers retained            |
| NUM plus prior published controls                       | 1510/1510 pass across 26 files, no test-name exclusions                                            |
| Broad source/harness/codemode suite                     | 5085 pass / 34 existing skips / 0 failures; 175 files                                              |
| Full `env -u TERM npm run build`                        | 67/67 workspace builds, root type compilation, schema generation and bundling pass                 |
| Configured new-test types                               | All five new NUM/AW test files pass using parsed packages/safejs/tsconfig.json options with noEmit |
| SafeJS production types and root lint:types             | Pass                                                                                               |
| Configured ESLint on 14 candidate TypeScript files      | Pass                                                                                               |
| Configured package lint                                 | All 17 rules / 68 packages pass                                                                    |
| Format on all 18 publishables                           | Pass                                                                                               |
| Post-build final NUM+AW tests                           | 317/317 pass                                                                                       |

The forty cases comprise ten values, before/after catch positions, and both next-yield dump and current-capture modes (20 each). Each creates a fresh snapshot in this integrated runtime; no historical capture was substituted. Full native/post-NUM/merged outputs, serialized snapshots, hashes and actual inline commands are retained in `out/safejs-remediation/source-exceptions-integration/original-comparisons.json`, `capture-comparisons.json` and `evidence/`. Both embedded copies of all thirteen original sources are byte-exact to the frozen inputs.

A metadata-only verification driver first compared fixture objects against input objects that also carried a path field. Its failed attempt is retained in evidence/fixture-byte-integrity.json. The corrected driver compares id/source fields and verifies all 26 embedded source copies; no test, assertion or program was changed. No merge or semantic repair was hidden by that correction. Historical validator attempts/restrictions remain intact.

### Scope and frozen handoff

- `out/safejs-remediation/source-exceptions-integration/num-prerequisite-manifest.json` and `num-prerequisite.patch` describe only the eleven NUM files and their seven current-main preimages.
- `out/safejs-remediation/source-exceptions-integration/aw-delta-manifest.json` and `aw-delta.patch` describe only the seven AW files and their two current post-NUM production preimages. The only author-owned plan change is this append-only integration proof.
- Top-level manifest/readiness bind both separate candidates, all validation evidence, input provenance and protection records. Ignored output uses a narrowly scoped local .git/info/exclude entry, not a tracked ignore-file edit.
- AR-001 remains separate: dumpCurrent during an active injected host operation still rejects, and the validator's restriction assertion passes unchanged. This work does not fix external active-host-call dumping or certify arbitrary historical snapshots.
- The broad gate retained 33 existing memfs conformance skips and one opt-in parser fuzz skip. No assertions were relaxed. The separate toolcraft Ctrl-D suite was not invoked or edited. No full-repository test-suite claim is made.
- Full build generated four untracked terminal-pilot font assets. They remain untracked, are explicitly nonpublishable, and are absent from both candidates. No blanket staging or unrelated cleanup occurred.
- No new production changes beyond NUM's validated prerequisite and AW's merged delta; no CBI/PPR/AR repair, README addition, inline comments, standalone QA executable, original/shared/publisher writes, branch creation, stash, reset, commit or push.
- Fresh Nash independent validation must check these frozen bytes. Publisher must preserve NUM-before-AW order, verify actual-main preimages, three-way reconcile any later drift, and validate again. This integration-author result is not release/overall-goal completion.
