# Which access policy v2: proposed profile migration

2026-08-27. **Root decision requested; independent freeze and all code HOLD.**
This bounded contract/source-only leaf review recommends the exact policy below.
It is not root approval, a bug fix to an accepted policy, or runtime evidence.
It supersedes only v1's permission eligibility, relevant matrix assumptions,
probe-operation accounting and associated error/cancellation text. All remaining
v1 policy is unchanged. No provider, capability, contract or runtime change is needed.

Immutable base: commit `5c34372be6aedd179123ceab2663c7d52f207ed1`,
`src/commands/which/DESIGN.md`, SHA-256
`fc8984c7a6858709ee9341c5e2b17f3f01c4a4b2306571229229d54584ada15c`.
The original design and raw evidence remain byte-for-byte intact.

## Decision for combined freeze

Use **followed stat, then delegated X_OK**. After v1 candidate admission, await
`context.fs.stat(absoluteLookup, { signal })`. If its type is not `file`, miss
without access. Otherwise await
`context.fs.access(absoluteLookup, ACCESS_MODES.X_OK, { signal })` on the same
literal absolute lookup. Only successful completion of both qualifies the display
candidate. Do not gate either call on `capabilities.permissions`, `readOnly`,
writability, chmod support, or any new capability. Do not request W_OK.

`access` is authoritative **for the supplied VFS's effective virtual access
decision**, not proof of native executable permission. Mode metadata is not an
alternative permission authority. Do not add an any-0111 gate, owner/group/UID
inference, root exception, ACL model or host access probe. Remove v1's mode-value
validation and `invalid file mode metadata` diagnostic from this command: it no
longer consumes mode to decide eligibility. FileStat's existing required fields
remain the provider's contract; this does not authorize malformed provider data.

There is **no fallback** from denied, unsupported, missing or failed access to
mode bits, F_OK, read permission, registry paths or host lookup. `access` is already
required by FileSystem. A malformed injected filesystem lacking it fails as an
unknown provider failure under v1, not as a hit or automatic capability downgrade.

The existing contract does not establish one portable principal/ACL enforcement
model. Its non-permission backend access profile allows virtual traversal and
regular-file execution denial despite advisory execute bits. Delegation retains
that limitation: a successful X_OK means what that backend supports, not a lease,
security/privacy guarantee, ability to launch contents or proof of later GET/PUT
or host execution. Stronger host authorization cannot be claimed by which.

## Primary source and contract anchors

All paths below are existing read-only inputs, not newly executed observations.

| Source path and starting line | Relevant actual behavior |
| --- | --- |
| `src/contracts/filesystem.ts:6`, `:93`, `:108` | FileStat metadata; required access method with FsOptions; X_OK = 1. |
| `src/contracts/filesystem.md:291`, `:306` | Mode capability is not universal authorization; access preserves errors; remote checks have explicit limitations. |
| `src/fs/readonly/index.ts:36`, `:56`, `:76` | permissions false; followed stat delegates; only W_OK is rejected, X_OK delegates with options. |
| `src/fs/readonly/README.md:40`, `:52`, `:68` | Read-only policy does not prohibit non-writing access checks. |
| `src/fs/memory/index.ts:145`, `:453` | Access resolves target and checks owner-bit mask; not any execute bit. |
| `src/fs/real/index.ts:370` | Access delegates to native access after configured-root path resolution; which does not acquire host paths/principals. |
| `src/fs/s3/filesystem.ts:730` | Access stats target, rejects regular-file X_OK with EACCES even with advisory execute bits. |
| `src/fs/webdav/webdav.ts:965` | Execute/write access checks are unsupported; no fabricated authorization from synthetic modes. |
| `src/shell/runtime.ts:1088` | Existing type -aP search skips permission-capability-false wrappers before their access call; not a policy to inherit. |
| `src/commands/which/design-evidence/which-source.data:102` | Pinned FreeBSD is_there checks access before stat, regular type, then a UID-zero execute-bit workaround. |

The user reports twelve existing type-aP observations where a read-only wrapper
was skipped despite X_OK success. Those observations are accepted as supplied,
not rerun or reclassified. Wrapper source explains why that positive is legitimate:
disallowing writes/mode mutation does not disallow execution-access checks.
The new command must retain such a positive when followed stat is regular.
No runtime correction is authorized by this review.

FreeBSD revision `8268a31bcceb9ebe32d380cab792c89c5d897d15` actually evaluates
access first, then stat. The recommended **stat-first** virtual order deliberately
differs: reject nonregular entries before asking a backend for potentially
unsupported file-execution policy; keep followed-type eligibility explicit.
Consequently a stat miss/nonregular entry hides a later hypothetical access error,
while stat ENOTSUP is fatal before any access call. This is an explicit order and
error-profile difference, not a claim of exact FreeBSD syscall parity. The native
UID-zero workaround is not portable to this VFS and is not adopted.

