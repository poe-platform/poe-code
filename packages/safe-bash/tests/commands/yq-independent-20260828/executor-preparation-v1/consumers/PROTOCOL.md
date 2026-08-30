# Deferred YQ Consumer and Package Guard Specification

Status: Accepted preparation v1; actual candidate execution pending

Implemented Through: Not applicable

Purpose: Authenticate deferred declaration, materialized-import, and full-package jobs without executing live YQ or claiming public admission from private modules.

## Normative Language

MUST, MUST NOT, REQUIRED, SHOULD, MAY and OPTIONAL describe conformance requirements. Implementation-defined choices MUST be recorded. This protocol implements the current delegated assignment, not a new YQ language, CARRY, limits, or dependency-injection policy.

## Problem Statement

The accepted 194-record framework and eight overlay proof roles include nonsemantic jobs. A type rejection, data check, package inventory, or admission decision MUST NOT be counted as a YQ semantic pass. This component owns only this consumers directory. Runtime orchestration, compound packaging, root exports, and product implementation remain separately owned.

## Goals and Non-Goals

Preparation MUST run only bounded synthetic regular-file tree checks. Preparation MUST NOT import, build, compile, pack, or execute any product, even if new YQ source appears. It MUST NOT use native utilities as product oracles, XAN/private packages, installs, source loaders, or live source fallbacks. The baseline tarball is bound by its accepted report and seal, not unpacked or replayed here.

## Authority and Domain Model

`SELECTED.json` binds immutable selected Git inputs. `SOURCE-BASE.json` is the exact baseline product source/configuration map with only the accepted interpreter length blob substituted. `BASELINE-PACKAGE.json` contains every accepted package file, including README bytes and mode. It has 846 baseline entries, not a required YQ candidate count. The 845 projection is insufficient.

The source base MUST be `5137a74ec855a32d8a8860eb66b62eb44d11e290`; length MUST be `74361026502d76b8c2b696f9c60e410ac9b78d95`. The final CARRY authority is `bd471ef682d768692a682d40009a874f51e3ad68` and independent review is `de89e478d8ddce62eac955708f1b87d7be1bd137`. The accepted full package report is from `6d5cf6c640d87a5e427049d329eabf5c39136259`, recipe `4e4fbb56ae92720735bb30c63b27708a22d248e1`, tarball SHA-256 `ff230f2e9079cc843198533e412f836abb62e4ade63f4fa210b7269f7deb4eff`.

`COVERAGE.json` retains the exact three MOVED and eight TYPE records, their frozen inputs, expectations and authority citations. TYP-05/06 are runtime-worker jobs; TYP-08 is private-source review, not a fabricated public DI/type test. MOV-03 includes outstanding actual jq regressions, not just a blob comparison. Other framework IDs and overlays stay with the runtime/framework owner.

## Trusted Configuration and Receipt

The root MUST supply a candidate receipt plus an independently routed expected SHA-256 of its raw JSON bytes. A self-announced digest is not authorization. The caller MUST verify this helper preparation seal before importing helpers. Every future build MUST first call `authorizeSources`; every future import/consumer MUST use `authorizeCandidate`. Neither function builds anything. Source commits MUST be full immutable Git IDs, never HEAD.

Receipt v1 REQUIRED keys:

```json
{
  "schema": 1,
  "sourceBase": "5137a74ec855a32d8a8860eb66b62eb44d11e290",
  "acceptedLength": "74361026502d76b8c2b696f9c60e410ac9b78d95",
  "candidateCommit": "ROOT_SUPPLIED_40_HEX",
  "sourceAdditions": {"src/commands/yq/NEW.ts": {"sha256": "64_HEX", "bytes": 1, "mode": 420}},
  "packageAdditions": {"dist/commands/yq/NEW.js": {"sha256": "64_HEX", "bytes": 1, "mode": 420}},
  "packageDirectories": {"": 493, "dist": 493},
  "entries": {"yq": "dist/commands/yq/index.js", "contracts": "dist/contracts/index.js"},
  "allowedBuiltins": [],
  "buildReceipt": {"path": "ABSOLUTE_ROOT_ROUTED_EVIDENCE", "sha256": "64_HEX"}
}
```

The example is schematic and deliberately incomplete, not an executable candidate. Maps MUST enumerate all entries. Source additions MUST be new `.ts` paths under `src/commands/yq/` or the exact new `src/commands/structured/query-core.ts`. No other source/root/package replacement is authorized. The package additions MUST contain the four configured compiler outputs (`.js`, `.js.map`, `.d.ts`, `.d.ts.map`) for every listed source. Existing baseline files MUST remain byte/mode-identical. Unknown receipt fields, duplicate JSON keys, path aliases, prototype-sensitive names, symlinks, nonregular entries and hard-linked files MUST be rejected. The trusted root build receipt binds source-to-output provenance; this guard does not reproduce or independently establish that build provenance.

## Guard and Materialization State Machine

