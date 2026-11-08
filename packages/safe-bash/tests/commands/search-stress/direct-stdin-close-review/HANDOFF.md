# Baseline phase handoff — prepared fixture version 2

**Ready for explicit candidate routing; no candidate inspected or approved.**

Current replay evidence: `runs/baseline-03/summary.json` and `seal.json`.
Original freeze: `3152f33005fbd6b85053a5c5990ce42011e663b1`.
Version 2 preparation freeze: `fc19be6ceac27828d22472e78ca0a86041618363`.
Committed pre-fix product: `c5d44262ecca11009df6ce32a180005d3f3cb574`.

## Exact outcome

- **18 cases: 13 pass, 5 fail; 834 checks: 825 pass, 9 fail.**
- All 18 exact child PIDs exit naturally under the 30-second per-child watchdog.
- All fixture resources close after explicitly labelled release/manual cleanup.
- All 16 actual constructed workers exit; two zero-worker controls create none.
- All 181 source/config build-input hashes match before/after; all 709 packed
  file hashes and actual loaded module hashes match. Compiler/type inputs match.

Failure identities, unchanged from baseline-02 but a separately recorded run:

| Case | Failed check identities |
| --- | --- |
| `direct-first-pending-no-hook` | `source-return-before-settlement`; `structural-resource-closed-before-settlement` |
| `direct-split-prefix-pending` | `source-return-before-settlement`; `structural-resource-closed-before-settlement` |
| `direct-opaque-pending` | `source-return-before-settlement` |
| `input-error-before-return-error` | `source-return-count`; `source-resource-closed` |
| `shared-executor-sibling-isolation` | `source-return-count`; `source-resource-closed` |

The last case fails only cancelled-source closure; the unaffected sibling's
pending-state, signal, exact output and EOF checks pass. Caller reason identities,
Shell structural closure, separate Shell opaque finalizer limitation, quiet/early
EPIPE behavior, limits, binary exact-boundary EOF, and 64/256 chunk handshakes pass.
See README for detailed profiles, static complexity bounds and contract limits.

## Immutable executable and package bindings

- Original frozen cases: `629054ab31c89d6c85d7e9aad7ec19808d5990aeef147aabfa61f96d650aa8c0`.
- Prepared v2 cases: `7c2878680b994f4b66ba3d564efe17c0f60a122667da83ed62fe4285f6e146e0`.
- Unchanged assertion lines: `6d3bb10685c8f3bc94273c007da8c620b98bde933517c2d02111a8ced78d36cc`.
- Baseline rg source: `fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3`.
- Packed virtual-bash: `238f40a9b70fe83fa4b0175bcf7d29ceef0ae91fe7d269487f69bc1478fe8cf7`.
- Worker entry: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.

The package hash matches baseline-02's separately built/packed artifact. The
prepared fixture hash does not: v2 removes the obsolete post-acquisition method
swap and leaves only the finite stateful producer. Exact transformations are
retained; all original cases/assertions and earlier output bytes remain unchanged.

Preserve baseline-01 as 13 pass / 4 observed contract failures / 1 fixture timeout
plus its false source-inventory flag. Baseline-02 is the separate successful
preparation-v1 run. Neither is overwritten or relabelled. `evidence-manifest.json`
is historical at cb8bf241; `evidence-manifest-v2.json` binds the current handoff.
The original sidecar 9/10 and whole-gate failures remain separate.

## Next authorized step

Root must route Faraday's exact committed candidate and source binding. Then
inspect its minimal diff, authenticate before/after source and packed assets,
and replay the same prepared-v2 bytes through the actual moved public package.
Do not substitute dirty HEAD, change expectations, add regex/native corpora,
claim opaque hard preemption, or certify wrapper complexity before inspecting it.

Reproduction with a fresh append-only label:
`node tests/commands/search-stress/direct-stdin-close-review/prepare.mjs baseline-04`.
Then `node tests/commands/search-stress/direct-stdin-close-review/seal.mjs baseline-04`.
Exact argv/cwd/status/raw output and package moves are recorded per run. Removed
owned scratch trees are reconstructible from the retained tarballs, source Git
objects and prepared fixture bytes. No product or foreign file was edited.
