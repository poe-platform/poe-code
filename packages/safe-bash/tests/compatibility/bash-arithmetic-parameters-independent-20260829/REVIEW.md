# Independent K08 SOURCE / PREEXEC review — 2026-08-29

## Decision

**SOURCE: ACCEPT for the explicitly narrow positional-text profile. PREEXEC: HOLD.**

This is a direct independent source/data review, not a runtime pass, an activation
receipt, a ROOT grant, or permission to execute the pending command. The user's
direct/no-subagents instruction governs this review; no subagents were started.
All edits and publication are confined to this new review subtree. No production
module was evaluated; no Shell.exec, production helper call, Worker, native Bash,
compiler, build, install, network operation, or archive inflation was performed.

Source acceptance means the inspected implementation is an appropriately narrow
repair, not that K08 or the new matrix has passed. PREEXEC HOLD applies to the
current future seal and must not be converted into its pending REVIEW.json ACCEPT.

## Exact bindings

- Production: `ffac894aa98b8cd98476b8ea109ef2e2425c2a07`.
- Author evidence: `71a5556b19ebf51e4ddd88bbd634399ca5243184`.
- Author publication: `bbe0b5c7bd8b9970b2842d26d0dc05d1c4f0aa6d`.
- Runtime: 211843 bytes, SHA256 `52b916030e4ca6e5c36bf858d16e26be8e39d124707597e3e601c94641185df6`.
- New private helper: 5221 bytes, SHA256 `cedcbab5ece5b8b109b37a6a2d61945f79168d679040e67feb519d23219f516a`.
- Shipping gzip: **981948 bytes**, SHA256 `0b6ae3340691c1c91b26f40454b8095d2ed346389353aa93e9a43c64d5a1132c`.
- Future seal: **196558 bytes**, SHA256 `ba016c4ff6bfa1add722d65c59a0d4f740e43ca652c56bfc12610472bb633d91`.

`audit.json` records independent same-file size/hash admission of all 13 local
future bindings, 9 inherited helpers and 1006 source-built shipping members.
The raw gzip was hashed without decoding; re-encoding that authenticated buffer
agrees with the preserved base64 text. Neither the new shipping gzip nor any old
capture archive was inflated. `verification.json` records the final fixed data
checks, including Git's NUL-delimited author publication inventory, source-input
bindings, and the qualified declaration comparison.

The production diff has one import and two replacement callsites. Reversing those
exact textual hunks independently reproduces the entire original runtime SHA256
`0c17850b1ceb4f09eec5458315dbb08433aa01721cf1b20fe7385481a20992e1`.
This is byte-level disjointness, including the foreign ERE implementation; it is
not a fresh ERE compatibility score. Pinned copies and `source.diff` are data only.
Before publication the two pinned source copies were renamed from `.ts` to `.txt`
to keep captured input out of TypeScript discovery without adding exclusions.
Earlier raw inspection records retain their original filenames; bytes are unchanged.

## SOURCE findings

At `src/shell/runtime.ts:1702` and `src/shell/runtime.ts:3720`, the existing
ArithmeticProgram now passes through the new private preparer before the same
evaluator and arithmetic-variable proxy. No parser, evaluator, LET implementation,
public export or public option is changed by the pinned production commit.

At `src/shell/arithmetic-parameters.ts:20`, whole-template admission permits only
plain one-digit positional references and braced decimal positional references.
Unsupported dollar/name/operator, quote, backslash and backtick forms return the
original program. It does not silently add general shell expansion.

At `src/shell/arithmetic-parameters.ts:43`, bounded decimal accumulation selects
position zero from arg0 and positive positions from the current positional frame;
leading zeros do not change decimal selection and excessive indices become missing
without unsafe numeric accumulation. `$10` is `$1` plus literal `0`; `${10}` is
position ten. The handoff's rendered `\10` spelling is a prose typo, not the actual
braced syntax in the source or frozen fixtures.

