# Package identity implementation notes

The current internal `packages/pptx/src/package-uri.ts` and `content-types.ts`
primitives implement the OPC identity milestone. They are not new public package
exports or a released `Presentation` object model. There is no `pptx` safe-bash
adapter yet. CLI schema/capabilities and paired SDK/CLI qualification remain
adapter milestones; no commands or unsupported model members are hidden here.

`packageUri(value)` returns an immutable name/key/baseURI/filename/ext/idx/relsUri
record, including the root pseudo-name. `resolvePartReference(baseURI, reference)`
and `relativePartReference(target, baseURI)` take package directory IRIs, never
host paths. Part identity uses ASCII-only folding. Percent-encoded reserved ASCII
retains its encoded representation with uppercase hex; decoding happens only for
ZIP-mapped UTF-8 non-ASCII names. Encoded unreserved characters, separators,
controls, invalid UTF-8, traversal and malformed percent triplets are rejected.
Unicode normalization and Unicode case folding are deliberately not identity
operations. Duplicate ASCII-equivalent parts and derivable part names are
rejected by the byte reader. Root is a relationship owner, not a normal part.

`parseContentTypes(bytes, {maxBytes, maxEntries})` synchronously admits already
supplied bytes. Both limits must be positive safe integers. It supports UTF-8 and
UTF-16, namespace-aware `Types`/`Default`/`Override`, ASCII-insensitive extension
and override lookup, and a bounded declaration count. The byte ceiling bounds
all XML tokens and depth is limited to the prescribed two-element structure.
DTD declarations, malformed XML, unsupported encodings, unknown schema content,
empty type streams and duplicate declarations fail. Empty streams are rejected
according to the normative prose's one-or-more requirement, even though the XSD
allows an empty choice. CDATA is conservatively rejected in this metadata stream.

The returned index's `get(part)` preserves declared MIME spelling and values,
including parameters and `image/jpg`; it never guesses media types from bytes.
Overrides take precedence over defaults. Media-type and extension grammars are
different and have separate validation. Parameter names match ASCII-insensitively;
duplicate parameter names are rejected. Parameters are forbidden for OPC media
types and the three presentation main types. Missing mappings raise
`OfficeError` with `missing-binding`; invalid XML/schema/media types raise
`invalid-opc`; unsafe part names raise `unsafe-path`; exceeded limits raise
`resource-limit`. Nonstring lookup arguments raise `invalid-type`.

`presentationKind(mainPart, expectedKind?)` requires an explicitly selected main
part URI and returns `pptx`, `potx` or `ppsx` from its content type. `expectedKind`
is an optional explicit suffix/kind constraint; disagreement fails. No filename
or host suffix is inspected implicitly. The routine does not discover the main
relationship, validate the presentation XML root, detect all macro parts, or
perform whole-package validation; those remain graph and security obligations.

All I/O still belongs to explicit byte/VFS capabilities. There are no added
configuration files, environment variables, host processes or network requests.
The XML dependency is a JavaScript parser with its normal standalone dependency
license notices. No source-project code or binary fixtures were copied. Existing
research notices and baseline audits remain intact; their historical adaptation
flags are supplemented by [the milestone evidence](opc-identity-evidence.json).
