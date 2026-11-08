# Real WebDAV author checkpoint — August 27, 2026

This is author implementation/replay evidence. Root must assign a **different
independent final verifier**. Neither raw protocol passes nor configured Apache
success establishes universal WebDAV support, default-lock compatibility, a full
project gate, superiority over another product, or 72 hours of work.

## Commits and frozen artifacts

- `3db0c63`: initial WsgiDAV raw-wire cohort and all initial failures.
- `4143efde6de0b5cff4feff03f0a479cd70b9510f`: four-line product fix, focused
  documentation, five regressions, original real Apache failure and validation.
- The commit containing this report publishes the complete independent-service
  harness and final evidence. It is separate from the product fix.

Original product baseline: `1ea140b50f0b4edcfa28a60e2f89351b97e509a5`.
Both final service profiles build the newer committed source `4143efd` above.
The final whole-source archive SHA-256 is
`abd438634015b2bb49afe737e2dd47f47e949bc11d45a201ddc71c38aed9b63b`.
This is not an assertion that unrelated concurrent checkout edits were clean;
their exact status is retained separately and they were not packed or committed.

Both final runs produced the same actual `virtual-bash@0.0.0` packed tar SHA-256:
`4864669ee5604bb3591f10eff6e16b08107aeec15371dde56f3bbc3d9a27aaff`.
The public root export and `virtual-bash/fs/webdav` resolve inside the extracted
tar's `consumer/node_modules/virtual-bash/dist`, recorded in each
`consumer.json` under `observations.publicImports`. Runtime dependencies remain
absent. Exact package file maps/integrity and all source hashes are retained.

Final `src/fs/webdav/webdav.ts` SHA-256:
`b7503e186108baae2ec69b56ee45d782b423a514c71094067b2ea877ee3c221e`.
Unchanged root export source SHA-256:
`2257a1ce3acc146ca7a3c1867e8a23153a5a968c96899a533b45cea69a446237`.
Unchanged product package manifest SHA-256:
`1f9579a9be0c1e1f23f03f38babad319fc1f8af941c7755aa7ca8759584cc2f1`.

WsgiDAV **4.3.5**, cheroot **11.1.2**, Python **3.14.7**, macOS arm64:
`dependencies.json` pins all eleven provider/required dependency wheels, their
official PyPI metadata and artifact URLs, version constraints, and SHA-256s.
The bootstrap pip wheel hash/version and actual installed package list are in
`evidence/wsgidav-final/commands.json`. There are no downloaded sdists/build tools.
Apache **2.4.66** uses existing Apple binaries; exact httpd and all loaded module
SHA-256s plus literal config/port are in `evidence/apache-final/apache-profile.json`.
No global install, system service, user server config, TLS trust store, credentials,
runtime manifest, or private poe-code checkout was changed.

## Final matrix

Counts below are **pass / fail**, separated by intent and provider. Refusals
are not supported workflows. Failed ordinary positives are not relabeled as
successful guards. Raw and packed-consumer denominators are not merged.

| Frozen profile | Positive | Guard | Explicit refusal | Total rows |
| --- | ---: | ---: | ---: | ---: |
| Apache final raw wire | 9 / 0 | 7 / 0 | 0 / 0 | 16 |
| Apache final packed consumer | 14 / 3 | 14 / 0 | 2 / 0 | 33 |
| WsgiDAV final raw wire | 3 / 6 | 3 / 4 | 0 / 0 | 16 |
| WsgiDAV final packed consumer | 10 / 5 | 13 / 0 | 4 / 0 | 32 |

Both final runners exit 2 because gaps remain. The extra Apache guard is a real
fresh-directory timestamp mismatch regression. WsgiDAV cannot reach that mutation
with its malformed/missing property ETags, so no such guard is credited to it.

## Useful measured workflows

