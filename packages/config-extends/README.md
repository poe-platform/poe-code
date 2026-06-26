# @poe-code/config-extends

Shared document-inheritance utilities for layered config resolution.

## API

- `resolve(chain, options)`: resolves exactly one document layer with surrounding data and base layers.
- `findBase(name, basePaths, fs)`: discovers a base document by name across configured base paths.
- `parseDocument(content, filePath)`: parses a document and separates inheritance metadata from data.
- `mergeLayers(layers)`: merges data layers and tracks the source of each resolved key.
- `resolvePromptDocument(input)`: resolves a safe Markdown prompt document with inheritance, partials, one-pass rendering, and provenance.

## Resolution behavior

A chain must contain exactly one document layer. Data layers before and after the document are merged around the resolved document, and base layers define directories that can be inherited from.

- Documents that set `extends: true` must resolve a base and still report circular inheritance as an error.
- With `autoExtend: true`, documents that do not set `extends` try to inherit from matching bases automatically.
- Optional auto-extend discovery is ignored when it finds the document itself, so a document can safely live in a configured base directory without creating a circular extends error.
- Prompt values can compose with the `{{yield}}` token across resolved base layers.
- Path-valued `extends` entries are trimmed before lookup.
- Frontmatter-only prompt documents preserve their prompt even when the Markdown body is empty.
- Markdown that starts with a horizontal rule is treated as prompt body unless it is valid frontmatter.
- Blank partial names are rejected before hidden dotfiles are read, and prototype-named partials resolve as own entries.
- Prompt document real paths must stay inside the configured roots; the normal macOS `/var` system alias is allowed.

## Environment variables

This package does not read or expose any environment variables.

## Config options

### `ResolveOptions`

- `fs`: file system implementation with `readFile(path, encoding)`
- `autoExtend?`: automatically inherit from bases even when a document does not set `extends: true`

### `ResolvePromptDocumentInput`

- `cwd`, `filePath`: root and project-relative Markdown document path
- `optional?`: fall back to a configured base when the project document is missing
- `basePaths?`: absolute directories containing inherited base documents
- `baseDocuments?`: in-memory packaged base documents with absolute virtual paths
- `variables?`, `validate?`: one-pass rendering view and unresolved-variable validation
- `fs?`: injectable file system for callers and tests
