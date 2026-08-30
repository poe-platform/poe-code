# CD prerequisite: exact author policy for independent freeze

August28,2026. **Proposal/binding only; no runtime implementation authorization
is inferred.** This refines the private-cap proposal in `d0b2557e` for ROOT and
Locke's new freeze. The diagnostic-boundary choice below requires ROOT resolution.
No native/provider execution or prior evidence rescore accompanies this document.

## Fixed inputs and reused provider acceptance

Base: `5137a74ec855a32d8a8860eb66b62eb44d11e290`, plus exactly the two provider
source/doc blobs from `ca1d33424b94a21ae0f40a36412fd8191611e2df`.
Accepted composed tree: `7c68831a81fc49c94ad9177e58ca9fd7d0aca352`.
Different review: `2ec9bcdafce7964769e87ed6fe681ea0936f266a`.

Reuse its102/102 source/installed/moved provider results,8 positive/10 negative
types per layout, five mutants and three load negatives as **existing provider
proof**, not new cd execution. Directory X_OK is virtual logical navigation
only, permissions:false, with no ACL/listing/child/future permission claim.
Memory, Real, readonly and S3 directory-X_OK compatibility observations from
`d0b2557e` remain applicable to their unchanged base blobs. No new provider
capability or cross-adapter permission inference is needed.

The future write set remains only `src/shell/runtime.ts` and owned cd tests/docs.
No shell.ts, contracts, public limits, providers, parser, root exports/README,
package, stack state or builtin registration changes. Use selected files and
their hashes; do not copy a whole Git archive or AGENTS into this cohort.

## Search and legacy input behavior

1. Retain existing argument-count and HOME/OLDPWD resolution first. More than
   one argument: status1, existing `cd: too many arguments` diagnostic. Missing
   HOME/OLDPWD: status1, corresponding existing diagnostic, no FS requests.
2. Resolve `-` to the visible OLDPWD value before search. No operand uses visible
   HOME. As before, an empty resolved target becomes `.`. Thus explicit `cd ''`
   remains the disclosed native divergence, **not silently fixed**. Empty HOME
   or OLDPWD retains this existing behavior without a new native-parity claim.
3. Search only if the effective target is relative and its first component is
   neither `.` nor `..`. Absolute targets, `.`, `..`, `./...`, `../...` bypass
   CDPATH completely, including its private validation/cost. Do not add -L/-P
   option parsing or physical-path resolution in this prerequisite.
4. For eligible targets, unset/empty CDPATH means one cwd-relative fallback.
   Nonempty CDPATH is split at literal colons, preserving all empty components
   and order, including trailing empties. An empty component means cwd and never
   requests CDPATH printing. Relative components resolve against original cwd.
5. Try each component in order, then the cwd-relative fallback if none succeeds.
   Do not deduplicate empty/repeated components or cache a failed observation.
   The fallback may repeat a path already tried: its new outcome is authoritative.
6. Successful nonempty-component selection prints the selected absolute logical
   path. Dash also prints. Their combination prints **once**, after state writes.
   Empty-component/fallback success does not print unless the original operand
   was dash. Relative HOME/OLDPWD participate exactly as observed in C23/C25.

Native28 remains immutable:21 successful cd observations/seven diagnostic
observations, not a virtual candidate score. Prior directory-stack0/34 and four
followups remain separate. No native syscall-count claim is made for repeated
components; the uncached probing rule is this bounded implementation profile.

## Exact proposed private caps and accounting

| Resource | Inclusive bound / rule |
| --- | --- |
| Effective operand | 65,536 UTF8 bytes. Empty-to-dot conversion precedes this count. |
| Logical cwd used for relative resolution | 65,536 UTF8 bytes, validated once before relative search/fallback. Absolute operands do not acquire an unused-cwd cap. |
| CDPATH, only when search-eligible | 65,536 UTF8 bytes;4096 colon-separated components including empties. Empty/unset CDPATH has zero search components and only the fallback. |
| Each raw constructed candidate and resolved candidate | 65,536 UTF8 bytes each, including separators. Raw cap is before allocation/normalization; resolved cap before provider admission. A long dot-heavy raw candidate is not excused by a short normalized result. |
| Candidate probes | At most4097:4096 search entries plus one fallback. Increment before stat, including failed/non-directory attempts. No later probe after success. |
| VFS calls | At most one stat and, only for a directory, one access(X_OK) per probe:8194 maximum. This is **not** a bound on provider-internal HTTP/ancestor requests. |
| Local byte-work | 8,388,608 units per cd invocation, inclusive; formula below. This is not a public/shared/global budget. |
| Cooperative cadence | Yield through existing interruptible(setImmediate, runtime signal) at every completed128 charged units, with signal checks before/after each yield and metadata await. No extra command/loop charges. |

Use UTF8 byte lengths, not UTF16 length or URL-encoded length. Unpaired UTF16
units count as three encoded replacement bytes **for accounting only**; do not
rewrite the path or invent a new cross-provider validation promise. Existing
path/provider validation continues to decide whether such a name is supported.
Mixed malformed-and-limit precedence is not a newly claimed native behavior.

Byte-work is a deterministic logical accounting model, not a claim to instrument
all JS/native operations. Charge:

- Once for each UTF8 byte of each used effective operand, relative-resolution cwd
  and eligible CDPATH while incrementally validating those inputs. CDPATH parsing
  records bounded offsets/component byte lengths during that scan; no second
  full split/allocation before validation. Unused CDPATH/cwd is not charged.
