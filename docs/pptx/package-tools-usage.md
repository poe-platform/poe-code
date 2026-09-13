# Package extraction and reconstruction

Draft usage for the bounded package tools. These examples describe workspace capabilities; no released package/import-path claim is made.

`pptx extract deck.pptx --output-dir parts --json` extracts all admitted members, including opaque resources, using generated `part-NNNNNN.EXT` names. Content types determine the extension; unknown types use `bin`. Original part URIs are metadata, never output paths. Selection uses a JSON array of canonical part URIs:

```sh
pptx extract deck.pptx --parts '["/ppt/presentation.xml"]' --output-dir selected --json
```

Directory publication requires an atomic adapter transaction. Where an adapter provides only individual publication, explicitly pass `--allow-partial-output`. A failed partial operation reports the outputs that were completed; that list is not a complete reconstruction manifest. Existing output collisions require `--force`; unrelated destination files remain independent.

`pptx pack --manifest manifest.json --output rebuilt.pptx --json` reconstructs a package from explicit scoped files. It does not scan a directory. The manifest is a closed object containing a nonempty `parts` array. Each item has exactly `part`, `sha256` and `file`; `file` is `{ "vfsPath": "..." }`. `part` is a unique canonical absolute package URI; `sha256` is the lowercase 64-digit digest of the file bytes. Relative file paths resolve against the manifest location in the supplied VFS. Paths confer no implicit host authority.

To construct manifest data from a successful **complete** extraction response, use its metadata without guessing member filenames:

```js
const manifest = {
  parts: extractionResult.data.outputs.map(({ part, sha256, path }) => ({
    part,
    sha256,
    file: { vfsPath: path }
  }))
};
```

Write that JSON using the caller's explicit VFS capability. If output paths are relative, resolve them in that VFS before placing the manifest elsewhere. A selected extraction may omit required parts and fail reconstruction. An authoritative manifest cannot prove that its author has not omitted an unrelated orphan resource; retain the complete original extraction when byte preservation is intended.

Pack verifies names, hashes, content types, presentation kind and required graph dependencies before publication. `--kind pptx|potx|ppsx` checks the admitted presentation kind; it does not convert one kind into another. `--dry-run` validates without publishing. Pack accepts no positional presentation and no `--in-place`; an ordinary write needs `--output`. `--force` does not bypass validation. Metadata is preserved; `--author` and `--timestamp` currently fail with `unsupported-edit` before manifest admission. Binary `--output -` is separate from JSON output.

The SDK exposes these operation signatures:

```ts
extractPackage(input: BinaryInput, context: SelectionContext,
  options?: { readonly parts?: readonly string[] }
): Promise<readonly ExtractedPackageMember[]>;

packPackage(members: readonly PackPackageMember[], context: SelectionContext,
  options?: { readonly kind?: "pptx" | "potx" | "ppsx" }
): Promise<Uint8Array>;
```

An extracted member contains `part`, generated `name`, `contentType`, `sha256` and owned `bytes`. A pack member contains `part`, `sha256` and `bytes: BinaryInput`. Callers supply explicit byte/archive/XML/relationship limits in the context and may supply cancellation. Byte inputs, pull sources and scoped read capabilities use the same admission path. The SDK returns data/bytes; the command adapter supplies publication authority.

`pptx schema extract`, `pptx schema pack` and `pptx capabilities` describe the operation surface. JSON uses the shared version-1 result envelope and camelCase data fields. Success is 0; usage/schema errors are 2, validation errors 1, I/O/publication failures 3, limits 4 and cancellation 130. These operation names do not alter neutral model spellings such as `Presentation` or `save`.
