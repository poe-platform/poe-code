# Final independent curl checkpoint

## Decision and ownership

**Accept the fixed retry behavior and corrected cleanup harness for this bounded
curl cohort at `aa2da57a5d1be8571f450a27c7b971245c1b7025`. Do not claim an entirely
green suite: the unchanged author suite is 80/81. Policy acceptance remains
pending Dirac.** No new product-source blocker was reproduced in this assignment.

This fresh leaf is separate from the author, original baseline verifier and fix
implementer. It performed no delegation. Every new file is under
`tests/commands/network-stress/final-verification/`; no source, author tests,
parent harness/evidence/docs, remote evidence or policy-sidecar files were edited.
The original baseline remains **57/60**, including two real retry-output defects
and the independently reproduced fixture race. Supplement history remains 18/18.
This report is not full curl/Bash parity, a security certification, filesystem
completion, superiority over just-bash, or evidence of 72 hours of work.

## Target and provenance

- Authentic author handoff: `deab14d9f4b3b6f0d73f96587c74a9de23091300`.
- Reviewed close-event harness commit: `7f7ccfbdf684ed8b75388c5aef4fefea8a2e680f`.
- Additive retry freeze: `3b63f98a785b84d78bbc4080ea475ee426b471e2`.
- Reviewed product source: `aa2da57a5d1be8571f450a27c7b971245c1b7025`.
- Implementer handoff reviewed after arrival: `eebc25c7c7c3b69dae30c319807cd0807a0bd456`,
  including `../POSTFIX.md`. Its green counts are not substituted for these runs.
- Original oracle SHA-256:
  `b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7`.
- Fixed network-tree SHA-256:
  `886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4`.
- Fixed `curl.ts` SHA-256:
  `4859cc27a94d4ffe74ecadf20280d5d519d85babc50d24f55b9c51357c2dca42`.

The tree digest hashes JSON-encoded sorted `[path, SHA-256]` pairs, including the
network README. Every capture checks inventory and bytes against the committed
revision before execution, samples network hashes during execution at roughly
100 ms intervals, and checks again afterward. **All 1,113 recorded samples across
20 captured processes match the requested tree.** These are observed checkpoints,
not a claim to detect an edit reverted entirely between polling instants.
`audit-complete.json` records individual file hashes, capture hashes, timing, exits
and the checks; each capture preserves raw stdout/stderr and their SHA-256.

The first retry run observed concurrent changes only to unrelated
`src/commands/diff-patch/GNU-PATCH.md` and `patch-gnu-paths.ts`. They are retained in
`retry-1.json`, not silently called a clean checkout. A second complete retry run,
`retry-2-stable.json`, passed 18/18 with **no recorded shared-source/harness changes**.
Every other captured run also reports `changes: []`. Network source never changed.
After the initial checkpoint, another worker changed shared shell runtime files.
A third core 60, supplement 18 and retry 18 replay, a second lifecycle-v2 15 and
another scoped typecheck all pass against that actual updated working tree, with
stable before/after source snapshots (`*-current-shell.json`). Earlier runs remain
at their recorded shared-source identities; no clean-HEAD claim is made.
An over-broad precommit guard subsequently noticed unrelated metadata command
work and stopped before writing/staging/committing. The final checkpoint records
that failure and enumerates the actual scoped compiler dependency graph: every
product source in this public curl integration graph still matches the final
typecheck snapshot. Metadata additions outside that graph are recorded rather
than silently treated as tested. Network and relevant shell/FS/contracts remain
at the tested bytes; this is not whole-worktree acceptance.
Measured capture timestamps begin August 26, 2026 at 23:08:28.734 UTC; complete
start/end times for every run are in `audit-complete.json`.

`verify.mjs` independently proves 17 historical files, including the original
README/reports/fixture/runner/oracle/baseline and supplementary evidence, remain
byte-identical to `0a3fb6ec419c5614457100757816671db7a39c4f`. Supplement and retry
pin manifests still match all their files. Git ancestry establishes both freezes
preceded their applicable product checkpoints. No old JSON was regenerated.

## Fresh counts, without denominator substitution

