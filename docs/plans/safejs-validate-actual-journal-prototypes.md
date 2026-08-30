# Actual-release journal-prototype validation preparation

Date: 2026-08-30. Independent validator: Noether. Status: **PREPARED; EXECUTION HELD**.

This is an agent-executed Markdown procedure, not a QA runner. Release version, source commit and registry artifact are not yet known. No installation, build, compiler, test or target runtime is authorized by this preparation. Wait for the exact publisher delivery receipt and explicit CPU GO. Ordinary String-helper publication must wait for actual prototype verification.

## Existing authority and inputs

- Candidate approval: `out/safejs-remediation/prototype-rename-independent/candidate-0b10f2f4-ready/manifest.json`, SHA-256 `9d101361e35fec4e80132b0a7a6ab8e31b92a59c7722b1ae0b2d5f64d2b42d82` in this isolated clone.
- Current-main metadata addendum: sibling `candidate-a015d8c2-preimage-addendum/manifest.json`, SHA-256 `5c0625c1427258e67f3a1454fd2229c790cb2ccd6c74cb9bca2db792657d536b`. All nine preimages matched a015d8c2; the named-host-policy runtime changes were not certified by old-base runtime results.
- This preparation's data index supplies exact absolute retained recipe/oracle selectors, hashes, O12 source/profile copies and helper before/after hashes. Read only these approved copies; no original audit or security payload access.
- The prior local 0.0.0-dev pack, npm 12.0.2 and npm 11.0.32 are historical evidence, not the target release.

## Required publisher inputs

Obtain the immutable final delivery receipt, its hash, exact version and source commit, retained actual npm tar path, byte count, SHA-256 and npm integrity/shasum. Require evidence linking that artifact to the published source, including gitHead where present; do not invent a missing gitHead. Identify any additional runtime changes after the approved source composition. Receive explicit setup/execution CPU permission; do not resolve `latest` or silently test a subsequent release.

## Owned actual installation, after GO

1. Create an exclusive directory outside the checkout under `/private/tmp/noether-journal-release-<receipt-id>/`, with separate HOME, npm cache/config/prefix, TMPDIR/TMP/TEMP and XDG subdirectories. Never reuse another clone's modules or cache.
2. Before installing, inspect the pinned tar's package metadata/scripts and confirm the version and identity against the receipt. If hooks cannot remain confined to owned storage, stop for coordination rather than bypassing them.
3. Install the exact retained tar normally into the owned project. Do not use `--ignore-scripts` or SKIP_SYNC_SKILLS to manufacture normal-package compliance. All HOME effects must remain in the owned HOME; no live-user skill writes. No source build or source suites are planned.
4. Record install argv, exit, dependency lock/resolution identities, Node version, selected public entrypoint/chunk identities and tar identity before/after. Inspect only the explicitly relevant files, not full source/dependency trees. Verify resolution points into this installation, never checkout workspace/private aliases.

## Locked finite execution: twenty Node processes, serial

Each command retains stdout/stderr, timing, exit/signal, source/input hashes, bounds and exact artifact binding. Preserve a failing result; no retries, broader matrix, relaxed bounds or normalization. After a producer failure, mark dependent fresh restores not attempted rather than substitute an older capture; run independent approved cases if safe.

| Group                         | Processes | Exact selection and limits                                                                                                                                                                                                                         |
| ----------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original O15                  | 4         | Seed 123 producer/fresh and seed 42 producer/fresh; retained REPAIR-BUILT recipes; 12 seconds, 256 MiB, 16 MiB output each                                                                                                                         |
| Ordinary/null semantic replay | 5         | Ordinary producer/fresh, genuine-null producer/fresh, one unchanged old-lossy negative; retained BUILT recipes; same 12-second/256-MiB/16-MiB limits                                                                                               |
| O12 typed projection          | 10        | Capture; complete modeled pending/followup; minimal modeled pending/followup; raw-left pending/followup; genuine-null-left pending/followup; raw Error negative. Preserve 3-second inner timer, 5-second parent bound and original Budget settings |
| Public aliases/examples       | 1         | Canonical/legacy main/core/CLI export namespace identities, shared Budget/SafeFS identity and three exact SDK snippets; 12-second/256-MiB/16-MiB outer cap                                                                                         |

The nine retained BUILT recipe programs are unchanged; only declared public-entry/working-directory/input-file mappings and new producer-capture bindings change. Bind canonical `poe-code/safe-js` for actual SDK execution; test legacy namespace identity in the public group. O15 native runs are not repeated: use both complete retained native oracles unchanged.

