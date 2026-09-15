# Finalization cancellation lifetime qualification — 2026-09-13

Acceptance for `qualify-weak-lifetimes` remains **OPEN**. This atomic repair fixes cancellation retention; it does not implement the missing Node 18.18.0 unique-symbol backend.

## Source and target

Source HEAD: `034185b29ade2973996b1999b538b4e80388c4b0`, on `main`, plus inherited working changes. Only the three source paths below were changed by this increment. Their exact tested bytes are included in the repair commit. Qualification used the inherited working dependency tree, not an isolated clean checkout or installed release. No inherited implementation is adopted by this commit.

The existing compatibility target is unchanged: **ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025)**, Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, plus the extensions already pinned in the gap-closure ledger, including weak-map upsert. `package.json` declares Node `>=18.18`; the exact minimum is **18.18.0**, not the newest Node 18 patch. CI uses Node 22. The runtime matrix also covers the cached current Node 24 and 26 executables.

| Task-owned source                                                        | SHA-256 of tested bytes                                            |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `packages/safe-js/src/interp/finalization-registry-state.ts`             | `98f68edd7a5b45ec445076dfe224081ff41262289ec34391d1b721b60ca41eb7` |
| `packages/safe-js/src/interp/owned-finalization-registry.ts`             | `30462971a8f90ca30a9ed3d093eb8941c43dee4df27551bbd2edb5034f086920` |
| `packages/safe-js/src/interp/finalization-cancellation-lifetime.test.ts` | `cb2ba50d643759d5244892499403cc2f3579a00fb72559116419b6ec7351847a` |

## Validated defect and repair

**WL-CANCEL-HELD:** a collection notice queued a closure over a finalization cell and copied its held value into owner retention. `unregister` and `dispose` removed the cell from the registry but left the queued cell's payload and the owner's retained roots alive until dispatch. A blocked queue could therefore prolong those lifetimes indefinitely. Pending restore activation also retained a dispatch closure after cancellation.

TDD: `finalization-cancellation-lifetime.test.ts` initially produced **five failures / zero passes**, before production edits. After the first repair, an additional deferred-activation regression produced **one failure / six passes**: unregistering before activation could re-retain the callback. The final seven regressions pass on all six Nodes.

Cancellation now clears the cell's held value, releases its budget roots, and clears the pending callback/job slot immediately. Deferred dispatch rejects cancelled activations and empty job slots. Successful or throwing cleanup also clears the completed cell. Live cells for other tokens keep their held value and deliver it unchanged; cleanup exceptions remain reported by the owner. This changes internal scheduling state only; no new host or guest capability is exposed.

Tests inspect explicit cells and retained roots and use the existing `register(undefined, held, token)` restore hook to represent a collected target. They exercise the actual owner queue without waiting for GC or sleeping. A captured cancelled cell must no longer hold its payload even if its queued closure is never dispatched. The live-token neighbor checks that cancellation does not clear another cell, and a throwing cleanup proves removal and error propagation. Existing tests cover native mocked notices, repeated notices, realm closure, queue ownership, callback arguments, duplicate token cancellation, held-value accounting, and rollback with throwing detach handlers.

## Final manual checks

Final checks ran after the last production/test edit. No support declaration, assertion, budget, timeout, hook, or version floor was weakened.

- `node node_modules/eslint/bin/eslint.js packages/safe-js/src/interp/finalization-registry-state.ts packages/safe-js/src/interp/owned-finalization-registry.ts packages/safe-js/src/interp/finalization-cancellation-lifetime.test.ts`: **exit 0**.
- `npm run build:workspaces -- --workspace=@poe-code/safe-js`: **exit 0**, including **8/8** maintained postbuild import checks. This is the declared workspace closure, not a hand-built substitute.
- The focused cancellation/state/owner/snapshot command below: **29 passed / zero failed / zero skipped**, exit 0.
- Final 30-file selection below: the new **7/7** cancellation tests pass on every Node; the broader matrix has the explicitly retained minimum-runtime failures shown below.
- `git diff --check` for task paths: **exit 0**. Source/index/ledger preservation assertions passed before staging. The original staged diff is preserved separately from task staging.

Lint/build/focused checks ran on Node **22.23.2 / ICU 78.2**. This focused repair does not claim full `npm test`, repository-wide lint, upstream Test262 reruns, installed artifact qualification, or CLI screenshot checks; no CLI visual behavior changed. The prior broad qualification receipts are historical, not fresh passes for this commit.

```sh
node node_modules/vitest/vitest.mjs run \
  packages/safe-js/src/interp/finalization-cancellation-lifetime.test.ts \
  packages/safe-js/src/interp/finalization-registry-state.test.ts \
  packages/safe-js/src/interp/globals/finalization-registry-cleanup.test.ts \
  packages/safe-js/src/snapshot/finalization-registry.test.ts
```