1. Authenticate the preparation seal, selected immutable manifests, receipt hash and complete source map before admission. A missing candidate or an unknown source delta is refusal, never fallback.
2. Authenticate the entire actual package against baseline plus authorized output additions. Check files, raw byte hashes, sizes, modes, and exact directory membership/modes, including README. New entries MUST be detected on every check; there are no broad ignored paths.
3. Copy regular compiled files into a fresh sibling staging directory outside the workspace, then rename that directory to its final location. The destination MUST differ from the original and staging roots; staging MUST disappear; rename MUST preserve staging directory identity. No in-place or source-tree import is permitted.
4. Return an in-process binding capability. Persisted JSON is evidence, not a recreatable capability. Every actual runtime binding MUST pass `resolveMaterialized`, including the initial explicit YQ/contracts entry, transitive relative modules, and explicitly allowlisted `node:` builtins. Bare dependencies, ambient/private/XAN paths, node_modules, workspace paths, source files, symlink escapes, URL queries/fragments and arbitrary root hooks MUST fail. The root integration entry is not inferred.
5. The synchronous Node import hook MUST load authenticated compiled bytes only. It is exclusive for its active scope; the root MUST preload harness dependencies. `withMaterializedImports` MUST guard before and after the whole callback, not merely the first import. It MUST deregister hooks on failure. Only explicitly requested namespace bindings are injected into the callback. This is a resolution/authentication guard, not a JavaScript security sandbox.

Generated consumer files, copied pinned compiler/type tools, compiler outputs and facts MUST be outside both original and moved guarded candidates. Future evidence MUST also be outside the real workspace. The complete candidate guard MUST run before and after each compiler/import scope, including failure paths. There are no artifact exclusions inside the guarded tree. No promise of hard RSS enforcement, leases, arbitrary concurrent mutation resistance, or detection of adversarial change-and-restore between checks is made.

## Declaration Consumer Contract

Fixtures remain `.mts.data`/`.ts.data` until an authorized candidate. Only the explicit `@@YQ@@`, `@@CONTRACTS@@`, `@@ROOT@@` path tokens MAY be replaced. No suppression directives, custom ambient declarations, tsconfig paths, or source fallback are allowed. The source-shape fixture is read-only static review, never a compile job in this recipe.

The worker MUST use the pinned available TypeScript 5.9.3 compiler and pinned Node/types trees from `SELECTED.json`, copied into isolated evidence. It MUST compile materialized candidate declarations with strict NodeNext, exact optional properties, no emit, no skipped declaration checking and explicit type roots. Compiler file-list output MUST be checked: only the current generated fixture, candidate `.d.ts` files, and pinned tool declarations may be consumed. Any other file is refusal.

TYP-01 MUST accept and exactly match the declared factory return/parameter types. TYP-02 splits both no-options calls. TYP-03 splits unknown limits and nonboolean replace. TYP-07 rejects explicit undefined under `replace?: boolean`. TYP-04 splits the five explicitly forbidden public exports, and MUST remain public-admission-only. Each negative job declares its compiler diagnostic code and source line; unrelated missing-module/declaration errors MUST NOT satisfy it. Positive prerequisite compilation MUST succeed before negatives are accepted.

The worker MUST capture raw compiler stdout, stderr, exit status, signal, spawn error and arguments before asserting anything. Expected compiler rejection is a TYPE fact called `ACCEPTED_COMPILE_REJECTION`, not semantic success. A worker exits zero only when every job exactly matches its declared compiler outcome and binding checks. Any unexpected compiler status, diagnostic, signal, timeout, output overflow or failed guard yields nonzero. A parent MUST treat ANY worker child nonzero as aggregate failure; it MUST NOT waive failures because a job is negative. The compiler is the worker's explicitly interpreted subprocess, not an ignored failing aggregate job.

## Public Admission Boundary

The inspected baseline root declaration/source/export map has no YQ root exports and no YQ package subpath. Direct `dist/commands/yq/index.js` / `.d.ts` proof is explicitly `DIRECT_MATERIALIZED_MODULE`, never public package proof. This v1 receipt cannot authorize root/package modifications, so public admission MUST return `PUBLIC_EXPORT_GAP`. Public TYP-01/02/03/04/07 and MOV-02 remain pending; adding direct evidence does not change that. A separately owned, accepted integration and later sealed receipt protocol are prerequisites to public package execution. No root or subpath export is invented here.

## Failure Model and Recovery

All failed prerequisites MUST throw before product execution. Failed checks write diagnostic evidence outside the candidate and fail the worker. Synthetic cases mutate only unique disposable copies below this owned directory. Missing external candidate authority is a deferred prerequisite, not a synthetic pass. A failed actual run MUST NOT overwrite earlier evidence; the root supplies a fresh evidence path and fixes/reroutes authority explicitly.

## Test and Validation Matrix

`NEGATIVE-CASES.json` is presealed before checks. It covers missing/wrong README, missing baseline, unauthorized addition, symlink, hardlink, mode, binding and hash mismatches, workspace fallback, not-moved/in-place, source import, omitted declaration, changed declaration, extra directory, malformed receipt and compiler outcome classification. A valid small fake package is the positive control. These are guard-only checks: product/build/compiler/package-replay counters remain zero.

| Frozen IDs | Proof role | Current status |
| --- | --- | --- |
| MOV-01 | Source and write-set admission | Deferred; synthetic refusal checks only |
| MOV-02 | Moved public export consumer | Pending public export gap |
| MOV-03 | Source identity plus real jq regression execution | Identity recipe only; runtime regression pending |
| TYP-01/02/03/07 | Actual strict compiler outcomes | Fixtures sealed; no compilation |
| TYP-04 | Forbidden public export compiler rejection | Fixtures sealed; public integration pending |
| TYP-05/06 | Runtime options/collision behavior | Separately owned runtime worker |
| TYP-08 | Private signature/source semantics | Static source-review fixture; no public DI claim |

## Conformance Criteria

Preparation conformance requires the preseal, bounded synthetic evidence, exact helper interface documentation and explicit-path commits. Actual conformance requires the later candidate, root-approved write-set/build receipt, moved package and authenticated compiler results. Candidate paths/hashes and public integration do not yet exist in this preparation. No accepted YQ policy question is reopened. Different-agent framework review remains root-routed and outstanding.
