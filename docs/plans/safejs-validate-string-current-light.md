# Independent current String preparation review

Date: August 30, 2026. Reviewer: Noether, independent of author Turing.

## Decision

**LIGHT READY FOR RUNTIME, not publication READY.** No concrete static blocker
was found in the declared String-only composition. The five added test cases
remain unexecuted. This review does not convert earlier runtime results into
current results, certify a future npm artifact, or authorize CPU work.

The isolated review checkout was cloned on main and pulled before review. Its
exact HEAD is `a709a292997bc167d594a736391df64e3a432c68`. No candidate patch was
applied to it. Author files and earlier captures remain unchanged.

## Pinned inputs and composition

- Author manifest: `/Users/kjopek/Workspace/poe-code-safe-js-string-coercion-released-prep/out/light-refresh/manifest.json`.
- Independently checked manifest SHA-256: `2d23bfebfb4394d4fc3ac9fd7d55b6aecc05d51e9e419170444126a233e8bd6e`.
- Author base: `1b180668e29f43421ab2b89210a17ab6eab8c06e`.
- Historical independent manifest: `/Users/kjopek/Workspace/poe-code-safejs-string-coercion-integrated-independent/out/safejs-string-coercion-integrated-independent/manifest.json`.
- Independently checked historical manifest SHA-256: `b3d30ab777f0b7a5052ebfc4aee7ce8c8b35735c951186f4c5dce7f86212f227`.
- The root-accepted actual prototype prerequisite is `f717e57a3d24ef7bc4551405be2211be3199e3d0582b624900878cefafc8c10e`; its acceptance is supplied coordination evidence, not a new artifact revalidation here. The author's earlier PENDING entry is retained as historical metadata.

All four existing author preimages match current Git blobs. The other four
paths are absent from current HEAD. The companion receipt records each path and
blob, including the absent identities. `git apply --check` of the author's
`out/light-refresh/string-only-draft.patch` exits 0 on the fresh checkout.
This is a non-mutating applicability check, not a runtime gate.

Seven explicit code/test postimages were compared byte-for-byte against
`/Users/kjopek/Workspace/poe-code-safe-js-string-coercion-rename-prep` and all
match. This is not an authentication of every file in either capsule.
The eighth path is the author's new preparation plan. No author assertions
were weakened or edited by this reviewer.

The existing `values.ts` prototype repair is already in the current preimage.
The String delta adds the internal invocation-context callback, not another
prototype-allocation repair. The host bridge remains blob
`05bb4433ce78b9cab6a680244d8338073c7ef94f`; snapshot policy remains blob
`4a41efba10e4fb5d7f9a12c490ec584c04086d8e`.

Upstream since the author base changes root dependency/packaging metadata,
`package-lock.json`, `packages/poe-agent/package.json`, documentation, and a
standalone-package metadata test, not the eight owned preimages. In particular,
the root and poe-agent shell-quote range changes and root gray-matter bundling
must remain intact. Old dependency/build results do not certify this checkout.
No old whole-file postimage was copied over upstream changes.

## Static boundary findings

References in this section are to the author's unchanged postimages unless
identified as current unchanged infrastructure.

1. `packages/safe-js/src/interp/string-coercion.ts:11` rejects a raw native
   function before applying native `String`. Owned object hooks use own data
   descriptors and `isSandboxClosure`, not a native function call or native
   `Function.prototype.toString`. The modeled host capability gets an opaque
   value; that is not a claim of native function-source parity.
2. The same helper at line 24 checks `toString` before `valueOf`, preserves the
   original receiver, distinguishes absent from own undefined, and tries the
   second hook only after a nonprimitive result. At line 104, accessor
   descriptors are refused without reading their getter. Raw-hook/accessor
   zero-invocation controls already exist at
   `packages/safe-js/src/interp/globals/string-coercion.test.ts:249`.
3. `packages/safe-js/src/interp/interpreter.ts:3466` routes owned hooks through
   the existing VM invocation path with the same evaluation context, stack,
   span, and receiver. Current `interp/cancel.ts:35`, interpreter node budget
   checks at line 404, and host-bridge dispatch remain in that path. No new
   callable is stored in guest output, bindings, or checkpoint data by this
   delta. Budget/error/cancellation behavior still requires current execution.
