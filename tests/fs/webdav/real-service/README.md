# Independent real-service WebDAV checkpoint

This subtree owns the independent-service harness and its evidence. No product
source, package manifests, runtime dependencies, or existing fixtures are changed.
All host witnesses and mutation targets are inside a newly created task-owned
server root. Synthetic Basic credentials are sent only over per-request trusted
loopback HTTPS; transport headers are not repaired to fit the adapter.

## First immutable cohort

`evidence/wsgidav-raw-initial` freezes product commit
`1ea140b50f0b4edcfa28a60e2f89351b97e509a5` (archive and per-file hashes,
actual package map, concurrent checkout status). The isolated provider is
WsgiDAV 4.3.5 / cheroot 11.1.2, Python 3.14.7, macOS arm64. All eleven
dependency wheels are pinned by official PyPI URL and SHA-256 in
`dependencies.json`; installation is offline after verified downloads, with
isolated pip, a task-owned HOME, no cache, and no ambient index configuration.

Initial raw cohort: positive 3 pass / 5 fail; guard 1 pass / 2 fail; no
refusal rows. Preserve these failures: distinct-target source If-Match produces
412 on COPY and MOVE; stale destination tagged ETags are accepted (204);
overwrite removes destination locks (subsequent UNLOCK is 409); LOCK returns
an unbracketed token. Raw requests deliberately construct RFC coded tokens in
subsequent requests, but do not change actual response headers. This does not
make the strict product adapter compatible with WsgiDAV default lock overwrite.

The first probe stops each row at its first assertion and therefore does **not**
contain post-failure byte witnesses for all failed requests. Later cohorts must
add those witnesses rather than retroactively relabel this as complete proof.
Raw probes alone are not packed-public-consumer acceptance.

Reproduce this first cohort from its author commit on the recorded host:

```sh
node tests/fs/webdav/real-service/run.mjs unique-cohort-name
```

Only the task-owned temporary subtree is deleted in finally. The root coordinator
must assign a different final verifier; author evidence is not independent final
acceptance. No broad superiority, portability, or full-project completion claim.