## Admission, errors, cancellation and output

- Keep v1 section 6's `maxProbes` as **one logical candidate attempt**, charged
  before construction/provider work, including failed attempts and duplicates.
  After the signal check, preserve probe/display-length/lookup-length admission
  order. Directory-designating suffixes still consume one attempt and make zero
  calls. Empty operands still generate no attempt.
- Each other admitted candidate makes one stat call and, only after a regular
  result, at most one access call. Thus at most two top-level provider method
  invocations per attempt, sequentially; not two logical probes. Adapter-internal
  stat calls, resolution, network requests and retries are not bounded by two.
  No new counter, limit, timeout, parallelism or shared budget is introduced.
- Check the signal before/after each awaited stat **and access**, in each catch
  before classifying errors, before output admission/write and before return;
  preserve all v1 scan-boundary checks. Pass the supplied signal into both calls.
  Abort wins over errno-shaped errors, preserving exact rejection identity. No
  access starts after observed cancellation or failed/nonregular stat. Existing
  uncooperative-provider and cooperative cleanup limitations remain unchanged.
- Apply v1 section 4 to either operation: actual FsError ENOENT, ENOTDIR, EACCES,
  EPERM, ELOOP and ENAMETOOLONG are ordinary misses; every other FsError is fatal.
  ENOTSUP is explicitly `which: CANDIDATE: operation not supported\n`, status 1,
  no further probes. EROFS is not silently swallowed. Non-FsError failures use
  `filesystem operation failed`. No unsupported access becomes silent success.
- Emit only after both calls succeed and output admission passes. Ordinary misses
  remain silent; all-operands-found aggregation, -a/-s behavior, fatal status 1,
  prior-output retention and first-hit short circuit are unchanged. FS catches
  never convert sink failures. No stdin/content reads, link inspection, manual
  traversal, child invocation, owned-output scope or independent resource is added.

Stat follows the final symlink through the adapter; access resolves that same
lookup through the adapter again. Print the original candidate, not the target.
Dangling links, loops and traversal denial use the same typed miss rules at either
step; a provider-returned non-followed symlink is nonregular and misses. Between
stat and access the namespace/permissions can change, including replacement by a
directory. Two successful checks do not establish same-entry identity, atomicity,
a lease or future executability. Do not add a third stat or claim TOCTOU repair.

## Only the affected v1 matrix expectations change

These are source-derived policy examples, not fixtures or observations. All v1
section 7 positive examples now assume successful X_OK as well as regular stat.

| Condition after regular followed stat | v2 consequence |
| --- | --- |
| Memory file mode 0001, X_OK EACCES | Miss; any-0111 metadata no longer creates a hit. |
| permissions false/absent, including read-only wrapper, X_OK succeeds | Hit; no write/permission capability gate. |
| Mode has no execute bits, backend X_OK succeeds | Hit under delegated virtual policy, not native-parity certification. |
| Advisory execute bits on S3 regular file, X_OK EACCES | Miss, not metadata discovery success. |
| WebDAV regular file, X_OK ENOTSUP | Diagnostic/status 1 and stop, even under -s; not a silent miss. |
| Stat ENOTSUP | Same v1 fatal diagnostic/status; access not called. |
| Stat nonregular | Miss; access not called, even if backend would reject X_OK as unsupported. |
| First hit, later access EIO with -a | Retain first line, diagnose later candidate, status 1; without -a later candidate is not visited. |
| maxProbes 1, first candidate qualifies | One attempt permits stat plus access; next attempted candidate exceeds the unchanged limit. |

## Unchanged base and release boundary

Bind the combined freeze to this delta plus immutable v1: section 1 retains API
proposals/no public integration and no fabricated registry/host paths; section 2
retains flags, literal grammar, exact usage and aggregate statuses; section 3
through line 125 retains PATH absence/empty-component handling, cwd lookup and
literal display spelling; sections 4–5 retain error/status/output ownership rules
except the explicit changes above; section 6 retains all seven caps/defaults and
stderr allowance; sections 7–8 retain unaffected examples and evidence limits.
The profile name migrates from **virtual executable-mode discovery v1** to
**virtual delegated-execute-access discovery v2**, still FreeBSD-style grammar.

Poincare's `independentDRAFT65d198cf` README has 28 proposed families, not a
normative freeze (user-supplied context; hidden cases not inspected). Root must
accept or reject this exact permission/order migration before routing the combined
policy to a different independent freeze and separately releasing code. No other
policy choice or new design framework is proposed.

Zero new native observations, oracle/corpus runs, tests, builds or typechecks.
Darwin which remains unqualified; FreeBSD binary/14.3 remains unprovisioned.
Existing raw provenance is retained, not refetched. Hash/document-only checks
cover enumerated inputs and the exact owned commit, not an append-proof repository.
No owned background process or native scratch was created. Coordination receipts
remain in the two authorized /tmp paths; all code remains HOLD.
