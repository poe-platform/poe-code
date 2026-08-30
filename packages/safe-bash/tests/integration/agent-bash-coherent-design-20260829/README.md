# Coherent agent Bash: source/data design, 2026-08-29

**No combined product execution, build, package, engine, native oracle, or acceptance.**
This directory proposes a selected shipping composition and a future bounded test
plan. It does not change production, public registration, tests, or package scripts.

## Exact proposed composition

| Role | Binding | Disposition |
| --- | --- | --- |
| Public Node base | source `bb4dd0571a0335b20e29448bf88126ca02c1a32d`, derived tree `a6d20781d3c099fb7b3d36c10696beb06615af1b` | ROOT accepted `6f449bf49d33e7e35b3882bb3396143efa346747`; finite profile only |
| Unit3 | source `7a5c620005fb04518d44bb284f4e99284e4a7c33`, derived `74dfe69135a3fc5ba89396b20dd32d9c9daae131` | ROOT qualified acceptance relayed during this design: `d7ec5e26` + `cccd876f6615020a083adf7ee8c51befa553c2ba`; 840 version-qualified expected outcomes plus types/mutants, not rerun here |
| Unit4 | source `9bb91c370a0672687399c0a9da4ce1b161f79615`, derived `37e793ce6dce48a958030e7cc86fa8315d0b112e` | **HOLD**: ROOT-relayed Dirac `cd06468eb1a067d8324e1d0e873cccbc2ede14c2`, N14 integration finding; see STATUS.md |
| Proposed combination | computed tree `df748fb93484479a695928b6849d1df8fbfaee3c` | Derived identity, not a claim that this tree is stored or accepted |

`COMPOSITION.json` authenticates **309 selected inputs**, including **253 TypeScript
modules**. `SOURCE-TREE-INVENTORY.json` covers **305 selected src files**; the other
four build inputs are README, package.json, tsconfig.json and tsconfig.build.json.
All selected stored blobs were checked by bytes, length, SHA256 and Git blob ID.
`TREE-WITNESSES.json` and the canonical tree construction in `compose.mjs` permit
recomputation; `SHIPPING-INPUT-PATHS.nul` uses NUL-delimited paths. Unchanged
nonshipping subtree IDs are opaque provenance, not full archive/materialization
proof. No instruction-file body was fetched into these artifacts.

Only four source paths override the accepted Node base:

| Path | Selected Git blob | Source |
| --- | --- | --- |
| `src/shell/parser.ts` | `27bcacc6c9a731ff02c6ef3700e96a7a1f8e4ebe` | Unit3 |
| `src/shell/display.ts` | `a949d0b37e54b1874c297030a49895d5c2bbff08` | Unit3 |
| `src/shell/conditional.ts` | `caab6172df5b8e5bad2d1db007b156f067e295ad` | Unit3, new private module |
| `src/shell/runtime.ts` | `180e6c8f8b86e17bee8723fda638b359531a6e79` | Unit4, includes Unit3 runtime behavior |

Do **not** union the entire Unit4 source manifest onto Node. That would replace
Node's README, package.json and root index with pre-Node versions. Retain these
base blobs respectively: `d4618a2170f53ed8f6f20fe1a320ab32e84dab23`,
`623d2493b94afa7752d87232c8eb62fb61a2370f`,
`3dd8a8c8e67e5c192e4fb1e94e20da25244f65ed`. All 16 Node module paths stay bound to
the accepted base. No shell.ts, shared contracts, arithmetic implementation, FS,
root exports, registry or numeric limits change in this proposal.

## Shipping and API consequences

- Default inventory remains **80**; Node, curl and SafeJS remain explicit opt-ins.
  There is no aggregate `AgentCommandsOptions.node` and no Node stub default.
- The accepted root and explicit `virtual-bash/commands/node` exports remain.
  Node exports nine runtime values: `createNodeCommand`, `createNodeCommands`,
  `nodeCommands`, `createNodeWorkerProvider`, `NODE_PROFILE`, `NODE_ENGINE_ABI`,
  `nodeLimits`, `NodeProfileError`, `NodeUsageError`, plus its existing types.
- Node requires a trusted provider. Worker entry/identity configuration is not
  byte authentication, host authorization, an embedded engine, or native Node.
- Unit3's additive exported parseShell conditional AST is an existing qualified
  component change. The combined public type surface still needs a fresh check.
- Selected package metadata is private 0.0.0, ESM, Node >=22, with zero runtime
  dependencies. This says nothing about npm publication or dev-tool dependencies.
- Build uses `src/**/*.ts`, with declaration/maps and JS/maps emitted to dist.
  `files: ["dist"]` plus package metadata/README means **1014 predicted members**:
  253 modules times four plus two. This is a prediction, **not a built census**.
  Combined package SHA is unknown. The inherited 1010-member Node package SHA
  `274839729aa916767d1664e0ec7a84579eb1c6e7eba677535dfe6273f5f079a9`
  must not be labeled the new package.
- Future materialization must use only authenticated selected inputs, start with
  absent dist, build once, then verify all emits/full package and actual loads.
  Physically shipped private worker code is not a public export. Resolve root and
  subpaths from the installed/moved package, never repository source fallback.

The selected src inventory, not current HEAD, excludes unaccepted YQ/XAN and
other unselected production. Tests, private engines and captured fixtures are
not build inputs. Separately admit exact test/tool/engine closures; a compact
shipping manifest alone does not authenticate those executable dependencies.

## Worktree and capture qualifications

The read-only comparison of the **309 declared paths** found only README bytes
different in the worktree. This is not a claim about all live paths. A separate
metadata-only live-src census hit its **4096-entry cap** and stopped; its intended
WORKTREE-QUALIFICATION.json was never written. No retry or larger census was used.
Do not build raw HEAD or infer current npm-test/typecheck status from this design.

A separate source-display helper attempted to decode every neutral Git fixture
entry as base64 although some entries are text/symlinks; it exited with TypeError.
That helper did not execute Git/product fixtures or change bytes. Its display
output/error is in the tool transcript, not a complete independently owned raw
stderr capture. The cap failure and both limitations are retained; neither is
product failure or a successful census. The composition helper completed before
the capped scan. Its acceptance labels were later updated from ROOT's Unit3
message without rerunning composition or changing any selected bytes/tree.

Outer source/data capture: `/tmp/agent-bash-coherent-design-WooVtu`. No private
checkout, native oracle, runtime engine, compiler or product was executed.

## Proposed next scope and decisions

1. Resolve Unit4's N14 HOLD under a separate repair grant; any changed source requires a new manifest/tree, not a
   silent replacement. Unit3 and Node acceptance do not accept this composition.
2. Authorize a finite combined validation only after its executable fixture/tool/
   engine/process preseal. See `WORKFLOWS.md` and `VALIDATION-PROPOSAL.md`.
3. Separately authorize maintained no-engine smoke placement and any dedicated
   package script. No test/script implementation is included here.
4. If updating shipping docs, bind a separate exact docs overlay: correct stale
   Node module candidate wording and describe conditional/nounset restrictions.
   That changes the package/tree and cannot inherit this proposed hash silently.

Keep Unit2/4 aggregate DISCARD and invocation-diagnostic/native questions open;
conditional regex `=~`, general comparator arithmetic and aggregate `-v` are not
upgraded. Preserve Node W23/E09, job-retirement/census/RSS qualifications and all
prior author/reviewer failures. Neither selected-package checks nor this design
claim whole HEAD, current default npm test, full GNU Bash or native Node parity.
