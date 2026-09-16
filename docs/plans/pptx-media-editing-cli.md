# Media insertion, replacement and extraction command verification

Ownership: command-media-editing.ts, media-schema.ts, media command tests and media
wiring hunks in command-engine.ts. The existing image changes in that engine are
unrelated and must be preserved. The existing safe-bash media-inventory test file
receives one new actual Shell integration case; no adapter logic is duplicated.
Root owns integration, public exports, maintained package checks and commits.

## Executed original regression procedure

1. Add a small original ftyp container and GIF poster through the command into a
   memfs presentation. The initial case failed with unsupported media.add before
   implementation. Check independently unzipped payload bytes and SDK inventory.
2. Reject absent posters, conflicting selectors, malformed payload types, duplicate
   flags and dual stdin without publication. Audio also requires an explicit
   supplied poster under this task's user instruction.
3. Set trim milliseconds, loop and volume during insertion. Replace the selected
   shape through the CLI with shared selection explicit; compare timing and trim
   XML independently of the rebound resource relationship metadata.
4. Extract original bytes with safe deterministic names. Default publication needs
   the injected atomic transaction; explicit partial output may use individual
   writes. Fail the second write and verify the manifest reports only one committed
   output. Validate both successful mutations and partial failure envelopes against
   the published closed schemas.
5. Run the actual safe-bash Shell with injected filesystem bytes and the public
   package engine. Compare output bytes, hash, poster type and preserved timing
   with SDK reads. The existing inventory scenarios continue to run.

## Evidence

`npx vitest run packages/pptx/src/command-media-editing.test.ts
packages/pptx/src/command-media.test.ts` passes seven cases. Zero-delay cooperative
scheduler waits are mocked to immediate yields; five mutation/extraction cases
complete in about 0.2 seconds. An early expectation compared rebound relationship
metadata as if its part name were unchanged; the corrected assertion compares
trim XML and timing, while resource rebinding is expected behavior.

The new independent schema checks reproduced two genuine schema defects:
inherited affected=0 on mutations and inherited data=null on extraction partial
failures. Mutation schemas now admit nonnegative affected counts and the extraction
error envelope retains the exact successfully published outputs.

After the maintained selected pptx build, from packages/safe-bash:
`node scripts/test-reporting.mjs --import tsx tests/commands/pptx/media-inventory.test.ts`
passes all four adapter cases.

Focused guarded lint used the existing root-authorized guard procedure from
pptx-media-cli.md: unchanged config and bindings, all 25 receipts verified, one
subject read and lintText through the guarded selection. Zero errors, warnings or
messages; 11,177 subject bytes; 2,009 matched opens/closes; receiptsComplete true,
failed false. Subject SHA-256:
44c2a3862674062ac17c7ff4ba4d4ea8fc5d277439862d1e839f732835a8b647.
This is a changed-file check, not a full-root lint claim.

Terminal QA uses `npm run screenshot` with an explicit actual Shell invocation of
`pptx media add --help`, provided engine limits and MemoryFileSystem. The screenshot
.cache/pptx-media-editing-help.png is legible, contains complete required geometry,
poster, output and playback restrictions, and has no clipping. It remains ignored
and uncommitted. Root coordinates final maintained checks and local-only commits.
No whole pipeline, product network, native runtime, README changes, push or release.

Final receipt: after the final maintained selected pptx build completed, the same
adapter reporter passed all four cases against final built public exports in
0.56 seconds, with zero failures, skips or cancellations. The help screenshot was
recaptured from current source and inspected again; --deduplicate appears and all
text remains legible without clipping. No screenshot or binary fixture is staged.
