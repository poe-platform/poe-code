# Phase 2: bounded independent real-provider decision

**Accept the tested explicitly configured profile**, on the pinned service and
deployment below. This is not acceptance of arbitrary callbacks, stock WebDAV
empty-directory removal, other deployments, or universal rmdir semantics.
No candidate source defect was reproduced. No production/source fix was made.

This phase is separate from source review `44534900396654ac760c49e599be738a1e6cf689`.
All 57 prior sealed artifacts remain byte-identical; phase 1 is not retroactively
described as real-service acceptance. All 99 sealed author artifacts also remain
byte-identical. Only this new `phase2` subtree is owned/changed by this review.

## Exact input and runtime profile

- Product source: `d1174e2db9f4a4c92403842dee6fb3d4ff57ec96`.
- Author provider/consumer/evidence: `a5f7d236b40446468ffa739ce8d26b172ed8e5d2`.
- WsgiDAV **4.3.5**, cheroot **11.1.2**, Python **3.14.7**, Python TLS OpenSSL
  **3.6.3**, Node **22.22.2**, TypeScript **5.9.3**, Darwin arm64.
- Numeric loopback HTTPS, task-owned certificate, explicit synthetic Basic
  credentials. One `/dav` provider instance, one process at a time, real
  `LockManager`/`LockStorageDict`; no alternate server aliases or shared processes.
  `/stock` is a separate native root using the unmodified stock provider.
- Stable trusted native ancestor directories and truthful fixed backing/transport
  bindings are assumptions, not properties proved by a namespace string or probe.

The source archive and all author fixture bytes were read by exact git revision,
not from the moving worktree. The original `server.py`, `consumer.mts`, `example.mts`
and `https.mts` ran unchanged. The independent runner replaces only orchestration,
output locations and the package loader so one downloaded environment can serve
both the unchanged author replay and subsequent independent tests. It strictly
builds the frozen source and author consumers, packs the actual package, and
extracts it into a differently named consumer package.

The original provider ran first without independent instrumentation, including
all 18 original rows and the standalone compiled example. It then exited cleanly.
One second provider process in the same environment served all independent
holdouts and mutations. Its original author source bytes remained unchanged;
`instrument.py` wraps/delegates real methods and adds scheduling/trace gates in
that isolated process. Mutation settings are path-specific and separately labeled.
No private engine, runtime product dependency, existing service, global TLS change,
user config, shared `dist`, or external server write was used.

## Separate measured cohorts

| Cohort | Positive | Guard | Refusal | Mutation |
| --- | --- | --- | --- | --- |
| Original author replay, unchanged | 4 pass | 12 pass | 2 pass | Not applicable |
| Independent qualified real-service cases | 8 pass | 17 pass | 1 pass | Not included in normal totals |
| Independent sensitivity controls | Not counted | Not counted | Not counted | 4 caught, 0 survived |

Every final normal case passed: **18 original + 26 independent**, separately
reported. The unchanged packed standalone example also passed with exact stdout
`atomic cleanup complete\n`. The independent refusal row checks both stock default
ENOTSUP and a configured stock probe's refusal before any DELETE; it is still one
row, not inflated into two. The original stock aggregate **78/79 remains unchanged**
and was not rerun or relabeled as this configured extension profile.

`evidence/real-provider/independent-first` preserves the complete first inputs,
wire/native/provider observations and its two failed verifier checks. Its result
was 7 positive passes/1 failure, 16 guard passes/1 failure, 1 refusal pass and
4 caught mutations. These were verifier defects, not candidate source failures:

1. My no-descendant-visitation assertion included PROPFIND metadata observations.
   The failed trace proves the visit belonged to PROPFIND, not DELETE. The corrected
   assertion forbids DELETE recursion, which is the actual requirement; it does not
   allow deletion-time visitation or child loss.
2. Sending a wrong Host through the author HTTPS helper made Node derive the TLS
   peer name from that header, so the request failed certificate validation before
   reaching HTTP. The corrected raw negative control pins TLS to the configured
   loopback peer with the existing CA, retains certificate verification, records
   `tlsAuthorized: true`, and still requires the original HTTP409 assertion.

