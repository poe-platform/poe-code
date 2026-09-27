# Native DOCX comment fanout QA

Verify atomic refusal of comment creation when a run contains 131,072 opaque
native extension siblings. Keep this stress matrix outside the fast unit route;
the unit fixture covers the same refusal with 1,024 siblings.

## Preparation

Use the project's built public `docx` package in a fresh Node process. Keep
archives and shell files in memory, following
`packages/docx/src/comment-range-native-fanout-public.test.ts`. Store temporary
execution evidence in `out/` and remove it after verification.

For each combination of transitional/strict XML and DOCX/DOTX packaging:

1. Create the minimal package with `textFixture("<w:p/>", {}, strict, { kind })`.
2. Replace `word/document.xml` with a document containing one paragraph and one
   run. Its run properties contain `<w:i/>` followed by 131,072 `<o:leaf/>`
   siblings; its text is `Coastal anchor`. Declare `o` as
   `urn:original:fanout`, declare the markup compatibility namespace, and set
   `mc:Ignorable="o"`. Use the Word namespace appropriate to strictness.
3. Write the archive with input ordering and store compression. Set archive and
   total byte limits to 4,194,304, entry bytes to 2,097,152, and retained bytes to
   2,147,483,648. Use a document budget of 2,147,483,648 for retained bytes and
   work. Preserve a copy of the original archive.

## Execute all twelve cases

For each prepared archive, exercise all three public routes with an empty
author, comment text `Unsafe opaque note`, and timestamp
`2026-03-04T05:06:07Z`:

1. **Model:** open `Document`, select the first run in the first paragraph, and
   call `add_comment`. Capture each package part's name and blob before calling.
2. **SDK:** call `executeDocumentBatch` with operations that obtain document
   paragraphs, obtain the first paragraph's runs, and call
   `model.document.Document.add_comment.call` with the first run. Publish to an
   in-memory stdout sink.
3. **CLI:** register `docxCommands` with the same archive and document limits in
   a `Shell` backed by `MemoryFileSystem`. Seed `/input`, `/operations`, and a
   `/destination` containing `Retained destination`. Execute
   `docx batch /input --ops-file /operations --timestamp 2026-03-04T05:06:07Z --output /destination --force --json`.

Require `unsupported-edit` from every route. The model must retain identical
package parts. The SDK must publish zero bytes. The CLI must exit with code 1,
report zero affected items and the expected error, and retain both the source
archive and destination bytes. No case may fail with a stack overflow, process
crash, partial publication, or modified source. Record each case's outcome and
duration; investigate slow cases without extending unit-test deadlines.

## Verified execution

On 26 September 2026, Node 22.22.2 passed all twelve 131,072-sibling cases in
the complete 24-case native run, including all model, SDK, and CLI assertions.
The large cases took approximately 1.3–2.3 seconds each after fixture reuse.
The subsequent unit route retains the twelve 1,024-sibling cases; the larger
matrix remains an explicit agent-executed QA check.
