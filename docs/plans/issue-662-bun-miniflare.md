# Issue 662: Bun-hosted Miniflare recreation

## Decision

For the macOS arm64 integration reported in [#662](https://github.com/poe-platform/poe-code/issues/662), use the verified Bun **1.4.2+744846f84** runtime with Miniflare **4.20260708.1** and workerd **1.20260708.1**. This combination completed the captured application's output-limit, disposal, and recreation sequence. It also completed recovery requests after each output-limit refusal.

This is a tested configuration, not a minimum supported Bun version or a guarantee for other platforms and fixtures. No SafeBash output limit, cancellation behavior, cleanup implementation, or deadline was changed. The comparison used an isolated Bun binary and preserved the normal installed runtime.

## Verified evidence

The September 10, 2026 macOS arm64 comparison changed the host runtime while retaining each fixture's bytes, Miniflare configuration, dependency pins, and deadlines. Every successful row completed all ten cycles; a partial run is a failure.

| Fixture | Bun 1.3.11-canary.1+687700d84 | Bun 1.4.2+744846f84 | Node 22.23.2 |
| --- | --- | --- | --- |
| Static Control C, no SafeBash | Two responses and disposals; readiness timed out at cycle 2 | Ten responses and disposals; exit 0 | Ten responses and disposals; exit 0 |
| Captured application, original runner | Six budget refusals and disposals; readiness timed out at cycle 6, with fd 3 Broken pipe | Ten budget refusals and disposals; exit 0 | Not repeated in this comparison |
| Captured application, response assertions and recovery observer | Six budget refusals, recoveries, and disposals; readiness timed out at cycle 6 | Ten validated budget refusals, recoveries, and disposals; exit 0 | Not repeated in this comparison |

Cycles are numbered from zero. Control C returned HTTP 200, body `ok`, header `x-read-bytes: 0`, and made no outbound requests. Its exact 1,053,988-byte Worker has SHA-256 `7b26032635dc0bc23da3b77fc7b3649c1781aadd6e6e90a09a7491614c3703dc`. The [public Control C generator and host runner](https://github.com/poe-platform/poe-code/issues/662#issuecomment-5579361819) provide the standalone upstream reproduction.

The captured application Worker was 1,730,124 bytes, SHA-256 `cbfed640c79f67ed97a476c4b8784bc869eafa6a81f29f6bae7e2b2bf14f077e`. Its source map identifies SafeBash/SafeFS 0.1.423; the recorded build used Wrangler 4.110.0. The exact runner had SHA-256 `0ac701b64b02a9a8e29c898799051b0b499b475cee11b60fee8b645f17809eeb`. Adding only response assertions and a recovery request produced runner SHA-256 `d8b88dd5f54067029040c5335eb5293d65cb3c732b99f7121a18209bea542a20`.

The application exercised a mocked 1 MiB binary response through `curl https://download.example.com/large | tee /keep.txt | wc -c`, with a 64 KiB output limit. The observer required HTTP 500 with the exact error `Shell limit exceeded: maxOutputBytes`, then HTTP 200 from `printf recovered` on the same Worker using a fresh shell, with stdout `recovered`, empty stderr, and exit code 0. Both new-runtime application runs had empty stderr. Every compared run preserved its input bindings and left no owned process group behind after supervisor cleanup.

The captured bundle corroborates the reported application failure but is not a signed build artifact. This experiment does not repeat the original unchanged-source SafeBash 0.1.70-to-0.1.423 upgrade comparison. It establishes a runtime workaround for the captured failure, not package-upgrade causality. Earlier intermittent Linux failures and later passing attempts remain valid observations.

## Upstream context

[Bun PR 32520](https://github.com/oven-sh/bun/pull/32520), merged June 20, fixes ownership of extra POSIX stdio descriptors used by `node:child_process`: a socket wrapper and subprocess finalizer could otherwise close the same descriptor. [Bun PR 33828](https://github.com/oven-sh/bun/pull/33828), merged July 10, addresses the related ownership transfer through the direct `Bun.spawn().stdio` getter.

These are relevant lifecycle defects, but the runtime comparison does not identify a single causal commit. A bisect would be needed for that attribution. A Broken pipe diagnostic alone also cannot distinguish the initial failure from a consequence of teardown. The failing static control shows that SafeBash execution and output aborts are not necessary for a recreation failure in the affected environment.

## Manual regression QA

1. Use an isolated directory and record OS, architecture, full Bun revision, Node version, and resolved Miniflare/workerd versions. Keep the recorded pins. Use an explicit runtime path; do not overwrite the user's installed runtime.
2. Generate Control C using the linked public reproduction. Verify its byte count and SHA-256 before running the same input under each runtime. Retain its compatibility date `2026-07-01`, `nodejs_compat` flag, inert outbound mock, and five-second cycle deadline. Require all ten response assertions and disposals, including zero outbound requests.
3. For application QA, preserve the Worker bundle and record its hash. A rebuilt bundle is a new fixture and must be reported as such. Keep compatibility date `2025-01-01` and flags `nodejs_compat_v2`, `global_fetch_strictly_public`, and `enable_nodejs_http_modules`, as in the issue's original runner. Preserve its mock bindings and transport.
4. Run ten sequential cycles. In each cycle, create a new Miniflare instance, await readiness, execute the original 1 MiB pipeline with the 64 KiB output limit, validate the exact budget refusal, validate the recovery request described above, and await disposal. Retain the original five-second deadline started after construction. Do not omit failure cases or extend deadlines to obtain a pass.
5. Run each host invocation under a bounded supervisor with a separate owned process group. The recorded comparisons used a 60-second outer bound and unconditional cleanup of owned descendants after either success or failure. Retain stdout, stderr, exit status, cycle counts, and before/after input hashes. Confirm that owned processes are gone before starting another runtime comparison.
6. Accept only ten fully validated cycles with exit 0. Preserve intermittent failures alongside successful attempts. A Node pass is comparison evidence; the Bun path must pass independently. Report newly failing runtime/fixture combinations with their exact inputs before changing SafeBash cleanup.

This document records already-executed diagnostics and their manual repeat procedure. No new production code or automated QA script is needed for the verified runtime workaround.