- Before constructing a candidate, reserve its raw byte length R for construction
  and R again for normalization:2R. Then charge the resolved candidate byte
  length N during bounded validation. Overlong raw candidates fail before this
  reservation/allocation; failed path normalization does not refund reserved work.
- Charge one unit before each stat and one before each admitted X_OK call.
  Never refund failed probes. Diagnostic/output encoding is governed separately
  by its size cap and the existing parent output budget, not this search counter.

Define raw candidate text without implicit separator elision: an absolute operand
is itself; an absolute nonempty CDPATH component is `component + '/' + operand`;
a relative nonempty component is `cwd + '/' + component + '/' + operand`; an empty
component/fallback is `cwd + '/' + operand`. Only after checking R and reserving
2R use existing lexical virtual-path normalization. No realpath/host-cwd query.

Long reservations advance in at most128-unit chunks to honor cooperative cadence;
the subsequent bounded native path-normalization call itself is not interruptible.
Inclusive work admission means exactly8,388,608 units may complete; the next unit
fails **before its operation/provider call**. Use subtraction-before-addition,
never overflow/wrap a counter. Counters are local to this invocation; the existing
shared Budget object, normal command admission,128-command yield and expansion
limits remain unchanged. No reset or new global deadline is implied.

Private-cap failures are ordinary status1 command failures, not a fabricated
`ShellLimitError` for a nonexistent public limit, and do not abort the shared
budget controller. Proposed stable cd-owned messages (before existing shell
origin formatting) are:

```
cd: CDPATH exceeds 65536 UTF-8 bytes
cd: CDPATH exceeds 4096 components
cd: path exceeds 65536 UTF-8 bytes
cd: probe limit exceeded
cd: helper work limit exceeded
```

Existing shared limits still retain their actual ShellLimitError identity and
global accounting. A later cd gets fresh private counters, not a fresh shared
budget. ROOT should bind these exact private messages/costs before code freeze.

## Metadata/error and checked state ordering

- Every candidate: check signal; stat with the runtime signal; check signal;
  require directory; check signal; await delegated X_OK with the same signal;
  check signal before publication. Reuse existing interruptible waits, with
  late rejection observation. No unbounded opaque-provider preemption claim.
- **Only typed FsError ENOENT, ENOTDIR and EACCES from search probes are misses**
  permitting another candidate. A non-directory stat is an ENOTDIR search miss
  and never calls access. This set is deliberately restricted to the measured
  error classes; EPERM/ELOOP continuation is not established by native28 and
  is not silently added. Unknown/untyped errors, ENOTSUP, EIO, ENAMETOOLONG,
  ETIMEDOUT, ECANCELED without a live caller abort, and all other errors are
  fatal to this cd attempt, following existing runtime status/diagnostic mapping.
- Caller/shared cancellation is checked before classifying any failure, so an
  errno-shaped caller reason is never swallowed as a search miss. Preserve
  actual existing control/limit failures, not reason-equality heuristics.
- After all search misses, use the **fresh final fallback** outcome/diagnostic;
  earlier EACCES/ENOTDIR does not override its ENOENT. An explicit unsupported or
  unexpected provider failure does not fall back to create a false success.
- A selected directory uses the existing checked sequence:
  `writeVariable(OLDPWD, oldCwd) → state.cwd = selected → writeVariable(PWD, selected)
  → exported.add(PWD) → exported.add(OLDPWD) → awaited print if required`.
  Readonly OLDPWD failure leaves both bindings/cwd/export flags unchanged.
  Readonly PWD failure leaves the earlier OLDPWD write and new cwd in place but
  does not perform the later export additions or print. Readonly attributes are
  never removed; no rollback or native-readonly parity claim.
- Output failure does not undo those successful writes. Preserve existing
  runtime mapping: EPIPE141; ordinary handler/sink errors generally status1;
  actual caller/control/shared-limit rejection follows existing precedence.
  Awaiting a sink is not a new promise that every sink exception escapes exec.
  Existing diagnostic-write failure mapping and cleanup barriers are not
  rewritten by this prerequisite.
- Keep all existing prefix-assignment, function-local, middleware, pipeline,
  subshell and invoke clone/restoration rules. A local cd helper introduces no
  state fields, cloned stack, new Shell, parent/sibling mutation channel or
  builtin/plugin count change. Existing earlier expansions/redirections/prefix
  effects are not rolled back by a cd failure.

## One unresolved boundary for ROOT before fixture finalization

The approved diagnostic number is65,536+256 =65,792 UTF8 bytes, with explicit
` [truncated]` marker when shortening and all emitted bytes charged to the parent
output budget. The previous proposal did **not** bind whether this number covers
only cd-owned diagnostic text or the complete shell-prefixed physical line.

Current runtime adds `scriptName: line N: ` and newline after the builtin records
a diagnostic; scriptName is not inherently bounded by cd input caps. It also
deliberately preserves existing error-to-status/diagnostic-sink behavior.

**Recommended choice: cap cd-owned diagnostic text at65,792 bytes**, including
the marker, preserving existing shell-origin formatting and parent output
accounting unchanged. Do not label that a65,792-byte full-line guarantee. If ROOT
requires a full-line bound instead, authorize an explicitly cd-tagged private
diagnostic-envelope adjustment inside runtime.ts; do not globally truncate other
commands or infer cd ownership from an error-message prefix. This choice must be
resolved before claiming the corresponding independent diagnostic assertion.

No source code is changed here. Provider compatibility is unblocked, but cd
implementation still awaits Locke's different freeze and explicit ROOT go.
