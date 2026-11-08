# Independent network baseline handoff

## Scope and immutable evidence

This leaf performed blackbox verification only. No product source, author test,
root documentation, other worker artifact or original frozen oracle code changed.
All five frozen files compare byte-identically to preparation commit
`06d1aecb1322954608857d3716d1af2085e793a5`: `oracle.json`, `rows.ts`, `lab.ts`,
`native.ts`, and `evidence.ts`. Original oracle SHA-256 remains
`b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7`.

Baseline evidence commit: `ea3f3b0c8eb0dd5542e15f845df252d8b53891f4`.
Supplementary native freeze commit (before supplementary product execution):
`3db9e30f9e34cc1360aa1ae13db9555237fd2db8`.
The final evidence commit containing this report adds supplementary outcomes and
the independent harness diagnostic without changing either frozen corpus.

Measured executions occurred August 26, 2026: baseline 22:42:34.720–22:42:39.137
UTC, supplementary native 22:47:30.166–22:47:31.048 UTC, supplementary product
22:48:46.773–22:48:47.523 UTC, diagnostic 22:49:36.178–22:49:36.605 UTC.
These are measured capture intervals, not 72 hours of work or scope completion.

## Counts, preserving failures

| Corpus/class | Pass | Fail | Pending |
| --- | ---: | ---: | ---: |
| Original native-parity product rows | 51 | 3 | 0 |
| Original separate security/lifecycle product rows | 6 | 0 | 0 |
| **Original total** | **57** | **3** | **0** |
| Supplementary native-parity product rows | 8 | 0 | 0 |
| Supplementary separate security product rows | 5 | 0 | 0 |
| Supplementary lifecycle product rows | 5 | 0 | 0 |
| **Supplementary total** | **18** | **0** | **0** |

The 13 supplementary native observations were captured successfully before any
supplementary product execution (13 transfer-process invocations plus one version
query). Native failure statuses, including 60 and 26, are expected observations,
not 13 successful HTTP transfers. Five security observations are not equality
oracles for deliberately stricter product contracts. No author 81-case suite,
broad suite, original native replay, or remote-cancellation audit was run.

## Findings for separate fix/review workers

1. **P1: real native-compatibility difference, two original rows.**
   `retry-get` and `retry-post-effect` return status 0 but emit only `ok\n`.
   Frozen native emits `retry-body\nok\n`. Exact base64 is respectively `b2sK`
   versus `cmV0cnktYm9keQpvawo=`. The failure is the unchanged stdout equality
   assertion in `product.ts:163`; methods, bodies, request counts and VFS bytes
   already match. The author README documents suppression before retry, so this
   is a disclosed profile difference, **not** a reason to remove strict-native
   failures. Root must decide the source behavior; this leaf made no fix.
   Reproducer arguments: `--retry 1 {A}/retry` and
   `--retry 1 -d effect {A}/retry`, through the frozen loopback lab and public
   `set -o pipefail; curl ... | cat` path. Both POST attempts reach the server
   with `effect`; accepted writes are not rolled back.
2. **P2: independently reproduced verifier cleanup race, one original row.**
   `missing-input-file` matches status 26, empty stdout, diagnostic meaning,
   unchanged files and empty HTTP trace, then fails `lab.ts:147` with one socket.
   `harness-diagnostic.ts:8` reproduces the exact assertion **1/20 times with no
   product import or execution**: the injected transport's upload iterator throws,
   followed by the same frozen lab cleanup. One event-loop turn then settles;
   all 20 diagnostic iterations have zero requests and no recovery error.
   Default transport missing-upload supplementation also passes without a peer
   leak. The frozen cleanup assertion can run before destroyed socket close
   events complete; this evidence supports verifier-race attribution, not a
   confirmed product leak. Original baseline remains 57/60, not retroactively
   58/60. A future separately reviewed harness correction can await actual socket
   close events without dropping resource checks; no frozen code was changed here.
3. **Security/lifecycle gaps closed only within this bounded profile.**
   Multipart binary file/field/stdin and 307 replay preserve exact normalized
   multipart bytes. Hostile literal form/output arguments do not execute shell
   substitutions. Redirect denial blocks the second request; custom headers stay
   stripped after origin crossing and return; trusted local HTTPS downgrade is
   rejected; default untrusted TLS returns 60. Exact native observations show
   why the security results are not native equality. Upload/response backpressure
   stop pulling at one blocked chunk. Default live cancellation closes peers and
   preserves the original outward reason; the accepted nine upload bytes remain
   accepted. Ignored host callbacks can outlive command timeout; late rejection
   is observed and cleanup waits for the intentionally bounded callback.

