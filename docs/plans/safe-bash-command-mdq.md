# mdq compatibility implementation

Issue: hey-boss #1906. Oracle: yshavit/mdq v0.10.0, commit
`c4eccd0e340ad32f966ee8675c093dabe1005ee0`.
Linux x64 release archive SHA256:
`de00a4dcbfb4cc2f59152b52ae774702343fdc82e6cd4f87a2a40c7be09935d7`.
Executable SHA256: `455038e937a65856b693c7e4cccb87bef3e79f01430d232b971623744bfe40b7`.
Native executable is a development oracle only.

## Contract inventory

- CLI: optional selector followed by ordered file operands; default stdin;
  `-` stdin operand consumed once; repeated files allowed. Files are joined with
  an added newline after each operand (including repeated `-`).
- Flags: `--link-pos section|doc`, `--footnote-pos section|doc`,
  `-l/--link-format keep|inline|never-inline`,
  `--renumber-footnotes true|false`, `-o/--output markdown|md|json|plain`,
  `--wrap-width N`, `-q/--quiet`, `--br`, `--no-br`, `-h/--help`,
  `-V/--version`. Hidden upstream `--allow-unknown-markdown` is inventoried too.
  `--[no]-br` is documentation syntax and errors if passed literally.
- Selectors: `#` and `#{min,max}` sections; `-` and `1.` list items with
  optional `[ ]`, `[x]`, `[?]`; links `[]()`; images `![]()`; `>` quotes;
  triple-backtick language/content selectors; `+++` front matter with optional
  yaml/toml variant; `</>` HTML; `P:` paragraphs; `:-: column :-: row` tables.
  Pipes compose filters. A matching ancestor suppresses duplicate descendant
  selection; subsequent filters include their input root.
- Matchers: omitted/`*`; case-insensitive letter-initial bare strings;
  case-sensitive single/double quotes with escapes; `^`/`$` anchors;
  `/regex/`; `!s/regex/replacement/`, including atomic inline boundary errors.
- Rendering: Markdown normalization with retained heading levels and nested
  sections; default reference links, placement and footnote renumbering; compact
  JSON without a terminal newline; plain text; optional separators/wrapping.
- Status: 0 on matches, 1 on no matches/query/Markdown/input/selection failures,
  2 for clap argument errors. JSON plus wrap width and literal `--[no]-br`
  are upstream extra-validation failures with status 1. Quiet suppresses stdout.
- Diagnostics: clap usage errors; source-positioned query errors prefixed
  `Syntax error in select specifier:`; Markdown and selection error categories;
  input errors identify stdin or the named file. Bounded runtime refusals and
  cancellation follow the safe-bash resource contract.

## Implementation and verification

1. Reproduce the absent command with the real Shell/VFS chapter test.
2. Reuse the existing first-party CommonMark block/inline parser through a
   private dependency-free Markdown engine; preserve Pandoc and HTML consumers.
   Existing Pandoc imports `entities`; reuse the existing first-party HTML
   character-reference data to avoid importing Pandoc's external runtime graph.
3. Implement command logic in private `safe-bash-command-mdq`, sharing CLI/SDK
   validation and byte-stream invocation. Register public and agent exports.
4. Capture upstream output/status fixtures, add memory-backed lifecycle/budget
   checks, run Shell integration, maintained builds/lint/tests and packed SDK
   consumption, and inspect help/output screenshots.
5. Record coverage, limitations, source revision and verified remote-main
   delivery in hey-boss before closing. Release publication is separate.

Temporary sources and oracle capture live in task-owned `out/issue-1906` because
the machine does not permit creating a filesystem-root `/out` directory.
