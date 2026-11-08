# WebDAV rmdir: bounded feasibility checkpoint

August 27, 2026. **No production source change. Empty WebDAV rmdir remains open.**
This is an author feasibility result for root/Curie, not independent acceptance
and not a claim that safe refusal satisfies the requested positive workflow.

## Decision before production edits

The current `src/contracts/filesystem.md:8` requires removal of an empty directory
entry, never descendants or a final symlink. Lines 15-20 require removal-time
emptiness, prohibit recursive remote collection DELETE, and require ENOTSUP when
safe removal is unavailable. Memory enforces emptiness in its synchronous map
removal; Real delegates to native rmdir without following the final symlink.
ReadOnly rejects, Mount delegates safely, and Overlay delegates an upper entry's
removal to the upper backend before installing a whiteout. Those sources were
inspected only and are unchanged.

A protocol lock does not make recursive DELETE an atomic empty-directory host
operation. The separately supplied contract review agrees that a protected DAV
exception needs root/Curie approval; its DAV discussion and original memo hash are
preserved in `evidence/primary-corrected`. The current no-global-snapshot caveat
does not override the explicit never-delete-children requirement.

**Actual Apache counterexample:** acquire a genuine exclusive write Depth:infinity
lock; list the directory while locked and observe empty; use the native backing
writer to create a six-byte child; send collection DELETE with the matching tagged
token. The server returns 204 and both directory and child are gone. This repeats
in both cohorts. The native child before-delete bytes are `[0,255,128,65,13,10]`;
after-delete witnesses record ENOENT. No token, response or validator was repaired.

This is a deliberate **raw feasibility experiment on an owned server root**, not
a child-loss bug exercised through the unchanged public rmdir. Public rmdir still
rejects empty removal with ENOTSUP and does not send LOCK/DELETE. Neither another
listing nor a bounded retry closes the demonstrated last-list-to-DELETE interval.

## Precise root/Curie decision needed

Do not change production semantics under the existing wording. A possible narrow
exception, for root/Curie to accept/revise/reject rather than this author to apply:

> Permit remote collection DELETE only when verified exclusive protection covers
> the target and every descendant-creation route from the protected empty check
> through destructive execution, with deletion conditional on that protection
> remaining applicable. Otherwise preserve the namespace and return ENOTSUP.

Root must define the trusted provider boundary: whether all native/other-protocol
writers are excluded by an actual deployment invariant, and how it is enforced.
The tested configuration does not exclude the native writer. The standards and
these probes also do not prove serialization when expiry/admin unlock occurs
after DELETE condition evaluation but before traversal. That interval remains
unmeasured, not a demonstrated exploit or a claimed guarantee. An atomic
server-side empty-directory primitive would avoid the recursive-delete mismatch;
it is not provided by the inspected public API or standard collection DELETE.

No new option, capability, contract, permission API, host fallback, directory
marker or unused lock-parser refactor is introduced. A future approved path must
reuse existing grant validation without weakening COPY/MOVE Depth:infinity,
legacy absent-only lockroot, exclusive/shared rejection, write, token/status/root,
timeout, callback or cancellation rules. Public compareEntry is a point-in-time
identity observation, not exclusion of concurrent backing writers.

## Frozen source, services and public consumer

Both cohorts use committed source `debb29ead94ae387f359d9d04b333ee4380f88d6`, not
the moving worktree. WebDAV SHA256 is
`d61d6d36eeea65f0c7e6eb5ecbe118e353ffe5a87131e4e26c1a3d772ee71acf`;
source archive SHA256 is
`63763b507b98d5b49957cd4505b95162524ecda131a9eac0d7207699fc0738de`.
Both providers and cohorts produce the same packed tar SHA256:
`dd1efd2f90061c52bc0c40aee73ba8156e91c6da69e4e22022d1a0e74492a1f0`.
The baseline includes the previous `69672fe` scope fix; it is untouched.

`run.mjs` copies frozen author fixtures into a new owned workspace and records
original/executed hashes for runner-only relocation and adding this consumer.
Original raw/public/direct matrix assertions are unchanged. `feasibility.mts`
strictly compiles and runs from the built/extracted package with actual root
`virtual-bash` and `virtual-bash/fs/webdav` imports; exact resolved URLs and package
maps are captured. It uses the existing complete typed HTTPS transport and
truthful public RealFileSystem backing resolver, not private Mock/resource APIs.

Providers remain preinstalled Apache 2.4.66 and pinned WsgiDAV 4.3.5/cheroot11.1.2.
Binary/module/config hashes and all eleven official-PyPI wheel artifacts/hashes
are retained per cohort. Numeric loopback, owned SSL config/CA, synthetic Basic
credentials, isolated HOME/TMPDIR/venv and per-request trust are unchanged. No
global config/install/TLS mutation, private credentials or external writes occur.

## New matrix: observations, not renamed support

Each new provider batch has 12 rows. The raw helper is a probe, not an alternate
public rmdir implementation. P/F/R means pass/fail/blocked-refused. A blocked
raw grant does not pass a guard whose operation was never exercised.

| Cohort / provider / surface | Positive P/F/R | Guard P/F/R |
| --- | ---: | ---: |
| First Apache / public | 0/2/0 | 3/0/0 |
| First Apache / raw | 1/0/0 | 4/2/0 |
| Final Apache / public | 0/2/0 | 3/0/0 |
| Final Apache / raw | 1/0/0 | 5/1/0 |
| First and final WsgiDAV / public | 0/2/0 | 3/0/0 |
| First and final WsgiDAV / raw | 0/0/1 | 0/0/6 |