No source/author-fixture status or byte expectation changed. Only independent
fixtures and their trace window were reset between runs, after retaining the
entire first trace; `between-cohort-reset.json` lists those actions. There was no
second environment, wheel download or instrumented provider restart. The qualified
30-row run repeats all normal cases and all four mutation controls, not just the
two corrected rows. Both input versions remain in evidence.

## Real lock manager and deletion evidence

Installed-wheel source inspection confirms DELETE evaluates request conditions,
checks its parent, calls `handle_delete`, and only enters descendant recursion
when the hook does not handle the operation. The unmodified author hook additionally
checks target/descendant locks through the actual manager before `os.rmdir`.
Qualified DELETE traces show parent check completion, actual infinity-depth target
check, then native rmdir; no normal extension DELETE visits descendants.

The manager's own read lock ends when `check_write_permission` returns. That
check alone is **not** a transaction covering removal. The relevant deployment
serialization is the original provider's RLock across all handler iterations.
The independent wrapper does not supply a mutex or lock table. It logs arrivals
before that original mutex, entry into normal dispatch after it, actual manager
calls/results, and native syscall entry/return/error. Controlled gates produce:

- A competing genuine target LOCK reaches the provider while DELETE is gated,
  but cannot enter real lock acquisition until native ENOTEMPTY completes. The
  late grant is actual manager state; the existing binary child is intact.
- An expiring real parent lock authorizes the initial check. After expiry, a new
  parent LOCK reaches the provider but cannot grant until native removal succeeds.
  In the qualified trace native return is sequence 807; new grant is 811.
- Genuine refresh and UNLOCK wait through the check/native interval. Their real
  manager entries follow native return (835 then 838; 863 then 866 respectively).
- A DAV PUT attempting to add a child cannot enter normal dispatch while deletion
  is gated. After removal it receives 409 because its parent no longer exists.
- A native writer bypasses the provider mutex and adds bytes `00ff80410d0a` while
  DELETE is gated. Actual `os.rmdir` rejects ENOTEMPTY and preserves those bytes.

Additional real controls cover missing/bad credentials, an authenticated second
principal, target locks, parent depth-zero/infinity locks and tagged tokens,
descendant locks, copied wrong-principal tokens, invalid/expired tokens, valid
owner/inherited tokens, incorrect operation/path/namespace/Host/query, stock
probe/default refusal, and replacement of the configured native root.

Final real infinite-depth DAV lockdiscovery is 207 with no active locks, not merely
an empty client token map. Its full response and final native tree were captured
before cleanup. Native root identities, child bytes, wire status/headers, receipt
outcomes, parsed real token controls, and ordered per-row traces are retained.

## Aliases, uncertainty and sensitivity

Two views of the **same declared canonical namespace** return unknown without
identity authority, never distinct merely because adapters/bindings differ. A
truthful explicit host comparison for that known shared entry makes a mounted
cross-view copy reject EINVAL before destructive I/O, preserving actual bytes.
An undeclared `/alias` route returns404; it is not claimed to be a supported alias.
The `/stock` and `/dav` roots have independently observed different native inodes.
No second same-backing server route, provider instance or process is accepted.

Actual completed native removal followed by a deliberately mismatched receipt
produces EIO without retry or restoration. Actual caller cancellation both before
and after native execution produces ECANCELED, with the late native outcome recorded;
the server can complete removal after cancellation. Each case sends one DELETE,
observes late handler completion and does not claim absence or rollback from errors.

Four separately labeled test mutations were caught by the strict guards:

| Mutation, only owned fixture/transport | Observed counterexample |
| --- | --- |
| Replace native empty-only primitive with recursive removal | Nonempty target succeeds and binary child is lost; ENOTEMPTY guard fails |
| Swallow the real manager's actual rejection | Locked target is removed; EBUSY guard fails |
| Relabel the genuinely authenticated second principal | Unauthorized extension removal succeeds; HTTP403 guard fails |
| Strip the opt-in marker after a successful real probe | Standard recursive DELETE runs, child is lost, and missing receipt yields EIO; ENOTEMPTY/byte-preservation guard fails |

