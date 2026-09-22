# PDF filters candidate QA

Scope: stream filters only. No command exports, rendering, encryption, page/text
semantics, filtered xref bootstrap or object-stream indexing are qualified here.
Run all fixtures in memory; do not invoke native compressors or PDF oracles.

1. Run `npm run test:unit --workspace=pdf-parser`. Inspect failures and skips
   separately. Include trailing-data/checksum negatives for stored, fixed and
   dynamic Flate and saturated LZW dictionaries for both EarlyChange values.
2. Run `npm run lint --workspace=pdf-parser` and
   `npm run build:workspaces -- --workspace=pdf-parser --no-cache`.
3. Import the built public SDK entry in Node. Decode the original empty zlib
   fixture `78 9c 03 00 00 00 00 01`, with and without trailing bytes. Require
   empty output and exact raw preservation. Corrupt its checksum; require
   `SYNTAX`, even with trailing bytes. Chain ASCIIHex then Flate and verify
   cumulative expansion denies a budget smaller than the intermediate output.
4. Bundle the source entry as a browser IIFE in memory. Require every input to
   reside in `packages/pdf-parser/src` and zero external imports. Execute in an
   isolated Node VM without supplied process, Buffer, require or fetch. Check
   ASCIIHex/RunLength order, owned raw copies, shared expansion, falsey
   cancellation reasons and explicit JPX preservation. This is conditional
   graph evidence; it does not qualify an actual browser/workerd runtime.
5. Review source paths for ambient acquisition and source license provenance.
   No caller file, network, native process or external decoder authority is
   admitted. Verify only task edits and retain other contributor changes.

No visible CLI change: CLI screenshots are inapplicable. This API has no
checkpoint/replay state; SafeJS replay and shipped Safe Bash command artifacts
remain dependent integration gates. No performance qualification is inferred
from deterministic tests or the VM's control timeout. No temporary files are
needed; leave no generated evidence to clean up.