The two required public positives are direct and actual Shell empty rmdir; both
remain failed, not refusal-green. Public guards preserve an existing child's
bytes, typed root/file/missing/preabort errors, readonly/mounted-root rejection
and Overlay upper-backend ENOTSUP without removal/whiteout.

Apache raw positive: genuinely empty locked collection DELETE returns204 and
removes it. Late child before lock is visible in the protected listing and no
DELETE follows. Wrong token DELETE returns412 and preserves an existing child.
After an actual Second-1 grant expires, a DAV PUT creates a child with201 and the
stale-token DELETE returns412 without losing it. These are useful protocol
observations, but they do not repair the native-writer guard failure.

All four final descendant creation attempts (PUT/MKCOL, /dav and /alias) are
blocked. Apache returns207 containing exactly the requested path's424 dependency
failure and its locked parent's423. No child is created. The first cohort wrongly
expected an outer423 and stopped after the first PUT. That failed assertion and
all original inputs are preserved. The final profile-specific oracle checks the
exact two DAV response entries and unchanged native namespace, not a broadened
status regex or blanket acceptance of207. It runs all four operations before
checking the responses. No product change accounts for this harness correction.

The raw final-symlink mapping reports DAV collection vs native symlink. Apache's
DELETE returns207 and preserves the symlink and target; it is not successful
rmdir. The first general witness used trailing-slash lstat, which followed the
directory; its explicit stripped-path nativeType observation still recorded the
symlink. Final witnesses strip the terminal slash for lstat. Both cohorts remain.

WsgiDAV's bare Lock-Token blocks all seven raw lock-based probes. Tokens are not
framed/repaired even for operation cleanup; these grants remain until owned
server shutdown/root deletion. No mutation follows those invalid grants. This is
a refusal profile, not evidence that its descendant/expiry/native-writer guards
work. Previously observed WsgiDAV conditional/alias limitations remain applicable.

After successful Apache raw DELETE, best-effort UNLOCK returns400 because the
resource/lock has gone; surviving ordinary grants release with204. Actual statuses
and post-row lockdiscovery are retained, not converted into guaranteed cleanup.

## Existing matrices and validation preserved

Original matrices repeat unchanged in both cohorts, cells pass/fail:

| Provider / surface | Positive | Guard | Refusal |
| --- | ---: | ---: | ---: |
| Apache raw | 9/0 | 7/0 | 0/0 |
| Apache public | 16/1 | 14/0 | 2/0 |
| Apache direct | 2/0 | 15/0 | 0/0 |
| WsgiDAV raw | 3/6 | 3/4 | 0/0 |
| WsgiDAV public | 10/5 | 13/0 | 4/0 |
| WsgiDAV direct | 0/2 | 13/2 | 0/0 |

Both isolated validations pass unchanged 564 WebDAV, 23 legacy LOCK, 23 authority,
five timestamp, 28 scope, 49 historical alias and separately14 constructor tests,
plus strict scoped types and ESM/declaration build. The readonly/mount/overlay
public checks here also run against both real providers. No Mock implementation
or old fixture is extended, and no independent or root matrix file is edited.
No all-repository gate or new rmdir mutation/cancellation safety claim is made.

## Primary proof and remaining work

Fresh primary RFC4918 §§6.6,7.4,9.6.1,10.2,10.4.4; RFC2518 §§7.1,7.5,8.6.2;
and Apache2.4.66 `dav_fs_delete_walker`/`dav_fs_remove_resource` excerpts and full
document hashes are in `evidence/primary-corrected`. Apache source recursively
walks collection deletion; it explains, but does not replace, actual wire/effect
evidence. The first primary extraction missed three formatting/name matches;
those found=false records remain separately in `evidence/primary`.

Not implemented/tested as new product behavior: protected rmdir publication,
its malicious-grant/cancel/error/late-lock cleanup variants, expiry during server
destructive execution, arbitrary provider alias exclusion, or host-writer
confinement. Existing transfer grant/cancellation suites still pass but do not
substitute for those future rmdir tests. Root/Curie must first settle the contract
exception and trusted deployment requirements. A different verifier is still
required after any subsequent implementation.

## Reproduce and cleanup

On the recorded macOS arm64 prerequisites, using a fresh label:

```sh
node tests/fs/webdav/rmdir-real-service/seal.mjs --check
node tests/fs/webdav/rmdir-real-service/run.mjs replay debb29ead94ae387f359d9d04b333ee4380f88d6
```

Outer exit0 means capture completion, not passing interoperability. Original
service runners retain exit2 for their existing failures. Inspect feasibility.json
and raw/public/direct summaries separately. A reproduction adds files and must
get a new seal rather than overwrite existing evidence.

All byte witnesses and intentional effects are confined to owned server roots.
Every bounded service/command exits; finally records evidence and removes its
owned root, lockdb, home, venv, downloads, private key, config and workspace. The
seal verifies workspace absence, source/contract hashes and historical author
evidence integrity. There is no production source commit because the tested
candidate does not meet the current contract; this checkpoint commits evidence
only and does not claim empty-directory support is finished.