| Cohort | Fresh outcome | Classification | Evidence |
| --- | --- | --- | --- |
| Corrected original public-shell matrix | **60/60 three times** | Each run: 54 native-parity + 6 separate contracts | `core-1.json`, `core-2.json`, `core-3-current-shell.json` |
| Supplement public-shell matrix | **18/18 three times** | Each run: 8 native-parity + 5 security + 5 lifecycle | `supplement-1.json`, `supplement-2.json`, `supplement-3-current-shell.json` |
| Frozen additive retry matrix | **18/18 three times** | Native-parity rows | `retry-1.json`, `retry-2-stable.json`, `retry-3-current-shell.json` |
| Original retry lifecycle harness | **14/15**, exit 1 | Separate injected contracts; retained sink-capture mismatch | `lifecycle-original.json` |
| Reviewed retry lifecycle v2 | **15/15 twice**, exit 0 | Separate injected contracts, not native parity | `lifecycle-v2.json`, `lifecycle-v2-current-shell.json` |
| New independent three-attempt cases | **3/3** | Native-parity: stdout, managed file/headers/POST, stdout-fd redirection | `independent-4.json` |
| Exact stale-author public-shell reproduction | **1/1** | Separate fractional-delay/writeout contract with native body reference | `independent-4.json` |
| Cleanup discriminators and repeated race probe | **3/3 + 100/100** | Product-free fixture checks; zero HTTP requests recorded | `cleanup-100.json` |
| Original frozen native replay | **65/65 Node tests** | 58 native row subtests + containing test + 6 profile/harness checks | `native-original-replay.json` |
| Additive native replay | **18/18** | Fresh capture compared against frozen bytes/effects/status | `retry-native-replay.json`, `audit-complete.json` |
| Unmodified author suite | **80/81**, exit 1 | Author Node tests, not independent matrix rows | `author-81.json` |
| Scoped types | Initial exit 2; corrected **exit 0 twice** | Own annotation defect repaired without semantic change | `scoped-types.json`, `scoped-types-final.json`, `scoped-types-current-shell.json` |

The matrix/lifecycle/cleanup scripts print JSON; they do not create Node test
containers. Repetitions do not add unique scenarios. Author checks can execute
multiple virtual commands, so 81 author tests are not 81 virtual invocations.

Native process accounting is **122 curl invocations**, not 122 parity cases:
original replay 58 transfer/argument rows + 1 version; retry replay 18 + 1 version;
new independent capture 3 + 1 version; author suite 40 transfers (34 HTTP cases,
5 file comparisons including two HEAD/include modes, 1 TLS comparison), no version
query. Total: 119 transfer/argument invocations and 3 version queries. Original
replay also starts two native `head` consumers. No native curl is executed by
the virtual comparison runners. HTTP requests, redirects and retry attempts are
separate counts; for example, the new three native rows issue nine requests.

## Exact harness and source review

`verify.mjs` asserts the entire v2 files equal narrowly specified textual
transformations, rather than merely checking their reported pass counts:

1. `lab-v2.ts` adds the helper import and replaces only shutdown implementation.
   `closeResources` subscribes before destroying sockets, waits for actual close
   events and server closure, bounds waiting to two seconds, retains zero tracked
   sockets, adds non-listening assertions, and removes its listeners/timer.
   The three discriminators prove destroy alone does not settle, missing close
   times out, and close without removing tracked resources still fails.
2. `product-v2.ts` changes only the lab import and adds the committed-source gate.
   `supplement-v2.ts` adds only that gate. Original comparison expectations remain
   unchanged, including every stdout/file/request equality check.
3. Lifecycle v2 changes only the failing sink's expected **Shell capture** and
   adds an assertion that the external rejecting sink accepted zero bytes.
   `src/shell/shell.ts:74` captures before calling the external sink. Original
   14/15 proof remains preserved; this is not a product or native-oracle rewrite.

The reviewed source commit moves response publication inside the attempt loop,
before retry. It resets per-attempt download/failure state, preserves intermediate
fail-mode diagnostics, and resets curl-managed output files after publication
and disposal, before retry sleep. It does not erase already emitted stdout or
roll back server-side POST effects. Only network `curl.ts` and README changed
in that commit's product-source portion.

Fresh evidence checks binary upload/download and multipart bytes; VFS namespaces
and exact files; request methods, bodies, selected headers and authorization
attempts; redirect credential behavior; partial timeout/disconnect outputs;
included/dumped retry headers; fail/fail-with-body/exhaustion status and diagnostics;
response and cumulative shell-output quotas; reset failure/fallback; explicit
caller-reason identity; response/upload backpressure; ordinary early `head -c 1`
closure; response disposal and fixture cleanup. Intermediate fail diagnostics
compare error-code sequence and HTTP-status meaning/count, not identical native
and virtual English sentences. Raw diagnostics remain available.

