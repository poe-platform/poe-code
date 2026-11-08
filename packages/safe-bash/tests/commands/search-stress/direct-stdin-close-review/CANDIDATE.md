# Independent candidate acceptance — exact prepared-v2 cohort

**ACCEPTED within this independent 18-case scope only.** Routed production
`c27249c8f6085d6d8366ae348b2b93aa0e377369` changes the matched baseline from
**13/18 to 18/18 cases** and **825/834 to 834/834 checks**: nine repaired checks,
825 unchanged passes, zero regressions. The prepared-v2 fixtures ran **once**,
without changed bytes, cases, assertions, schedules or expectations.

No product source was edited. Author evidence
`8a08ecc026a2d0884508d4115acb909b22251199` and its 14/14, original 9/10→10/10,
107-test, build and scoped-type cohorts are not counted as independent acceptance.
The source author did not inspect these holdouts, per the user's routed handoff.

## Execution and provenance

- Baseline product: `c5d44262ecca11009df6ce32a180005d3f3cb574`.
- Original freeze: `3152f33005fbd6b85053a5c5990ce42011e663b1`.
- Prepared-v2 freeze: `fc19be6ceac27828d22472e78ca0a86041618363`.
- Matched baseline-03 evidence: `32d2f7dc1d8438338d2b7bf070041b3302c0a668`.
- Candidate execution binding frozen before replay:
  `4d524fd8d8c7f0bfbafba625778e8fa4550acf5f`.
- Node v22.22.2, TypeScript 5.9.3; exact executable, compiler package and type-input
  hashes are in `runs/candidate-01/execution-binding.json` and verified afterward.
- Reconstructed all 181 source/config build inputs from exact candidate Git
  objects, not HEAD or uncommitted files. The 177 tracked source TypeScript paths
  match the build-input inventory. Against baseline, only `rg.ts` differs.
- Built in owned scratch, packed offline with scripts disabled, extracted into a
  public `virtual-bash` installation, moved the consumer, and quarantined the build
  tree before execution. No root build, dependency installation, native semantic
  probe, external service or new regex corpus was used.
- All 709 packed files match the build and remain unchanged. All recorded actual
  loaded package modules match their packed hashes before and after execution.
  Each real worker entry is authenticated at construction; the unchanged static
  worker→matching import graph is separately hashed, not represented as an
  instrumented worker-internal module-load trace.
- Exact child argv uses `--unhandled-rejections=strict`; the frozen parent watchdog
  is 30,000 ms per child. All 18 children exit naturally, with empty stderr; no
  timeout, kill or forced fixture release substitutes for a passing assertion.
- 16 actual workers in 16 cases retire; two explicit zero-worker controls create
  none. All exact child and recorded preparation-process PIDs are absent. Fixture
  resources close after their explicitly recorded cooperative releases/cleanup.
- The exact owned build/cache/consumer scratch directory is removed. Findings and
  readiness text markers are handoff metadata, not retained active scratch trees.

Preparation began 2026-08-27 14:01:59 UTC, binding was frozen at 14:02:13 UTC,
the one replay began at 14:02:45 UTC, and corrected sealing completed at 14:05:04
UTC. These timestamps describe this work only, not 72-hour or performance evidence.

## Key SHA256 bindings

| Input or loaded asset | SHA256 |
| --- | --- |
| Original cases | `629054ab31c89d6c85d7e9aad7ec19808d5990aeef147aabfa61f96d650aa8c0` |
| Exact prepared-v2 cases | `7c2878680b994f4b66ba3d564efe17c0f60a122667da83ed62fe4285f6e146e0` |
| Unchanged assertion lines | `6d3bb10685c8f3bc94273c007da8c620b98bde933517c2d02111a8ced78d36cc` |
| Unchanged public consumer | `f0c7c93eecc99c3213665a221c53b89536e90e6f7ac6aef6d84914a979879c59` |
| Baseline rg source | `fee9a380679e17da179a1c6b4f9bacf9c89a10e0dd1d18981c26b9296f9846d3` |
| Candidate rg source | `1c38e14b811a46795af958a99b9fae6b02b415b6ff8363e5755ecd15bfdd9d5f` |
| Baseline packed tarball | `238f40a9b70fe83fa4b0175bcf7d29ceef0ae91fe7d269487f69bc1478fe8cf7` |
| Candidate packed tarball | `37ee331ca0769aaebadfbfce9bbd35bb1d4e8405c0cedd03cb774ab286ca9003` |
| Loaded candidate rg.js | `c74d3773ba9423e4928ce32036882138cafdc091dafcbf001c56ccafa6f02634` |
| Loaded public index.js | `77b771a6066aa32f82b903f7a80c578132388d6d9cec9fbde15485915859df5d` |
| Actual worker entry | `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7` |

