# Resolved Unit2 author handoff — independent review required

2026-08-29. **Author-scoped results, not complete Unit2 or GNU parity.** No native goldens were acquired or executed. Root's exact diagnostic/status selection remains provisional. Unit1's independent review is separate; its historical failures are not rescored here.

## Immutable source and package

| Item | Binding |
|---|---|
| Unit2 production commit | `928be5585f05c15867fbbb5f4b5debe153b0734e` |
| Author preseal | `30af0d840b8b05b8386c14d86143d1ed3ccbd4ad` |
| Selected composition | `26215b99cb379a9f825f803454f758fab5a3c8e9` (computed tree, not a claim that this object was published) |
| SOURCE.json SHA256 | `75ac56902fdce22f8292c17c14d48287063a5544c46ac8c526b5d4572143bde2` |
| Baseline | accepted c83 public80 plus exact provisional unit1 `1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e` |
| New overlay | only `src/shell/runtime.ts` and existing parameter-line metadata in `src/shell/parser.ts` |
| Runtime source SHA256 | `d47946f659af53880de53e65f93d26b934404a56b31183d937174d0f46221f66` |
| Parser source SHA256 | `e8c19ffc7a5c2ffcd63608f0fd4722466e1999e647bc2e676b12710555a0e9a4` |
| Source input closure | 292 authenticated regular input blobs; canonical tree witnesses and unchanged baseline ancestors included in SOURCE.json |
| Actual full package | `results-v1/virtual-bash-0.0.0.tgz`, 950 members, 865091 bytes |
| Package SHA256 | `1fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4` |

This is not a raw HEAD build. Runtime dependencies, root exports, public options, limits and default80 names are unchanged. Frozen unit1 files/fixtures/candidate were not modified. No Node-command/YQ/XAN/private engine or later feature overlay entered the source view.

## Implemented resolved behavior

- Finite +/- e/u clusters and terminal o with an exact supported name including nounset. Existing e/pipefail control selection is unchanged, nounset absent/off at new logical root.
- Presence-sensitive unguarded reads, lazy existing defaults/alternatives, empty values, ordinary aggregate exemptions, scalar/positional/element distinction.
- A private status1 exit unwinds current function/source/eval scope to its logical execution boundary; isolated children retain their own boundary and existing outer status rules.
- Budgeted active stderr, raw caller/limit handling and new diagnostic-sink failure transport. Nested function/subshell/pipeline sink failures and explicit public invoke rejection are exercised; no reason-equality/global provenance table added.
- Diagnostic cleanup is registered/owned through existing mechanisms. A diagnostic write failure is not replaced by command-owned input-close failure; nonzero nounset result is not itself an escaping host rejection.

The public-invoke test catches the child's raw rejection explicitly. This does not claim that an arbitrary host handler's own catching, replacement or mapped ordinary command-error behavior is overridden. New private diagnostic propagation beyond the tested call patterns remains an independent-review target.

## Actual author results

One outer launch, exit0, no runtime retry/source correction. Source/build, offline package/install (scripts disabled), and physical move ran against the selected closure. Each layout:

| Cohort | Result | Qualification |
|---|---:|---|
| Resolved strict-mode selection | 50/50 | 39 original known-role identities +11 separately named author controls; not50/50 of the original design |
| Git public composition | 45/45 | Existing selected author corpus, no native Git |
| apply_patch public | 28/28 | Existing author corpus, retained module/public limitations |
| Arrays | 12/12 | Existing selected corpus, not full array profile |
| Coherence | 18/18 | Existing selected scalar/builtin/module flows |
| Unit1 redirection fixture-v2 | 48/48 | New composition execution of versioned assertions; original unit1 22/48 and its failures stay historical |

Thus **201/201 selected identities per layout, 603 across source/installed/moved**, without promoting the eleven open design rows. U49 uses two rejection values and E08 three programs; identity counts are not counts of individual Shell.exec calls.

- Strict production build passed once. Six public consumer type groups passed: three positive and three negative groups with18 required diagnostics. They are existing Git/public API controls, not new nounset type APIs or global typecheck.
- Three actual loaded compiled mutations detected (missing-read check, function fatal propagation, u setting); three restored single-case positives passed. Two missing/changed package-binding controls refused as intended. Mutant failures are negative controls, not product passes or source patches.
- Source src/dist, installed/moved package membership and post-run292 input hashes checked; actual loader traces and per-member package hashes are retained. No source fallback was allowed.
- Runner35.436s, outer36.093s. 36 supervised direct children,26 conservative internal-loader reservations,0 product RegexWorkers; all direct children closed naturally, no TERM/KILL. This is62 run-owned slots plus outer/preparation/publication development roles, not a kernel process census or proof about arbitrary host descendants.
- Runner capture3034669 bytes; final run scratch71023010 bytes, below sealed bounds. No native/oracle/private/engine/network/full-gate execution. RegexWorker compatibility is not demonstrated by0 workers.

## Still OPEN / outside this implementation

The immutable50-design role split is in ROLES.json. **U06/U07/U17/U27/U28/U31–U36 remain unexecuted (11), not passing skips.**

1. Arithmetic bare-name/LET nounset behavior is unchanged and unqualified; no guessed missing-read override or expansion to indexed arithmetic.
2. Unset versus set-empty aggregate array lengths retain prior behavior, no compatibility verdict.
3. Invalid-option partial mutation retains implementation-specific token validation; no GNU claim. Existing no-argument/listing/unsupported option surfaces are not newly implemented.
4. Exact GNU diagnostic/status/line bytes and virtual `$-` versus native option-inventory differences await the separately authorized reference/native lane.
5. Explicit `${x?}`/`${x:?}` legacy status profile, interpreter startup-u, local-option restoration, SHELLOPTS, [[ ]], declaration/mapfile features, strict integer/array extensions remain outside the resolved subset.
6. No native40/43 oracle, broader gate, unit1 independent acceptance, global product score, universal cleanup or preemption claim.

## Preserved preparation/publication outcomes

The actual author runner completed successfully before evidence publication. `publish.mjs` v1 then failed an artifact-role assertion on the **known empty `global-npmrc` setup file**, not during product execution. The full exception and old helper remain. `publish-v2.mjs` adds only exact npmrc/global-npmrc roles with size0 required, uses separately named publication receipts, and publishes the same retained run without rerunning it. No source/fixture/runtime expectation changed for this correction.

`results-v1/RAW.json.gz` binds191 records (9143898 original bytes,3551274 compressed), SHA256 `2a7b3163dbb9aa1e49d4bc4cfc7225e152e1a5381a0abcd3d4520dcfd10bb343`. It includes admission/source inspection, all run stdout/stderr/loads/resources, source/tool/package manifests, outer and failed-publication receipts. Instruction reads were context-only; no AGENTS plaintext was copied or materialized.

Retained roots: `/tmp/strict-mode-author-preparation-IGGdKS`, `/tmp/bash-strict-unit2-launch-hy4rsN`, `/tmp/strict-mode-author-YM54kF`. No active author child remains. These are evidence, not current live source or an instruction to repeat the one-shot run.

## Independent handoff

Use this selected manifest/full package and unchanged known-role cases; keep the original design's unknown expectations null. Prioritize lazy nested alternatives, fatal function/source control, isolated-child continuation, raw/falsy diagnostic rejection, cleanup precedence and caller/limit competition. Additional reference-backed arithmetic/length/diagnostic outcomes need root binding before implementation. No further source widening or runtime retry is performed by this handoff.
