# unrtf task review

Review of the current command candidate on September 20, 2026. The package
pattern is now at `docs/plans/archive/safe-bash-command-package-pattern.md`.
Unrelated working-tree changes were preserved.

## Validated correction

The tokenizer discarded CR only at the outer token loop. CR within a control
name/parameter caused `E_PARSE`, and backslash CRLF did not become `par`.
A failing memory-stream test reproduced this with `rtf` header spelling and
backslash CRLF. Text reads now discard CR throughout token spelling. Binary
numeric lookahead and payload reads remain raw: tests include CR/braces with
and without a space delimiter, at chunk sizes 1, 2, 7 and 2048. No producer
bytes are changed. Cancellation, raw offsets and resource charging stay on
the same read path. All 61 workspace tests and workspace lint/typechecks pass.
The maintained selected safe-bash build closure also passed (19 build tasks).

## Unresolved admission findings — completion blocked

- `render.ts` implements a generic strict HTML/text projection, rather than
  GNU 0.21.10 output personalities. The native text body separator, entity
  mappings and legacy low-byte output are absent. Existing tests deliberately
  assert this narrower behavior; they cannot establish native compatibility.
- `command.ts` refuses personality/configuration options beyond text/html.
  Ordered `-P`/`-t`, other formats and independent inline/simple/noremap/debug/
  dump/verbose profiles are not implemented. CLI and SDK agree only for the
  admitted subset. Quiet/nopict are no-ops in that subset.
- `Budget` refuses native-legacy/recovery profiles; `extract.ts` uses scoped
  Unicode fallback and surrogate combination, not GNU token-level skipping.
- Codec inventory uses fatal WHATWG decoders and explicitly refuses Symbol,
  Johab and unavailable pages. Full pinned native codec/charmap coverage is
  not admitted. The exposed provenance correctly declares native personality
  incompatibility.
- Pictures are skipped rather than exported to the VFS. Collision protection
  and partial-image cleanup cannot be qualified without that implementation.
  Tables are limited to flat rows; nested/merged table behavior remains absent.

These findings are directly visible in the current implementation and README,
and profile/codec refusal is covered by existing tests. They require engine and
personality work, not a wiring-only simplification. No host execution, network,
ambient configuration search or external runtime dependency was introduced.
The command remains private and registration remains opt-in. No publication,
commit or push was performed. Previously recorded packed-consumer verification
is historical evidence; this review does not claim a fresh packed release gate.