Both providers support the tested binary/empty/UTF-8/percent/space/XML-sensitive
names, depth-one complete listing, collection creation, absent-destination native
COPY/MOVE, collection MOVE, explicit recursive DELETE, conditional exclusive PUT,
and append with a real strong GET validator. Shell pipelines preserve binary and
UTF-8 bytes. With the explicit truthful backing resolver, cross-view existing
`cp` works in both directions and shell `mv` succeeds in the tested absent-target
case. Alias, hardlink and configured internal symlink copies cannot truncate their
source. An unregistered arbitrary Real/WebDAV relationship stays unknown and
preserves the existing destination. Readonly composition preserves policy.

Apache's **opt-in `overwritePolicy: "etag"`** native existing-target COPY/MOVE
works with actual strong source and destination validators. Raw positive and
negative If-Match, If-None-Match, tagged destination If, Overwrite, and lock-token
conditions are exercised separately. Authentication, configured 403, 404, limits,
stream upload/drain, paused downloads, early return, active abort, timeout,
late real-response settlement, and upload cancellation have explicit controls.

Transport backpressure evidence measures application pulls/bytes and awaited
outgoing drain, not exact kernel/SSL buffering or whole-process memory. Cancellation
does not promise rollback: the cancelled upload's actual namespace/bytes are
witnessed, including any partial or empty accepted file. Delayed-response tests
delay delivery of an actual unchanged server response, not a synthetic provider.

## Remaining provider and product gaps

1. **Default lock native overwrite remains unsupported by both tested profiles.**
   Apache grants a lock with no `DAV:lockroot`; the adapter rejects it with
   `ENOTSUP`, sends best-effort UNLOCK, and preserves source/destination bytes.
   WsgiDAV returns an unbracketed Lock-Token; the adapter rejects it with `EIO`,
   with a real finite server lock still observable until server termination or
   expiration. Neither token nor XML is repaired. Both COPY and MOVE rows remain
   failed positives. There is no default-policy change or permissive fallback.
2. **WsgiDAV raw conditional-transfer limitations.** Using the genuinely quoted
   strong HTTP GET ETags, distinct-target source If-Match COPY/MOVE returns 412
   and preserves both entries. A stale absolute destination tagged If is accepted
   (204), changes destination bytes, and removes the source for MOVE. Wrong-token
   requests preserve bytes but return 423 rather than the asserted 412. Valid
   locked overwrite succeeds, but the destination lock is gone and UNLOCK returns
   409. These status mismatches and dangerous accepted writes remain failures.
3. **WsgiDAV `DAV:getetag` is unquoted.** The format row fails independently; raw
   native conditionals use unchanged HTTP GET validators and are actually sent.
   Product opt-in ETag overwrites and file utimes stop before transfer/PROPPATCH
   with `ENOTSUP`. They are blocked interoperability failures, not executed guard
   passes. Directory getetag is absent, so directory utimes is explicitly refused.
4. **First Apache directory metadata write changes its own validator.** The
   provider creates `.DAV`, changing native directory size/mtime and the current
   ETag. The stored dead property still binds the old tag. The original adapter
   reported success without exposing requested timestamps. The fix adds exactly
   one post-stat; mismatch now reports `EAGAIN`, without invented validators,
   retry, rollback, new API or broader contract changes. The initial workflow
   remains a failed positive, not a supported/refusal-green rewrite. A separate
   guard proves explicit error and unchanged child bytes; a separate second update
   after metadata-store initialization succeeds. That warm case is not the first
   attempt and is not automatic recovery. Before/after XML and native metadata are
   in `consumer.json` under `observations.directoryMetadata`.
5. **Deliberate capability gaps remain.** Safe empty-directory `rmdir` returns
   ENOTSUP with no DELETE fallback; `atomicRename` stays false. POSIX permission
   enforcement/chmod and write-access probing are unsupported. Advisory modes do
   not promise privacy. Real-service listings used no pagination; vendor pagination,
   server-side truncation detection, other deployments, hostile symlink writers,
   inherited/source/ancestor lock combinations, ABA races, and arbitrary provider
   relationships are not established by this checkpoint.

