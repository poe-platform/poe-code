# Current encoding capability independent review

Reviewed the current candidate after the root-owned import capability change in
`packages/ssconvert/src/encoding/decode.ts`. The separate reviewer owns only
`encoding-current-independent.test.ts` and this report; exports, integration and
Git remain root-owned. Existing edits were preserved. No implementation defect
was reproduced in this review, so no implementation repair was made.

## Deterministic checks

The direct, fresh command
`npx vitest run packages/ssconvert/src/encoding-current-independent.test.ts`
passed all 29 cases on 2026-09-20. Runtime test time was 6 ms; this is an observed
bounded run, not a performance guarantee. These tests use original in-memory
bytes and injected configuration, without native processes, disk fixtures,
ambient environment changes or LLM calls.

- Ten native-only alias negative controls refuse capability even for ASCII
  payloads: WINDOWS-31J, CP932, CSISO2022JP, GB18030, EUC-KR, JOHAB, BIG5-HKSCS,
  SHIFT_JISX0213, IBM-930 and UTF-7-IMAP. Refusal is a gap check, not an encoding
  parity pass.
- Four unknown-label controls retain UTF-8 guessing instead of normalizing
  punctuation/whitespace into a recognized native converter.
- Four import suffix controls refuse unmeasured modifier semantics.
- Five sliced-byte controls independently check byteOffset/byteLength boundaries
  and consumed-prefix handling for truncated UTF-8, UTF-16 and UTF-32 tails.
- One foreign-realm UTF-32 typed-array view exercises decoding without a host
  `instanceof Uint8Array` admission dependency. This is a value boundary check,
  not a sandbox or host authority qualification.
- Five locale controls exercise nonempty LC_ALL masking, explicitly empty
  LC_ALL with different categories, POSIX/C.utf8 canonicalization, and explicit
  unavailable category requests overriding an available LANG. Input
  configuration remains unchanged.

The maintained package test/lint/build and virtual-command integration results
are root-owned and must be reported separately. The direct selected-file run
does not substitute for those gates.

## Limits and remaining cells

This review did not invoke the native oracle; newly added tests independently
stress candidate invariants and negative capability controls rather than adding
new native differential facts. Existing captured byte/diagnostic expectations
and prior independent reviews remain separately recorded. Native-only encoders
and decoders, uncaptured locales, unmeasured modifier semantics, arbitrary
context-sensitive transliteration sequences and malformed SDK strings remain
outside this review's verified native parity. The tests do not qualify all
possible invalid/truncated sequences.

Cancellation, exact output budgets, memfs destination preservation and SDK/CLI
publication behavior are exercised in existing independent stress files, not
newly duplicated here. Original/checkpoint/replay shell execution, rollback,
cleanup, screenshots and broader realm/host authority are not newly measured by
this report. No skipped case or unavailable matrix cell is counted as a pass.
