# Native DOCX wide-fanout QA

Keep the 1,024-sibling cases in the fast unit route. Execute the 131,072-sibling
matrix manually against the real native APIs, with the same assertions and no
changes to unit deadlines. The larger archives exercise native arity and memory
behavior rather than the fast semantic regression checks.

## Matrix

Use both transitional and strict XML, and both DOCX and DOTX packaging. Keep all
archives and CLI files in memory. For each fixture below, reproduce the setup in
the named unit file with `count` set to 131,072, then exercise every listed route.

| Fixture in `packages/docx/src` | Routes | Required result |
| --- | --- | --- |
| `comment-style-retention-native-fanout-public.test.ts` | Model, SDK, CLI | Create the rich comment while retaining ignored style siblings, comments, processing instructions, unrelated parts, and source bytes. |
| `signature-retention-native-fanout-public.test.ts` | SDK, CLI, SDK batch, CLI batch | Remove only signature relationships and signature members; retain the opaque relationship subtree and all unrelated bytes. |
| `property-custom-id-native-fanout-public.test.ts` | SDK, CLI | Add boolean custom property `Fresh` with ID 3, retaining the existing opaque vector and all unrelated parts. |
| `review-part-next-id-native-fanout-public.test.ts` | Model, SDK, CLI | Return story-part ID 32 from the physical opaque ID 31; publish nothing and retain all archive and destination bytes. |

This is 48 large cases. Preserve each fixture's archive limits: archive and total
bytes 4,194,304, entry bytes 2,097,152, retained bytes 2,147,483,648. Preserve the
document work and retained-byte budgets of 2,147,483,648. Use input ordering and
store compression. Do not replace native implementations with mocks.

## Execution

1. Build the selected workspace through the maintained build declarations.
2. Prepare the exact in-memory archives described in each fixture, including
   namespace strictness, content types, relationships, opaque nodes, and Unicode
   text. The comment-style scenario uses `Fresh海🌊`, author `Archive`, initials
   `AR`, and timestamp `2026-03-04T05:06:07Z`.
3. Execute the real model/SDK calls and `docxCommands` in a `Shell` with
   `MemoryFileSystem`, using the operation arrays and CLI arguments in the
   fixture. Await every operation before advancing to the next case.
4. Check every fixture assertion, including returned values, package members,
   exact opaque markup, comments and processing instructions, source retention,
   destination retention for read-only operations, and fresh comment styles and
   metadata after reopening the published archive.
5. Record each outcome and duration in `out/`. A stack overflow, native process
   crash, changed source, partial publication, lost opaque bytes, or wrong ID is
   a failure. Investigate failures before delivery. Purge temporary drivers and
   logs after recording the verified result.

## Verification

The 12 comment-style cases passed on 26 September 2026 with Node 22.22.2. All
archive, style, metadata, and publication assertions passed; durations were
approximately 3.4–5.2 seconds. All remaining 36 signature, custom-property, and review-ID cases also passed
with their original assertions in the native agent-executed QA run. All 48
large cases are verified; the fast unit route retains all 48 corresponding
1,024-sibling semantic cases.

## Default-stack comment ownership depth

Exercise `comment-paragraph-ownership-depth.test.ts` scenarios in a standalone Node process with its default stack: strict/transitional namespaces, docx/dotx, and 4096/8192 ignored wrappers. Edit the selected comment paragraph through the compiled Document API, save in memory, reopen, and verify text, alignment, annotation marker and italic retention, unrelated comments, unchanged archive parts, wrapper count, comments and processing instructions, and unchanged input. All eight original scenarios passed on 26 September 2026. Unit coverage retains every depth and assertion through a statically loaded compiled API without per-case Node startup.

## Default-stack opaque controls

Run all strict/transitional, docx/dotx, SDK/SDK-batch/CLI/CLI-batch and depth 32/4096 combinations in standalone Node with its default stack and the compiled public APIs. Both controls must initially read Coast. Filling all controls must reject with unsupported-edit, leave input and any retained destination byte-identical, report zero affected items, and publish zero bytes. All 32 original scenarios passed on 26 September 2026. Unit cases retain both depths and all four routes with actual compiled APIs loaded once per file.
