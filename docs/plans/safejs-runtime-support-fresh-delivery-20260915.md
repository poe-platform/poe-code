# Runtime matrix fresh qualification and delivery — 2026-09-15

**Acceptance remains OPEN / RELEASE BLOCKED.** No runtime repair, changed support floor, weakened assertion/budget/timeout or new host authority.

Source HEAD: `365774cd83ff387c4237adfed8fe7b8bf0ffb4f1` plus accumulated dirty inputs. Zero changed inputs in the original source-fingerprints.json; staged diff SHA-256 remains `839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8`. Date: 2026-09-15T05:59:12.029848+00:00. Tested dist is existing candidate build, not a fresh build or pristine remote-source qualification. Installed artifact remains actual public 0.1.605, independently observed registry integrity `sha512-bWYNWrXbv/D3IkYnSErQlwmB5hEorbNa+zfIMfxKa0lboztuBqHPmAaBMC47HZFtscQADBo6FFM6sz1PvpQllA==`.

Compatibility target remains published ECMA-262 edition 16 / ECMA-402 edition 12, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus previously tracked newer APIs. [Bounded matrix](safejs-runtime-support-matrix-20260915.md) defines every required Node/Bun/Workerd, OS, module and entrypoint cell; preceding observations are predecessor evidence, not newly executed cells.

## Fresh commands and outcomes

[Receipt](runtime-support-20260915/fresh-audit/receipt.json) preserves exact executable paths, command arrays, actual exits, dates and log hashes. Logs preserve full Node/ICU/V8/platform metadata and individual assertions. Maintained imports: 56 passes / zero skips. Ten-case current and installed controls: 138 passes / two failures / zero skips.

| Runtime | Import exit | Current exit | Installed exit |
| --- | --- | --- | --- |
| bun | 0 | 0 | 0 |
| v18.18.0 | 0 | 1 | 1 |
| v18.20.8 | 0 | 0 | 0 |
| v20.20.2 | 0 | 0 | 0 |
| v22.23.2 | 0 | 0 | 0 |
| v24.21.0 | 0 | 0 | 0 |
| v26.8.2 | 0 | 0 | 0 |

`npm run typecheck:contracts --workspace=@poe-code/safe-js`: exit 0, four NodeNext/Bundler × Node-only/DOM cells of 25 positive/negative cases (100 total). Prior terminal package suite remains dated predecessor evidence (30806 passed /52 skipped); no fresh whole-suite, cross-runtime suite, screenshot or build is claimed.

Backend/language reproduction on exact minimum: `const s=Symbol();const m=new WeakMap([[s,7]]);return m.get(s);` requires 7; current and installed throw `TypeError: WeakRef: target must be an object`. Current weak-reference.ts delegates fresh symbols to native WeakRef. Registered-symbol rejection passes. This is backend incompatibility leaking into edition-16 language behavior, not missing host authority. Strong retention would alter weak ownership and is not a justified repair. TDD plus weak reachability/recovery evidence is required before a repair.

No packaging failure reproduced in maintained imports or these installed controls. Installed 0.1.605 is predecessor product, not the candidate. Recorder/language mismatches in earlier attempts remain retained separately; fresh commands use corrected Bun syntax and lint ParseError contract. No external services/LLMs are queried by the probes.

## Remaining blockers and recovery

Linux x64 and Windows x64 cells: no fresh executed runners. Workerd: predecessor selected runtime evidence only; authoritative ICU/V8 metadata and complete feature coverage absent. Other Node/Bun cells: selected probes only; complete repaired-feature, pending replay/cancellation/cleanup/version transports, installed CLI/types/umbrella and maintained suite qualification remain absent. No unavailable cell or skipped feature is a pass. No newly unsupported OS; ESM/CommonJS/browser and explicit authority boundaries remain those derived in the matrix.

Recovery: reproduce the weak-symbol case with a maintained failing regression on exact minimum, implement only a semantically justified weak backend, then qualify reachability, replay and ownership without raising engines.node. Execute the bounded checks on real Linux/Windows runners; obtain authoritative Workerd build metadata; stage candidate scoped and umbrella artifacts and complete repaired-feature mapping. Deliver each validated repair atomically and monitor required GitHub publications independently. Never locally publish or destructively roll back partial publication.

## Delivery accounting

Fetched origin/main `55c7d8b1186be5e272595dc6499ec349fa86d833`. Shared main diverges by 60 local/1026 remote commits. Evidence-only delivery uses an isolated checkout based on remote main, avoiding unrelated source delivery. No issue is explicitly associated; no issue closure is claimed. Predecessor scoped run https://github.com/poe-platform/poe-code/actions/runs/34921860899 is successful for source `6bc5290f862612a79944c105facb408d9e0057b0`, publishing 0.1.605; registry advertises SLSA provenance. That is not this task publication. Local delivery SHA, verified remote ancestry and workflows are recorded separately after push. Docs-only path changes may produce no release, which must not be described as publication.
