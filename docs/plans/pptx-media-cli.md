# Media inventory command integration

Owned scope: media list/get integration, the media result schema, public SDK export,
original command and safe-bash adapter tests. Domain parsing remains in media.ts.
Existing image replacement edits in command-engine.ts, index.ts and discovery
assertions are preserved and excluded from this task's staged diff.

TDD evidence: both original command tests failed before implementation because
media.list was unsupported (wrong operation hint inspect). After integration,
both pass. Tests use original minimal archives and memfs; no downloads.

Contract: one input, common JSON envelopes and limits, all admitted explicit media
scopes, one-based slide plus shape name or opaque token. Get requires one
occurrence; list may return none. Both preserve all relationship bindings. Schema
is closed through relationships, metadata, occurrences and media parts.
Metadata parsing does not prove playback. External targets remain inert.

QA procedure: build selected pptx workspace; run focused command tests and the
maintained safe-bash reporter for media-inventory.test.ts. Verify nonempty JSON
against published schema and independent poster/hash/relationship/timing fields.
Capture media help with the maintained generic screenshot command using the
explicit engine and Shell plugin, inspect the PNG, retain it only under .cache.
No slide playback or renderer acceptance is inferred from terminal QA.

Safe-bash style procedure follows the root-authorized existing guard API described
in pptx-advanced-chart-cli.md: bootstrap bindings, unchanged config, one-shot
begin, all 25 receipts, classify exact subject, read subject once, lint admitted
bytes. This is a changed-file check, not a full-root lint claim.

Validation: selected maintained pptx build passed. Final adapter checks and
screenshot evidence follow below. Root coordinates atomic staging and commits;
this worker does not commit, push or release.

Final CLI evidence: selected maintained build completed; command tests 2/2 pass;
maintained adapter reporter 3/3 pass. Adapter assertions cover inert local-file
links, SDK parity, stdin, output-budget failure, dual media bindings to one part,
independent SHA-256, poster, raw trim/volume, caption track relationships, closed
nonempty result schema and escaped newline names. A tentative caption fixture
failed because its element was outside the documented track namespace; the
original fixture now uses the documented tracksInfo/track structure. This did not
justify changing parsing to accept an invented caption dialect.

Terminal screenshot `.cache/pptx-media-help.png` was inspected: complete legible
help, common selectors, explicit scopes and playback limitation, with no clipping.
It remains disposable and uncommitted. No binary QA fixtures are added.

Focused final adapter lint: zero errors/warnings/messages; 25 receipts verified;
one subject, 8,492 bytes; 2,009 opens and closes; receiptsComplete true, failed
false. SHA-256 e109e060aa9d3c53cc85eb55f53bea0cab72a66a5b9a3d3cf1bcaec0e6984f18.
Discovery current type-accounting and default normal runner literal inclusion
checks passed. Package-wide checks are coordinated and recorded by root.

Focused discovery-file lint also passed through a fresh guard invocation with
zero errors/warnings/messages, 25 receipts, one 220,318-byte subject, 2,009 matched
opens/closes, receiptsComplete true and failed false. Whole working-file SHA-256:
82da7b1a09745c7e6c2e620f46d0e408f818719311480dab9e776157da36db03.
Only the new literal media test-discovery assertion is owned for staging; the
existing image-replacement assertion remains unrelated work.
