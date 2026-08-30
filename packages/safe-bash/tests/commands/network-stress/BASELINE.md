# First independent product baseline

Captured after the authentic user handoff, against network source identical to
`deab14d9f4b3b6f0d73f96587c74a9de23091300`, while HEAD was
`b98e239374ccdb53860c88f41b06a4bc977ecc1d`. Network tree digest (SHA-256 of
JSON-encoded sorted `[path, file SHA-256]` pairs):
`46a75e15c8e63054dac33d79be354eaf9a12bb3be96390c5f610519a065cfdc3`.
`baseline.json` records every network, shell, FS, contract and harness file hash
before and after, exact outputs, request/file bytes, command, times, and exit.
All recorded files stayed unchanged during this run. The preexisting dirty real
FS source is recorded rather than misrepresented as committed HEAD content.

Original frozen oracle remains SHA-256
`b1b51398c3fb51a275ffb8f5d344c2c105fb077719674e44f297e7d66cdc21d7`.
No expectations, frozen fixture code, or product source were edited.

## Unmodified denominator

- 60 executed: 57 passed, 3 failed, 0 pending.
- Strict native-parity: 51/54 passed, 3 failed.
- Separately defined security/lifecycle: 6/6 passed.
- `retry-get` and `retry-post-effect`: actual stdout `ok\n`, native expected
  `retry-body\nok\n`; both status 0. Two outgoing requests match native, including
  both accepted POST bodies. Retried writes are not rolled back. This is a real
  compatibility difference, also consistent with the author's documented
  before-publication retry policy, not a harness excuse to remove failures.
- `missing-input-file`: status 26, diagnostic, stdout, files and request trace
  assertions pass, but fixture cleanup asserts one socket remains. This is
  **not yet a confirmed product leak**: the frozen lab asserts immediately after
  `server.close` while destroyed socket close events can be pending. Preserve
  the failed result; independent default-transport coverage and a separate
  verifier-lifecycle diagnostic are needed before attribution.

Later evidence (original result unchanged): `harness-diagnostic.json` reproduces
that exact cleanup assertion 1/20 times without importing or executing product
code; deferred socket close events then settle. `supplement-product.json` also
passes the default-transport missing-upload row. See `REPORT.md` for attribution.

## Reproduce without overwriting evidence

```sh
CURL_VERIFY_AFTER_HANDOFF=deab14d9f4b3b6f0d73f96587c74a9de23091300 node tests/commands/network-stress/watchdog.mjs product
```

Initial evidence capture used
`node --unhandled-rejections=strict tests/commands/network-stress/capture.mjs baseline`.
It refuses to overwrite the retained baseline. The existing early-head rows
passed here; that does not resolve another worker's S08/D08 matrix or establish
remote-adapter cancellation. Outward AbortSignal and native SIGINT are separate
contracts. No full curl/FS/Bash parity or superiority is certified.
