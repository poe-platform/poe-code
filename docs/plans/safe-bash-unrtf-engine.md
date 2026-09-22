# unrtf engine admission and verification

Engine owner: `packages/safe-bash-command-unrtf` (private, ESM, zero runtime
and workspace dependencies). Public entry:
`@poe-platform/safe-bash/commands/unrtf`. The safe-bash source only exports the
engine; its maintained private workspace profile admits bundling implementation
and recursive declarations. Use the archived package pattern at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its former location
was already deleted when this task started.

The pinned GNU source baseline is 0.21.10, archive SHA256
`b49f20211fa69fff97d42d6e782a62d7e2da670b064951f14bbff968c93734ae`.
This implementation admits **standards-strict extraction**, not native rendering.
The supplied source observations establish the deliberate corrections below;
no new native invocation or native output-parity claim is made here.

| Cell | Engine contract |
| --- | --- |
| Binary raw bytes | Exact count across chunks including braces, slash, NUL, CR, LF and TAB; preserve suffix for file/stdin alike; truncation `E_PARSE`, status 1 |
| Unicode | Scoped `uc` fallback-byte count, signed `u` units, surrogate combination; unpaired units `E_ENCODING`, status 1 |
| Malformed documents | Reject plain text, missing root/header, unterminated groups, malformed hex, invalid/overflowed binary counts with `E_PARSE`, status 1 |
| Legacy/recovery profiles | Explicit `E_PROFILE`, status 1, before pulling input; not silently treated as strict |
| Encoding | Fatal realm WHATWG codecs; explicit inventory and source fcharset table; unknown/unavailable codec `E_CODEC`, status 1 |
| DBCS | Preserve complete prefixes before error, keep pending bytes over formatting, flush/reject incomplete bytes at group/font/page/Unicode boundaries |
| Fonts | Read declarations, explicit cpg precedence, charset-1/default page fallback, exact Symbol override; Symbol codec unavailable explicitly |
| Destinations | Objects, pictures, instruction URLs/macros, metadata and starred destinations skipped; field result text survives; no execution, fetch or exports |
| Resource bounds | Input, estimated retained chunk/group/font storage, spelling, tokens, depth, raw binary/image bytes, images, decoded/output UTF-8 bytes and work; exhaustion `E_LIMIT`, status 1 |
| Lifetime | Snapshot limits, invocation-local decoder/font/group state, abortable pending pulls, bounded scheduling cooperation, iterator return on failure/early return |
| Renderer boundary | Group/font/control/skipped/text events; unhandled control words remain visible; no generic HTML substitution |

Pandoc's current parser is a retained-buffer tree coupled to Pandoc adapter
contracts; its existing tests do not establish streaming skip, six-codepage or
native-personality parity. Importing the whole package brings unrelated runtime
dependencies. The first-party streaming tokenizer therefore implements the
requested profile without importing or copying that parser. No shared codec
engine is declared by this private workspace. Realm WHATWG codec availability
is checked explicitly, not treated as a pinned iconv implementation.

Still open in later tasks: GNU text/HTML/RTF/VT/LaTeX personalities and aliases,
configuration/option ordering, native token Unicode and byte projection,
additional deterministic codecs/Symbol charmaps, font-name decoding beyond the
byte declaration profile, color/font style and table projection, VFS picture
collision/rollback exports, command registration and CLI/SDK behavior controls.
There is no command implementation or changed visual CLI in this engine task.
Source chunk immutability and prompt iterator return are explicit caller
contracts; an uncooperative external source cannot be forcibly cleaned up.

TDD evidence: original engine tests ran first against the absent engine and
failed. Additional accounting, unsupported-profile/limit-snapshot and scheduled
cancellation tests were observed failing before their repairs. Tests use only
in-memory byte iterables and mocked source capabilities, never files or LLMs.
The original binary fixture crosses chunk sizes 1/2/7/2047/2048/2049 and a
non-power-of-two boundary with 8192 opaque bytes. DBCS prefix preservation covers
the source-observed 10238-ASCII boundary and six observed code pages.

Verification routes: private workspace `test`, `lint` (ESLint plus source/test
typechecks), selected maintained safe-bash build closure, maintained package-safe
publication unit tests, and isolated assembled-artifact runtime/declaration
fixtures `scripts/fixtures/safe-packages-unrtf{,-types}`. Generated artifacts go
under `out` and are removed after validation. No commit/push/publication is
requested by this task.

Verified local results: 22 engine tests passed (under one second total in the
final run); workspace lint and source/test typechecks passed; the maintained
selected safe-bash build completed all 19 build tasks successfully. The 164
publication unit tests passed. `package-safe.mjs` assembled the artifact;
`npm pack --ignore-scripts` produced a 2409-entry safe-bash tarball. Its unpacked
isolated consumer passed the unrtf runtime fixture with an empty PATH and strict
TypeScript declaration checks, with zero private command packages installed and
no private manifest runtime requirements. This was local packing/unpacking,
not an npm registry install, remote-main delivery or release. Whitespace checks
passed. No visual CLI behavior changed, so no screenshot was needed.

Generated assembly/consumer/tarball directories were removed after validation.
The source-observed charset table is exposed explicitly; Symbol/Johab and
unlisted Mac/OEM codecs remain typed unavailable-codec admission cells. Color
and style declaration destinations are reported skipped, not body text.

Task-diff review reproduced and repaired fallback control/binary counting,
character-symbol decoder boundaries and interrupted surrogate pairs, and
cleanup errors masking structured tokenizer failures. Original failing controls
preceded each repair. The engine suite now contains 25 tests. Cleanup remains
attempted; an existing invocation error takes precedence over cleanup failure.
Renderer/personality, deterministic unavailable codecs, style/table projection
and VFS image exports remain explicit unimplemented admission cells above;
this review does not certify those cells or full GNU command compatibility.

Review verification: all 25 engine tests, workspace ESLint/source/test
typechecks, and the maintained 19-task selected safe-bash build passed after
the final code changes. Fresh artifact assembly and packing passed. An isolated
unpacked consumer with only safe-bash installed passed the runtime fixture with
empty PATH and strict NodeNext TypeScript declarations; exported entries and
manifest runtime requirements do not reference the unpublished unrtf package.
Temporary review artifacts were removed. No commit, push or publication occurred.
