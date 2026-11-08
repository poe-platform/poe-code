# F05 v3 author repair — HOLD, dynamic controls unrun

2026-08-28. Code/preseal commit `dccf634ae3fa2ffe6decab4955dcef55d48cd7c9`. Main manifest SHA256 `b83584d1584474a7899510ed55dd76cf09aa8fa39d913da83273a08317a92bb4`; preseal SHA256 `7290c78747cbf1a2b35bf50062fa8de30ee13da8e497eb93e72c327a8884a053`. Evidence commit is independently identifiable as the commit adding this handoff and FINAL.json; it is not self-embedded.

## Patch and immutable inputs

Exact old code7b350bf7472cabfc2e5ed699f19c2a1c8bde2f98, old evidence7b269a291d9fdc76e0760d36446d937e54060757, Raman review61d32bd080e7a134b8b6f26de451cd7f611b86db and Workerdesign checkpoint82aae2f5bff404423e81ddb6ddfacb6e0abd35a9 were authenticated. Old manifest3b4169c6dcb15f5f9d43e08fd417c93a38004604404cebab724cb44dbeae5f8c remains intact. Complete recipe is copied in recipe/.

Only reconcileReceipt nativePromise logic changes: successful synchronous F05 requires a present boolean false; present values in every other case still require true. Strict equality does not coerce null/numbers/strings/objects/undefined. Original absent-field throw branches and optional absence outside successful F05 remain unchanged; no universal presence validation is claimed. The only other supervisor change is the versioned own-root locator. README, REUSE and MANIFEST metadata changes are separately enumerated. Twelve unaffected recipe files, seven extracted whole functions and all66 public-source data hashes pass source-only comparison; no source/child/reference/loader/guest program change. See SOURCE-COMPARISON.json, controls/EXTRACTION.json and evidence/SOURCE-AUDIT.json.

## Single authorized launch: admission failure, no retry

The presealed controller launched once at 2026-08-28T20:12:48.585Z and naturally exited1 at 2026-08-28T20:12:49.034Z (449ms), signal null, rescue0. Node denied mkdir of runs/f05-01 before LAUNCH.json, subject import or controls. The initially absent allowed runs path was created, but nested-directory access was denied. This unrelated launcher defect is reported, not repaired. Complete558-byte stderr and zero stdout are retained; no fixture artifacts were produced. The empty runs directory is preserved. No second launch, fixture run or syntax command occurs.

Two labels/34 subchecks were planned:31 whole composed acceptEvaluation calls plus3 direct whole-reconciler own-undefined checks. Actual unique cases0, subchecks0, composed0, reconciler0, subject imports0, all34UNRUN. One controller parsed/started; zero fixture children, zero natural/contained fixture closes, zero rescues, peak existing launcher+controller2. Therefore there is **no actual whole-composed proof or dynamic strict-boolean pass** from this patch. Exact reviewer P06 artifacts are retained; engineEntered1 is historical inert fixture DATA, never actual entry. F03 is declared synthetic DATA. Synthetic engine/load/close ports would not establish real engine behavior even after a future pass.

Post-preseal source/data audit106 assertions took 727ms; committed-file prelaunch authentication took 1038ms. These source-only checks are not extra dynamic passes. Sixty-six Git blob metadata reads occurred outside the synthetic controller; this is not a claim of six total OS processes across preparation and finalization. Preparation reading/hashing was not fully timed: no all-task five-minute duration claim. Controller449ms is measured. No RSS guarantee.

## Complete inactive main profile

Main limits remain480s,192MiBwork,9direct children/10processes;66public sources/all18 prior bindings/4tool files. Eight evaluations remain F01,F02,F03,F04,F05,F06-object,F06-null,F07; all8UNRUN and actual main evaluations0. Every source/tool/entry/child hash, ABI, guest-source hash, limit, extraction binding and exact review/grant field is in PROFILE.json. Source manifest `a670629995f8cb7331a5e24d35ad4bb185dc0fbe5f70de8281598de615cd35b1`; tool manifest `4efc7ff6181d6f92dd9aa3fe67803c55af027adc734b701582998efb452ae788`. Node binary was stream-authenticated, not copied; compiler/Git tool-file hashes are unchanged inherited bindings, not new executions. Public source archive was parsed and hashed as DATA only; no engine tree materialization/import, private read, compiler/native/network/Worker/product work or counter reset.

## History and authority

Original Raman20/21HOLD plus3unscored,11children (7natural/4SIGTERM),0rescue unsafe=false remains unchanged and unrescored. Prior author10 observations/seven children (4natural/3SIGTERM) remains unchanged. No old cohort is rerun.

Fresh bounded control authorization and launcher follow-up are needed before any further run; no automatic retry. Fresh Raman focused review and then fresh ROOT GO remain necessary. RAMAN-REVIEW.template.json is NOT_REVIEWED. ENGINE-GRANT.template.json has authorized=false, exact code/manifest/source/tool/ABI/limits, and unresolved review/run/time placeholders. No actual main activation, engine GO, Worker work or readiness grant is issued.

Authoring-tool qualification: one preparation apply_patch call timed out after files were written; all32 preseal rows were subsequently authenticated before committing. This was not a validation/control execution. The tool failure is retained in evidence/PREPARATION-NOTE.json.
