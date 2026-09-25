# Markdown queries

Read the relevant chapter of a large Markdown document, extract links or tables,
and pass structured results to the next command. `mdq` is included in safe-bash's
`agentCommands()` preset and reads the shell's virtual filesystem and byte streams.

```sh
mdq '# Authentication' < SPEC.md
mdq '# Authentication | # Token expiry' < SPEC.md
mdq -o json '# Token expiry' SPEC.md | jq -r '.items[0].section.title'
mdq -q '# Authentication' SPEC.md
```

Queries retain section heading levels and nested content. Headings inside fenced
code stay code; setext headings and headings inside lists and quotes are parsed
structurally. Success returns status 0, no matches return 1, and argument errors
return 2. `-q` suppresses output while preserving match status.

| Select | Query |
| --- | --- |
| Sections | `# Authentication`, `#{2,3} Token` |
| Paragraphs or quotes | `P: token`, `> warning` |
| List items and tasks | `- token`, `1. token`, `- [x] completed` |
| Links and images | `[]()`, `![]()` |
| Code blocks | Three backticks followed by a language matcher and content matcher |
| Front matter or HTML | `+++ yaml`, `</> div` |
| Tables | `:-: Name :-: Alice` |

Chain filters with `|`. Bare match text ignores case; quoted text is case
sensitive. `^` and `$` anchor literal matchers. Regex matchers use `/pattern/`;
`!s/pattern/replacement/` replaces matched content while retaining inline
formatting. Replacements crossing a link, image, or code boundary report a
selection error when upstream treats that boundary as indivisible.

`-o/--output` selects `markdown` (also `md`), `json`, or `plain`.
`--link-pos` and `--footnote-pos` accept `section` or `doc`;
`-l/--link-format` accepts `keep`, `inline`, or `never-inline`.
`--renumber-footnotes true|false`, `--wrap-width N`, `--br`, and `--no-br`
control formatting. Use `--help`, `-h`, or `--version` for the pinned command
interface. Pass `--` before a selector that would otherwise look like an option.
With file operands, `-` reads stdin once; each operand adds a joining newline.

Use the same implementation from a command context:

```ts
import { mdq, mdqCommands } from "@poe-platform/safe-bash/commands/mdq";

shell.use(mdqCommands({ limits: { inputBytes: 4 * 1024 * 1024 } }));

const result = await mdq(context, {
  selectors: "# Authentication | # Token expiry",
  files: ["/SPEC.md"],
  output: "json",
  linkFormat: "keep",
  quiet: false,
});
```

The plugin is useful when composing a shell without `agentCommands()`. To replace
an existing registration, pass `replace: true`. `createMdqCommand` creates a
definition for direct registration; `createMdqCommands` returns the one-command
collection. Both accept `MdqCommandsOptions`. Typed SDK options also include `linkPos`,
`footnotePos`, `renumberFootnotes`, `wrapWidth`, `breaks`, and
`allowUnknownMarkdown`. Alternatively, pass `argv`; it cannot be combined with
typed query options. Results include `exitCode` and resource `accounting`.
The implementation and declarations ship within safe-bash; this private workspace
does not require a separate installation.

Compatibility is tested against mdq **v0.10.0**, source revision
`c4eccd0e340ad32f966ee8675c093dabe1005ee0`. Native mdq is only a development oracle.
Runtime parsing, matching, and output use portable TypeScript with zero external
runtime dependencies. This is a bounded implementation of that version's CLI
contract, not a promise of compatibility with future mdq versions or every
Markdown parser extension. The hidden upstream `--allow-unknown-markdown` option
is accepted; the CLI's parser profile does not enable MDX or math extensions.
Regex compilation admits at most 8,192 UTF-16 source units, 64 nested groups,
and 16,384 instructions, followed by shared work and state-buffer limits.
The captured regex cases establish the covered v0.10.0 behavior; Unicode
classification follows the JavaScript runtime's Unicode version.
Two captured Unicode replacements cause the native v0.10.0 renderer to panic
when a formatting boundary falls inside a UTF-8 character. Here they return
status 1 with a `Selection error` diagnostic and no output. They are tested
separately from native compatibility comparisons.

Input and arguments must be valid UTF-8. Queries collect an admitted document
before selecting elements; output is written in awaited byte chunks. Defaults
cap input at 16 MiB, output at 32 MiB, cumulative retained allocation at 256 MiB,
nodes/references/table cells at 262,144 each, nesting at 128, work at 268,435,456,
files at 128, and arguments at 1,024 / 256 KiB. Hosts may lower these ceilings
through `limits`, including to zero. Accounting measures logical allocations and
work, not process RSS. Host stream/filesystem budgets also apply. Cancellation
and closed output drain admitted cooperative resources; an uncooperative host
operation cannot be forcibly stopped. Diagnostics are capped at 16 KiB.
