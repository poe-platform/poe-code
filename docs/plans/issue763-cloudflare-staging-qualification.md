# Issue 763: disposable Cloudflare staging qualification

## Ownership and claims

The external Poe2/Cloudflare account owner executes this plan using their
existing authorized session. Do not transfer Cloudflare credentials, the
qualification bearer secret, or private deployment endpoints to another agent.
No credential workarounds, production routes, existing buckets, Docker or
workspace data copies are required or permitted by this plan.

This first deployment is a **fixture**, not the actual consumer filesystem:
real R2 holds private pages and streamed immutable versions, but namespace/CAS
state is process-local. A successful deployment advances native Cloudflare
execution evidence; it does not qualify the consumer's authorization, atomicity,
crash recovery, quotas or `createStaging` implementation. Keep #763 open.

Frozen runtime: `e0dfa9b1eece8686886bc288763bf07b7e47b66c` (#746, including its
startup-cancellation retirement correction). Frozen staging:
`a767681a262f5ec21ef9d5b0f1790235269194e8` (including the parent's cleanup
refactor). The earlier `8c3dbbc39` local matrix is separate historical evidence.

## Artifact and prerequisites

Use the owner-reviewed nine-module artifact and `qualification.json` emitted
under issue-763 `out/issue763-workerd/deployment-e0dfa9b1e`. Transfer only those
files, not a workspace, runtime installation, credentials or browser profile.
If regeneration is necessary, run the maintained staging integration test with:

```sh
SAFE_FS_EXECUTOR_ROOT=/absolute/path/to/issue-746 \
SAFE_FS_EXECUTOR_REVISION=e0dfa9b1eece8686886bc288763bf07b7e47b66c \
SAFE_FS_STAGING_REVISION=a767681a262f5ec21ef9d5b0f1790235269194e8 \
SAFE_FS_PYODIDE_ROOT=/absolute/path/to/pyodide-314.0.6-package \
SAFE_FS_WORKERD_ROOT=/absolute/path/to/miniflare-project \
TMPDIR="$PWD/out/issue763-workerd" \
SAFE_FS_EXPORT_WORKER_DIR="$PWD/out/issue763-workerd/deployment-e0dfa9b1e" \
node --test packages/safe-fs/tests/integration/object-staging-workerd.test.mjs
```

The output directory must not already exist. The executor checkout's package
metadata must match the frozen revision. Tooling is Miniflare
`5.20260917.0-alpha` / workerd `1.20260917.1`; Pyodide asset hashes are enforced
by the test. A compatible host workerd launcher can be selected using
`MINIFLARE_WORKERD_PATH`; no system-library replacement is necessary.

On the deployment owner's machine, verify every artifact before deployment:

```sh
cd /owner/out/issue763/deployment-e0dfa9b1e
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync('qualification.json', 'utf8'));
assert.equal(manifest.frozenExecutor, 'e0dfa9b1eece8686886bc288763bf07b7e47b66c');
assert.equal(manifest.stagingRevision, 'a767681a262f5ec21ef9d5b0f1790235269194e8');
assert.equal(manifest.cases, 4);
assert.equal(manifest.artifacts.length, 9);
for (const artifact of manifest.artifacts) {
  assert.equal(artifact.name.includes('/'), false);
  const bytes = readFileSync(artifact.name);
  assert.equal(bytes.length, artifact.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
}
console.log('Verified nine frozen modules');
JS
```

The account must support the static Wasm module upload, R2, the compressed
artifact size, and the selected paid-Worker resource profile. This plan uses
75,000 ms provider CPU and 10,000 subrequests per invocation, without raising
the platform's memory limit. Local initial Wasm capacity is not a peak-memory
measurement. If upload, startup, account limits or JSPI fail, stop and return
the exact sanitized failure; do not change pins or silently reduce the matrix.

## Isolated deployment

Record the owner's approved Wrangler version and account selection locally.
`WRANGLER` below is an absolute path to that installed executable. Use fresh,
unique `issue763-staging-...` Worker and bucket names, and verify that neither
belongs to an existing service. All command output stays under the owner's
`out/issue763`; never enable shell tracing or verbose HTTP header logging.

1. Create one disposable R2 bucket using
   `"$WRANGLER" r2 bucket create "$BUCKET_NAME"`.
2. In the artifact directory, create this **new** `wrangler.json` with the exact
   owner-selected names and an epoch-millisecond expiry 30 minutes in the
   future. The Worker rejects expiry more than one hour ahead.

```json
{
  "name": "OWNER_SELECTED_DISPOSABLE_WORKER",
  "main": "main.mjs",
  "compatibility_date": "2026-09-17",
  "no_bundle": true,
  "find_additional_modules": true,
  "preserve_file_names": true,
  "workers_dev": true,
  "preview_urls": false,
  "observability": { "enabled": false },
  "rules": [
    { "type": "CompiledWasm", "globs": ["*.wasm"], "fallthrough": true },
    { "type": "Data", "globs": ["*.bin"], "fallthrough": true }
  ],
  "limits": { "cpu_ms": 75000, "subrequests": 10000 },
  "r2_buckets": [{ "binding": "SCRATCH", "bucket_name": "OWNER_SELECTED_DISPOSABLE_BUCKET" }],
  "vars": { "QUALIFICATION_EXPIRES_AT": "OWNER_SELECTED_EPOCH_MILLISECONDS" }
}
```