These are not accepted implementations or passing product cases. In particular,
the fourth mutation demonstrates why a capability probe/receipt is not a lease or
cryptographic binding to unchanged server/transport behavior. It is outside the
truthful stable binding profile, and receipt rejection cannot repair prior loss.
No synthetic lock table or generic HTTP prototype stands in for the real provider.

## Provenance and hashes

| Artifact | SHA256 |
| --- | --- |
| Frozen raw product source archive | `e705552cb347ccb7b7e11a4c582591126e75ecd1b0f51d2397efc51843bc114a` |
| Product implementation | `e66a66e2745852c6bd12be12a18c855df069152cf6b8089d2ecee8880c62de94` |
| Original provider extension | `9e9c9d660857e715aba1cd312eb1d30082742602027508eb9b4dd3530de03c9b` |
| Packed product | `78461169565ceb3da674d881bf983b7a50832cd57fb7ff1bbaf68db43c46b937` |
| WsgiDAV wheel | `0985f5cb572e00c151e1c60d00e1ae8cbf74dea2a3286ec0bc040ab482cd5095` |
| cheroot wheel | `0f6c0ba05c00fbc869fb46b1de4ec2384e1d85418ae963d3bc10ae83b688dbfa` |
| Actual Node executable | `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011` |
| Actual Python executable | `87d4df53fd91304be5bac391fb204643c36b7df2023c04a0953bcbc7d4fdf634` |

The consumer package is named `independent-real-provider-consumer`, not
`virtual-bash`. Each runtime cohort records **157 actually loaded emitted package
modules**, with loader-time hashes verified against both the isolated build and
extracted tarball. This is not merely hashing files found in a build directory.
The instrumented Python process records **65 loaded site-package modules**,
including native extensions. Binary realpaths/hashes, installed core source
bytes/hashes, dependency lock, all downloaded artifact hashes and compiler hash
are retained in the evidence and `CHECKPOINT.json`.

The installed WsgiDAV wheel sources use CRLF, whereas the phase-1 official tagged
texts use LF. Four corresponding files compare exactly after line-ending
normalization, but their raw hashes are correctly different. Both raw byte forms
remain preserved; no source hash is substituted or relabeled. Installed source
snapshots are marked non-text for git to retain exact CRLF bytes.

## Limits and cleanup

No supported guarantee is established for hostile/stale ancestor replacement,
symlink swaps between checks, ABA, target-inode CAS, arbitrary host JavaScript,
reconfiguration after probe, lost replies, distributed locks, multiple provider
processes, other server products/versions, or undeclared same-backing URL aliases.
Native external writers may bypass DAV authorization; only removal-time emptiness
against their late children is demonstrated. There is no generalized lock or
namespace transaction API. Stock snapshot capability remains absent and existing
COPY/MOVE behavior is not changed or broadly requalified by these cases.

One isolated dev environment downloaded **1,769,458 bytes** of hash-pinned official
wheels once. No product dependencies changed. The unchanged and instrumented
children both exited0 (PIDs7971 and7985). The environment, downloads, cache/config,
keys, consumers, builds and native data were removed at
`2026-08-27T08:41:24.132Z`. Both the final lock state and pre-cleanup native witnesses
are retained. The phase's environment setup began at `2026-08-27T08:33:28.551Z`;
these timestamps are not a 72-hour or project-completion claim. The shared worktree
continued changing under other owners; this decision concerns only frozen inputs.

## Rechecking and reproducing

Offline evidence audit, without installing or starting a service:

```sh
node tests/fs/webdav/atomic-extension-independent/phase2/audit.mjs
```

For a new authorized live replay, use a fresh label with `run.mjs`. It first runs
the unchanged author matrix/example, then exposes the owned instrumented instance
and waits for `phase2/control.json` containing
`{"action":"run","cohort":"unique-independent-label"}`. `post-live.mjs` records
final real locks/native witnesses. Then write `{"action":"stop"}` to that same
control file so the runner cleans everything. The session has a bounded timeout;
do not reuse a prior evidence label. The two first-run verifier corrections and
the between-run reset are historical evidence, not reproduction prerequisites.
