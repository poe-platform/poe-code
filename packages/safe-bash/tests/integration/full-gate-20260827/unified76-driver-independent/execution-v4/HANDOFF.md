# Independent unified76 bounded execution — HOLD

This is a qualified component review, **not driver integration acceptance, public acceptance, root release, or a full gate**. No product build, typecheck, pack, public fixture cohort, private SafeJS load, or full-candidate reconstruction was performed.

## Immutable identities and chronology

- Product base: `44f00bf84278e3361b52106478d59c707ab7b2bc`.
- Candidate: `f5e9fc49b6abb38e180cc9de16c95fced102ff75`; tree `5687cbdebc46ec6d3618d32072c4de708118b9bb`; unchanged source tree `5876c6bf4ad9bc07f22cc46f8dbee99461981862`.
- Launcher/source: `2713defc1f53a00dd975931946de4782a980836d`; evidence: `b283eb0dad7a895168ad6b5df47db4066a95b7e3`.
- Preexecution plan: `2c5cf4676f8d5d4738f8765d5b1d67d4b93f1fdc`; attempt1 plus followup freeze: `3856519ab1d9bf5fe4b9c722de2aa8b73eddb39d`; followup plus final completion freeze: `79b40285303d57cba08b5ce6463d7558ed7610b4`.
- Original preinspection22 seals `7f98f745ffbf14da484ca3867ebf09cfa18841a2` / `148d77b2f2a30d7e24a29e977dc9104cd02d1113`, v2 `dfd7775b5319a85dffeee9c240806677d39e3572`, and v3 `97ae548cbbf518317457d9b83680d0adb2f2e834` remain unchanged. Initial author-file existence preceded the original seal; this is not literal pre-authoring attestation. Pinned bodies were inspected under later authorization before the v4 plan; driver/product imports had not occurred before that plan commit.
- Execution windows, UTC: attempt1 `2026-08-28T02:09:28.528Z`–`02:09:43.769Z`; followup `02:14:26.686Z`–`02:14:30.465Z`; completion `02:17:12.688Z`–`02:17:15.862Z`. Local timezone is America/Chicago, August27 CDT. These are actual bounded windows, not claimed sustained work duration.

## Results without hidden retries

Attempt1 retains **12 PASS / 7 FAIL / 3 HOLD**. Its failures include the review parent's permission-mode environment propagation and relative-symlink setup. A separate builtin probe observed Node24 `spawnSync` appending inherited permission flags to the supplied environment's `NODE_OPTIONS`; that contaminated later admission and made the first narrow-read probe incorrectly broad.

The separately frozen followup retains **4 passing subgroup sets / 4 failing subgroup sets**, not another22-group denominator. Fresh environment verification succeeded, as did genuinely narrower permission checks and retained package inspection. Relative links still failed under the review parent; `GIT_PAGER` correctly blocked the first clean-release attempt. Changing cwd had not solved relative-link setup, and that failed hypothesis remains recorded.

The final separately frozen completion has **4 passing subgroup sets / 0 failures**. Hash-recorded `/bin/ln` prepared only exact owned fixture links; actual archive verification then ran. Transport used tiny regular files, with escaping-link bytes supplied as a Git object. The actual unreleased launcher refused at the nonexistent release file after the explicitly prohibited ambient keys were removed. No valid receipt was fabricated.

The consolidated **v4 bounded criteria** are **19 PASS / 3 HOLD**, not22 unconditional passes:

| Groups | Status | Evidence |
| --- | --- | --- |
| A01–A03, A05, A07, A09, A14, A16–A17, A19, A21–A22 | PASS, bounded/static as frozen | `RESULTS.json` |
| A04, A08, A15 | PASS, bounded; initial failures retained | `RESULTS.json` plus `FOLLOWUP-RESULTS.json` |
| A06, A12–A13, A20 | PASS, bounded; both prior attempts retained | `COMPLETION-RESULTS.json` plus prior passing subcontrols |
| A10 | HOLD: real build/type reuse unexecuted | Authenticated seam rendering and one-driver-build verdict mutations passed; no production integration |
| A11 | HOLD for independent build derivation | Actual complete package hashes/listings passed in followup; no independent build reproduction |
| A18 | NOT_EXECUTED / HOLD | Product cooperative/root-barrier cleanup not replaced by supervisor evidence |

