# VFS resource resolution

The original TypeScript converter resolves local images through an explicitly
injected `ConversionContext.resourceFiles` VFS. The command supplies its configured
`context.fs` and `cwd`; command configuration cannot inject another resource provider.
No native tools, network client, HTTP/file URL handler, home search or font lookup
were added. Data URI acquisition is explicitly unsupported, so no decoding occurs.

## Supported options and identity

- `--resource-path=DIR:DIR` / `resourcePath: string[]` searches only those VFS
  directories, in order. A later CLI occurrence replaces the earlier list.
  Relative directories resolve against `resourceCwd` / command `cwd` (default `/`).
  Without the option, local images resolve against each input's `base` VFS
  directory, then the configured cwd when the input has no base.
- `--extract-media=DIR` / `extractMedia` explicitly acquires local image targets,
  extracts embedded media, and rewrites resolved image URLs. Without extraction,
  text writers preserve image URLs without acquiring targets. Ordinary links and
  raw HTML remain text and never cause resource acquisition.
- Embedded `Document.resources[].id` values are literal media keys matched exactly;
  percent escapes in these keys are not decoded. Conflicting duplicate keys fail;
  duplicate keys with identical bytes share an extraction entry.
- Local image URLs have query/hash suffixes removed before lookup and restored
  after rewriting. Percent escapes are decoded once per component. Encoded path
  separators, schemes, absolute paths, home prefixes and traversal outside a search
  directory fail before acquisition. Interior dot segments normalize lexically.
- Extracted files use basenames. Collisions receive deterministic `-2`, `-3`, …
  suffixes before their extension. Filenames are separate from URI spelling;
  rewritten URL components are percent encoded. Names remain Unicode without
  case folding or Unicode normalization.
- Source identities and directories are weak sidecars, preserved through joined
  CommonMark/GFM parsing, conversion normalization and the SDK read/write seam.
  Serializing/cloning AST data outside the converter does not carry these sidecars.
  Custom joined readers must call `resourceTarget(target, sourceLine)` to identify
  image occurrences; without a sidecar their images use the first input origin.

All resource and extraction paths reject observed symlink components rather than
treating lexical normalization as symlink authority. This policy operates in the
configured VFS namespace; the provider retains authority over its actual backing
storage and races. Directory options reject parent segments. The CLI rejects an
output file inside the media directory before acquiring inputs.

## Preflight, limits and failure behavior

All target spellings, embedded keys and the extraction directory are validated
before resource reads. All planned output paths are checked before any mutation.
Warnings and serialized output byte limits are checked before media publication.
Existing output files are refused. Publication rechecks each path and requests
exclusive `wx` creation from the provider.

There is no multi-file provider transaction. A failure or abort after publication
starts can leave created directories and completed media files; a later document
output failure can leave all extracted files. Completed effects are not rolled
back. Providers must honor cancellation and exclusive creation in their namespace;
inspection followed by writing does not establish atomic ancestor isolation.

Streaming resources share aggregate `resourceBytes`, `resources`, retained-memory
and work limits. Every retained producer chunk is copied before advancing it.
VFS providers without streaming receive `readFile(..., {maxBytes: remainingBudget})`;
returned bytes are still checked before retention; bounded `EFBIG` refusals become
`E_LIMIT`. Capability host allocation and
cooperation remain the trusted provider's responsibility.

Missing images fail with `E_RESOURCE` in strict extraction. Explicit `--lossy`
retains unresolved image URLs with `W_RESOURCE_MISSING` and source/AST locations.
Lossy mode never converts denied paths, cancellation or limit failures into warnings.
`--fail-if-warnings` prevents extraction writes.

## Original verification

The first test run reproduced 16 failures with the new original resource cases
before implementation. Further failing tests reproduced later-target acquisition,
base inheritance, loss of SDK read/write origins, unsafe embedded basenames,
VFS streaming assumptions, unreferenced media omission and untyped provider injection.
Unit fixtures use memfs and injected producers exclusively, without host scratch,
LLMs, downloaded fixtures or external executables.

Final scoped routes:

- `npm run test --workspace=@poe-code/pandoc`: 20 files, 628 tests pass.
- `npm run lint --workspace=@poe-code/pandoc`: package ESLint and source/test typechecks.
- `npm run build:workspaces -- --workspace=@poe-code/pandoc`: maintained selected build.

The 30 resource cases and four additional command cases cover escaped/literal names,
Unicode, dot segments, suffixes, duplicate basenames and media collisions, repeated
references, missing/denied targets, symlinks, resource byte boundaries, reused chunks,
abort with producer cleanup and late rejection, preflight refusal and partial writes.
These are original scoped cases, not an upstream corpus or full Pandoc parity claim.

The repository screenshot renderer captured the built command with an in-memory
VFS. [The inspected CLI transcript](resources-cli.png) shows strict failure with no
content, diagnosed lossy output, correctly escaped image URLs with query/fragment,
exit statuses and exact extracted VFS bytes. QA procedures live in
`docs/plans/pandoc-resources.md`; no QA script was added.

Delivery is a local atomic commit on `main`. No push or release is authorized.
