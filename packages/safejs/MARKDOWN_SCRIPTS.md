# Markdown scripts

JavaScript (`js` or `javascript`) and legacy `ajs` fenced blocks form one module
in document order. They share lexical bindings, imports, declarations, and the
normal JavaScript control flow: a top-level `return` still ends execution.
Backtick and tilde fences are supported. Non-executable fenced blocks and prose
remain inert, including executable-looking fences nested inside a larger
non-executable fence. An unclosed executable fence anywhere in the document
fails before executing any block.

The loader replaces inter-block prose and fence markers with whitespace while
preserving UTF-16 offsets and line breaks. Diagnostics from the CLI, example
runner, and SDK refer to original Markdown lines, including frontmatter. LF,
CRLF, and CR line endings are counted consistently. Documents without an
executable fence retain the existing whole-body script fallback.

`--fix` changes only the original code spans. It preserves frontmatter, prose,
fences, indentation, and line endings outside each applied edit. A fix spanning
two code blocks is not applied, because replacing it could delete intervening
Markdown; its diagnostic remains available from the linter. Split such an
expression into a single block before applying that fix.

The linter's `fixRanges` option restricts fixes to supplied source-offset ranges;
an empty list permits none, while omitting it permits the whole source. Each
range is a half-open `[start, end]` UTF-16 interval. A fix must fit entirely
inside one range. With `fix: true`, the result also includes `fixes`, the actual
non-overlapping edits in descending offset order, alongside `fixed` and the
remaining `diagnostics`. The CLI and example runner map these edits back to the
original document rather than writing the whitespace projection over prose.

Snapshots remain pinned to a hash of the parsed program structure, not raw text.
Formatting or comment edits that preserve that structure remain compatible;
source-coordinate corrections alone do not require migration. Added executable
code, or a CR-only script previously discarded during hashbang stripping, can
change the program structure. Snapshots for a different program are rejected
rather than silently migrated.