`retry-native.ts` alone asserts expected status, not byte equality. This verifier
therefore additionally compares all 18 fresh observations with the frozen artifact:
argv, status/signal, stdout, semantic and raw wire traces, files and consumer status,
plus diagnostic codes/counts and 503 meaning. That separate audit passes.

## Remaining red evidence and exact reproduction

**Author suite: root network owner follow-up remains required.**
`tests/commands/network/http.test.ts:72` still asserts `recovered:2`; unchanged code
now returns `retryretryrecovered:2`. The server at `helpers.ts:73` emits `retry`
twice, then `recovered`. Fresh author TAP reproduces precisely this failure and
no other author failure. Do not delete the test, suppress its failure, or claim
81/81 from this report. Updating its expectation requires the responsible owner.

The new local native fixture independently repeats that response sequence.
Before importing product code it records native stdout containing
`retryretryrecovered`, final size/status statistics, three requests, and managed
file/header effects. `independent-native-frozen.json` is created with
`productExecutions: 0` for that new process/corpus; earlier cohorts had already
run and source had been reviewed. The actual public Shell then reproduces:

```sh
curl --retry 2 --retry-delay 0.001 -w ':%{num_retries}' http://127.0.0.1:PORT/retry-author
```

It returns `retryretryrecovered:2`, status 0, with three requests. `PORT` must be
the fresh local fixture port; use the included runner, not an external service.
Native **8.7.1 does not supply the fractional-delay/num_retries oracle**: native
rows use integer delay 1 and supported size/status writeout. The exact product
suffix is checked against observed attempts as a separate contract. Official
documentation dates `num_retries` to 8.9.0 and fractional retry delay to 8.16.0.

**Original lifecycle harness: 14/15 is retained.** `sink-failure` expects empty
`ShellResult.stdout`, but observes `first\n`; external accepted bytes remain
empty, status is 23, requests/opened iterators/returns/disposals are each one.
The independently reviewed v2 assertion reflects the existing shell boundary
and passes 15/15 without altering the source or native expectations.

**Own initial type failure: preserved, fixed.** The first scoped typecheck reports
TS7022 for inference of `expected` from the observations array. Adding an explicit
array type fixes it; no behavior or expected bytes changes. The exact executed
pre-annotation file is preserved as `independent-before-types.ts.txt` and matches
the frozen fixture SHA. `verify.mjs` proves the final executable differs only by
that type annotation. Final scoped types cover all parent stress TS, owned TS,
the example and imported public-source graph, not every repository test.

## Safety, cleanup and limits

All captured child processes run with `--unhandled-rejections=strict`, explicit
handoff/revision environment, bounded output and outer 430/432-second process-group
watchdogs. Native rows have their own deadlines and byte bounds. Native execution
uses argv arrays, `-q` first, clean environment and loopback fixtures; independent
captures additionally disable proxies and constrain protocols. No external uploads,
user credentials, global TLS mutation or production trust-store changes occurred.
Existing TLS fixture material is unchanged. Author tests retain their own local
temporary-file behavior; new native files are confined to this owned subtree.

Completed scripts settle normally, not through watchdog termination. Labs check
idle work and actual server/socket closure; injected rows check iterator returns,
disposal and aborted request signals. Per-run fixture-root inventories match
before/after. New native files and fds are removed/closed in finally. The recorder
does not silently delete parent fixture leaks to make assertions pass. These are
the fixture's tracked resources, not a universal leak proof for arbitrary hosts.

Only HTTP(S) is supported by this optional plugin; the measured native profile
uses curl 8.7.1 on macOS, SHA-256
`5ef748580e05e8208c8faacc9be88d1aa48d9970101c0a29ba26896e017e6226`.
The default command bundle does not register curl; root/subpath alias identity
and zero runtime dependencies are independently checked. No native subprocess
invocation is present in network product TS. No built-package installation test
or full-repository suite was performed.

Explicit URL authorization is **not DNS/IP pinning or a complete SSRF sandbox**.
Dirac owns mutation/TOCTOU, pending policy cancellation/late rejection, transport
policy boundaries, URL parsing and DNS/SSRF review; this leaf adds no overlapping
sidecar cases and leaves that acceptance pending. Ignored host work may outlive
abort; cancellation cannot undo accepted effects. Download limits remain
per-response, shell-output limits cumulative, and the virtual total per-URL
deadline differs from native per-attempt timing. Native wire-header normalization
and declared stronger contracts retain the frozen profile, not universal parity.

