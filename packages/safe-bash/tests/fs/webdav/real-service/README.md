# Independent real-service WebDAV checkpoint

The subsequent bounded source-author checkpoint is [PHASE2-REPORT.md](PHASE2-REPORT.md):
default Apache LOCK interoperability, direct transfer authority guards, frozen
public consumers and separate remaining WsgiDAV failures. Use `phase2-seal.mjs`
for the expanded tree; the original seal and every original cohort are preserved.

The remainder describes the original `a4c7824` checkpoint. This subtree owns the
independent-service harness and its evidence. At that checkpoint, the only
product change was bounded timestamp post-validation, committed as `4143efd`.
Package manifests, runtime dependencies, and existing fixtures are unchanged.
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

Reproduce this first cohort from its author commit `3db0c63` on the recorded host:

```sh
node tests/fs/webdav/real-service/run.mjs unique-cohort-name
```

Only the task-owned temporary subtree is deleted in finally. The root coordinator
must assign a different final verifier; author evidence is not independent final
acceptance. No broad superiority, portability, or full-project completion claim.

## Current executable checkpoint

See `REPORT.md` for the final matrix, source/package hashes, limitations, and all
preserved intermediate cohorts. The final frozen product source is
`4143efde6de0b5cff4feff03f0a479cd70b9510f`, not the original baseline. That is a
committed source snapshot, not a claim that the shared worktree was clean.

Prerequisites on the recorded macOS arm64 host: Node 22.22.2; repository-installed
TypeScript/tsx development tools; `/opt/homebrew/bin/python3` 3.14.7; local
OpenSSL; and preinstalled `/usr/sbin/httpd` 2.4.66 with the modules enumerated in
`apache.mjs`. Nothing is installed globally. The wheel lock is intentionally
specific to CPython 3.14 macOS arm64; it is not a cross-platform resolver.

Run from the repository root using new cohort names:

```sh
node tests/fs/webdav/real-service/run.mjs apache-reproduce apache --source=4143efde6de0b5cff4feff03f0a479cd70b9510f --validate
node tests/fs/webdav/real-service/run.mjs wsgidav-reproduce wsgidav --source=4143efde6de0b5cff4feff03f0a479cd70b9510f
node tests/fs/webdav/real-service/validate.mjs source-validation-reproduce
```

The first two commands intentionally exit **2** when any positive/guard row fails;
they still collect every row and clean up. Existing cohort names are rejected
before workspace creation. Exit 0 from historical runners meant capture completed,
not that all observations passed. `validate.mjs` checks the current checkout;
`run.mjs --source=...` builds only its frozen archive. No all-repository test gate
is run. After adding a reproduction cohort, rerun `seal.mjs` to update the seal.

`run.mjs` archives committed `src`, the actual package manifest and build configs,
builds into its isolated snapshot, calls `npm pack --ignore-scripts`, and extracts
that actual tarball into `consumer/node_modules/virtual-bash`. A separate named
consumer package prevents ancestor package self-resolution. It strictly compiles
`https.mts`, `example.mts`, and `consumer.mts`, then executes the generated `.mjs`
with ordinary Node, without tsx, source fallback, private mocks or resource helpers.
`consumer.json` records the resolved public root/subpath URLs. `package.json`
inside each cohort is the npm pack record, including exact file map and tar SHA-256;
`baseline.json` contains the actual product export map and per-source hashes.

The complete executable example is `example.mts`, not a suggested API fragment.
The runner supplies and archives literal `baseUrl`, `aliasUrl`, `serverRoot`,
`caFile`, and synthetic `authorization` values in `literal-config.json`. During a
run it invokes `consumer/out/example.mjs config.json`. Those archived paths refer
to intentionally deleted fixtures; rerun the harness to create a new live config.
The host binding explicitly registers the two real configured URL mappings and
the public RealFileSystem object for the same backing root. Unregistered objects
stay unknown, even if they happen to address the same disk. Native stat identities
retain their actual shared scope/dev/inode; no endpoint/client fake identity is used.

`https.mts` is a fully typed Node-built-in transport: explicit loopback origin and
per-request CA, ordinary known-length body framing, streaming unknown-length PUT,
awaited drain, pull-driven copied response chunks, reader cancellation, and socket
abort. It does not repair tokens, ETags or XML, follow redirects, add hidden
credentials, use ambient cookies/proxies, or mutate global TLS/dispatchers.

Apache uses a task-owned `-X -f` configuration, root, SSL key/certificate, password
file, runtime directory, PID, logs, and lock database. WsgiDAV uses a temporary venv
and official-PyPI hash-verified wheels; offline isolated pip checks its dependency
closure. Server directories, HOME, downloads, venv, package, and keys are deleted
in finally after evidence capture. Certificate public bytes are retained, not keys.
Every child command is time-bounded; each service is stopped in finally.
