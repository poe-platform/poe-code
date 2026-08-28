# R3 author harness repair — independent review requested, no gate GO

2026-08-28. ROOT's narrow repair authorization follows independent682aad12.
Preseal `d627747d`; source **437778996f60109e212e20b1b242455866fda285**;
whole-module stub/control seal `b7e7689b`. No product source or old evidence changed.

## Exact selected changes

`SOURCE-CANDIDATE.json` records all15 selected paths, previous/current SHA-256,
mode, byte length and Git blob identities.13 are fixture/helper files; two are
shipping `execute.mjs` and `DRIVER.json`. Selection is explicit, not current HEAD.

| Paths | Change / retained boundary |
|---|---|
| `tests/commands/table-text-stress/support.ts` | Each native call allocates unique owned TMPDIR scratch; `try/finally` is installed before the first sentinel/file write, and exact-root removal is awaited. All original result/file/sentinel assertions retained. |
| `tests/commands/table-text-stress/shared-stdin-fix/support.ts` | Version/native calls no longer create canonical source-local `.runtime`. Each owns a unique parent; child cleanup is recursive only for that newly created child, parent cleanup is **nonrecursive rmdir**. Foreign parent children cause refusal and survive. The exported old runtime path and opt-in historical `validate.ts` remain unchanged. |
| `tests/fs/mount/identity-authority-review/implementation/public-comparison.test.ts` | Same ownership principle replaces source-local `.runs`; after-hook registration precedes child acquisition. Foreign parent children are not deleted. All actual FS/comparison assertions unchanged. |
| `launcher-v3/execute.mjs` | `benchmarkTypeInvocation` validates admitted root TS5.9.3 package, bin/tsc, lib/tsc.js and lib/_tsc.js bytes/modes before selecting root compiler. Benchmark cwd and `--noEmit -p tsconfig.json` unchanged. Build audit/accounting, dependency closure and external guards retained. |
| `tests/commands/diff-patch-stress/editflows/helpers.ts` | Direct exact admitted Git executable/hash and Git core path; original apply/version argv and fixture namespace unchanged. No `/usr/bin/git` selector execution. |
| `tests/integration/s3-http-exports/verify.mjs` | Exact same Git route; inherited finite gate PATH is no longer replaced by a selector PATH. Later source-proven bare npm calls route through current Node plus the exact admitted npm CLI. Actual executable and executionArgs added to step records, original requested command/args retained. |
| `tests/plugins/qualified-current-release-native-data/helpers.ts` | Bare npm request uses current Node plus authenticated existing CLI; script argv, cwd, finite inherited PATH and NODE_TEST_CONTEXT removal preserved. No npx/install/ambient lookup introduced. |
| `tests/commands/search-stress/{safety,streaming}.test.ts` | Explicit `--test-reporter=tap` before positional files; exact exit and10/6 count assertions remain. |
| `tests/commands/diff-patch-stress/{gnu-target/oracle,gnu-auxiliary/helpers,gnu-target-followup/helpers}.ts` | Missing TMPDIR now comes from fresh owned scratch outside semantic fixture roots; identity-probe and actual patch paths share the synchronous helper. Gate-root containment checked before dispatch, native argv/locale/hash pins unchanged. Existing formats/helpers already sets TMPDIR for the later replay and is untouched. |
| `tests/commands/stream-inspection/oracle.ts` | Native capture gets separate owned TMPDIR, not default `/var/tmp`; original cwd/argv0/input/expected observations unchanged. Both created roots cleaned in finally. |
| `tests/shell-stress/helpers.ts` | Native Bash gets separate scratch TMPDIR; HOME and semantic cwd stay unchanged. **No filtering/deleting sh-thd entries from semantic snapshots.** Actual extra semantic files remain observable. |
| `launcher-v3/DRIVER.json` | Author-only reseal for changed execute.mjs, previous source/driver retained. Not a new accepted release or a complete successor profile. |

New normalized driver:
`e5f3124bd62f8710d5293b8c06b4ce6184a80ca68cba534f519ee85af8eac6d4`.
The40 member files plus DRIVER itself remain41 shipping files. No fence, tool
identity/profile, eligibility, native permission, immutable helper or product API
change. No old release receipt matches this new driver.

## What was actually checked

**45/45 author synthetic/source controls**,17 synthetic child-process dispatches,
174ms recorded, Node24.11.1. `RESULTS-v1.json` is the unchanged first capture.
Whole changed fixture modules were parsed using builtin TypeScript syntax stripping
and linked with Node VM synthetic imports. Product imports were not executed;
filesystem operations used bounded in-memory fixtures, child-process imports
recorded arguments rather than spawning. No source-function extraction/model is
presented as OS or native behavior proof.13 modules have actual VM load hashes;
the auxiliary callsite is separately inspected as source.