No author56, author components34+12, fixture49pass/1missing-helper failure then separate19/19, old2ff20/1, historical71PASS/7NOTEXECUTED, or prior F01 static10 is included in that denominator. Original22 assertion bytes and their historical unexecuted status remain unchanged.

## What was actually established

- The candidate is directly based on44f, with exactly the four authorized paths. `RESULTS.json.fixtureProof` contains complete before/after hashes, Git blobs, replacement multiplicities and full-index diff. Reversing all declared replacements restores base bytes. The public inspection fixture has the complete76 name/count sweep and two custom77 counts. No fifth path, helper373, later WHICH77, or Stage2 enters this candidate.
- Exact37397 committed blob/mode/size entries total2382440321 bytes. Exact632 canonical and192 classified memberships are validated, not merely counted. Runtime-helper changes/removals, additions, modes, directories, source/link origin changes, malformed transport objects and escapes exercised actual frozen guards on small owned namespaces.
- Node `v24.11.1` realpath and SHA256 `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0` match. Actual declared61 readable tool identities and four dependency trees match; native49+2 membership is preserved. This is qualified tool/profile binding, not51 unique executable binaries or native semantic parity.
- The exact11 tool/system-library reference pairs and macOS26.4.1/build25E253 metadata are retained in `FOLLOWUP-RESULTS.json.external.systemBoundary`. These are metadata-only unreadable references, **not file hashes or full-OS attestation**. Extra/non-system/readable references and ambient injection are rejected. Other required readable tools/dependencies were hash-checked; no generalized library exception was introduced.
- Actual pinned loader probes authenticated own marker bytes and rejected wrong hashes/outside-origin loads. Explicit TAP/concurrency2 argv ordering and omission mutations ran. A tiny independent `node:test` capture exercised the frozen TAP reader; truncated capture did not reconcile. This is not the canonical cohort or a full per-phase/nested-child permission audit.
- Actual supervisor natural completion, timeout, output overflow and observed descendant cleanup ran. Forced cleanup remains non-green even with no survivors. Actual strict verdict mutations reject guard, cleanup, survivor, signal, missing phase/binding/capture, second driver-managed build and nonzero skip/TODO/cancel/fail. No SIGSTOP was used.
- The selected inventory checker actually ran with frozen current routes and Git-byte callbacks. F01 CURRENT provider is `webdav-loopback`, blob `21f5fe464f028b4e056d2aae40b26612f560bd95`, actual SHA256 `af9ffdb0f991696818512c5f50dab94fdb76387d3b66a2abca80fb799d6d30b6`; old informational inventory SHA256 `288d17dca5b6950fababb945cf21c15594dfbf37897d1cdcaab2aba1088a6b9b` and old exit1 remain. Wrong current route/blob/actual bytes and wrong NONCURRENT/captured-evidence hashes fail.
- Both packet-declared retained tarballs were read-only streamed and independently match full SHA256 `c109372f90b1bd19bcf756cf993bb2976fb52b75fe0c92a1cf96dab4c229b5cd`:727526 compressed bytes and834 exact members each, including full package runtime/declarations. No tar extraction or whole-archive buffer, new pack/build, or product import occurred. The original production commands remain author-derived lineage evidence, not our reproduced build.

## Seven NEW76 proof statuses

These are new bounded bindings, not rescoring the historical seven:

| New76 proof | Status and exact limit |
| --- | --- |
| binding-complete | HOLD: emitted-build/type reuse, cooperative product cleanup, private prerequisite and integrated full candidate execution remain unestablished |
| binding-pending-template | PASS_BOUNDED_REFUSAL: actual empty/missing authorization and missing-binding verdict rejected; not historical template-runner execution |
| binding-mutable-head | NOT_EXECUTED_LITERAL_MUTANT: wrong immutable candidate was rejected, but the literal `HEAD` token was not exercised; exact comparison is only source-visible for that token |
| binding-missing-asset | PASS_BOUNDED_REFUSAL: actual missing runtime inputs and required readable tool failed; no full admission launch |
| binding-missing-classification | PASS_BOUNDED_REFUSAL: actual profile/inventory missing and unknown classification mutations failed |
| binding-missing-cleanup-manifest | NOT_EXECUTED_LITERAL_MUTANT: missing member/hash/stale revision ran, but removing the entire `CLEANUP.json` file did not |
| binding-skipped-case | PASS_BOUNDED_REFUSAL: actual strict verdict rejects synthetic skipped=1 with nonzero HOLD; not measured canonical execution |

