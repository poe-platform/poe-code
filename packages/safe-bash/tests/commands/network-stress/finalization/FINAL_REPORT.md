# Bounded curl finalization

## Decision and scope

The accepted curl checkpoint remains accepted within its existing bounded scope.
The authorized one-line author assertion is corrected; all six requested cohorts
pass in their single fresh executions. The global build and built-package smoke
pass. **Global typechecking fails with three unrelated filesystem-test errors**;
this is not a clean whole-repository validation claim.

This finalization leaf performed the work directly, without delegation. No
network source, other author assertion, policy sidecar, shell/FS/lifecycle
contract, optional pretransport abort guard, or prior evidence was changed.
No remote, full-shell/full-filesystem, fuzz, policy diagnostic, or additional
native-oracle suite was run. Existing native curl calls inside author81 were
allowed; there was no new native breadth or external upload.

- Author assertion-only commit: `cbde2fea6a645dbd6395e6b82f1526769e51c1fc`.
- Source revision: `aa2da57a5d1be8571f450a27c7b971245c1b7025`.
- Network-tree SHA-256: `886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4`.
- `curl.ts` SHA-256: `4859cc27a94d4ffe74ecadf20280d5d519d85babc50d24f55b9c51357c2dca42`.
- Prior independent acceptance: `77f859182e6bc9d1ea3dbf26852d529e77ea65ff`.
- Finalization evidence is committed separately from the author test; its exact
  commit ID is supplied in the final handoff, rather than self-embedded here.

## Single-execution results

Every row below ran exactly once. No launch failures or reruns occurred.
Node was `v22.22.2`. Capture ran on August 26, 2026, from
`23:33:06.571Z` through `23:33:39.573Z`; these are measured capture times, not
72 hours of work or a claim that the full product is complete.

| Requested cohort | Result | Exit | Evidence |
| --- | --- | --- | --- |
| Author | **81/81**; no skips/cancellations/todos | 0 | `author-81.json` |
| Independent corrected product-v2 | **60/60**: 54 native-parity + 6 separate contracts | 0 | `independent-60.json` |
| Supplement product | **18/18**: existing 8 parity + 5 security + 5 lifecycle | 0 | `supplement-18.json` |
| Frozen retry product | **18/18** native-parity rows | 0 | `retry-18.json` |
| Corrected retry-lifecycle-v2 | **15/15** injected contracts | 0 | `lifecycle-15.json` |
| Dirac policy | **22/22**; no skips/cancellations/todos | 0 | `policy-22.json` |
| Global `npm run build` | **Pass** | 0 | `build.json` |
| Global `npm run typecheck` | **Fail**, three unrelated diagnostics below | 2 | `typecheck.json` |
| Build-gated package smoke | **5/5** existing-profile workflow steps | 0 | `package-smoke.json` |

The orchestration process exits 1 because it preserves the failed global
typecheck; it does not recast that result as a curl failure or silently ignore it.
The retained bad `retry-lifecycle.ts` was not run. Dirac's runner was discovered
read-only from `tests/commands/network-policy-stress/README.md`; its exact test
command was used, without the separate scoped compiler or admission diagnostic.

The actual commands, absolute Node executable, environment, timestamps, raw
stdout/stderr, base64 byte captures and their hashes, parsed counts, network
samples, before/after inventories, process-group IDs and cleanup are in each
JSON. Equivalent command spellings from repository root are:

```sh
export CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300
export CURL_VERIFY_SOURCE_REVISION=aa2da57a5d1be8571f450a27c7b971245c1b7025
export NODE_OPTIONS=--unhandled-rejections=strict
node --unhandled-rejections=strict --import tsx --test tests/commands/network/*.test.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/product-v2.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/supplement-v2.ts product
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/retry-product.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/retry-lifecycle-v2.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/network-policy-stress/*.test.ts
npm run build
npm run typecheck
node --unhandled-rejections=strict tests/commands/network-stress/finalization/smoke.mjs
```

`run.mjs` executed that sequence with detached owned process groups, strict
unhandled rejections, 8 MiB capture limits, 430-second watchdogs plus a two-second
hard bound, and a 20-second smoke watchdog. It refuses to overwrite existing
captures; do not rerun it against this evidence directory. Every child exited
naturally; no watchdog, output-bound termination, source-gate termination, or
cleanup kill was needed. All nine owned process groups were absent on completion.

## Assertion provenance and exact bytes

Only `tests/commands/network/http.test.ts:72` changed, from `recovered:2` to
`retryretryrecovered:2`; the author denominator remains **81**. The report at
`../final-verification/FINAL_REPORT.md` and its independently captured native
artifact establish the `retry`, `retry`, `recovered` body sequence and three
requests. Native 8.7.1 captured `retryretryrecovered:9:200:0` with supported
size/status writeout. The product's `:2` retry-count suffix and fractional delay
are separate existing contracts, not features falsely attributed to that oracle.

