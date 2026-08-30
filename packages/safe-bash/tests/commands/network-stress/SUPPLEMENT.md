# Additive independent fixture freeze

Completed comparison: `supplement-product.json` records **18/18 passed**:
8 native-parity, 5 separately defined security, 5 lifecycle. Network and shared
source hashes were stable during the run. See `REPORT.md` for evidence and limits.

This is a separate 18-case corpus, not a modification or replacement of the
original 60-case denominator. The 13 native observations in
`supplement-native.json` were captured before any supplementary product run;
all 13 captures settled successfully (including expected native failure codes).
`supplement-pins.json` pins the evidence artifact and controlled existing TLS
certificate/key. Native capture records hashes of all three supplementary TS
sources before/after; product execution refuses source changes. Existing TLS
fixture bytes were read, not author test logic; their hashes were recorded
immediately after native capture and before the product run. No trust store or
environment mutation is used. Scoped TypeScript passed, recorded in `types.json`.

## Predeclared comparison classes

Eight strict native-parity rows: multipart binary file, binary field, binary
stdin, hostile literal form-string, 307 multipart file replay, literal hostile
output path, default untrusted TLS, and default missing upload. Multipart wire
bytes are compared exactly after replacing only each generated boundary token;
part headers, CRLF, filenames and binary payload remain exact. Transport-owned
headers are preserved raw but excluded from semantic comparison, as in the
original profile. Default Accept, content-type and custom headers remain checked.

Five security contracts have native observations, not native-equality claims:
control-character URL rejection, multipart filename control rejection, explicit
authorization denial on redirect, permanent custom-header removal across an
origin crossing and return, and HTTPS-to-HTTP downgrade rejection. Native
observations include percent-escaped filename controls, forwarded custom headers,
and successful downgrade. Stricter product behavior is scored separately. For
rejections without a specifically documented numeric code, require nonzero,
correct diagnostic meaning, empty output and the exact allowed request count;
the observed numeric status is always retained. Redirect policy denial requires 7.

Five injected/default lifecycle contracts: response and upload backpressure,
default live upload and response cancellation, and late rejection from a host
transport ignoring its signal. Backpressure freezes pull counts while the first
consumer is blocked, then verifies all bytes after release. Cancellation checks
the exact supplied reason, peer socket closure and accepted partial upload bytes;
it is not native SIGINT equivalence or rollback. A runtime cannot forcibly stop
ignored callbacks; the deliberately late host task is awaited during cleanup.

## Execution and safety

```sh
node --unhandled-rejections=strict tests/commands/network-stress/capture.mjs supplement-native
node --unhandled-rejections=strict tests/commands/network-stress/capture.mjs supplement-product
node tests/commands/network-stress/watchdog.mjs typecheck
```

Capture commands refuse overwrites. Product-only console replay, with existing
frozen evidence, is:

```sh
CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300 node --unhandled-rejections=strict --import tsx tests/commands/network-stress/supplement.ts product
```

Native is argv-safe `/usr/bin/curl` 8.7.1 with `-q` first, clean environment,
proxy disabled, HTTP(S)-only protocols, loopback-only fixture URLs, per-child
six-second kill timers and bounded captured bytes. Its shared `profile()` reports
the original base profile as well; **each supplementary row's argv** is the
actual HTTP(S) profile, including explicit fixture CA only for downgrade.
No real credentials or external uploads are used. Generated native temporary
roots live solely beneath the owned directory and are removed in finally.

The product uses public Shell + agentCommands + explicit networkCommands, actual
VFS files and byte sinks. Ordinary supplementary rows omit `transport`, exercising
the default Node client. Downgrade uses the public Node transport with only the
fixture CA; three lifecycle rows use instrumented host transports. The source
root and network-subpath exports and alias identity are checked; package export
mapping is inspected, but this is not a built-package installation test.

Primary official reference consulted August 26, 2026:
`https://curl.se/docs/manpage.html` (form, form-string, location and retry).
The installed executable, not a live manual version assumption, supplies native
expected bytes. This is bounded independent evidence, not full curl/FS/Bash
parity, remote-adapter cancellation certification or a superiority claim.