4. An internal await is not itself proof of awaiting a guest Promise to its
   eventual primitive. Current `interp/async.ts:428` preserves/wraps async
   results as branded SandboxPromise objects; `interp/values.ts` creates that
   modeled object without a native callable `then`. A guest thenable's method
   is a SandboxClosure object, not a native callable. The existing async-hook
   case and two new synchronous Promise/thenable cases must establish the
   observable result and order at runtime; static tracing is not their PASS.
5. `interp/globals/object-array.ts:128` is the explicit String entry. The
   new helper is not wired into passive snapshot/digest construction. Existing
   host bridging still chooses explicit policy before named registration and
   records real host calls. The new named-policy cases require one active
   call and no additional dump/completed-replay calls. Passive typed-graph
   counter controls from the previous approval remain required.
6. Recursive hooks, default Error fields, string construction, and typed/array
   traversal remain budgeted in the helper and VM. Error name conversion
   precedes message lookup. Existing thrown-sentinel identity, receiver, hook
   mutation/order, array-cycle, and abort-before-next-host-call assertions must
   remain exact, not replaced by success-only checks.

The normative comparison is ECMAScript OrdinaryToPrimitive with the string
hint: callable toString then valueOf, original receiver, primitive-only
success, and no implicit Await step. The String constructor algorithm also
distinguishes no argument from an explicit argument. Primary references:
`https://tc39.es/ecma262/multipage/abstract-operations.html#sec-ordinarytoprimitive`
and
`https://tc39.es/ecma262/multipage/text-processing.html#sec-string-constructor-string-value`.
These references do not establish blanket support for inherited hooks,
Symbol.toPrimitive, native accessors, or arbitrary native function capabilities.

## Five unexecuted draft cases

- Opaque capability/intrinsic String: three exact opaque results, host counter
  zero during conversion, dump, and two completed restores.
- Synchronous hook returning Promise: exact `['8', ['string', 'value']]`;
  the Promise's eventual primitive is not the conversion result.
- Synchronous hook returning a thenable: the same exact result and log;
  the thenable's `wrong` action is never invoked.
- Named host policy: one journaled read-side-effect call, unchanged operation
  identity, and zero completed reissues.
- Explicit host policy override: the same counter/identity checks with the
  explicitly declared re-issue policy taking precedence over registration.

The two Promise/thenable cases compare independent native execution with both
a literal expectation and current output. The opaque-capability case instead
asserts the modeled public boundary; it must not be described as native source
text equivalence. No additional independent test file is necessary for this
LIGHT review. If runtime exposes an uncovered defect, add one unique proper
package test with a preserved failing control; route production repair to Turing.

## Minimal independent gates after explicit CPU GO

1. Recheck the eight preimages and author freeze at the actual intake HEAD.
   Preserve current package/lock inputs. Perform an owned isolated normal
   dependency setup and only the build required for current source/public
   entrypoints. Do not reuse old built chunks as current proof.
2. Execute the three declared String/Error test roots, including all five
   draft cases and the existing eight typed String controls. Keep native
   expected values independent. Record current baseline results for the new
   drafts when arranging TDD evidence; do not assume all five must be RED.
3. Reuse the existing bounded public matrix, not a new feature matrix:
   historical `evidence/public-50-inputs.json` identifies 39 original cases
   plus 11 already approved typed cases. Its indexed hash is
   `8a449d1ce9e45e35265ae23bde88b865b3aad666814c7cf7ae726b9f12548922`.
   Inspect/authenticate its declared retained material before execution and
   map only package entrypoint paths to the canonical current package. Preserve
   sources, full native expectations, caps, errors, journals, and fresh
   completed-replay call counts. The eight typed unit controls are not eight
   additional workflow cases. The older large observations were not reread here.
4. Reuse the three retained original/active/passive typed-graph profiles and
   public budget/cancel controls. Check exact canonical graphs, aliases,
   source-capability identity, passive counters, and pending versus completed
   reissue counts through both source and current built public entrypoints.
   Preserve documented outer-projection differences as differences.
