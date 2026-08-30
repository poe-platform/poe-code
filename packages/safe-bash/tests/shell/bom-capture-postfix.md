# Independent BOM capture post-fix review

**2026-08-27 — scoped fix verified, frozen suite still 63/64.**

Reviewed `abdc741c22a3c974f3f3ec00ed8a5caa9f2cf6ac`, after invocation source
checkpoint `3aa3a4110c09fbab48d9aa8a8d762f48c8ce56cc`. The only production diff
against its parent `22171fc27b39cc6ad5c10f95e5b869ec7038b0a7` changes the two
final stdout/stderr `TextDecoder` constructors to UTF-8 with `ignoreBOM: true`.
No `collectText`, JSON parser, capture-byte, sink, budget, or cancellation code
changes occur in that diff. This review edits no production or author-proof
files and leaves the original three `d8d0f12` BOM files byte-for-byte intact.

## Single bounded run

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/bom-capture.test.ts
```

Node v22.22.2; one run, no retry. The test process had a 15-second limit and
the complete verification process a 25-second limit. All processes completed.

- **64 tests: 63 pass, 1 fail; zero skips, todos, or cancellations.**
- **All 16 formerly failing BOM-preservation tests now pass.** Unicode,
  split/empty/repeated chunks, repeated executions and string/byte inputs remain
  covered by the unchanged tests.
- **All 22 byte-field/external-sink tests pass.** Invalid UTF-8 replacement,
  interior BOM, literal binary bytes, output-cap and pre-abort controls pass.
- Decoder baselines and direct `JSON.parse` control pass. The plugin control
  passes plain JSON before reaching its stale exact diagnostic assertion.

The author-reported immediate pre-fix baseline is 47/64 (16 BOM failures and
one jq diagnostic mismatch); that full baseline was not rerun here. Earlier
independent 48/64 and 47/64 checkpoints remain preserved in the original
`bom-capture-evidence.json`, not overwritten or reclassified.

## Remaining exact failure: separate jq owner review

Test: `existing jq plugin retains its own JSON input decoding`.

```text
expected: "jq: invalid JSON input at offset 0\n"
actual:   "jq: parse error: Invalid numeric literal at line 1, column 4\n"
```

For an independent before/after check, the exact parent `shell.ts` was
transpiled and imported entirely in memory, with imports bound to current
TypeScript dependencies. The fixed shell was imported from its actual `.ts`
file and matched the shell index export by identity. Source hashes and runtime
function checks distinguish zero versus two preserving decoder constructors.
This isolates the capture change; it does not reconstruct all historical
parent dependencies and does not invoke the product's source/dot/eval commands.

Only the three existing JSON inputs were checked for each shell. **Every
status, text field, byte field and external-sink byte sequence matched before
and after**:

| Input | Exit | stdout hex | stderr |
| --- | --- | --- | --- |
| Plain JSON string | 0 | `7b226f6b223a317d0a` | empty |
| BOM JSON string | 5 | empty | actual diagnostic above |
| BOM JSON bytes | 5 | empty | actual diagnostic above |

Both BOM diagnostics have identical hex before/after:

```text
6a713a207061727365206572726f723a20496e76616c6964206e756d65726963206c69746572616c206174206c696e6520312c20636f6c756d6e20340a
```

Thus the capture fix did not change these JSON semantics. The remaining
diagnostic-control obsolescence belongs with root/Archimedes for review, not a
JSON source fix or automatic expectation revision. The frozen assertion was
not edited, skipped, weakened, or marked expected-failure. **Not 64/64.**

## Guard, evidence and limits

Raw TAP, test outcomes, before/after JSON rows, exact parent diff, executable
probe, import proof and SHA-256 manifest are in `bom-capture-postfix.json`.
HEAD stayed `319299e7d24be17bed990242d605a4fc37d0d305` during verification.
All **482** endpoint entries matched: 156 source files, 318 installed dependency
files/symlinks, and eight frozen evidence/configuration paths. The shell source
hash is `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`;
runtime hash remains the invocation checkpoint's
`8af9bb685fee68e6f199e1ebf9613ac8da50572f357fd98599e570d30810e820`.

This guard cannot exclude transient write/revert. Current dependencies include
foreign filesystem work; this is not a clean-product or global-green claim.
Transpilation/import proof is not a typecheck or built-package check. No native,
full, first-read, tar, invocation-closure, broad jq, or source/dot/eval suites
were run. No delegated agents or watchers remain. Tar's earlier byte evidence
is unaffected; no tar byte failure is inferred.

Policy basis remains the primary WHATWG Encoding and official Node TextDecoder
sources recorded in `BOM_CAPTURE.md`: preserving a decoded initial U+FEFF uses
`ignoreBOM: true`, while default replacement decoding remains unchanged.
No new interface/API or broader shell-compatibility claim is made.
