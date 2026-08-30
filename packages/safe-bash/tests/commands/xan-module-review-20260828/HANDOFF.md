# Preparatory handoff — candidate review HELD

Recipe commit: **9c8855b806bd963ccc1f1209e454ffc582b16e1b**.
Recipe manifest SHA256:
`ff49c0a535115d5f3bddbcf4e6737020596a22dfc9e2883a6e3a81bca6bbb53a`.
The evidence commit is the Git commit containing this handoff and EVIDENCE-SEAL.json;
its full ID is reported by the leaf's final response, avoiding a circular self-ID.

## Actual qualification

- Exactly one synthetic invocation, 2026-08-28T04:53:57.428Z–04:54:05.216Z.
- **74/74 helper controls qualified; 0 failed; 0 unrun; no retry.**
- **21/21 subprocesses reaped**, including two intentional timeout/leak controls,
  two bounded-output overflow controls and two ordinary exit-7 controls.
- Partial helper coverage maps to all **12 families**; **18 generic cap counters**
  qualified. Neither is full product-family/default-scale/resource-ledger proof.
- Both SOURCE and physically moved installed layouts exercised the generic
  module executor with the new synthetic echo module only. Existing valid
  synthetic bytes qualified before deny-load/source-fallback/builtin/eval controls.
- Finite trace: **5242954 bytes**, streamed and hashed separately from 16384-byte
  ordinary log budgets. Recipe verification and append-aware raw evidence
  verification passed. A separate post-qualification streaming evidence transport
  preserved 175 files and 29 directories without altering raw inputs.
- **XAN implementation reads 0; product executions 0; native oracle calls 0;
  builds/typegates 0.** Preparation was post-author-release, not pre-author-code.

Raw evidence manifest: 33785 bytes, SHA256
`42b1c369bed32e39c3d1d49678618ae21e7c027686d0ad2d9e7add82488d60bd`.
Bound compressed transport: 56666 bytes, SHA256
`2ab52da3efa910dd0fbf53dd8b32671b43b622c85c9ee3edbdf9a7ac62724334`.
The bundle preserves the intentional empty-directory integrity control, which Git
cannot itself represent. On a fresh checkout, use bundle verification; raw-tree
verification intentionally holds if that captured empty directory is absent.

## Binding and held coverage

All **88 cases/references, 12 families, 18 recipes, seven ratifications and
36 selectors** are individually hash/pointer-bound in COVERAGE.json. Selectors
remain **21 valid / seven S+N / eight R**. Fourteen ratification case bindings
are retained. Historical native 28+16 records remain observations, not passes.

G01–G08 in PREPARATION.md identify the remaining work: actual candidate/API;
32 contextual diagnostic matchers; authenticated selected build/pack/tool closure;
actual Shell/registry/public lifecycle adapter; independent cap generators and
work/capacity ledgers; complete phase/ownership/cancellation orchestration; full
alias/fault/typeguard/flag matrix; future strict compiler emission binding.
No current policy contradiction or new policy hold is asserted.

Root must supply full candidate/base/tree SHAs, exact allowed XAN-only delta,
actual module exports/factory binding, selected manifests with modes/bytes/hashes,
build/pack evidence, and separate SOURCE/installed layouts. Base is exactly
**5137a74ec855a32d8a8860eb66b62eb44d11e290**; registry 77/no public XAN export
remain prescribed. `admit` is only a metadata screen; `run-candidate` refuses
product execution until the explicitly held integration is completed.

```sh
node tests/commands/xan-module-review-20260828/run.mjs verify-recipe
node tests/commands/xan-module-review-20260828/run.mjs verify-evidence
node tests/commands/xan-module-review-20260828/bundle-evidence.mjs verify
node tests/commands/xan-module-review-20260828/run.mjs admit-candidate HANDOFF_JSON EXACT_BYTES SHA256
```

Do not rerun qualification in the captured directory. Await root-routed author
candidate/handoff; mutable implementation appearance does not authorize review.