The full before/loaded/after module records and source/config after-hashes are in
`runs/candidate-01/seal.json`. Original stdout/stderr and structured outcomes are
retained per case. `transitions.json` matches all 834 check identities and expected
values against baseline-03, including repeated identities at distinct positions.

## Exact repaired checks

| Case | Original failure → candidate pass |
| --- | --- |
| direct-first-pending-no-hook | source return count before settlement 0→1; structural resource closed false→true |
| direct-split-prefix-pending | source return count before settlement 0→1; structural resource closed false→true |
| direct-opaque-pending | source return count before settlement 0→1 only; opaque finalizer remains unpreempted |
| input-error-before-return-error | source return count 0→1; source resource closed false→true |
| shared-executor-sibling-isolation | cancelled source return count 0→1 and resource closed false→true; survivor assertions remain passing |

## Exact wrapper review and bounds

The routed production diff adds the `readBytes` import and changes only stdin's
selection at `src/commands/search/rg.ts:38` to
`readBytes(stdin, limits.signal)`, inside the input passed to
`AvailableRecords.source`. File input, limits, worker/session code, contracts,
Shell/FS and root exports are unchanged.

At `src/contracts/io.ts:200`, `readBytes` acquires one iterator, awaits one `next`
at a time through the existing abort-aware helper, checks Uint8Array values, then
yields the same chunk. It adds no collection, concatenation, byte copy, prefetch,
growing array or scan over previously received chunks. Added wrapper state is
constant per iterator and control work is constant per requested chunk/EOF;
there is no new accumulating materialization or quadratic wrapper. This is a
static wrapper bound, not a time/memory benchmark or proof that existing long-line
concatenation in `shared.ts` is globally linear. `AvailableRecords.source` retains
its existing owned-byte copy before advancing the producer.

The inner placement matters: an abort interrupts `readBytes`' await of the raw
source's `next`, allowing its finally to request the raw iterator's return even
while the surrounding async-generator chain had been pending. Normal early
termination awaits cooperative return; natural EOF sets `finished` and skips
return. Nested generator returns do not duplicate the raw source return in these
cases: abnormal/early sources show one return; natural EOF shows zero.

An already-aborted signal prevents source acquisition. The unchanged Limits signal
combines caller cancellation and the local output-stop signal. Primary caller
reason reference identity, distinct caller/sink/return errors, input-error
diagnostic/status precedence, and sibling isolation pass the exact frozen checks.
`readBytes` rethrows the primary read failure and does not replace it with a return
failure when `failed` is set; aborted cleanup has a rejection observer. Fixture
promises also have observers, so strict-mode success does not prove the product is
their sole observer.

On abort, `readBytes` requests return but does **not** await arbitrary underlying
opaque work. Structural immediate-return fixtures close before settlement;
opaque generators receive return but their finalizers remain pending until the
explicit release. The separate Shell opaque case waits for release according to
its frozen cleanup sequence. EPIPE's gated source return is likewise not claimed
closed before its release. No opaque hard preemption or universal resource lease
is promised.

Matched accounting is unchanged: input/line/output quota cases use respectively
2/1/2 source next calls and one return each. Binary NUL/ff, empty chunks and split
EOF use six next calls, ten bytes and zero returns. The 64/256 chunk controls use
65/257 next calls (including EOF), 64/256 writes, 256/1024 input bytes, zero returns
and zero reads during awaited writes. Every per-chunk no-prefetch/write handshake
remains passing. Quiet early termination uses one next and one return and stays
pending until its cooperative return gate is released.

## Preserved postprocessing defect and scope

The original runner completed all 18 cases, then failed its seal because logical
`/tmp` and Node's physical `/private/tmp` paths produced a missing manifest key.
`replay-error.json` and the frozen runner remain unchanged. The separate
`candidate-seal.mjs` resolves that existing alias before exact hash lookup; it does
not execute cases. `CANDIDATE-SEAL-CORRECTION.md` records the correction; retained
raw evidence hashes match before/after. This is disclosed harness postprocessing,
not a second replay or an assertion relaxation.

Historical baseline-01 defects, baseline-02 and baseline-03 failures, c5d44262
failures and the earlier frozen8670 whole-gate remain untouched. This acceptance
does not rescore that whole gate, establish universal parity/superiority, certify
provider behavior, or replace broader release acceptance. No new product blocker
was found in this exact cohort and wrapper review.