5. Run the current named-host-policy and host-error-identity tests plus bounded
   prototype/v6/O12 regression selection. Include the ordinary versus genuine
   null record String acknowledgement producer/fresh-replay control and the
   existing three original Float fixtures. Retain the real old-lossy negative
   and O12 raw-left/minimal-loss distinctions. Use existing relevant Map/FS/
   locale controls, not a new universal matrix or repeated complete O15 audit.
6. Run configured and owned-test types after the required build, scoped lint,
   publication-file format and strict whitespace checks. Obtain the author's
   exact current package/source gate exits. Do not duplicate a publisher full
   root gate solely to repeat old counts; report its distinct identity/owner.
   Current source approval and later actual published String verification are
   separate gates.

The historical matrix selectors and hashes above are read from the authenticated
manifest index, not freshly authenticated payload files. The historical approval
records 50 native cases, source/built observations and fresh restores, three
typed graphs, 12 budget/cancellation controls, and a six-RED/74-pass then
80-pass composition history. Those remain historical counts, not this phase's
results. Expected scoped runtime is approximately 4-6 minutes after setup;
installation/build cost must be reserved separately. Lock exact commands and
the finite selection before CPU GO; no automatic retries or relaxed caps.

## Qualifications and phase completion

- O08 callable-own writes and binary-addition coercion remain separately OPEN.
- The historical CHECKPOINT_REPLAY line-53 qualification is currently at
  `packages/safe-js/CHECKPOINT_REPLAY.md:120`. Canonical replay is not a promise
  of lossless outer bindings/heap/legacy projections or transferable whole-dump
  migration receipts. No old actual or fixture is normalized or repaired.
- No source fixes, candidate overlay, test additions, original-audit reads,
  installations, target executions, builds, typechecks, lint, formatter runs,
  bulk hashing, README/SKILL/home changes, commits, or pushes occurred.
- Only seven explicitly declared postimages were byte-compared; small manifest
  and reviewer-report hashes are not a full artifact authentication gate.
- A read-only locator command referenced nonexistent `interp/closures.ts` and
  exited 2; it was a review locator mistake, not a runtime failure. Its next
  lookup used the actual imports. Truncated display output is not treated as
  unread source proof; required sections were inspected narrowly.
- A metadata shell wrapper then used zsh's read-only `status` variable and
  exited 1 before reporting the whitespace check's status. The corrected
  metadata-only invocation returned `git diff --no-index --check` exit 1
  with no diagnostics: an expected new-file difference, not an exit-0 claim.
  The final seal repeats that check after this explanatory append. Formatter
  validation remains unexecuted. The capsule uses the existing ignored `tmp/`
  convention; no ignore configuration is changed.
- This phase is finished and CPU-quiescent: zero target runtime processes
  started. Runtime and publication decisions remain pending their own gates.

## Final independent current-candidate review

This appended August 30, 2026 review supersedes the initial LIGHT-only decision
for the exact candidate below. The initial LIGHT capture remains immutable.

**SCOPED SOURCE CANDIDATE READY.** This is not an actual published String
artifact approval, a universal coercion/prototype claim, or README approval.
The author is Turing; this reviewer made no production fixes or assertion edits.
Publication remains the coordinator/publisher's decision after current intake
preimage checks. O08 callable-own writes and binary-addition coercion stay OPEN.

### Exact intake

The fresh pull selected `420233dc9af5977bee2cec5688cfa58bdd55ab40`, not merely
the earlier `a709a292` checkout. The change between those bases is four
documentation files; the selected runtime/dependency inputs are nevertheless
identified and tested directly, not assumed equivalent to an npm release.

The final author manifest is
`/Users/kjopek/Workspace/poe-code-safe-js-string-coercion-released-prep/out/safejs-remediation/string-coercion-current/candidate-a709a292/manifest.json`,
SHA-256 `da5bc65d5935bffd291a492555bd303557c94f3e02189b20d29cb82015a95e70`.
All eight postimages and four existing preimages authenticated before intake;
the four new paths were absent. The exact patch dry-applied without conflict.
The production files are unchanged from the LIGHT-reviewed candidate. The
only final test delta is formatting of the named-policy callback; its patch
hash is `d8c19dc3d11ceeee3834f8ff5ba8f7be3fcfa1d097ecc7d43ba9dbc442b14fcb`.
Its source, expectations, operations, and call-count assertions are unchanged.

