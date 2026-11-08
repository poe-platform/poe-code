# Version 4: byte-adjudicated source/fixture packet

2026-08-29. SOURCE/DATA only; no actual authorization or execution-ready claim.

## Exact correction

The committed and materialized v3 fixture at `aed62f65` is 15,764 bytes,
SHA256 `298fce206c0c4abf5a9960e9140d5b430267cf9819089a0bbfbb3936af9dabbc`.
Reconstruction from its authenticated generating patch yields 15,763 intended
bytes, SHA256 `6d8a19854a6e96986013ed3d94ee15dd774e225259dea922bf4749799c60d89b`.
The first difference is byte offset 15,763: one additional `0a` in v3.
Every earlier byte is equal. The generator split a terminal LF into an empty
sentinel, emitted that as another added patch line, and materialization added
one LF. The independent line-materialization calculation reproduces the
committed bytes exactly. No newline normalization or observed-hash substitution
is used. `ADJUDICATION.json` records committed blob identities and byte evidence.

Root's conditional authorization applies: the v4 serializer removes only that
artificial split sentinel. `CORRECTION.patch` was applied with apply_patch.
The seal requires exact intended Buffer equality and expected size/hash on
the physical v4 file. All original v3 STOP/captures remain untouched. Original
and superseding C11/C14 expectations are UNRUN, not failed or passing cases.

## Unchanged source and planned coverage

Derived source tree `3adc676a0ab638c9788ef007e465931d65d2c6fe`, 309 inputs;
manifest SHA256 `ef0b79dbd30cebec3f8b939a98928b9441947ff4be724e5031b2ee03925f26ae`.
Node's sixteen files are unchanged. Default80; Node/curl/SafeJS remain opt-in.
1,014 package members is a PREDICTION, with no built package hash yet.
`PRESEAL.json` admits unchanged v2 files and replaces only the workflow file
route with v4. Twelve earlier DATA controls are inherited, not rerun.

All eighteen author IDs remain UNRUN: C01 inventory/options; C02 strict/lazy
pipeline; C03 quoted patterns; C04 arrays/functions; C05 pipefail; C06 pipe
stderr ordering; C07 combined redirection effects; C08 source/LET; C09 fail
before provider; C10 engine argv; C11 curl/Node edit/Git diff; C12 curl auth;
C13 readonly Git queries; C14 patch/Git diff; C15 engine readonly refusal;
C16 engine caller/cleanup; C17 EXACT non-async invocation Promise; C18 engine
replacement/snapshot. C10/C11/C15/C16/C18 are five separately authorized engine
workflows; remaining thirteen are engine-free (39 layout slots, versus15).
Retained cohorts: 48+ALL50 Unit2+67+35+12 =212/layout,636 total. N14 twelve/layout
adds36; combined proposed engine-free total711. Dedupe exact cohort/layout IDs;
never double-count Unit2. Six type groups and21 negative sites across layouts
remain proposed, not emitted diagnostic counts. Independent18+6 proposed slots
are not implemented or credited here. Node61/public24 are separate recipes.

## Exact command proposal and concrete unfinished work

The authenticated `aed62f65:v3/HANDOFF.md` command section remains a PROPOSAL:
one TS5.9.3 production build; offline scripts-disabled npm10.9.7 pack/install;
same-Buffer exact raw package admission BEFORE inflate; physical directory
rename; strict staged consumer typing; literal retained cohorts. Its staging
instruction is superseded ONLY to use v4/workflows.mjs with unchanged
v2/workflow-entry.mjs and v2/admission.mjs. `--test-reporter=tap` does not turn
that JSON script into node:test. No build or consumer command was executed.

Engine-free proposal: 2,700s including cleanup/publication;112 known OS starts,
peak4;192MiB captures;1GiB work;30s/case;120s/build;40 fixed loader admissions;
8 qualified RegexWorkers;0 engine Workers/private inputs. Separate engine
proposal:1,800s;64 starts;peak4;96MiB capture;768MiB work;12 loaders;18 Node
Worker ceiling for15 workflow slots;0 RegexWorkers/private inputs. These are
requested ceilings, not measured usage or current permissions.

Remaining blockers are concrete: integrated outer product supervisor with
deadline/capture/owned-teardown tests; complete staged retained-helper closure;
loaded mutation/restoration/binding-negative dispatch; actual build/full member
inventory; PUBLIC95/adapter/support closure from Poincare. No engine locator
discovery was repeated. The v3 text claiming an existing PUBLIC-ENGINE-RECEIPT
is stale after its STOP: no such receipt was produced, and it is NOT inherited.
The per-case entry timer alone cannot prove retirement or release hung work.
Maintained selector `tests/integration/agent-bash-smoke.test.ts` and optional
package script remain proposed only, with a separately admitted tsx closure.

The source/fixture seal is useful for inspection, but is NOT a complete executable
preseal. Actual source/install/move/types/mutants/engine outcomes remain UNRUN.
Capture event records cover direct metadata children; they are not complete
transitive process-group or future product cleanup proof.