No shared-shell or filesystem source defect is newly established. Existing
S08/D08 and D02/D05 work remains owned elsewhere and is neither waived nor
reclassified by these local successes.

## Exact source identity, not merely HEAD

Every evidence capture asserts all nine network files match author revision
`deab14d9f4b3b6f0d73f96587c74a9de23091300`, and asserts identical network
hashes before and after execution. Network aggregate SHA-256 throughout:
`46a75e15c8e63054dac33d79be354eaf9a12bb3be96390c5f610519a065cfdc3`.
Aggregate means SHA-256 of JSON-encoded sorted `[path, file SHA-256]` pairs.
Full per-file network, shell, filesystem, contract, harness and entrypoint hashes
are retained in each machine artifact's `before.hashes` and `after.hashes`.

| Source group | Baseline aggregate SHA-256 | Supplement aggregate SHA-256 |
| --- | --- | --- |
| Shell | `b41d9c80d22828802777da01df851efc395a974eeb48e45485d497f2a5006f9b` | same |
| Filesystems | `72acbb5649a9667b0175cb5b76e43f9bf034d5d8ec373273b589afe8fb3bc1ff` | `ef01c9af9b136fa84e0ba824c6caf7ea60a748a3b974c265a55013847689b093` |
| Contracts | `d6bac36e065ff685247369bf2b22d90dbde778d643ea8bbe4338584298c46436` | same |

All recorded sources were stable within each run (`changes: []`). Mount and
overlay files changed **between** baseline and supplementary runs due to other
workers; tests here use memory VFS, not those adapters. The original dirty real
adapter is recorded in status/hashes, not falsely equated to committed HEAD.
Baseline HEAD was `b98e239374ccdb53860c88f41b06a4bc977ecc1d`; supplementary
product HEAD was the freeze commit `3db9e30f9e34cc1360aa1ae13db9555237fd2db8`.

## Commands and retained artifacts

```sh
CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300 node tests/commands/network-stress/watchdog.mjs product
CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300 node --unhandled-rejections=strict --import tsx tests/commands/network-stress/supplement.ts product
node --unhandled-rejections=strict --import tsx tests/commands/network-stress/harness-diagnostic.ts
node tests/commands/network-stress/watchdog.mjs typecheck
git diff --check -- tests/commands/network-stress
```

`baseline.json` is the immutable first failed run; `supplement-native.json` is
the pre-product native oracle pinned by `supplement-pins.json`;
`supplement-product.json` contains all 18 comparisons;
`harness-diagnostic.json` contains the 20 product-free repetitions.
`types.json` and `types-final.json` record both successful scoped typechecks.
The capture wrapper refuses overwrites; console replays do not rewrite evidence.
All commands use strict unhandled rejection mode, bounded children/settlements and
cleanup. Final capture hardening adds process-group termination and cleanup only
of newly created owned native temporary roots. No owned temporary roots remain.

## Harness change ledger

- Original frozen fixture, evidence and product comparison files are unchanged.
- Additive runner/lab/corpus were frozen by the native capture before product;
  hashes are checked on supplementary product entry. No native expected outcomes
  were revised after comparison.
- The supplementary lab awaits socket close events explicitly, rather than the
  original lab's immediate set-size assertion. This was designed before product
  comparison, not a post-failure assertion relaxation.
- Product-free diagnostic isolates the original cleanup race without fixing or
  suppressing it. A capture-mode template-literal typo caused one parse failure
  before any child ran; it was corrected before diagnostic execution. No product
  outcome, fixture or expected value was affected.
- Capture wrapper now records TLS fixture hashes, checks supplementary oracle
  pins, and supports final typecheck/diagnostic evidence modes. These changes do
  not affect product or native expected semantics.

## Minimal public API example for root

Derived from `src/commands/network/types.ts:43`,
`src/commands/network/index.ts:12`, and the actual public Shell integration:

```ts
import { Shell, agentCommands, createMemoryFileSystem, networkCommands } from "virtual-bash";

const origin = "http://127.0.0.1:8080";
const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(networkCommands({ authorize: ({ url }) => new URL(url).origin === origin }));
try {
  const result = await shell.exec(`curl --silent '${origin}/health'`);
  console.log(result.exitCode, result.stdoutBytes);
} finally {
  await shell.dispose();
}
```

The host must run the selected local endpoint. `transport` is optional;
`curlCommands` aliases `networkCommands`. Root/subtree export identity and the
`virtual-bash/commands/network` package export mapping were checked, not an
installed built-package import. Authorization is URL policy, not DNS/IP pinning.
These checks do not establish complete curl, full shell, cross-filesystem parity,
universal socket backpressure, production SSRF containment or superiority.
Stop here for a different source-fix leaf and a different independent verifier.