Current root package, lock, and poe-agent package Git blobs are respectively
`2683cb646bd29037b68f8829c4f377ffd559c15e`,
`171ec72b2dfdc8cbb9530e3febc9988302967bb7`, and
`d5322140140edcd61caea92547e6056c73467e0d`. The source package identifies itself
as `0.0.0-dev`. No claim about the latest registry package follows from it.

### Executed gates and complete-output adjudication

Evidence root:
`/Users/kjopek/Workspace/poe-code-safe-js-string-noether-review/out/safejs-remediation/string-current-independent/tmp/run-2026-08-30T111548561Z`.
Every executed command has its own saved argv, exits and output there. Its
`full-output-adjudication.json` records saved-data comparisons, not new tests.

- An owned Node 22.22.2 installation used isolated HOME/cache/config/prefix/TMP
  under `/tmp/nstr-6lLyEZ`, normal source-install hooks and the expressly
  authorized `SKIP_SYNC_SKILLS=1`. No writable dependency tree was shared.
- Forced build: 68 tasks, zero cache hits, exit 0. Configured root build also
  exited 0. No full-root test suite was duplicated.
- Focused current source tests: 928 passed across 16 roots, zero failed/skipped.
  The owned String/Error roots contribute 85 of these, including all five new
  controls. Current named policy, host Error identity, prototype, genuine v6,
  Float camera/storage, Map replay/aliases, locale, and FS roots are included.
- O12: 10 tests passed; 18 captured source-mode observations were inspected.
  This run does not claim a separate built-O12 execution.
- Public matrix: all 50 native outputs match the retained complete native
  observations and traces. The 39 original plus 11 existing typed cases give
  100 source/built current observations, 100 same-process restores, and 100
  fresh-process restores. All 200 current-to-replay dump comparisons are exact;
  all completed host/provider reissue counters are zero. These yield 300
  completed captures, not 300 independent test cases.
- All 100 current observations, including recorded prototype observations,
  also match their historical equivalents. The original Error-dependency
  case has a native ordinary return-record prototype versus a guest null
  prototype in each entrypoint; those two raw domain differences remain in
  the evidence. Data, own-key order, traces and replays were not normalized.
- Three typed profiles ran in 21 processes: three native, six source/built
  producers, six pending restores and six completed restores. Full recorded
  values, byte storage, aliases, hook metadata and host observations match.
  All 12 canonical replay comparisons match; four whole dumps match and
  eight active/passive outer dumps differ in hostCalls/heap projections.
  Those real differences remain qualified under CHECKPOINT_REPLAY, not waived
  as renumbering. Pending checkpoint reissues are exactly one; completed
  exchange/checkpoint reissues and passive hook invocations are zero.
- Twelve public budget/cancel controls retain six expected budget refusals,
  two positive controls and four abort controls with zero subsequent calls.
  The retained typed workflow deadline remains five seconds; its unchanged
  limits and 192 MiB Node setting are captured in the command evidence.
- Configured root/package types and the ten owned/relevant test-root command
  each exit 0. Seven-file lint and eight-author-path format checks exit 0.
  These are not a universal legacy-test typecheck or global format claim.

The saved-output adjudicator performs 637 bounded checks with no failures;
another 100 historical current-observation comparisons also match. Neither
number is added to the runtime test/case census. The original scripts' assertions
are retained and not replaced by an exit-code-only interpretation. Changes to
the retained procedures are limited to canonical package entrypoint spelling;
sources, fixture values, expectations and internal budgets are unchanged.

### O12, provenance and historical negatives

O12 complete modeled proofs and genuine-null-left controls preserve the exact
canonical journal. Minimal proofs lose exactly errorType and stack. Native-field
proofs retain their separate errorType/stack-value differences. Raw-left complete
proofs differ at exactly the three documented record prototype flags; the genuine
null records are not grafted onto Object.prototype. Each completed proof replay
has zero calls and requests and preserves its own completed journal.

