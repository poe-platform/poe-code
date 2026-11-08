# Independent real WebDAV review

Owned verification only. Product source and the author real-service subtree are
read-only. The new tests use actual task-owned Apache2.4.66 and
WsgiDAV4.3.5/cheroot11.1.2 HTTPS services, synthetic credentials, temporary config
and native backing witnesses. No private repository, global configuration or
main package dependency changes are required.

```sh
node tests/fs/webdav/real-service-independent/run.mjs \
  /tmp/NEW_WEBDAV_REVIEW e8acecc3a843642ca83127d43d8c65ea46c2c0e4
```

The output directory must not exist. Runtime prerequisites are the documented
macOS arm64 Apache binary/modules, OpenSSL, Homebrew Python and the repository's
cached development tooling. Python wheels are downloaded only from the author's
pinned eleven-artifact official PyPI lock, hash-checked, and installed offline
in a temporary venv. The harness never starts or modifies an existing service.
All private keys, venv/tool copies, server roots and child processes are cleaned;
only the selected outside evidence remains.

The runner copies author fixtures from `1c745c3`, relocates the runner's repository
lookup to this checkout, and adds compilation/invocation of `independent.mts`.
Author raw/public/direct assertions and services are not rewritten. Exact original
and executed fixture hashes distinguish these runner-only adaptations. Product
source is an explicit committed archive, not the moving worktree. Services run
against a clean built/packed package and strict public TypeScript consumers.
The extra consumer uses root and subpath imports with a private/source-fallback
guard. Native file/process access here belongs only to the test harness.

The unchanged validation gate includes564 WebDAV,23 legacy LOCK,23 direct
authority,5 timestamp,49 historical alias cases and14 separately repeated
constructor cases. `--services-only` does not rerun this validation and records
that fact; it is not a validation pass. Use the separately preserved same-source
cohort. Original positive/guard/refusal matrices remain separate from the new
negative batch.

The outer runner's exit0 means capture completed, not all behaviors passed.
Inspect each provider's `summary.json`, `independent.json`, command statuses and
cleanup record. Author service runners deliberately exit2 when recorded matrix
failures remain. No skip or refusal is counted as positive support.

The injected grant controls fetch a real server-issued LOCK grant, change only
specified XML and update Content-Length to describe the new bytes. They do not
repair WsgiDAV's invalid token header or validators. Native source/destination
bytes and request methods expose forbidden publication. WsgiDAV's earlier token
rejection masks the deeper XML controls; these passes do not verify its XML
validation. The unchanged-body and unknown-element controls ensure the injection
path is usable rather than deny-all.

`primary.mjs /tmp/NEW_PRIMARY.json` records fresh primary RFC/server-source hashes
and targeted excerpts. RFC4918 section17 matters: an unknown DAV:read element is
not a recognized competing lock type and must not be called a product failure
merely because it is ignored beside DAV:write. In contrast, DAV:shared and
DAV:exclusive are recognized competing lock scopes. The regression deliberately
expects contradictory known scopes to be rejected before COPY/MOVE.

See `REPORT.md` and `evidence/CHECKPOINT.json` for frozen results, historical
fixture defects, exact acceptance boundaries and remaining failures. No atomic
rename, safe rmdir, rollback, arbitrary-provider or overall superiority claim.