| Node    | ICU  | Pass | Fail | Skip | Exit |
| ------- | ---- | ---: | ---: | ---: | ---: |
| 18.18.0 | 73.2 |  271 |   11 |    0 |    1 |
| 18.20.8 | 74.2 |  282 |    0 |    0 |    0 |
| 20.20.2 | 78.2 |  282 |    0 |    0 |    0 |
| 22.23.2 | 78.2 |  282 |    0 |    0 |    0 |
| 24.21.0 | 78.3 |  282 |    0 |    0 |    0 |
| 26.8.2  | 78.3 |  282 |    0 |    0 |    0 |

The final matrix ran after the final build completed, against unchanged tested source hashes. An earlier exploratory matrix overlapped a build and test development (280/281 tests); those counts are superseded, not combined with the final 282-test cells.

### Reproduction procedure

From the repository root, select each exact executable below, inspect `process.versions`, and run the same selection. The final runs additionally used `--reporter=json --outputFile=docs/plans/qualify-weak-lifetimes/cancellation-repair-20260913/<version>-final-tests.json` to preserve receipts. These outputs and build/red/green logs are local artifacts, not files included in the commit.

- Node 18.18.0: `/Users/kjopek/.npm/_npx/5c21e3f970cab345/node_modules/node/bin/node`
- Node 18.20.8: `/Users/kjopek/.npm/_npx/00073ba5d7c1f8bc/node_modules/node/bin/node`
- Node 20.20.2: `/Users/kjopek/.npm/_npx/185e25162edaacfb/node_modules/node/bin/node`
- Node 22.23.2: `/Users/kjopek/.nvm/versions/node/v22.23.2/bin/node`
- Node 24.21.0: `/Users/kjopek/.npm/_npx/538786c08bcb9442/node_modules/node/bin/node`
- Node 26.8.2: `/Users/kjopek/.npm/_npx/131005c554cfb1ac/node_modules/node/bin/node`

```sh
"$node_executable" -p 'JSON.stringify(process.versions)'
"$node_executable" node_modules/vitest/vitest.mjs run \
  packages/safe-js/src/interp/finalization-held-accounting.test.ts \
  packages/safe-js/src/interp/finalization-registry-state.test.ts \
  packages/safe-js/src/interp/globals/finalization-registry-cleanup.test.ts \
  packages/safe-js/src/interp/globals/finalization-registry.test.ts \
  packages/safe-js/src/interp/globals/weak-collection-realms.test.ts \
  packages/safe-js/src/interp/globals/weak-collections.test.ts \
  packages/safe-js/src/interp/globals/weak-constructor-prototype-descriptors.test.ts \
  packages/safe-js/src/interp/globals/weak-prototype-realms.test.ts \
  packages/safe-js/src/interp/globals/weak-ref-budget.test.ts \
  packages/safe-js/src/interp/globals/weak-ref.test.ts \
  packages/safe-js/src/interp/globals/weakmap-upsert.test.ts \
  packages/safe-js/src/interp/job-kept-targets.test.ts \
  packages/safe-js/src/interp/structured-clone-weak-graph.test.ts \
  packages/safe-js/src/interp/structured-clone-weak-state.test.ts \
  packages/safe-js/src/interp/weak-collection-cleanup.test.ts \
  packages/safe-js/src/interp/weak-collection-well-known.test.ts \
  packages/safe-js/src/interp/weak-collection.test.ts \
  packages/safe-js/src/lint/finalization-registry-global.test.ts \
  packages/safe-js/src/lint/weak-collection-globals.test.ts \
  packages/safe-js/src/lint/weak-globals.test.ts \
  packages/safe-js/src/lint/weak-ref-global.test.ts \
  packages/safe-js/src/snapshot/finalization-registry.test.ts \
  packages/safe-js/src/snapshot/weak-collection-key-kinds.test.ts \
  packages/safe-js/src/snapshot/weak-collection.test.ts \
  packages/safe-js/src/snapshot/weak-reference.test.ts \
  packages/safe-js/test/conformance/finalization-owner.test.ts \
  packages/safe-js/test/conformance/realm.test.ts \
  packages/safe-js/test/conformance/execute.test.ts \
  packages/safe-js/test/conformance/source-modules.test.ts \
  packages/safe-js/src/interp/finalization-cancellation-lifetime.test.ts
```

The selection tests allowed/registry symbols, weak-map upsert, job-scoped keep-alive and release, callback/owner isolation, held-value reachability, unregister tokens, cancellation, failed-restore rollback, and weak graph snapshots. Snapshot tests require independently rooted keys and symbol property keys to preserve identity/aliases, propagate chained ephemeron reachability regardless of root order, and omit weak-only keys and back-reference cycles. Passing snapshot controls prove graph behavior; they do not prove eventual host collection.

