# Independent direct rg stdin cleanup: baseline ready

Current handoff is `HANDOFF.md` with prepared-v2 `runs/baseline-03` evidence.
The detailed baseline-02 record below is retained as a separate cohort.

**No candidate has been routed, inspected or approved.** This phase authenticates
the supplied committed pre-fix source, freezes independent holdouts, and prepares
an actual built/packed/moved consumer. Root must route Faraday's exact candidate.

## Commits and identity

- Baseline: `c5d44262ecca11009df6ce32a180005d3f3cb574`, supplied pre-fix proof.
- Original holdout freeze: `3152f33005fbd6b85053a5c5990ce42011e663b1`.
- First baseline outcomes retained: `62699e8d`.
- Preparation-only repair: `e055878b`, committed before corrected baseline or
  any candidate inspection; original frozen files and all assertions unchanged.
- Baseline `src/commands/search/rg.ts` SHA256:
  `fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3`.
- Authentic retained package `runs/baseline-02/virtual-bash-baseline.tgz` SHA256:
  `238f40a9b70fe83fa4b0175bcf7d29ceef0ae91fe7d269487f69bc1478fe8cf7`.
- Original cases SHA256:
  `629054ab31c89d6c85d7e9aad7ec19808d5990aeef147aabfa61f96d650aa8c0`.
- Prepared executable fixture SHA256:
  `a6e5db52430a7de8986deb421273417c00c43ec8dd4ea8d86bc05d11ca151d19`.

The live working tree was observed for status/object identity only; it is not the
selected baseline or a routed candidate. Foreign source/test work stays untouched.

## Corrected baseline results

`runs/baseline-02/summary.json`: **18 cases: 13 pass, 5 fail**; **834 named checks:
825 pass, 9 fail**. All 18 exact child processes exit naturally. No timeout,
signal termination or leftover fixture resource in this corrected run. Node's
strict unhandled-rejection mode is enabled. Fixture-owned pending promises also
have safety observers; this is not proof that the product is their sole observer.

| Failing independent case | Exact failure identities | Observation |
| --- | --- | --- |
| `direct-first-pending-no-hook` | `source-return-before-settlement`, `structural-resource-closed-before-settlement` | next=1, return=0, resource open at caller-abort settlement |
| `direct-split-prefix-pending` | same two identities | empty + split nonmatch, next=4, return=0, resource open |
| `direct-opaque-pending` | `source-return-before-settlement` | return=0 before release; finalizer correctly not preempted |
| `input-error-before-return-error` | `source-return-count`, `source-resource-closed` | next=2, return=0; primary diagnostic/status preserved but resource not closed |
| `shared-executor-sibling-isolation` | same two identities | cancelled source not closed; survivor isolation/output/EOF all pass |

All caller-reason reference comparisons pass, including distinct errno-shaped
caller, sink and return error objects. Failures are never converted into passes
because a later fixture release/manual return closes the resource.

Passing controls include:

- Public plugin registration followed by direct registered execute, and public
  `Shell.exec` structural cleanup before settlement: next=2, return=1, closed=true.
- Separate Shell opaque control: return=1 while finalizer remains pending;
  explicit gate release completes the finalizer. No opaque hard-preemption claim.
- Quiet early success awaits gated cooperative return; only one read despite
  multiple records. EPIPE stops after one attempted `hit\n` write with status 0,
  no diagnostics, and does not await deliberately held raw return completion.
- Input/line/output limit failures retain exact diagnostics and status 2, exact
  accepted output, one return and no read beyond the violating chunk.
- Natural EOF at exact 10-byte input/5-byte line/6-byte output limits preserves
  NUL and `0xff`: five chunks, six next calls, zero returns after EOF.
- 64/256 four-byte chunk schedules have 65/257 next calls, 64/256 awaited sink
  writes, 256/1024 input and output bytes, and zero next calls during writes.
- Pre-aborted invocation preserves its exact reason with no iterator acquisition,
  read, hook or worker. Zero maxWorkers rejects with the existing RangeError.
- Same-plugin/same-registry/same-executor sibling remains pending and unreturned
  when the other caller aborts, then emits exactly `hit\n` and naturally reaches
  EOF after release. Only the cancelled source's missing closure fails.

## Authentication and worker qualification

The isolated build reconstructs **181 committed build inputs** (177 source TS
files plus four package/config files), runs the existing TypeScript build, packs
with npm offline/ignore-scripts, extracts the package, then renames the consumer
and quarantines the original build directory. No source or root dist imports.
The package contains 708 built files plus package.json. Exact argv/cwd/stdout/
stderr/status are retained in `commands.json` and per-case records.

Node is `v22.22.2`; compiler is TypeScript `5.9.3`. Compiler, Node types and
undici-types file manifests are retained and checked unchanged. No dependency
install, product/native subprocess, external service or root build was used.

All **16 worker-using cases actually construct and retire one worker each**;
the two explicit zero-worker controls construct none. The unchanged ordinary
fixed pattern uses a worker in this baseline; the evidence is not an empty-event
list. Every actual main-thread load URL/hash and constructed worker URL/hash
matches the moved package manifest. Worker execArgv/resource limits remain
unchanged. `seal.json` authenticates the static worker graph:

- `worker.js`: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.
- `matching.js`: `2f97a68fce0ab504676afe31b4c4fd5eea1edde87ffb28bea9f55c8422693791`.

These are static dependency bytes plus real worker construction/exit observations,
not dynamic instrumentation of module loads inside workers. Main-thread imports
are directly observed by a forwarding Node module hook. Product files are not
patched; the forwarding Worker observer keeps constructor arguments unchanged.

## Preserved preparation defects

`runs/baseline-01` remains **13 pass, 4 contract-failing cases, 1 fixture timeout**.
The timeout stopped only owned child PID 75937 after the frozen 30-second bound.
Changing an iterator's next method after acquisition did not change the method
cached by for-await. The prepared finite schedule correction restores the already
specified pending/chunk/EOF sequence, changes no expectation, and is fully
disclosed in `PREPARATION-CORRECTION.md` and `prepare-fixture.mjs`.

The original `sourceUnchanged=false` field also remains: its comparison mistakenly
included an unmaterialized context-only Markdown file. The corrected exact
build-input comparison and seal check all 181 actual source/config bytes. Neither
old field nor timeout is relabelled. The original and corrected executable hashes
are distinct; this is not described as unchanged all-input executable proof.

The supplied sidecar's historical 9/10 and earlier frozen whole-gate failures are
separate cohorts and unchanged. Author cases were read only as context, not run
or counted as independent cases.

## Remaining routed-candidate work

Root must supply the exact Faraday commit and authorized source binding. Compare
its precise diff and source/package hashes with this committed baseline, then
replay the same prepared fixture bytes through the moved public package. Preserve
all five baseline failure identities and thirteen passing controls. Inspect any
added wrapper for one-next-per-chunk behavior, no accumulating copy/concatenation,
and unchanged budgets/signals; rerun the bounded handshake accounting, not a broad
performance corpus. Existing long-line processing is not certified globally linear.

No production fix, candidate approval, whole-gate acceptance, superiority claim,
new pathological regex, native oracle or unrelated audit occurs in this phase.

Reproduce with a fresh label, e.g.
`node tests/commands/search-stress/direct-stdin-close-review/prepare.mjs baseline-03`.
The runner records the package move, exact module paths/hashes, child argv and
hard watchdog. The seal is specific to baseline-02. Temporary build/cache/consumer
trees are removed at handoff; committed source provenance, prepared fixture bytes,
the packed package, raw outputs and closure evidence remain reproducible.
