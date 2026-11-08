# Curl retry fix: implementer handoff, not final acceptance

Source is stable for a **different final independent verifier**. This leaf owned
only `src/commands/network/**` and `tests/commands/network-stress/**`. It did not
delegate, change author expectations, edit root/package/shared shell/FS, or run
the separate remote audit. No overall curl/Bash acceptance, superiority or
72-hour completion is certified.

## Atomic checkpoints and exact identity

- Harness-only correction: `7f7ccfbdf684ed8b75388c5aef4fefea8a2e680f`.
- Additive native freeze before source edits: `3b63f98a785b84d78bbc4080ea475ee426b471e2`.
- Source fix and targeted comparison runner: `aa2da57a5d1be8571f450a27c7b971245c1b7025`.
- The subsequent evidence commit contains this handoff and captured outcomes;
  it does not change the network source checkpoint.

Network tree digest is SHA-256 of JSON-encoded sorted `[path, file SHA-256]` pairs,
including the network README:

| Identity | SHA-256 |
| --- | --- |
| Original handoff network tree | `46a75e15c8e63054dac33d79be354eaf9a12bb3be96390c5f610519a065cfdc3` |
| Fixed network tree | `886d7b03e4b280ab90bb1385f199f363c13349e3fe439fee0777bd274a1499a4` |
| Original curl.ts | `eb3683ae45b3f236e1929ddd67398baa8df5a901d4a0275df793b4dbb3e8236d` |
| Fixed curl.ts | `4859cc27a94d4ffe74ecadf20280d5d519d85babc50d24f55b9c51357c2dca42` |
| Fixed network README | `41e75f9ae587e63a61344df06b0cb518eae1f1d5eab155fd5892026c8c1ccb0f` |
| Unchanged original oracle | `b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7` |
| Additive retry native freeze | `7a84039e93c52bbc63d0f776963dbee518082a0d6a7c39541530e5930bc1660c` |

All postfix captures record the fixed tree before/after, source match to the
explicit committed revision, exit, exact command, raw output and file hashes.
Every listed capture reports `networkStable: true` and `changes: []`. Shared
working-tree state is recorded, not silently described as a clean checkout.

## Results without changing historical denominators

| Corpus | Historical result retained | New result | Evidence |
| --- | --- | --- | --- |
| Original native parity | 51/54 | 54/54 | `postfix60.json` |
| Original security/lifecycle | 6/6 | 6/6 | `postfix60.json` |
| Original total | **57/60, three failures** | **60/60, corrected lab** | `baseline.json`, `postfix60.json` |
| Supplement native parity | 8/8 | 8/8 | `postfix18.json` |
| Supplement security/lifecycle | 10/10 | 10/10 | `postfix18.json` |
| Supplement total | 18/18 | 18/18 | `supplement-product.json`, `postfix18.json` |
| Additive retry native parity | No old product baseline | 18/18 | `retry-product.json` |
| Additive injected retry lifecycle | First harness attempt 14/15 | Corrected 15/15 | `retry-lifecycle.json`, `retry-lifecycle-v2.json` |
| Unchanged author suite | Author reported 81/81 at handoff | **80/81, one failure** | `author-postfix.json` |

The new 60/60 does not retroactively turn 57/60 into 58/60 or 60/60. Two original
failures are fixed native stdout mismatches; the third used the separately
corrected event-driven lab. Original reports, oracle, fixture source, baseline
JSON, supplementary freeze and product evidence remain immutable.

`cleanup-final.json`: 3 discriminating resource selfchecks plus 100 product-free
failing-upload iterations pass, zero requests. `provenance-selfcheck.json`: 3
exact runner/lab transformation checks and 3 source-gate checks pass, including
rejection of `HEAD` and rejection of the original revision against changed code.
`types-postfix.json` and `types-final-postfix.json`: owned stress tsconfig passes
strict TypeScript, including its imported public API dependency graph. This is
not a whole-repository typecheck. No broad FS/shell suites were run.

Measured UTC captures on August 26, 2026: native freeze 22:58:45.234–22:59:01.960;
targeted retry product 23:01:29.904–23:01:46.985; original 60-row replay
23:01:41.486–23:01:46.119; supplement 23:01:46.453–23:01:47.419;
corrected lifecycle 23:05:17.060–23:05:18.771; final scoped types
23:06:23.537–23:06:25.084. These intervals are measured work, not 72 hours.

## Root cause and bounded changes