The controls cover successful/error/awaited scratch removal, foreign parent-child
preservation, unique overlapping parents, cleanup registration before acquisition,
root compiler identity/path/arguments, exact Git/npm routing and wrong-hash
refusal, TAP/wrong-format behavior, semantic/scratch separation and unchanged
source/evidence boundaries. Actual native-facing path refusals, version output,
kernel cleanup, compiler success and full package flow were **not** executed.

Specific limits, not hidden missing passes:
- Shared version work checks cleanup after missing-data rejection, not a real
  successful version query. No oracle binary ran.
- C08 auxiliary check is source-only. Followup and scratch helper controls use
  recording stubs; they do not validate native patch behavior.
- S3 whole-module control checks first Git dispatch and wrong-hash refusal, then
  stops at an injected second dispatch fault. Its later npm/build/pack/type/service
  phases remain unexecuted; npm helper's separate synthetic checks are not that flow.
- Compiler selection is exercised with exact readonly admitted metadata/bytes,
  **not** a compiler/checker invocation. No global/scoped typecheck or build ran.
- Synthetic records do not prove real-child retirement, OS enforcement, live
  syscall targets, a safe socket path or native authority eligibility.

## Concrete remaining capability gaps

The existing admitted external-tool closure has **no cut/sort/tee/xargs/cat**.
Those five search pipeline failures cannot honestly be fixed by adding ambient
PATH. Exact finite binary/dependency/argv roles need separate ROOT admission.
No route, binary copy, permissions or source expectation was added for them.
Python/xxd/cksum and optional grep replay obligations/skips also stay unresolved.

G04 structural-signal behavior, G05/G06 directory authority/modes, G07 Node22
characterization, G11 socket setup and G14 env-S expectation remain untouched.
No source/type/default/parser/runtime/private edits or assertions waived.
Native temporary-location repairs are plausible source fixes supported by the
observed missing/misplaced TMPDIR; actual success/effect equivalence needs the
separately authorized bounded native review. They do not authorize forbidden
operations outside the fence or expand file-mode eligibility.

## Exact prospective successor recipe — proposal only

1. Start with fixed **f5e9fc49b6abb38e180cc9de16c95fced102ff75**, not live HEAD.
2. Replace **only the13 fixture/helper blobs** listed in SOURCE-CANDIDATE from
   reachable43777899. Preserve all product `src`, package/lock, README and build
   config bytes. Native captures and expected results are unchanged. The same632
   canonical filenames remain selected; three canonical bodies are intentionally
   versioned (two reporter wrappers and mount fixture setup), not old-body passes.
3. Bind a new reconstructible Git candidate/tree. No such combined candidate was
   materialized/built here. Packagec109 is expected from unchanged shipping/build
   inputs **by derivation only**, not a newly reproduced pack.
4. Derive a versioned complete closure/profile/cleanup/consumer/source binding
   for that exact candidate, preserving qualification and native obligations.
   Do not reuse the original f5 source hashes for the changed13 files. Audit any
   downstream current-fixture binding affected; sealed historical profiles remain
   unchanged and can legitimately refuse changed inputs.
5. Reseal this shipping driver against that chosen candidate/profile. The current
   author driver still references historical f5 metadata and is **not** that
   coherent full-gate admission. Rebind evidence, tools, exact instruction metadata
   projection and OS-fence receipts; no historical GO is inherited.
6. Different reviewer (Dirac/root-designated) verifies exact15-file delta, control
   linkage/limitations and hidden cleanup/route failures. Root separately decides
   missing tools and authorizes any real compiler/native/test subset. Full gate
   requires its own independent driver review and fresh one-attempt release.

Suggested bounded future subset remains CONTROL-RECIPE's declared families:
71-row table native corpus, changed shared/mount fixture lifetimes, benchmark
noEmit using one existing production build, two Git families/npm script smoke,
two reporter wrappers and native scratch positives/denials. No setid/socket/signal
or private setup rerun is included. Preserve original arguments, golden bytes,
unexpected-file sensitivity, exact count assertions and same fences throughout.

## Preservation / ownership

R3 remains **19425P/132F/7skip,6/14**, aggregate integrity/cleanup false. The928
captures and286 retained entries were not removed or repaired; old source/code
and failure data stay read-only. Final metadata verification is in
`PRESERVATION.json`; no old capture/attempt was rerun. All new repairs and evidence
are explicit owned commits. Foreign staging and unrelated untracked trees are
preserved. No gate release, product acceptance, native parity or superiority claim.