The fresh retry18 replay compares every row to the unchanged frozen18 artifact,
including exact stdout, VFS files/namespace, request effects and diagnostics.
`audit.json.retryComparison` additionally records these concrete examples:

| Existing frozen row | Exact stdout | Managed `result.bin` |
| --- | --- | --- |
| `retry-stdout-explicit` | `retry-body\nok\n` | Unused seed remains `old bytes must disappear` |
| `retry-file-fail-body` | empty | `ok\n` only |
| `retry-writeout` | `retry-body\nok\n:3:200:0` | Unused seed unchanged |

Thus stdout is not rolled back; curl-managed `-o FILE` resets before retry and
contains only the final body. Lifecycle15 also retains the existing reset,
denial, fallback, failing-write and stdout-redirection checks. No frozen data
was rebaselined to obtain these results.

The built-package smoke uses the existing two-retry native body fixture:

| Workflow step | Exact stdout bytes | Exact VFS output bytes |
| --- | --- | --- |
| Binary download | empty | `00 ff 0a 0d 80 41` |
| Binary VFS PUT upload/echo | `00 ff 0a 0d 80 41` | no new output file |
| Retry stdout with writeout | `retryretryrecovered:2` (21 bytes) | no output file |
| Curl-managed `-o result.bin` | empty | `recovered` (9 bytes) |
| Shell `> redirected.bin` | empty shell capture | `retryretryrecovered` (19 bytes) |

The managed-file `--fail-with-body` case retains two 503 diagnostics while
finishing successfully. Shell redirection stores stdout's transient bytes; it
does not acquire curl-managed reset semantics. The binary base64 is `AP8KDYBB`.
Assertions use `ShellResult.stdoutBytes`, never lossy decoded binary text.

## Built-package integration and API

The smoke first resolves and actually imports **`virtual-bash`**, without a TS
loader or source fallback. Resolution is the freshly built repository
`dist/index.js`; module identity is also checked against that entry. Its recorded
SHA-256 is `209b3c19c710987fe997cfbb2654bb590f915f9315a1f41c8767f18ad8022430`.
It creates MemoryFS, installs `agentCommands()` and explicitly installs
`networkCommands({ authorize, limits })` through `.use(...)`. It verifies that
the default aggregate does not include curl. The smoke makes eleven authorized
HTTP requests only to its ephemeral `127.0.0.1` server; no TLS, remote adapters,
external host or new behavior corpus is added. Cleanup records disposed Shell,
cleared watchdog, non-listening server and zero sockets.

Minimal package-root authorization API, matching the exercised installation:

```ts
import { Shell, createMemoryFileSystem, networkCommands } from "virtual-bash";

const allowedOrigin = "http://127.0.0.1:8080";
const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(networkCommands({
    authorize: ({ url }) => new URL(url).origin === allowedOrigin,
    limits: { maxTimeMs: 3000, maxDownloadBytes: 1024 * 1024 },
  }));

try {
  const result = await shell.exec(`curl -sS ${allowedOrigin}/download`);
  console.log(result.exitCode, result.stdoutBytes);
} finally {
  await shell.dispose();
}
```

The example's fixed port is illustrative; the smoke obtains an ephemeral port
from its own server. `authorize` receives URL, method, attempt, signal and
optional redirect origin; only explicit `true` allows transport. Hosts may
also inject `transport`; injected transport is **trusted**, must perform only
the authorized request, honor cancellation/backpressure and release resources.
There is **no DNS/IP pinning**, no universal SSRF guarantee and no ambient
networking through `agentCommands()`. Dirac22 demonstrates its bounded current
contract, not a new pretransport-abort admission guarantee; no source fix or
optional guard is required or introduced by this report.

## Existing feature and limit profile

- HTTP(S) methods, custom headers, Basic/Bearer authorization, explicit stdin,
  binary VFS upload/download, data/JSON and bounded multipart are included.
  Upload/form/output paths remain in the VFS, with no host-file fallback.
- Redirects and retries authorize each attempt/hop. Cross-origin credentials
  and custom headers are removed; retries may repeat accepted server effects.
  Stdout retains all published bytes; managed output resets, header dumps append.
- Total per-URL deadlines cover authorization, I/O and retry sleeps, not native
  per-attempt timeout semantics. Cancellation propagates the caller reason;
  uncooperative injected host work cannot be forcibly stopped.
- Defaults remain 64 MiB upload and response-body limits, 8 MiB replay/buffer,
  64 KiB headers, ten redirects, five retries, 32 URLs and 120 seconds per URL.
  CLI flags cannot raise host ceilings; shell output quotas are separate.
- Existing bounded ordinary `head -c 1` early-consumer closure is covered by the
  accepted cohorts. Separately tracked `head -n 0` does not block this scope
  and was not tested or fixed here.
