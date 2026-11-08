# Markdown Reader

A toolcraft-powered package that reads markdown files section-by-section instead of all at once, exposed as CLI, MCP, and SDK.

## 1. Problem

Agents and humans often need to consult a specific section of a long markdown document (a design doc, a README, a plan, a runbook), but today the only way to do that with poe-code tools is to read the entire file. That is wasteful for three reasons:

- **Context burn.** Long markdown files (plans, specs, design docs in `docs/`) can run to thousands of tokens. Loading the whole file to answer "what does the auth section say?" wastes the model's working context and costs.
- **No structural view.** Without a table of contents, a caller cannot plan which section to fetch. They either read everything or guess a grep term.
- **Front matter noise.** Plans and docs often carry YAML front matter (status, owner, lock metadata). It is relevant occasionally (e.g. superintendent plans) but not when you just want the prose.

Evidence it is worth solving now:

- The `docs/plans/` directory already has 15+ plan files, several with front matter and lock files; reading them whole is the norm today.
- The superintendent loop and the `plan-browser` package both need to navigate plan docs by section; they currently re-parse markdown ad hoc.
- toolcraft is the house pattern for new command-surface packages — this is a natural fit and gives us CLI + MCP + SDK for free.

Explicitly out of scope:

- Writing or editing markdown (this is read-only).
- Rendering markdown to HTML, PDF, or terminal-pretty output. The TOC is a compact text outline, not styled rendering.
- Cross-document search or indexing. One file at a time.
- Non-markdown formats (mdx, rst, asciidoc).
- Resolving links, transclusions, or includes.

Resolved decisions:

- **Section addressing** accepts two forms, both resolving to the same section: numeric path (`1.2`) and full heading text (`"2. User-facing shape"`). Numbers cover programmatic use; heading text covers human/copy-paste use. No slugs.
- **Command surface:** three sibling subcommands under the existing `plan` group — `plan markdown-read`, `plan markdown-read-section`, and `plan markdown-reader-mcp`. The first two are one-shot CLI commands. `markdown-reader-mcp` starts a standalone stdio MCP server exposing the two tools, mirroring the `terminal-pilot-mcp` shape. **Not** wired into the central `poe-code mcp serve`; this is a standalone server per user requirement.
- **Package layout:** core parsing / walking / orchestrator logic lives in a new `packages/markdown-reader`. The CLI and MCP entry points live in [src/cli/commands/plan.ts](../../../../../src/cli/commands/plan.ts) (commander subcommands) and import from the package. This keeps the `plan` group's commander style intact while isolating the testable guts.
- **AST parser:** extend `toolcraft-design`'s `terminal-markdown/parser` with source positions (details in §3), rather than duplicating a scanner. One parser in the monorepo.

## 2. User-facing shape

Three subcommands under the existing `plan` group:

- `plan markdown-read <file>` — one-shot CLI, prints TOC + frontmatter.
- `plan markdown-read-section <file> <section>` — one-shot CLI, prints the body of one section.
- `plan markdown-reader-mcp` — starts a standalone stdio MCP server that exposes the above two as MCP tools.

The SDK exports `readMarkdown` / `readSection` from `@poe-code/markdown-reader`.

### Command: `plan markdown-read`

Returns the table of contents and the frontmatter, not the body. The TOC is intentionally compact: one line per heading, numeric path + title, no blank lines.

CLI:

```text
$ poe-code plan markdown-read <file>
$ poe-code plan markdown-read ./docs/plans/markdown-reader.md

file: docs/plans/markdown-reader.md
frontmatter:
  (none)
sections:
  1      Problem
  2      User-facing shape
  2.1    Command: `plan markdown-read`
  2.2    Command: `plan markdown-read-section`
  2.3    Command: `plan markdown-reader-mcp`
  3      Implementation details and technical decisions
  4      Interfaces and test plan
  5      Code plan
```

Flags:

