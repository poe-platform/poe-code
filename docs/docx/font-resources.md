# Theme and font resource inventory

`inspectDocument(bytes, context)` and `docx inspect INPUT --json` expose additive
`fontResources` data. Existing `fonts` aggregates remain unchanged. Human output
shows resource and unresolved-reference counts; `schema inspect` describes the
result and capabilities reports F42 inventory support.

Inventory includes theme color slots and system-color fallback values,
major/minor Latin/East Asian/complex-script faces and supplemental script faces.
Font tables expose names, alternate names, charset, family, pitch, four embedding
kinds, owner-scoped relationship IDs, targets, font keys and subset flags.
Language settings and color-scheme mappings remain stored strings. Unmodeled
settings and extensions remain available through raw XML.

Each reference retains its part, zero-based structural element path, attribute
and value. `resolved` means one supported slot exists in the related package
theme. It does not imply installed/licensed fonts or a rendered font choice.
Empty East Asian/complex-script slots remain empty; script fallback is not guessed.
Availability and licensing are explicitly null.

Reference updates use existing `runs set`, `styles set` and `styles defaults set`:
`--ascii-theme`, `--high-ansi-theme`, `--east-asia-theme`,
`--complex-script-theme`, `--theme-color`. SDK options use corresponding camelCase
names. The style-owned model retains Font.name and ColorFormat.theme_color/rgb/type
and existing typed batch routes. Direct getters preserve null/inheritance;
effective style inspection resolves the supported base/default cascade.

Unknown typed tokens reject before input acquisition. Inventory diagnoses missing
themes/slots and invalid embedded relationship IDs, types, external targets or
fragments. Missing physical relationship targets fail package admission. Stored
unresolved references may be preserved; no theme is silently created or fetched.
These diagnostics do not certify complete schema or layout conformance.

Untouched font/theme parts, embedded bytes, extensions, language metadata and
relationships survive unrelated text/formatting edits. XML replacement rejects
embedded font definition, obfuscation metadata or binding changes with
UnsupportedEmbeddedFontMutationError (unsupported-edit, CLI exit 1) before
publication, including dry-run. No font installation, deobfuscation, rasterization
or licensing inference is performed.

[Original acceptance and exact mappings](../plans/docx-theme-font-resources.md)
cover this bounded milestone. Whole document-model coverage and later tasks
remain pending.