For O12, statically extract the frozen test's childProgram literal, not the test runner or esbuild setup. Its literal contains no backslash escapes or interpolation. Replace only the two exact private package string literals used by import.meta.resolve/import with the actual installed public `poe-code/safe-js`. Record this as a NEW public-entry adapter, not an unchanged historical command. Guest source, profile, Budget, timing, proof construction and observations remain byte-identical. Pass typed stdin/stdout with node:v8; do not JSON-normalize typed graphs. The data index pins original and mapped helper hashes.

O12 uses profile `profiles[1]`, reject-right-first, from the retained expectations fixture. Selected previous observation indexes are 0, 1, 2, 5, 6, 13, 14, 15, 16, 17; these are recipe selectors, not current PASS evidence. Fresh current capture/model feeds every current pending restore, and each current completed output feeds its own fresh followup. The helper includes native controls inside its capture/raw processes; these are not extra standalone commands. Duplicate proof repetitions and native-fields projection are deliberately not rerun; no full O12 matrix claim.

No actual CLI command is needed for this engine-only verification. The `/cli` public module alias is checked without launching a binary. If binary behavior or visual changes need certification, coordinate a separate bounded CLI/screenshot scope; do not silently add subprocesses to the twenty-command plan.

## Required full-output adjudication

### O15

Keep the original localeCompare guest source intact, seeds 123/42, shared UUID/LCG stream, all 54 draws, final clock 1006 and all ten meaningful native anchors. Compare complete native values, ordered host events, errors, random stream/state and full 23-node mixed-provenance graphs: sixteen guest null records, three ordinary host acknowledgements, four arrays. Check own keys/descriptors, references and aliases; no acknowledgement normalization. Fresh restore must match the entire current producer journal/completed capture, the native replay event sequence and zero new host calls.

The original literal finalAttempts comparison remains a separately reported 9/10 RED. Only the approved finalAttempts expected input-boundary observation supplies the tenth domain-correct anchor; never convert all actual outputs. API success and guest success are separate fields.

### Ordinary/null replay

For `const value = await ack(); return String(value);`, ordinary producer and fresh replay must both return `[object Object]`, with one producer host call and zero fresh reissues. Check the complete recorded ordinary outcome graph and journal, not just String coercion. Genuine-null controls retain null provenance, values, descriptors and the exact declared replay notification, again with zero fresh reissues. The unchanged old-lossy input must retain its exact TypeError negative and zero host reissues: this fix must not be credited with repairing historical lossy captures.

### O12

Compare complete values, genuine Error metadata and reason aliases, request/proof source/module/operation/digest/call IDs, callbacks, original input graphs, captured settlement prefix and whole five-call journals. Complete modeled proof preserves the captured reason. Minimal proof must lose exactly the error-type marker and stack, not other fields. Raw-left changes only the three originating ordinary host-record nodes; genuine-null and public-input-converted records remain null. Preserve keys, symbols where present, descriptors and array/event aliases. Receipt bytes cannot be mutated.

Every completed followup must preserve the corresponding whole journal and promise replay with zero calls/requests. Keep raw Error refusal separate. No arbitrary cause-chain, native-function admission or historical-capture repair conclusion follows from these fixtures. The existing own-data defineProperty safety review is retained; no new security probes are planned.

### Public examples

Execute exactly these unchanged requested sources; check API ok and full primitive result:

- `return new Float32Array([0.1])[0];` → `0.10000000149011612`.
- `return "10".localeCompare("2", "en", { numeric: true }) > 0;` → `true`.
- `return String(new TypeError("example failure"));` → `"TypeError: example failure"`.

The old reversed-operand/undefined-locale probe is not the exact locale example. Keep its history; do not rerun it in place of the corrected source.

## Timing and release handoff

Reserve approximately 2–4 minutes for the owned normal install (network/hook time can vary), then a three-minute exclusive serial runtime window. The twenty external command caps sum to 170 seconds: nine times 12, ten times 5, plus 12. Typical runtime should be shorter; no cap is raised to fit the reservation. If installation needs longer, report readiness separately and finish normally; do not start deadline workflows until the runtime window is granted.

At the final child exit, write an atomic CPU-release receipt and report process statuses/quiescence before longer metadata adjudication. Then seal actual artifact identities, full observations, failures, qualifications and an actual-release verdict. Publisher full source gates remain separate. Ordinary String-helper release must not proceed on this preparation alone or on the prior local-pack result.

## Preparation phase record

Only approved metadata/source copies were inspected. No install, build, compiler, test, native/guest runtime, original payload read or home mutation occurred. A stale Node metadata binding was unavailable after context restoration; the subsequent metadata session used explicit paths. Existing candidate seals were not changed. Exact publisher receipt and explicit CPU GO are the outstanding prerequisites, not an inferred product failure.