## Unresolved compatibility and other runtime observations

**WL-MIN-SYMBOL remains a product compatibility defect.** The current primitive-symbol implementation delegates unique symbols to native weak APIs. Node 18.18.0 rejects them. A synchronous public SDK/native probe was rerun on all six Nodes: WeakMap set/get, WeakSet add/has, WeakRef construct/deref, finalization target registration, and unique-symbol unregister-token registration all fail on the floor and succeed on the later Nodes. Object and guest well-known-symbol neighbors pass; registry symbols correctly throw. Probe process exit 0 means observations were recorded, not that all required semantics passed.

The eleven final floor failures are:

- `packages/safe-js/src/interp/weak-collection.test.ts`: activates a weak symbol key from an independent symbol root.
- `packages/safe-js/src/interp/weak-collection.test.ts`: activates a weak symbol key retained by an ordinary property key.
- `packages/safe-js/src/snapshot/weak-collection.test.ts`: preserves a weak symbol reachable as a value.
- `packages/safe-js/src/snapshot/weak-collection.test.ts`: preserves a weak symbol reachable as a property.
- `packages/safe-js/src/snapshot/weak-reference.test.ts`: preserves a symbol target rooted by a binding.
- `packages/safe-js/src/snapshot/weak-reference.test.ts`: preserves a symbol target rooted by a property.
- `packages/safe-js/src/interp/globals/finalization-registry.test.ts`: supports unique and well-known symbols as targets and unregister tokens.
- `packages/safe-js/src/interp/globals/weak-collections.test.ts`: supports weak collection keys: const key=Symbol();const map=new WeakMap([[key,7]]);const set=new WeakSet([key]);return [map.get(key),set.has(key)].
- `packages/safe-js/src/interp/globals/weak-collections.test.ts`: restores fresh symbol keys without making registered symbols valid.
- `packages/safe-js/src/interp/globals/weak-ref.test.ts`: accepts non-registered symbols and rejects registered symbols.
- `packages/safe-js/src/interp/globals/weakmap-upsert.test.ts`: accepts weak key Symbol('unique') without coercion.

All floor failures retain `TypeError: WeakRef: target must be an object`; two WeakRef snapshot fixtures fail while creating a native symbol reference in test setup. Those two are backend prerequisites, not independent snapshot algorithm defects. No failure is skipped or treated as a pass. A direct minimal public reproduction is:

```sh
"$node_executable" --loader tsx --input-type=module <<'JS'
import { run } from './packages/safe-js/src/run.ts';
console.log(process.versions);
console.log(await run('return new WeakRef(Symbol()).deref()'));
JS
```

Use `--import tsx` instead of `--loader tsx` on later Nodes. The prior native-reference experiment establishes only weak symbol reference admission, not a WeakMap ephemeron implementation. A strong table of values beside weak symbol keys would keep `map.set(key, {key})` alive through its value. A strong symbol-to-box table would root symbols itself. Neither is an acceptable repair; neither is introduced. A portable ephemeron-capable backend or a coherent guest symbol lifetime representation remains unimplemented. This is unresolved implementation work, not a claim that native alternatives are impossible.

Bun **1.3.11-canary.1+687700d84 / ICU 74.2**: the fresh source stdin probe fails before guest execution because `#safe-js-platform` cannot resolve. The corrected built public-entrypoint probe (`bun run -`, importing `packages/safe-js/dist/index.js`) records all **20/20** expected admission/rejection observations. This does not qualify Bun cancellation/isolation. An initial `bun --input-type=module` attempt printed usage (exit 0) and its report parser failed; it executed no guest checks and contributes no passes. `workerd` is unavailable on PATH; no Workerd compatibility-date cell was executed. These are unqualified surfaces, not inferred language defects.

Actual host collection and eventual cleanup remain **nondeterministic contracts** under [ECMA-262 edition 16, WeakRef objects](https://262.ecma-international.org/16.0/#sec-weak-ref-objects) and [FinalizationRegistry objects](https://262.ecma-international.org/16.0/#sec-finalization-registry-objects). No deterministic GC deadline is promised or tested. Missing ambient forced-GC authority is intentional and is not an ECMAScript defect.

## Delivery

The cancellation repair and this evidence are one task-owned Conventional Commit; resolve its local SHA with `git log -1 --format=%H -- packages/safe-js/src/interp/finalization-cancellation-lifetime.test.ts`. The response reports that SHA separately. Unrelated staged changes and inherited ledger edits are excluded.

**Verified remote-main delivery: none. Successful release/publication: none.** No push was requested or performed; no release was initiated. Earlier releases do not establish delivery of this repair. Overall acceptance remains **OPEN** for the floor-symbol implementation and unqualified supported-runtime cells.
