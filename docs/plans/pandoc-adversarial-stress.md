# Original converter adversarial stress

Use deterministic, capped original inputs only. Keep unit mutations in memfs;
exercise the SDK and registered safe-bash command without native fallbacks.
Preserve unrelated working-tree changes. Local atomic commits only; no push.

## Procedure

1. Reproduce lifecycle failures with cooperative deferred gates, then fix them
   in the owning package. Assert no writes, no later acquisition and exactly-once
   cleanup where the supplied capability contract permits it.
2. Exercise delimiter/bracket runs, nested lists/HTML/JSON, attributes, entities,
   references, sparse tables, spans, escaping, aliases and malformed decoders.
3. Exercise LaTeX and RST cycles, malformed RTF/binary counts/code pages, EPUB
   decompression/entities/spine dependencies and PDF font/layout admission.
4. Verify cancellation inside each parser/renderer using injected scheduler
   checkpoints, never a timeout race as evidence of CPU termination.
5. Run focused maintained unit/lint/build routes. Keep heavier capped growth
   measurements in an explicit lane and report CPU/allocation budget accounting;
   do not promise total-process RSS bounds.

## Status

Initial inspection: the SDK has finite counters; lifecycle and parser growth
acceptance is not yet established. DOCX/XLSX have no built-in enabled adapter;
PPTX is enabled and uses the sibling public API. Existing evidence is unrelated.

JSON reproduction: direct reader token admission reached an invalid suffix with
`E_AST` without yielding; the original cancellation test expected `E_CANCELLED`.
Replace synchronous visit/JSON.parse with cooperative strict JSON parsing,
reserving intermediate nodes, slots and decoded token ownership before growth.
Test cancellation inside long strings/numbers/whitespace as well as containers.
Preserve exact integer checks and duplicate-key rejection.

Verified JSON milestone: maintained pandoc unit route (979 tests), package lint
including source/test typechecks, and selected workspace build closure passed.
Evidence: `docs/pandoc/adversarial-json-{unit,lint,build}.log`.

Streaming preflight is intentionally lazy: existing canonical tests require no
abort before acquisition. Retain that contract; no lifecycle change is justified
by the initial supplied-sink experiment.

RST reproduction: a direct 2048-unit paragraph finished without any scheduler
checkpoint; 256 opening brackets also bypassed the documented search work
accounting, and an inline node ceiling of four was not admitted before growth.
Inline resolution is now awaited, scans cooperate, and output nodes/slots/text
reservations precede growth. Original cycle and malformed-RTF tests retain their
existing exact errors. Maintained pandoc units (1013 tests), lint/typechecks and
selected workspace build passed; see `adversarial-rst-*` evidence.

PDF cancellation reproduction: a direct writer checkpoint aborted the signal,
but the sibling font path normalized that callback rejection to `E_CAPABILITY`.
The adapter now checks its sticky session failure before mapping sibling errors.
Canonical tests assert `E_CANCELLED` and no sink acquisition/writes/close.
Final maintained pandoc unit route passed 1043 tests; package lint/typechecks and
selected workspace build passed. See `adversarial-final-{unit,lint,build}.log`.

PPTX resource reproduction: a text-only original presentation succeeded with a
1024-byte resource ceiling despite larger ZIP expansion. Public sibling archive
entry/total ceilings now include resource and retained-byte ceilings, with a
zero-capacity guard before acquisition. Archive adversarial units pass for ZIP
amplification, compressed/expanded/part/resource/XML/reference ceilings, EPUB DTD,
duplicate spine and fallback cycles, malformed sfnt directories/locations,
oversized mapped glyph IDs, zero advance and impossible page geometry.
PPTX cancellation is injected at an acquisition boundary and verified through
the signal passed to the next sibling API call. No Office native fallback exists.
See `adversarial-office-resource-before.log` and `adversarial-archive-focused.log`.

LaTeX reproduction: a 1024-character lexical run reached a forbidden suffix
without yielding; macro expansion admitted 2048 replacement bytes before its
first yield. Lexical runs/math/verbatim/comments and definition/expansion scans
now cooperate while advancing. Token nodes, slots and source/raw ownership are
reserved before growth. Reuse the already parsed optional list-label token.
Both new regressions and all 47 existing reader units pass; the final maintained
unit/lint/build evidence above includes this change. See `adversarial-latex-*`.
