# Spreadsheet conversion

Convert spreadsheets through the `poe-code/ssconvert` SDK on Node.js 22 or newer.
The engine provides spreadsheet import and export, recalculation, workbook updates,
and chart and print rendering. The optional `pythonSampleFunctions` binding adds
percent formatting through `PY_PRINTF`; supply it as `runtimeFunctions` to enable
the sample functions. It also opens XOR-obfuscated and RC4-encrypted Excel workbooks (standard and CryptoAPI)
using the native reader's built-in password or an explicit host `password.read` callback. AES/Blowfish-encrypted OpenDocument spreadsheets open through the same host callback. Encrypted Paradox tables open automatically using their declared header key. Format support has documented limits; see the
[usage guide](../../docs/ssconvert/usage-draft.md) for examples and capabilities.

```ts
import { createEngine } from "poe-code/ssconvert";

const engine = createEngine({
  codecs: [],
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: {
    inputBytes: 1_000_000, outputBytes: 1_000_000,
    cells: 10_000, sheets: 16, operations: 100
  }
});
try {
  console.log(engine.listServices("read"));
  console.log(engine.listServices("write"));
} finally {
  await engine.dispose();
}
```

Filesystem and network access require explicit host bindings. The engine never
uses a native spreadsheet converter as a fallback. Safe Bash provides a separate,
opt-in `ssconvertCommands` plugin using the same engine.

This workspace is private and is distributed through the `poe-code` SDK subpath.

For encrypted BIFF imports, `createEngine({ ...config, password: { read: readWorkbookPassword } })` asks only after the built-in password fails. The callback receives the algorithm, revision, input filename when available, encoding, maximum byte length and invocation cancellation signal. Return a string or UTF-16LE bytes for RC4 (up to 255 UTF-16 code units); XOR requires explicitly encoded bytes (0–15). Return `undefined` to decline. Passwords never come from command arguments or guest environment variables, and callback failures produce a sanitized diagnostic. OpenDocument AES-CBC and Blowfish-CFB8 imports accept UTF-8 strings or bytes through this callback, supporting AES128/192/256 and Blowfish4–56-byte keys, SHA1/SHA256 start keys and prefix/full checksums. The callback runs once after every encrypted member is admitted; malformed Unicode is rejected. All encrypted members are verified before conversion. Encryption is read-only; exports contain plaintext. BIFF ciphers and ODF encryption checksums do not authenticate workbook data; ODF prefix checksums cover only the first 1024 compressed bytes. Mixed AES/Blowfish packages are supported; the callback request identifies `mixed`.