The raw public Error input remains an expected UnhandledRejectionError refusal,
not a substitute PASS for the modeled O12 contract. Captured Error aliases,
stack, source-context/request identity, receipts and saved prefixes remain in
the full observations and exact test assertions. No blanket prototype flag or
Error-output normalization is applied.

The root-accepted actual prototype receipt `f717e57a...` remains a prerequisite,
not a new execution in this String run. Its old-lossy captures and previous
literal failures remain immutable historical evidence. They were not rerun or
repaired here; in particular, success from a new explicit String helper would
not prove an old lossy capture's prototype metadata had been restored. Earlier
author unreaped-parent-exit qualifications and this author's retained long-TMP
build/initial-format failures are not replaced by this run's scoped exits.

### Exact README and alias proof

`readme-candidate-receipt.json`, SHA-256
`3bcb391fdaca145aeddacdc84dc3d66149a8a56b05912bdee4d89a727b07a738`,
records exactly one execution of each supplied example through the owned built
public SDK, API ok true and a primitive returnValue:

- `README-STRING-ORDINARY`: `return String({ value: 1 });` returns
  `[object Object]`.
- `README-STRING-GUEST-HOOK`: `return String({ toString() { return "custom"; } });`
  returns `custom`.

Both bind to public entry SHA-256
`e68636db45fba9767962b374f7ba555c0b2d6fee211aac9b59f3370057afccc6`.
Canonical/legacy SDK run/dump/restore identities match; all core and CLI export
identities match. Both configured CLI bin names execute the same retained
ordinary-object fixture successfully, with exact JSON output. Those bin names
are owned symlink projections of package.json targets, not an npm installation
or package-tar proof. Two inspected PNGs render the saved actual CLI stdout;
rendering does not rerun the CLI.

The README wording gate remains separate: ordinary unbound hooks receive the
object as receiver; arrow hooks retain lexical this. The two examples above
do not independently demonstrate every arrow/bound-hook combination. No README
file is part of this nine-path source candidate.

### Failures, storage recovery and CPU release

There are 41 saved command/renderer receipts: 39 exit 0, one npm spawn ENOENT
with exit -2 and no child PID, and one PNG renderer ENOSPC with exit 1. Additional
tool-level failures are retained in the incident receipt: unavailable REPL
process global, kernel-asset ENOSPC, shell heredoc ENOSPC before CLI launch, and
the failed CLI fixture write. The corrected environment starts one actual
npm installation. Both CLI target processes execute once; only the failed PNG
rendering is retried. No target workflow is retried.

Before the resource pause, recovery removed only this run's disposable npm cache,
`/tmp/nstr-6lLyEZ/tmp/tsx-501`,
`/tmp/nstr-6lLyEZ/tmp/node-compile-cache`, and the review checkout's
`.turbo/cache`. Source, raw evidence, node_modules, old captures, other clones,
live HOME and skills were not deleted. No separate root cleanup-approval receipt
was captured for those earlier own-cache actions; the later Sartre approval is
not retroactively attributed to them. Exact paths and qualifications are in
`cleanup-and-failure-history.json`.

CPU release is documented after the pause in `cpu-release.json`, SHA-256
`287ded1fceeac5456bc63e81b2342a6ee28600e7be7889a36233b07e7fc2522d`.
The last target CLI completed at 11:22:47.524Z; rendering completed at
11:23:31.298Z. The historical release wall-clock is unknown, not invented from
either timestamp. The later receipt records its actual creation time and an
empty check of all recorded PIDs. No target code, test, compiler, installation
or build was rerun during LIGHT adjudication.

### Publication boundary

The final capture contains the author's exact eight publishables plus this
review plan: four existing preimages and five absent paths at the tested HEAD.
It excludes raw output publication, README, ledger, SKILL, generated build assets
and dependencies. The build-created untracked terminal-pilot assets are not
intaken or cleaned up. No commits, pushes, branches or author repairs were made.

The final manifest authenticates these nine small, explicit publication files,
four base preimages and selected review receipts. Raw outputs remain located by
the bounded evidence index; this LIGHT phase does not bulk-rehash all artifacts
or dependency trees. Later upstream composition and the actual released String
artifact require their own checks. This qualified source READY does not close
O08, binary addition, all legacy representation differences, or every JS feature.