- `<file>` (required, positional) — path to the markdown file.
- `--depth <n>` — limit TOC to headings at depth `<= n`. Default: all depths.
- `--output <terminal|markdown|json>` — matches the rest of the `plan` group's `--output` flag ([src/cli/commands/plan.ts:368](../../../../../src/cli/commands/plan.ts#L368)). Default: `terminal`.

JSON output shape:

```json
{
  "file": "docs/plans/markdown-reader.md",
  "frontmatter": { "status": "draft", "owner": "kjopek" },
  "sections": [
    { "number": "1", "title": "Problem", "depth": 2 },
    { "number": "2", "title": "User-facing shape", "depth": 2 },
    { "number": "2.1", "title": "Command: plan markdown-read", "depth": 3 }
  ]
}
```

### Command: `plan markdown-read-section`

Returns the body of one section (the heading and everything under it until the next heading of equal or shallower depth). Children of the section are included.

CLI:

```text
$ poe-code plan markdown-read-section <file> <section>
$ poe-code plan markdown-read-section ./docs/plans/markdown-reader.md 2.1

## Command: `plan markdown-read`

Returns the table of contents and the frontmatter, not the body. ...
```

`<section>` accepts either:

- Numeric path: `2.1`
- Full heading text: `"Command: plan markdown-read"` (quoted because spaces)

Flags:

- `<file>` (positional).
- `<section>` (positional) — number or heading text.
- `--include-children / --no-include-children` — default on. When off, returns only the content between this heading and the next heading at any depth (i.e. no nested sections).
- `--output <terminal|markdown|json>` — default `markdown` (the raw body is what callers almost always want).

JSON output shape:

```json
{
  "file": "docs/plans/markdown-reader.md",
  "section": {
    "number": "2.1",
    "title": "Command: plan markdown-read",
    "depth": 3
  },
  "markdown": "## Command: `plan markdown-read`\n\nReturns the table of contents ..."
}
```

### Command: `plan markdown-reader-mcp`

Starts a stdio MCP server exposing the two tools above. Follows the [packages/terminal-pilot-mcp](../../../../../packages/terminal-pilot-mcp) pattern: `runMCP(group, { name, version })` from `toolcraft/mcp`.

CLI:

```text
$ poe-code plan markdown-reader-mcp
# (blocks, reading MCP JSON-RPC on stdin / writing on stdout)
```

No flags. The server is minimal by design; configuration happens in the MCP client.