Thus four bounded refusals, two literal mutants unexecuted, and one complete-binding HOLD. Related source-visible checks are not relabeled executions.

## Remaining questions and boundaries

Q1/R1 final binding and four-path packet are resolved at this static/component boundary. Q2/F01 current/noncurrent authority is resolved for the exact selected Git bytes. Q3/R5 sole `--run`, inert run/worker imports and missing-release refusal are exercised. Q4 readable tool/dependency identities and exact11 exception are qualified, not native/provider acceptance. Q7/R6 strict zero-skip/nonzero-HOLD policy mutations are exercised, but legitimate private availability remains untested and must never become skip-green or implicit private loading.

Q6/R4 **A10** still requires authorized real reuse of the one driver-managed production build by typing/current consumers. Test-owned isolated builds are separate; this prospectively versions the original literal-one-build oracle, not retroactive satisfaction. **A11** independently reproduced derivation remains unexecuted despite actual c109 artifact verification. Q5/R7 **A18** registered-before-acquisition, root barrier, sibling destinations and opaque-host semantics remain unexecuted here.

Q2/Q3/R2/R3 full runtime closure is declared and bound, but full2.382GB extraction/history, private/provider runtime access, generated binding consumers, complete phase permissions and child fences have not been exercised together. Successful contained-link transport itself remains unexercised under the review parent, although contained-link archive validation and escaping-link transport refusal ran. `execute.mjs`/`public.mjs` were never loaded; execute body review was excerpt-based, not an exhaustive implementation audit. No moving live implementation was used as a fallback.

## Reproduction, limits and cleanup

`PLAN.json`, `FOLLOWUP-PLAN.json` and `COMPLETION-PLAN.json` freeze the expectations/adapters before their respective execution. `review.mjs`, `followup.mjs`, `completion.mjs` are explicit opt-in independent harnesses, not canonical tests. Each was syntax-checked with pinned Node. Each actual invocation uses:

```text
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --permission --allow-fs-read='*' --allow-fs-write=/Users/kjopek/Workspace/safe-bash/tests/integration/full-gate-20260827/unified76-driver-independent/execution-v4 --allow-child-process tests/integration/full-gate-20260827/unified76-driver-independent/execution-v4/<review|followup|completion>.mjs
```

Existing receipts intentionally prevent overwriting a prior attempt. This is an audit recipe, not permission to rerun against populated evidence. Exact child/Git argv, cwd, status, output hashes and bounded raw output are in `RAW-COMMANDS.ndjson`, `FOLLOWUP-RAW.ndjson`, `COMPLETION-RESULTS.json`; large Git metadata stays hash-bound to immutable Git rather than being duplicated as archive buffers.

Parent filesystem writes were restricted to the owned execution directory. The retained Node child-process permission warning matters: exact-path Git/setup children are not an OS sandbox. Ordinary synchronous children have240s/8MiB caps; supervisor probes have smaller explicit caps. Final completion adds240s asynchronous-child kill guards. Earlier transport adapters inherit the frozen setup timeout. Review total/disk/history ceilings are measured postconditions plus bounded fixture design, not a claim of an all-enclosing OS resource limit. Driver numeric BOUNDS remain explicit in `RESULTS.json`; no gate-scale performance claim follows.

All three owned data trees and staged byte-exact driver/helper copies were removed after hashing. Owned process PIDs, raw lifecycle status and final absence check are sealed separately. No AGENTS copies, loose canonical TS snapshots, dependency installs, private writes or foreign artifact cleanup occurred. All nine original/v2/v3 independent file hashes match their preserved history. A static receipt-generation command initially failed on an undefined local variable before writing anything; it was corrected without rerunning any control. Foreign staging/artifacts and concurrent README work remain untouched. **Stop here; root/full-gate release remains HOLD.**