At `src/shell/arithmetic-parameters.ts:105`, undefined reaches requireParameter
before nullish-to-empty conversion; present empty remains distinct. Each admitted
reference is read once. Chunks contain the exact selected text, without numeric
evaluation or inserted grouping. `1+2` followed by `*3` therefore prepares `1+2*3`,
not `(1+2)*3` and not an atomic `3*3`. Injected dollar/command-substitution text is
not run through a shell expander a second time.

At `src/shell/arithmetic-parameters.ts:119`, join-overlap reservation precedes the
join, and the callback receives prepareArithmetic(expanded) exactly once. Finally
releases temporary admissions and the header. UTF-8 sizing and periodic synchronous
checkpoints precede bounded work; this is not asynchronous preemption. Existing
private array-ledger caps can still refuse overlap when an array owner is active;
maxExpansionBytes is not a guarantee that every independently sized final string
fits an already occupied private ledger.

`src/shell/runtime.ts:1181` retains cancellation/control rethrow, and
`src/shell/runtime.ts:1186` retains checked variable reads and writeVariable routing.
Nounset, readonly writes, int64 evaluation, lazy arithmetic branches, command status
mapping, fatal expansion handling, evaluator limits and deferred-error machinery
continue to use their existing implementations. No new whole-invocation/RSS,
arbitrary-host cancellation, filesystem-quota or OS-containment guarantee follows.

No definite defect in this narrow production repair was established by this
source review. Runtime results and the boundary gaps below remain unproved.

## PREEXEC blockers

### B1 — child failure precedence is lost at the owner boundary

Path: `tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:55`.

The owner publishes the lifecycle record before adopting child.primary. An
unqualified child is then converted unconditionally to Error('TARGET_LIFECYCLE').
Thus a first child failure with raw reason undefined, null, false, zero or an Error
is replaced at the owner primary boundary. If lifecycle publication also fails,
that later publication error becomes the primary instead. The child row retains
a serialized diagnostic, but that is not preservation of the selected raw primary
and ordered secondary failure. Compare the build owner's explicit
`if(child.primary.present) throw child.primary.reason` handling.

Required repair: select the child's present primary first, preserve its raw value,
then retain publication/retirement failures as secondary; use a fallback error only
when no child primary exists. Add finite data-only failure-path controls under a
separately approved revision. Do not call the private H05/H06 checks owner-boundary
proof: they never enter this path.

### B2 — the collector qualifies process completion, not the owner result