`src/commands/network/curl.ts:207` now processes each completed response inside
the attempt loop, before deciding to retry. Stdout and `-o -` retain earlier
attempt bodies/headers, including when stdout is piped or shell-redirected.
Per-attempt download counters preserve final `size_download` and response quotas.
Curl-managed output files are actually written, then reset before retry sleep
if bytes were published. Reset failures return 23 without another request.
Denied retries, timeout and cancellation preserve the already-observed effects;
accepted POST requests can execute twice and are not rolled back.

`--fail` suppresses error bodies but preserves included headers; `--fail-with-body`
publishes bodies. Header dumps append across attempts. Retry-exhaustion status,
per-failed-attempt diagnostic codes/counts and final write-out match the additive
native rows. Partial bodies, quota errors and output errors stop without replay.
The source README explains the stdout/file distinction and preserved deadline
profile. Only `curl.ts` and that README changed under product source.

The 15 injected cases cover blocked response output without read-ahead/retry,
sink rejection, caller reason identity, body and retry-sleep timeout/cancellation,
partial stdout/file state, unknown-length response quota, cumulative shell output
quota, denied retry file state with/without `--fail`, reset write failure,
writeFile/append fallback, and shell redirection. They are separate contracts,
not native equality or remote-provider coverage.

## Retained failures and precise follow-up

1. Author `tests/commands/network/http.test.ts:72` still expects
   `recovered:2`; actual is `retryretryrecovered:2`. The author server sends two
   `retry` bodies before `recovered` (`helpers.ts:73`). This is precisely the
   old before-publication suppression contract. The responsible owner should
   independently review changing that expectation; this leaf did not edit it.
   All other 80 author checks pass. Do not report the author suite as green.
2. First additive lifecycle harness assumed `ShellResult.stdout` excluded a
   rejected external sink write. `src/shell/shell.ts:74` explicitly captures
   before invoking the external sink. Thus the result contains `first\n`, while
   the rejecting external sink accepts zero bytes. Curl returns 23, makes one
   request and disposes the response. This is a harness observation-boundary
   correction, not a shell/product fix. Original source/result are retained.
   V2 changes only that expected capture and adds a zero external-byte assertion:
   old source SHA `47d9134a777134cce76581193b23c76bb85a190b61049fcd11016a4cc9d563aa`,
   new SHA `02ac39b27fb5f12c1c3e7a4ce8371b3c5a022476608347860388f7cd406e4e93`.
3. Initial additive native preparation failed after two rows because a reused
   helper assumed successful final status required empty stderr. Native fail-mode
   retries emit intermediate diagnostics. `retry-native.json` remains failed;
   the complete separately pinned freeze precedes all source edits. See
   `RETRY-FREEZE.md` for the exact correction and official reference provenance.

The original safety profile is untouched: explicit opt-in, authorization for
every hop/retry, permanent cross-origin stripping of credentials/custom headers,
no HTTPS downgrade, VFS-only curl file access, and zero runtime dependencies.
The default Node transport is not a DNS-pinned sandbox. Host callbacks can ignore
cancellation; cancellation cannot undo remote effects. The total per-URL deadline
is deliberately stricter than native per-attempt timeout behavior. No new flags,
native subprocess product code, ambient networking or security exceptions were
added. No built-package installation check was performed. Final independent
verification remains pending.

## Minimal public API and replay

With a host-controlled HTTP service listening on `127.0.0.1:8080`:

```ts
import { Shell, createMemoryFileSystem, agentCommands, networkCommands } from "virtual-bash";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(networkCommands({
    authorize: ({ url }) => new URL(url).origin === "http://127.0.0.1:8080",
  }));
try {
  const result = await shell.exec("curl -sS http://127.0.0.1:8080/ | cat");
  console.log(result.exitCode, result.stdout);
} finally {
  await shell.dispose();
}
```

`curlCommands` is the same plugin alias. `transport` and `limits` remain optional
host-injected options. The actual comparisons exercise public Shell + aggregate
agentCommands + explicit networkCommands; no internal command fallback is used.

Console replays (do not overwrite captures):

```sh
export CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300
export CURL_VERIFY_SOURCE_REVISION=aa2da57a5d1be8571f450a27c7b971245c1b7025
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/product-v2.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/supplement-v2.ts product
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/retry-product.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/retry-lifecycle-v2.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/cleanup-selfcheck.ts
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/provenance-selfcheck.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/commands/network-stress/tsconfig.json
```

The unchanged `watchdog.mjs product` deliberately retains its historical runner;
use the explicit versioned runner for corrected cleanup. `capture-v2.mjs` adds
an outer process-group watchdog, records hashes and refuses evidence overwrites.