Agent-side configuration example (Claude Code `~/.claude.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "markdown-reader": {
      "command": "poe-code",
      "args": ["plan", "markdown-reader-mcp"]
    }
  }
}
```

MCP tool names exposed by this server (derived by toolcraft from command names with the root prefix omitted):

- `read` — params `{ file, depth? }`.
- `read_section` — params `{ file, section, includeChildren? }`.

### Error cases users see

- File does not exist → `UserError: file not found: <path>` (printed on CLI; returned as MCP tool error).
- Section id does not resolve → `UserError: no section matching "<id>" (try 'plan markdown-read' to see the table of contents)`.
- Ambiguous full-heading match (two headings with identical text) → `UserError: multiple sections match "<id>" (use numeric path e.g. 2.1)`.

### SDK

```ts
import { readMarkdown, readSection } from "@poe-code/markdown-reader";

const { frontmatter, sections } = await readMarkdown({ file });
const { markdown, section } = await readSection({ file, section: "2.1" });
```

## 3. Implementation details and technical decisions

### Where the code lives

- New workspace package `packages/markdown-reader` (internal; `private: true`) published as `@poe-code/markdown-reader`.
- Internal layout:
  - `src/index.ts` — SDK barrel: `readMarkdown`, `readSection`, plus `markdownGroup` and `runMarkdownReaderMcp` re-exports.
  - `src/core/scan.ts` — thin AST walker: maps design-system `MdNode`s into the local `Section[]` shape using `range` offsets already on the AST.
  - `src/core/resolve.ts` — numeric/title → `Section` resolver.
  - `src/core/read-markdown.ts`, `src/core/read-section.ts` — orchestrators used by both the SDK and MCP tool handlers. File I/O goes through an injectable `fs` so tests use `memfs`.
  - `src/mcp/tools.ts` — two `defineCommand` entries (`scope: ["mcp"]`) that wrap the orchestrators as MCP tools.
  - `src/mcp/group.ts` — `markdownGroup = defineGroup({ name: "markdown-reader", scope: ["mcp"], children: [readTool, readSectionTool] })`.
  - `src/mcp/run.ts` — `runMarkdownReaderMcp()` → `runMCP(markdownGroup, { name: "markdown-reader", version, omitRootToolNamePrefix: true })` from `toolcraft/mcp`. Mirrors [packages/terminal-pilot-mcp/src/index.ts](../../../../../packages/terminal-pilot-mcp/src/index.ts).
  - `src/testing/fixtures/*.md` — static sample docs used by unit tests.
- CLI wiring lives in [src/cli/commands/plan.ts](../../../../../src/cli/commands/plan.ts). Three new commander subcommands under the existing `plan` group:
  - `plan markdown-read` — imports `readMarkdown` from `@poe-code/markdown-reader`, prints via the existing `writeOutput` + `resolveOutputOption` helpers in that file (`terminal` / `md` / `json`).
  - `plan markdown-read-section` — imports `readSection`, same output treatment; default format is `markdown`.
  - `plan markdown-reader-mcp` — imports `runMarkdownReaderMcp` and awaits it. No flags.
- [src/cli/program.ts](../../../../../src/cli/program.ts) `ROOT_HELP_COMMAND_SPECS` gets three new rows under the `plan` prefix.
- `@poe-code/markdown-reader` is **not** registered in `src/cli/mcp-server.ts`. The tools live inside the standalone `markdown-reader-mcp` server only — per user requirement that this be a standalone server, not part of `poe-code mcp serve`.

### Parsing strategy — extend the shared AST with source positions

Section 1's direction stands: reuse `toolcraft-design`'s parser. The only thing missing is **source positions on AST nodes** ([packages/toolcraft-design/src/terminal-markdown/ast.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/ast.ts)). Rather than duplicate a scanner here, the plan extends the shared parser so every node carries a byte range. This benefits any future caller that needs round-trip source slicing (doc-lint, superintendent tooling, alternate renderers) and keeps exactly one markdown parser in the monorepo.

Changes to `toolcraft-design` (in the same PR as `packages/markdown-reader`, since this is the motivating consumer):

1. Add an optional `range: { start: number; end: number }` field to `MdNode`. Offsets are byte indices into the input passed to `parse()`. `end` is exclusive. BOM is preserved in the input so offsets line up with the file buffer.
2. Capture offsets in `parser/block.ts`. The parser already threads a `state.position` cursor and a `readLine` helper that returns `{ start, nextPosition }` ([packages/toolcraft-design/src/terminal-markdown/parser/block.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/parser/block.ts)). Every block rule:
   - Records `rangeStart = state.position` **before** consuming input.
   - Sets `node.range = { start: rangeStart, end: state.position }` **after** advancing.
3. `parser/frontmatter.ts` — the frontmatter node gets a `range` covering the opening `---` through the closing fence (inclusive of its trailing newline).
4. `parser/inline.ts` — inline nodes also get ranges. Cheap (the inline parser already tracks offsets) and useful. Tests for v1 only assert block-level ranges; inline coverage is bonus.
5. Public API is **additive**: `parse()` still returns `{ frontmatter?, ast }`. Existing callers (terminal renderer, tests) keep working with no changes. The new field is optional in the type.

In `packages/markdown-reader`, `src/core/scan.ts` is then a ~30-line AST walker: call `parse(source)`, iterate `ast.children`, pick heading nodes in document order, map each to a `Section` using `node.range` directly. Body extraction is `source.slice(thisHeading.range.start, nextSectionStart)`. No parallel parser, no fence tracking, no ATX/Setext branching — all inherited. Frontmatter likewise comes from `parse().frontmatter`, so the dedicated `src/core/frontmatter.ts` goes away.

### Walking the AST

- `scanMarkdown(source)` = `parse(source).ast.children.filter(node => node.type === "heading")`, producing `Section[]` in document order.
- Depth, and `range` come straight from the node.
- Title text: flatten the heading's `children` (strip `inlineCode`/`emphasis`/`strong`/`link` markup to plain text) via a tiny local helper in `src/core/scan.ts`. The existing design-system renderer is overkill — we only need a readable TOC line.
- `headingStart` = `heading.range.start`. `bodyStart` = `heading.range.end` (first char after the heading line — the parser consumes the trailing newline).
- `bodyEnd` (with children) = start of the next heading with `depth <= this.depth`, or `source.length`.
- `bodyEndNoChildren` = start of the next heading at any depth, or `source.length`.
- Setext headings are supported automatically — [parser/block.ts:347 parseSetextHeading](../../../../../packages/toolcraft-design/src/terminal-markdown/parser/block.ts#L347) already emits a `heading` node for them.

### Numbering rule

Matches the section-2 example (where `## 1. Problem` is section "1" and there is no section for the document title):

- Identify the **numbering baseline depth** = shallowest heading depth in the document, unless a leading depth-1 heading exists at the very top (first non-frontmatter heading, and the only depth-1 heading in the file), in which case the baseline is max(2, next-shallowest).
- Headings shallower than the baseline receive `number: null` (they still appear in the TOC unless filtered by `--depth`).
- Headings at the baseline are numbered 1, 2, 3 in order. Children at baseline+1 reset their counter each time a new parent opens: 1.1, 1.2, 2.1, 2.1.1, etc.
- If the doc has no leading h1 and the shallowest is h2, baseline = 2; same scheme.

### Section resolution

`resolveSection(sections, id)` tries, in order:

1. Numeric path match (exact string equality on computed `number`).
2. Title match (exact, after trimming). Multiple hits → `UserError("multiple sections match …")`.

No fuzzy matching, no slugs. If nothing hits, throw `UserError("no section matching \"<id>\" (try 'read-markdown' to see the table of contents)")`.

### Flags, env vars, config

- Flags listed in section 2 are the complete surface. No env vars. No config knobs.
- Formats: `rich` (default for `read`), `markdown` (default for `read-section`), `json` — all standard toolcraft renderers.
- No caching. Re-read on every call; files are small and callers already decide when to invoke.

### Edge cases

- File missing → `UserError("file not found: <path>")`.
- File exists but unreadable (permission) → bubble the underlying errno with `UserError`.
- Empty file → `frontmatter: {}`, `sections: []`. `read-section` on an empty file → `UserError` from the resolver.
- Frontmatter only, no body → same as above.
- Malformed YAML frontmatter → `UserError("invalid frontmatter in <path>: <reason>")`.
- Heading inside a fenced code block → ignored (the shared parser does not emit headings inside fenced blocks).
- Duplicate heading text → resolution by title becomes ambiguous (`UserError`); callers fall back to numeric path. Numbering keeps incrementing normally.
- `--depth 0` → empty TOC. `--depth` below 1 not rejected; just returns nothing.
- `--include-children=false` on a leaf section → body stops at EOF or next heading (same as default).
- Paths: accept relative and absolute; resolve against `process.cwd()` for relative.

### Open questions

- Open question: should `read-section` also return the frontmatter (useful when the section is the first one and the caller wants context)? Current plan: no, keep it strictly "section body". Callers who want frontmatter call `read-markdown`.
- Open question: do we expose a flag to include the heading line itself or return only the content under the heading? Current plan: always include the heading (matches the `## Command: ...` example in section 2).

## 4. Interfaces and test plan

### Module boundaries (TypeScript)

```ts
// src/core/scan.ts
export interface Section {
  depth: number; // 1..6
  title: string; // raw heading text, trimmed
  number: string | null; // "2.1" — null when heading is shallower than numbering baseline
  headingStart: number; // byte offset in the original buffer
  bodyStart: number; // byte offset right after the heading line's newline
  bodyEnd: number; // exclusive; next heading with depth <= this.depth, or EOF
  bodyEndNoChildren: number; // exclusive; next heading at any depth, or EOF
}

export function scanMarkdown(source: string): Section[];

// src/core/resolve.ts
export function resolveSection(sections: Section[], id: string): Section; // throws UserError

// src/index.ts — SDK
export interface ReadMarkdownParams {
  file: string;
  depth?: number;
}
export interface TocEntry {
  depth: number;
  number: string | null;
  title: string;
}
export interface ReadMarkdownResult {
  file: string;
  frontmatter: Record<string, unknown>;
  sections: TocEntry[];
}
export function readMarkdown(params: ReadMarkdownParams): Promise<ReadMarkdownResult>;

export interface ReadSectionParams {
  file: string;
  section: string;
  includeChildren?: boolean; // default true
}
export interface ReadSectionResult {
  file: string;
  section: TocEntry;
  markdown: string;
}
export function readSection(params: ReadSectionParams): Promise<ReadSectionResult>;

export { markdownGroup } from "./group.js";
```

### MCP tool and group shape

toolcraft `defineCommand` with `scope: ["mcp"]` only — the CLI surface is delivered through commander subcommands in `plan.ts`, not through toolcraft's CLI renderer. Pattern follows [packages/superintendent/src/commands/superintendent-group.ts:25-65](../../../../../packages/superintendent/src/commands/superintendent-group.ts#L25-L65) for the `defineCommand` block and [packages/terminal-pilot-mcp/src/index.ts](../../../../../packages/terminal-pilot-mcp/src/index.ts) for the `runMCP` entry:

```ts
// src/mcp/tools.ts
export const readTool = defineCommand({
  name: "read",
  description: "Read the table of contents and frontmatter of a markdown file.",
  params: S.Object({
    file: S.String({ description: "Path to the markdown file" }),
    depth: S.Optional(S.Number({ description: "Limit TOC to headings at depth <= n" }))
  }),
  scope: ["mcp"],
  handler: async ({ params }) => readMarkdown(params)
});

// src/mcp/group.ts
export const markdownGroup = defineGroup({
  name: "markdown-reader",
  description: "Read markdown files section-by-section.",
  scope: ["mcp"],
  children: [readTool, readSectionTool]
});

// src/mcp/run.ts
export async function runMarkdownReaderMcp(): Promise<void> {
  await runMCP(markdownGroup, {
    name: "markdown-reader",
    version: packageJson.version,
    omitRootToolNamePrefix: true
  });
}
```

The commander subcommands in `plan.ts` do **not** go through toolcraft; they call `readMarkdown` / `readSection` directly and print with the existing `writeOutput` helper in that file. This matches how `plan view` currently works.

### Test plan

All tests are vitest, colocated, run under the package's `npm test` script that uses the repo-root vitest (mirrors [packages/toolcraft-openapi/package.json](../../../../../packages/toolcraft-openapi/package.json)). File I/O in tests uses `memfs` per project instructions.

- `toolcraft-design` — new tests in `packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts` (or a new `parser-range.test.ts` if the existing file is large): assert `range.start` / `range.end` on heading, paragraph, code block, list, and frontmatter nodes across representative fixtures. These lock the new position invariant so future parser changes do not silently break consumers.
- `scan.test.ts` (covers the walker + numbering only — fence / CRLF / BOM / ATX-vs-Setext are the shared parser's responsibility):
  - Fresh scan of the plan itself (fixture) — asserts the exact TOC produced and that body slices round-trip source byte-for-byte.
  - Leading h1 title + h2 body → baseline 2, title numbered `null`.
  - Doc with only h3s → baseline 3, first h3 numbered `1`.
  - Deep nesting h2→h3→h4 → `1`, `1.1`, `1.1.1`.
  - Setext heading (`===` underline) → depth 1 and body slice round-trips exactly (regression guard against the shared parser losing positions on setext).
  - Empty input → `[]`.
- `resolve.test.ts`:
  - Resolves by number and by title (two hits on the same section).
  - Missing id → `UserError` message names the id and points to `read-markdown`.
  - Ambiguous title → `UserError` suggests using the numeric path.
- `read-markdown.test.ts` / `read-section.test.ts` (orchestrator tests, memfs):
  - Happy path read on a fixture doc (matches snapshot).
  - `--depth 2` filter.
  - Missing file → `UserError`.
  - `read-section` by number and by title return identical `markdown`.
  - `--no-include-children` stops at next heading of any depth.
  - Body slice preserves fenced code blocks and trailing blank lines exactly.
- `commands/read.test.ts`, `commands/read-section.test.ts`:
  - Invoke via toolcraft's test harness (see `packages/toolcraft-openapi/src/*.test.ts` for the pattern). Assert JSON renderer output for deterministic assertions; a separate snapshot asserts the rich render.
- Snapshots live at `packages/markdown-reader/src/__snapshots__/`. Fixtures are checked-in markdown files in `src/testing/fixtures/` so they do not drift when `docs/plans/` changes.

### Rollout / migration

- New package; no callers to migrate. No `plan markdown-*` subcommands exist today (grep of [src/cli/commands/plan.ts](../../../../../src/cli/commands/plan.ts) confirms).
- After wiring, `poe-code plan --help` must list the three new subcommands alongside the existing `browse`, `view`, `edit`, `archive`, `delete`, `install`, `list`.
- `poe-code plan markdown-reader-mcp` must pass an MCP handshake smoke test (see acceptance checklist).

### Autonomy checklist

- **Acceptance criteria** (all must pass before declaring done):
  - `npm run build --workspace=@poe-code/markdown-reader` succeeds.
  - `npm test --workspace=@poe-code/markdown-reader` passes, with ≥90% line coverage on `src/core/**`.
  - `npm run build` at the repo root succeeds (main CLI picks up the new package).
  - `npm run dev -- plan markdown-read docs/plans/markdown-reader.md` prints a TOC that includes `2.1    Command: plan markdown-read`.
  - `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md 2.1` prints a body starting with `### Command: \`plan markdown-read\``.
  - `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md "Command: plan markdown-read"` returns the same body.
  - `npm run dev -- plan markdown-read missing.md` exits non-zero with a `UserError`-style message, not a stack trace.
  - `npm run dev -- plan --help` shows the three new subcommands.
  - `npm run dev -- plan markdown-reader-mcp` passes an MCP handshake smoke test: an `initialize` request over stdio returns a capabilities payload, a `tools/list` request returns exactly `read` and `read_section`, and a `tools/call` on `read` with `{ file: "docs/plans/markdown-reader.md" }` returns a TOC. Pattern to copy: [packages/terminal-pilot-mcp/scripts/smoke-test.ts](../../../../../packages/terminal-pilot-mcp/scripts/smoke-test.ts).
  - `npm run screenshot-poe-code -- plan markdown-read docs/plans/markdown-reader.md` — visually validate the terminal renderer once, attach to PR.
- **Verification commands** (exact): `npm run build`, `npm test`, `npm run lint`, `npm run dev -- plan markdown-read docs/plans/markdown-reader.md`, `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md 2.1`, `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md 2.1 --no-include-children`, MCP smoke script against `npm run dev -- plan markdown-reader-mcp`.
- **Fixtures / setup**: none external. All fixtures are in-repo markdown strings under `src/testing/fixtures/`.
- **Decisions already locked**: package name, command names, parser strategy (extend design-system AST with `range` and walk it — no parallel scanner), numbering rule, ATX and Setext both supported (inherited), resolver precedence (numeric then title — no slugs), output defaults, no caching, standalone MCP server (not in `poe-code mcp serve`).
- **Decisions the agent may make alone**: internal file splits, private helper names, snapshot formatting, whether to break `scan.ts` into multiple files if it grows, test helper utilities.
- **Stop and escalate when**:
  - Adding `range` to `MdNode` forces a visible change to `toolcraft-design`'s public `parse()` signature or breaks the terminal renderer's snapshots. (Additive is the whole point; if it cannot be additive, surface the tradeoff.)
  - `toolcraft-design`'s `parse()` throws on frontmatter that previously worked (regression outside this package's scope).
  - The top-level CLI registration pattern changes mid-flight (e.g. `ROOT_HELP_COMMAND_SPECS` is refactored).
  - A name collision surfaces during `npm install` (e.g. another package declares `@poe-code/markdown-reader`).

## 5. Code plan

### New files

- `packages/markdown-reader/package.json` — name `@poe-code/markdown-reader`, `private: true`, type `module`, deps `toolcraft`, `toolcraft-schema`, `toolcraft-design`. Scripts mirror [packages/toolcraft-openapi/package.json](../../../../../packages/toolcraft-openapi/package.json) (`build`, `test`, `test:unit`).
- `packages/markdown-reader/tsconfig.json` — extends workspace base, `outDir: dist`.
- `packages/markdown-reader/README.md` — per the package README rule. Sections: overview, SDK usage, MCP tool names, standalone server invocation (`poe-code plan markdown-reader-mcp`), example agent config. No env vars, no config.
- `packages/markdown-reader/src/index.ts` — exports `readMarkdown`, `readSection`, `markdownGroup`, `runMarkdownReaderMcp`.
- `packages/markdown-reader/src/core/scan.ts` — `scanMarkdown(source)` (AST walker).
- `packages/markdown-reader/src/core/resolve.ts` — `resolveSection(sections, id)`.
- `packages/markdown-reader/src/core/read-markdown.ts` — `readMarkdown(params)` orchestrator.
- `packages/markdown-reader/src/core/read-section.ts` — `readSection(params)` orchestrator.
- `packages/markdown-reader/src/mcp/tools.ts` — `readTool`, `readSectionTool` (toolcraft `defineCommand` with `scope: ["mcp"]`).
- `packages/markdown-reader/src/mcp/group.ts` — `markdownGroup` (`defineGroup`, scope `["mcp"]`, name `"markdown-reader"`).
- `packages/markdown-reader/src/mcp/run.ts` — `runMarkdownReaderMcp()` wrapping `runMCP(markdownGroup, ...)`.
- `packages/markdown-reader/src/core/*.test.ts`, `src/mcp/*.test.ts` — colocated vitest.
- `packages/markdown-reader/src/testing/fixtures/simple.md`, `nested.md`, `with-frontmatter.md`, `with-fenced-code.md` — fixtures.
- `packages/markdown-reader/src/__snapshots__/` — created by vitest on first run.

### Files to change

- [packages/toolcraft-design/src/terminal-markdown/ast.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/ast.ts): add optional `range?: { start: number; end: number }` to the `MdNode` union. Export the range type so consumers can narrow.
- [packages/toolcraft-design/src/terminal-markdown/parser/block.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/parser/block.ts): capture `state.position` before each block rule runs and attach `range` to every node it returns. One touch per `parseAtxHeading`, `parseSetextHeading`, `parseParagraph`, `parseCodeBlock`, `parseList`, `parseBlockquote`, `parseTable`, `parseHtmlBlock`, `parseThematicBreak`, `parseAlert`, `parseFootnoteDefinition`.
- [packages/toolcraft-design/src/terminal-markdown/parser/frontmatter.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/parser/frontmatter.ts): return the byte range of the frontmatter block alongside the existing payload; `parser.ts` attaches it to the synthesized frontmatter node.
- [packages/toolcraft-design/src/terminal-markdown/parser/inline.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/parser/inline.ts): same treatment for inline nodes. Lowest priority; include in this PR because the plumbing is already there.
- [packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts](../../../../../packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts): add positional assertions across a representative fixture.
- [src/cli/commands/plan.ts](../../../../../src/cli/commands/plan.ts):
  - Add `import { readMarkdown, readSection, runMarkdownReaderMcp } from "@poe-code/markdown-reader";` at the top.
  - Inside `registerPlanCommand`, add three `plan.command(...)` blocks alongside the existing `browse` / `view` / `edit` / `archive` / `delete` / `install` / `list` subcommands:
    - `plan.command("markdown-read").argument("<file>").option("--depth <n>").option("--output <format>")` — action calls `readMarkdown` and prints via the existing `writeOutput` / `resolveOutputOption` helpers.
    - `plan.command("markdown-read-section").argument("<file>").argument("<section>").option("--no-include-children").option("--output <format>")` — action calls `readSection`, default output `markdown`.
    - `plan.command("markdown-reader-mcp")` — action awaits `runMarkdownReaderMcp()`. No flags.
- [src/cli/program.ts](../../../../../src/cli/program.ts) `ROOT_HELP_COMMAND_SPECS` (lines 61-95): add three rows: `{ path: ["plan", "markdown-read"], args: "<file>" }`, `{ path: ["plan", "markdown-read-section"], args: "<file> <section>" }`, `{ path: ["plan", "markdown-reader-mcp"] }`.
- Root `package.json` / workspace glob: the existing `packages/*` glob covers the new folder; no edit needed. Verify with `npm install` after creating the package.
- `src/cli/mcp-server.ts`: **no change**. The markdown-reader MCP tools are intentionally excluded from the central `poe-code mcp serve` — they only surface through the standalone `plan markdown-reader-mcp` server.

### Function signatures (new or noteworthy)

```ts
// src/core/scan.ts
export function scanMarkdown(source: string): Section[];

// src/core/resolve.ts
export function resolveSection(sections: Section[], id: string): Section;

// src/core/read-markdown.ts
export function readMarkdown(params: ReadMarkdownParams): Promise<ReadMarkdownResult>;

// src/core/read-section.ts
export function readSection(params: ReadSectionParams): Promise<ReadSectionResult>;

// src/mcp/run.ts
export function runMarkdownReaderMcp(): Promise<void>;
```

### Build order (keeps the branch green at every step)

1. **Extend the shared AST first.** In `toolcraft-design`: add `range` to `MdNode`, thread offset capture through `parser/block.ts` + `parser/frontmatter.ts` + `parser/inline.ts`, add positional assertions to `terminal-markdown.test.ts`. Run `npm run build` + `npm test --workspace=toolcraft-design` — green, terminal-markdown renderer snapshots unchanged.
2. Create `packages/markdown-reader`: `package.json` + `tsconfig.json` + empty `src/index.ts`. Run `npm install` and `npm run build` — green.
3. `src/core/scan.ts` + `scan.test.ts` with fixtures. Green. The walker is small; complexity now lives in the shared parser.
4. `src/core/resolve.ts` + `resolve.test.ts`. Green.
5. `src/core/read-markdown.ts` + `read-section.ts` + their tests (memfs). Green. SDK surface is now usable.
6. `src/mcp/tools.ts` + `src/mcp/group.ts` + `src/mcp/run.ts` + unit tests (mock stdio transport, assert tool list + one `tools/call` succeeds). Green.
7. `src/index.ts` barrel exports. Green.
8. Wire the three commander subcommands into [src/cli/commands/plan.ts](../../../../../src/cli/commands/plan.ts). Add three `ROOT_HELP_COMMAND_SPECS` rows in [src/cli/program.ts](../../../../../src/cli/program.ts). Root `npm run build` + `npm run dev -- plan --help` shows the new subcommands.
9. Write `README.md` (SDK + MCP usage, agent config example).
10. Run the full acceptance checklist (§4), including the MCP handshake smoke test. Take a screenshot of `plan markdown-read` for visual validation. Done.