Paths:
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:68`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:69`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/collector.mjs:13`.

The owner correctly counts primary-case, helper, mutant and refusal assertions in
TARGET-RESULT.json. However, COMPLETED_WITH_ASSERTION_FAILURES still produces
OWNER_COMPLETED and exit zero, because only final.primaryPresent selects a failing
outer outcome. The collector tests only direct-child qualification and exit status;
it neither binds/parses TARGET-RESULT.json nor verifies its status, full finite
membership, or publication receipt. Its COLLECTOR_COMPLETED is consequently also
possible when the terminal result contains assertion failures.

This is not a claim that the author labeled the unrun matrix as passed: the inner
result is truthful. It is a missing outer owner-result qualification. Before GO,
either propagate a distinct assertion-failure terminal outcome or explicitly make
the outer acceptance consumer authenticate and validate the terminal result and
complete denominators. Lifecycle completion alone must not become runtime ACCEPT.

### B3 — M01 can receive credit for an unrelated red result

Paths:
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:56`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:65`.

The mutation site is uniquely matched against the pinned compiled helper, and the
generated role manifest plus synchronous loader provide useful byte binding.
Nevertheless, M01's detection predicate is only baseline.pass === true and a
failing mutant receipt. It does not require the old literal-$1 arithmetic defect's
specific observation. An unrelated stdout, status, stderr or filesystem assertion
failure in an otherwise settled case can earn that credit. M02 adds an exact 9:9
stdout condition; M03 adds the H04 missing-limit/no-primary condition. M01 does not
have an equivalent discriminator.

Additionally, trace qualification checks only the permission-admitted and
synchronous-hooks-installed counts. It does not explicitly select and bind the
module-loaded row for the expected changed helper to the baseline/mutant digest.
The raw traces and role files are preserved, so this is a missing qualification,
not an assertion that the loader lacks hashing.

Required repair: require the precise M01 old-defect signature with no competing
failure, and publish/verify the expected loaded helper path/hash for each baseline
and mutant. Keep the exact one-site mutations and same-layout baseline requirement.
No mutant has been loaded or run in this review.

### B4 — the owner derives a later deadline instead of inheriting the outer one

Paths:
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/activation.mjs:11`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/collector.mjs:6`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/collector.mjs:13`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:10`,
`tests/compatibility/bash-function-keyword-author-20260829/k08-repair-v1/future/target-owner.mjs:23`.

Both collector and owner independently compute min(their own started + 25 minutes,
grant expiry). The owner can therefore admit cases against a later deadline while
the collector begins retiring that owner five seconds before the collector's
deadline. Source-derived example, not an executed timing test: with grant expiry
nonbinding and owner startup delayed 70 seconds, the owner's body cutoff is 10
seconds after the collector's final deadline; the collector may kill the owner
while its known case child is still active. runDirect sends signals to the direct
PID, not to that known child. Direct owner exit/close cannot certify child retirement.

Required repair/authority: carry one authenticated outer start/deadline through
the owner and child admissions, include startup and final publication/admin time,
and qualify known-child shutdown before retiring its owner. Otherwise report that
known descendant as outstanding and retain HOLD; do not substitute a universal
process census or claim OS containment. Typed epoch checks themselves are good:
the current templates use null times and PENDING, and cannot activate this matrix.

## Frozen matrix and expected basis

- 23 primary identities across 3 layouts = **69 proposed Shell.exec calls**.
- M01 and M02 add **2 proposed Shell.exec calls**; total **71**, all UNRUN.
- H01–H08 are **8 helper identities / 16 rows per batch**, in 3 baseline batches.
- M03 is a fourth helper batch, not a Shell.exec call. There are **3 mutant children**.
- N01/N02 are **2 pre-load binding refusals**, not successful Shell.exec calls.
- Runtime known starts are **1 collector + 1 owner + 69 + 3 + 3 + 2 = 79**.
- Seven proposed administration starts make **86**, not 79 and not the current
  review's 48-start cap. No administrative implementation or slots are borrowed
  from the old author grant.

P01–P12 and P14–P15 have literal primary programs; P13 is private helper injection
and P16 is mutation/refusal evidence. Decimal/braced selection, textual precedence,
missing/empty, active nounset before arithmetic short circuit, deferred injection
refusal, checked writes and the source-derived division diagnostic have coherent
stated bases. These are not independently observed native goldens. P11-readonly
uses a stderr substring rather than an exact-byte diagnostic assertion; retain
that narrower qualification even though the full raw stderr is captured.

H05/H06 preserve presence separately from the supplied falsy reason, avoid calling
the evaluator on injection, and H06 compares live ledger counters before closing
the owner. H05 injects at the first checkpoint, before temporary reservations; it
does not prove cancellation after allocation. H03/H04 test Unicode byte sizing
with no ArrayOwner. Baseline successful overlap, evaluator-throw cleanup, active
array-owner limits, cross-chunk surrogate accounting, and public caller-abort
identity/cleanup are not covered by those rows. These are future proof needs, not
additional executed cases or implicit authority to enlarge the frozen matrix.

P15's retained test-group references are context, not reruns. The primary P15 case
does not itself exercise all referenced deferred errors or prior-effect behavior.
Do not promote the 16-family naming scheme to all-public-boundary coverage.

## Package, declarations, retirement and publication

The current source-built package is bound to the one author strict build and its
306 inputs. The build receipt says STRICT_BUILD_COMPLETED, compiler status zero,
empty streams, qualified direct lifecycle, zero Shell calls and zero consumer
checks. This review does not rebuild it. The sole reported declaration addition
is the private arithmetic-parameters.d.ts. Final verification compares existing
declarations against the retained old source-app bytes, with that comparison's
historical-authentication qualification recorded explicitly.

The future owner authenticates source-built shipping members; its installed layout
comes from the same authenticated tar buffer, and physically-moved is an actual
rename after installed cases. Source-built imports the bound product entry;
installed/moved import the virtual-bash package name. Loader edges, role manifests,
canonical paths and refusal controls are concrete source, not consumer execution
evidence. Neither installed nor moved has been created or executed by this review.

Inherited package admission checks regular-file/type/size, opens without following
the final symlink, checks file identity, performs a bounded read and exact hash,
then decodes that same buffer. The 2 MiB compressed-package ceiling is unchanged.
Inherited direct-child capture is opened before spawn, tracks exit/close and both
EOFs, distinguishes presence from falsiness, handles partial capture-open cleanup,
and refuses qualification after forced or unknown retirement. The inherited
finalizer preserves primary/secondary presence through census/publication failures.
These useful inherited properties do not repair B1–B4 in the new composition.

The shell launcher redirects outer startup stdout/stderr before collector startup.
That is direct startup capture, not a continuous disk quota. Capture reservation,
per-stream bounds and fresh logical-file samples are not actual filesystem quota,
RSS, group-absence or OS-containment guarantees. The final sample precedes terminal
publication, so publication itself and subsequent admin artifacts need explicit
reserved/accounted room; it is not a post-publication peak census.

The proposed future grant is versioned separately: 25 minutes inclusive, 60-second
finalization tail, 96 MiB capture, 512 MiB sampled logical work, peak 3, maximum 86
known starts, no new build and no case subprocess/Worker/async-loader permission.
Before activation ROOT must approve that envelope, bind the fixed administration
and publication roles (including the seven extra starts), and issue concrete typed
times and new exact seal/review hashes after repairs. If additional holdouts change
counts, publish a new finite matrix and request a new envelope. This report issues
no GO and does not edit the pending templates.

The historical B35 result remains **51/54**, with K08 failing in both keyword and
legacy forms on literal `$1 - 1`. The old **24/24 comparison** and **2 MiB capture
archive publication STOP** remain historical and unrescored. A larger future
capture allowance is not a retroactive increase of that failed archive cap, nor
permission to rearchive or replace its evidence.

## Review execution and publication accounting

The review started at **2026-08-29T14:49:57Z**; its inclusive 20-minute ceiling is
**2026-08-29T15:09:57Z**. Shell control groups, including instruction reads and
publication, are bounded to 9, with at most 3 pure-data helper invocations. Helpers
import only Node builtins; their counters are invocation-local, not REPL globals.
No zsh `path` variable or shell JSON parser is used. Capture descriptors are opened
by the shell before each helper starts. The first inspection attempt's truncated
tool display was followed by bounded line reads; the retained inspection/audit
captures contain the helper outputs. Missing optional paths and oversized display
requests are retained as inspection diagnostics, not silently classified as tests.

Known launched roles through control 6: 6 + 7 + 8 + 4 + 6 + 4 = **35**.
Control 7 reserves shell + patch + two fixed Git inventories = **4**.
Control 8 reserves shell + final data-classification patch + third data helper +
add + scoped whitespace check + explicit-path commit = **6**. Control 9 reserves
shell + commit metadata + index check = **3**. Total planned/maximum used by this
publication sequence: **48/48**
known launches, counting shell and administration roles, peak **3** (shell, helper,
capture tee). This is an explicit command-role count, not a universal OS census.

`verify.mjs` takes a fresh, bounded, invocation-local census only of this owned
subtree, records hashes/bytes and checks the 64 MiB capture / 384 MiB logical-work
review ceilings with final publication reserve. That sample precedes its own
verification receipt and the commit; later fixed publication roles are separately
reserved above rather than falsely included in the sample. Git object storage and
opaque tool internals are not an asserted filesystem quota or process census.

Publication uses only explicit owned file paths and git commit --only, with hooks,
signing and automatic maintenance disabled for that command. Initial
staging was empty; no foreign source, staging, historical evidence, pending grant,
or author packet is edited. The final commit identity and post-commit index check
are reported separately, avoiding a self-referential commit-hash claim.