3. Run `"$WRANGLER" deploy --dry-run --outdir ../upload-review`, review the
   module list/types, compressed size, binding, limits and absence of routes.
   A dry run is not a deployment result. Preserve original module bytes; do
   not add a bundling/minification step or upload `qualification.json` as code.
4. Deploy with `"$WRANGLER" deploy`. Without the bearer binding the fixture
   fails closed (503). Save the actual deployment/version receipt locally.
5. Generate and install a dedicated short-lived bearer secret, in the owner's
   shell only, without echoing it or placing it in command arguments:

```sh
set +x
QUALIFICATION_TOKEN=$(openssl rand -hex 32)
printf '%s' "$QUALIFICATION_TOKEN" | "$WRANGLER" secret put QUALIFICATION_TOKEN
```

Record the resulting deployment/version receipt too: secret installation may
create a new version. Copy the deployed URL into the owner's local
`QUALIFICATION_URL` variable; do not send the endpoint or secret back.

## Bounded run and acceptance

Only `/staging`, empty POST bodies, size 9437184 or 104857600, profiles
`immediate`/`delayed`, and optional `spill=0`/`1` are admitted. There is a
per-isolate busy guard, **not** a global lock. The operator must send requests
serially, with no load generator, concurrency or automatic retries. Stop at
the first failure. Guest/Shell time limits are cooperative; admitted backend
cleanup may outlive client cancellation. Do not retry an ambiguous invocation.

First verify one unauthenticated request gets 401. Then run exactly four
authenticated success cases, preserving JSON and HTTP status locally:

```sh
for size in 9437184 104857600; do
  for profile in immediate delayed; do
    printf 'Authorization: Bearer %s\n' "$QUALIFICATION_TOKEN" |
      curl --silent --show-error --fail-with-body --max-time 90 --retry 0 \
        --request POST --header @- --header 'Content-Length: 0' \
        --output "../${size}-${profile}.json" --write-out '%{http_code}\n' \
        "${QUALIFICATION_URL}/staging?size=${size}&profile=${profile}&spill=1" \
        > "../${size}-${profile}.status" || break 2
  done
done
```

For each response require HTTP 200, `exitCode=0`, the requested `size`, empty
stderr, and the following assertions; do not count missing cases as passes:

- stdout SHA-256 is `b8b5dabaa3454f7fa46a97c51cec9ccd118ffc0d61df6e46d845ef200a2fd1bb`
  for 9 MiB, or `4cbf988462cc3ba2e10e3aae9f5268546aa79016359fb45be7dd199c073125c0`
  for 100 MiB, followed by a newline.
- `stageWriteBytes`, `stageReadBytes`, and `publishedBytes` each equal size;
  `largestChunk=65536`, `peakWrites=1`, `activeWrites=0`.
- `publications=2`, `created=closed=retired=1`, `acquired=released`.
- R2 private-page and fixture-version cleanup completes before success is
  returned. Independently inspect the disposable bucket for leftovers.

An optional **single 9 MiB immediate** `spill=0` request is the deployed negative
control: expect native ENOSPC/nonzero exit, not a success pass. Do not run a
larger negative-control matrix remotely. After expiry, one authenticated
request must return 410 without executing Python.

The fixture reports `deploymentAttested=false` and `productionHost=false`:
it cannot attest where it was invoked and it is not the consumer store. Pair
unaltered responses with provider deployment/version receipts and the owner's
sanitized execution report to establish deployed Cloudflare evidence.

## Teardown and remaining host acceptance

Whether tests pass or fail, stop requests; remove **only this disposable**
Worker with `"$WRANGLER" delete --name "$WORKER_NAME"`. Verify deletion, inspect
and empty only this disposable bucket using the owner's approved R2 tooling,
then run `"$WRANGLER" r2 bucket delete "$BUCKET_NAME"` and verify removal. Do not
use a force/purge command against an existing bucket. Unset the bearer variable
and remove any private header files. Expiry alone is not resource teardown.

Return hashes/pins, the Wrangler version, sanitized provider receipts, four
results or the exact blocker, resource-limit outcomes and teardown evidence.
No secret, URL, IP or account credential is required in the handoff.

The consumer owner must separately identify the authoritative adapter path and
implement `createStaging` with tenant permissions, bounded transfers/caches,
quotas/deadlines and orphan reclamation. Then repeat public
`requireStaging: true` conformance, 9 MiB Shell copy, native outputs to the
configured limit, shared pressure, retained readers/conflicts, and
spill/publication failure/abort cases against that actual host in Miniflare and
Cloudflare. This fixture does not replace that remaining #763 acceptance.

Configuration/limits source references (reviewed September 18, 2026): official
Cloudflare Workers Wrangler configuration and Workers platform limits docs.
Local fetched copies are retained in the qualification evidence directory.