- This is not full curl parity: unsupported flags/protocols fail rather than
  invent behavior. No proxy/config/netrc, cookie jar, native subprocess or new
  runtime dependency is introduced. No universal Bash/FS compatibility,
  superiority over just-bash, or full-product completion is claimed.

## Exact unrelated global typecheck failures

The single `npm run typecheck` invocation exits 2 with the following diagnostics,
preserved verbatim in `typecheck.json`. No fixes or reruns were attempted:

```text
tests/fs/overlay/review-regressions.test.ts(30,7): error TS2741: Property 'identityScope' is missing in type '{ type: "file"; size: number; mode: number; mtimeMs: number; atimeMs: number; ctimeMs: number; birthtimeMs: number; ino: number; dev: number; nlink: number; uid: number; gid: number; }' but required in type 'MutableStat'.
tests/fs/readonly/metadata.test.ts(45,3): error TS2322: Type '{ birthtimeMs: number; ino: number; dev: number; nlink: number; uid: number; gid: number; type: FileType; size: number; mode: number; mtimeMs: number; atimeMs: number; ctimeMs: number; identityScope?: object | symbol; }' is not assignable to type 'Mutable<Required<FileStat>>'.
  Property 'identityScope' is optional in type '{ birthtimeMs: number; ino: number; dev: number; nlink: number; uid: number; gid: number; type: FileType; size: number; mode: number; mtimeMs: number; atimeMs: number; ctimeMs: number; identityScope?: symbol | object; }' but required in type 'Mutable<Required<FileStat>>'.
tests/stress/adapters/s3-truncate-profile.test.ts(50,76): error TS2367: This comparison appears to be unintentional because the types '"headObject" | "putObject" | "deleteObject" | "copyObject" | "listObjectsV2"' and '"getObjectStream"' have no overlap.
```

## Integrity, concurrent work and cleanup

All **294** recorded network samples across the nine processes match the exact
committed inventory and bytes. The digest is SHA-256 of JSON-encoded sorted
`[path, SHA-256]` pairs, including the network README. Before/during/after samples
are observations, not protection against an edit reverted between samples.

All **92** existing files under `tests/commands/network-stress/` outside this new
directory match the prior independent acceptance commit and remain byte-identical.
All **8** policy-sidecar files are unchanged. In particular, the historical
**80/81** author capture and **57/60** original baseline remain intact, as does
the retained old lifecycle 14/15 observation. Important preserved hashes:

| Evidence | SHA-256 |
| --- | --- |
| `../baseline.json` | `b487fc61868f1f1592f93a1657bc3f480a5ef249e1cccb87cbcb7a8816aae02d` |
| `../final-verification/author-81.json` | `593264346dac4eea2bc0610415663c7eeb25b6046d568f98a361d66151506be9` |
| `../oracle.json` | `b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7` |
| `../retry-freeze.json` | `7a84039e93c52bbc63d0f776963dbee518082a0d6a7c39541530e5930bc1660c` |
| `../final-verification/independent-native-frozen.json` | `4c1b8ec9da019393f2db189a74485248f2fd475d291e3ddf098ebbb2318d813d` |

Shared-source/config and author/policy snapshots report no byte changes within
or across these runs. **HEAD was not stable or clean**: it moved from
`09555d0a993989bbc50cc1a26c93027624f13dca` to
`435476ddfe6557232ce53888ffa40854481b8fee` during supplement18, when another worker
committed S3 tests. Existing unowned package/root-export/plugin changes and
native fixture directories are recorded in the status snapshots and untouched.
The global compiler consumes tests beyond the source snapshot; its actual
diagnostics, not whole-HEAD stability, are the evidence for that invocation.

One pre-execution smoke-harness refinement occurred while the suites were
running: binary assertions switched from decoded `stdout` to `stdoutBytes`, and
the smoke began reporting its own executed hash. No smoke had run before that
edit. `start.json` retains the initial unexecuted draft hash
`cc9cba231438be06836f2c8005bd814446dec5d3e5a485983b541f6517b4c9c5`;
the actually executed and committed smoke hash is
`769a090b3a20c342576408c3a9dc6aadff7beb087463db11ec287e0802dc84da`.
This was not a rerun, product change, expectation change or lost capture.

`audit.json` aggregates capture hashes, source identities, frozen-byte comparisons
and absent owned process groups. `seal.json` records the final precommit file
manifest, integrity/cleanup observations and any later shared-source drift.
The first metadata-only sealing attempt accidentally invoked `apply_patch`
without a payload and stopped before creating the seal or staging files. The
corrected sealing attempt is recorded separately; it reran no test, build,
typecheck, smoke, native process or product operation.
Only the new finalization paths enter the evidence commit. Build-produced
`dist` and every unowned path remain uncommitted and are never cleaned by this
leaf. The final handoff supplies postcommit owned-path status; no further test
checks follow this bounded finalization.