The host resolver is trusted host code, not a sandbox or lease. It recognizes
only registered real backing mappings, forwards signals, and compares public
native scope/dev/inode observations. Server symlink following was explicitly
enabled for authored links that remain within the owned root. That configured
fixture is not a claim that FollowSymLinks confines a hostile deployment.

## Failure preservation and fixture corrections

- `wsgidav-raw-initial`: original 3/5 positive, 1/2 guard results. Failed rows
  stopped early and lack complete after-effects. Retained without relabeling.
- `apache-raw-initial`: fresh GET ETags were weak; expecting successful strong
  If-Match was an oracle error. Those 4 positive failures and 1 guard failure remain.
- `apache-public-first`: isolated PATH omitted npm; no service acceptance.
- `apache-public-second`: compiler exposed ambiguous ancestor package self-reference;
  fixed by an independently named consumer package and explicit rootDir, not by
  source fallback or relaxed types. No service acceptance.
- `apache-public-third`: packed example passes, but even fresh PROPFIND ETags can
  be weak; four raw rows are blocked format expectations, not exercised guards.
- `apache-matrix-first`: first actual default-lock and directory-timestamp failures.
  Wrong token `opaquelocktoken:invalid` yields Apache 400; a syntactically valid
  absent UUID is used later. Response chunks were incorrectly expected to fill
  chunkSize exactly; corrected to nonempty/capped/exact-byte checks with cleanup.
- `wsgidav-matrix-first`: one strict test callback typing failure, no provider run.
- `wsgidav-matrix-second`: unquoted property ETags blocked four native raw rows;
  those remain blocked, not guards. A transport framing issue sent known-size XML
  as chunked, causing LOCK 400; the final typed helper sends its known Content-Length,
  while actual stream PUT remains chunked. No server response/header was repaired.
- `apache-matrix-corrected`: all 16 raw rows pass; packed 14/3 positive, 12/0 guard,
  2/0 refusal. This is pre-product-fix evidence, not the final current gate.
- `timestamp-before-fix`: five minimal regression tests fail (four missing rejection
  checks and one missing post-stat check). All five pass after the fix; 560 existing
  WebDAV tests, focused strict types, and isolated full ESM/declaration build pass.
- Final cohorts add unconditional after-row raw GET/PROPFIND lock witnesses,
  including failed rows, source and Destination paths. All witness error lists are
  empty. Host witnesses preserve small exact bytes and namespace absence; consumer
  large files use SHA-256/size. `.DAV` internals are excluded from routine content
  snapshots but explicitly captured for the directory-metadata investigation.

Fixture input copies/hashes are per cohort. Changed inputs, header framing,
validator selection, new guards, and the newer product commit are disclosed;
this is **not** unchanged-all-input proof. Existing tests were not weakened or
edited. No all-repository suite was run. `evidence/apache-final/commands.json`
also records the frozen 560-test old WebDAV replay, focused types, product build,
strict packed-consumer compilation, and actual executable example success.

## Reproduction, cleanup and evidence seal

Use the complete commands in `README.md`. Each run supplies literal configuration,
pins the product archive, freezes fixture inputs, packs/compiles the actual public
consumer, and retains all reports under a fresh cohort name. `seal.mjs --check`
verifies the author artifact seal; it is not a replacement for independent replay.
Exact dependency, binary, config, fixture and evidence hashes are in the linked
JSON files and `SHA256SUMS`/`CHECKPOINT.json`.

Final Apache activity: `2026-08-27T05:33:52.539Z` to
`2026-08-27T05:34:32.873Z`; recorded service window 34,785 ms.
Final WsgiDAV activity: `2026-08-27T05:34:33.840Z` to
`2026-08-27T05:34:41.781Z`; recorded service window 2,405 ms.
These are actual cohort windows, not investigation duration or 72-hour work claims.
Both final service processes exited; each cleanup record confirms removal of its
owned root/HOME/venv/downloads/config/keys/package. The seal audits all recorded
workspace paths for absence without deleting anything else.
