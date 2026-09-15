# Native synthetic scenario recording plan

- Use the SHA-256 verified native 1Password CLI 2.39.0 only, with isolated temporary configuration and desktop integration disabled.
- Parse the authorized external dotenv file in memory; select only `OP_SERVICE_ACCOUNT_TOKEN` for the native child environment. Never record its value or raw errors.
- Restrict mutations and reads to newly created, uniquely tagged items in vault `6vm5bepg2thg44tfve3aackkwe`. Persist created IDs immediately in recording metadata.
- Extend the earlier ten recordings with blank category templates; assignment, stdin, and file-descriptor templates; sections, Unicode, empty fields, edits, projections, multiline and missing references, literal/reference injection, run masking, password generation, SSH generation, binary document round trips, narrow lists, and archive/delete.
- Use anonymous pipes/file descriptors for synthetic template and document inputs, not saved fixture files. Hash binary output; suppress generated passwords and private keys.
- Capture each attempted scenario as readable text and asciicast, distinguishing command failures and failed assertions from successes. Inspect representative terminal screenshots.
- Delete only tracked newly created IDs, including archived own items. Record cleanup failures explicitly. Native deletion can retain items in Recently Deleted; do not permanently purge.
- Do not infer restore support, authentication parity, or other unavailable behavior. No production or README edits.

## Recorded outcome

- Capture index: `out/op-native-expanded-JvU0oR/INDEX.md`; machine-readable manifest beside it. Additional controls are in `out/op-native-controls-MHHDzp`.
- 89 native command attempts: 80 exit zero, seven exit one, and two intentional child exit seven. The missing-field negative control is one of the exit-one cases.
- All 22 blank category templates are covered across the previous Login capture and 21 additional templates.
- Item assignment/template/stdin creation, sections, empty/Unicode fields, edits, timestamp controls, projections, read newline behavior, injection, and two-dotenv precedence/masking were recorded. Generated passwords and SSH key material were suppressed.
- Three first-batch assertions failed because document creation did not use the assumed item response shape; unique-tag evidence recovered its ID. Two document download assertions failed; a force control also failed with a permission diagnostic. Binary roundtrip is not verified.
- Explicit CSV output format and the attempted base64/hex encoding query forms failed. These attempts do not establish the accepted encoding grammar.
- All seven unique created IDs have successful exact-ID native delete records in `cleanup-verification.json`. This verifies command success, not permanent deletion; Recently Deleted retention applies.
- Casts are replayable buffered command output, not interactive PTY recordings. Some long screenshots are labeled excerpts. The default screenshot font lacks some CJK/emoji glyphs; text transcripts and recorded hexadecimal bytes preserve the original Unicode evidence.