The separate shell `head -n 0` before first nonempty output discussion remains
Sagan/Curie's; it is not relabeled native curl parity or used to indefinitely
block this bounded checkpoint. The remote 24/24 x3 result at `90ddc74`, evidence
`4a021a9`, belongs to its separate verifier and was not rerun or independently
certified here. Filesystem/mount gaps remain outside this report.

## Minimal public API

The example's equivalent source imports are typechecked in `api-example.ts`.
Package export mappings are inspected, not presented as a completed install test.
The host must provide a real allowed service; an optional injected transport can
replace the default Node HTTP client. `curlCommands` is the same plugin alias.

```ts
import { Shell, createMemoryFileSystem, agentCommands, networkCommands } from "virtual-bash";
import { curlCommands, type HttpTransport } from "virtual-bash/commands/network";

function createCurlShell(allowedOrigin: string, transport?: HttpTransport) {
  return new Shell({ fs: createMemoryFileSystem() })
    .use(agentCommands())
    .use(networkCommands({
      authorize: ({ url }) => new URL(url).origin === allowedOrigin,
      ...(transport ? { transport } : {}),
      limits: { maxTimeMs: 5000, maxDownloadBytes: 1024 * 1024 },
    }));
}

const shell = createCurlShell("http://127.0.0.1:8080");
try {
  const result = await shell.exec("curl -sS http://127.0.0.1:8080/ | cat");
  console.log(result.exitCode, result.stdout);
} finally {
  await shell.dispose();
}
```

## Commands and references

Every capture stores the exact expanded Node command, required environment, exit,
errors, raw outputs, source hashes and timing. Wrapper invocations used:

```sh
export CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300
export CURL_VERIFY_SOURCE_REVISION=aa2da57a5d1be8571f450a27c7b971245c1b7025
node tests/commands/network-stress/final-verification/run.mjs core core-1
node tests/commands/network-stress/final-verification/run.mjs supplement supplement-1
node tests/commands/network-stress/final-verification/run.mjs core core-2
node tests/commands/network-stress/final-verification/run.mjs supplement supplement-2
node tests/commands/network-stress/final-verification/run.mjs retry retry-1
node tests/commands/network-stress/final-verification/run.mjs lifecycle lifecycle-original
node tests/commands/network-stress/final-verification/run.mjs lifecycle-v2 lifecycle-v2
node tests/commands/network-stress/final-verification/run.mjs cleanup cleanup-100
node tests/commands/network-stress/final-verification/run.mjs author author-81
node tests/commands/network-stress/final-verification/run.mjs native native-original-replay
node tests/commands/network-stress/final-verification/run.mjs retry-replay retry-native-replay
node tests/commands/network-stress/final-verification/run.mjs independent independent-4
node tests/commands/network-stress/final-verification/run.mjs types scoped-types
node tests/commands/network-stress/final-verification/run.mjs types scoped-types-final
node tests/commands/network-stress/final-verification/run.mjs retry retry-2-stable
node tests/commands/network-stress/final-verification/run.mjs core core-3-current-shell
node tests/commands/network-stress/final-verification/run.mjs supplement supplement-3-current-shell
node tests/commands/network-stress/final-verification/run.mjs lifecycle-v2 lifecycle-v2-current-shell
node tests/commands/network-stress/final-verification/run.mjs retry retry-3-current-shell
node tests/commands/network-stress/final-verification/run.mjs types scoped-types-current-shell
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/final-verification/verify.mjs
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/final-verification/verify.mjs audit-final
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/final-verification/verify.mjs audit-complete
```

These evidence-producing commands **refuse existing output filenames**. Choose
new labels for future core/supplement/retry/type captures; do not rerun an immutable
capture intending to overwrite it. The new independent native freeze also refuses
replacement. Original parent capture commands and historical README stay unchanged.
The displayed exports are also set explicitly inside `run.mjs`; captures record
the actual environment, not an assumed inherited shell setting.

Primary official references reviewed August 26, 2026 via web tools:
`https://curl.se/docs/manpage.html` (retry, fail modes, output behavior and versioned
writeout/delay options), and
`https://raw.githubusercontent.com/curl/curl/curl-8_7_1/src/tool_operate.c`
(publication before retry, managed-file truncate/seek and retry sleep ordering).
The 8.7.1 writeout source was also inspected at
`https://raw.githubusercontent.com/curl/curl/curl-8_7_1/src/tool_writeout.c`.
The manual explains why redirected output cannot be reset like curl-managed files;
the installed executable supplies actual expected bytes, not a live-manual version
assumption. No live documentation was used to rebaseline the frozen corpus.
