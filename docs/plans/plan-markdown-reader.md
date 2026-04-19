---
kind: pipeline
vars:
  plan_doc: "{{file 'docs/plans/markdown-reader.md'}}"

tasks:
  - id: extend-ast-range
    title: Add byte ranges to design-system markdown AST
    prompt: |
      Extend `@poe-code/design-system`'s terminal-markdown parser so every AST node
      carries a `range: { start: number; end: number }` field (end exclusive, byte
      offsets into the input passed to `parse()`).

      Do exactly what section 3 "Parsing strategy — extend the shared AST with source
      positions" and section 5 "Files to change" describe — no more, no less:

      - `packages/design-system/src/terminal-markdown/ast.ts`: add optional `range?`
        on `MdNode` union. Export the range type.
      - `packages/design-system/src/terminal-markdown/parser/block.ts`: capture
        `state.position` before each block rule and attach `range` to every emitted
        node (ATX + Setext headings, paragraph, code block, list, blockquote, table,
        html block, thematic break, alert, footnote definition).
      - `packages/design-system/src/terminal-markdown/parser/frontmatter.ts`: return
        the frontmatter byte range; `parser.ts` attaches it to the synthesized node.
      - `packages/design-system/src/terminal-markdown/parser/inline.ts`: same
        treatment for inline nodes.
      - `packages/design-system/src/terminal-markdown/terminal-markdown.test.ts`:
        add positional assertions on heading, paragraph, code block, list, and
        frontmatter nodes. Existing renderer snapshots must stay unchanged.

      Constraints:
      - The change must be additive — `parse()` signature and return shape stay
        the same. Stop and escalate if additive isn't possible.
      - BOM preserved; offsets align with the file buffer.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: scaffold-package
    title: Scaffold packages/markdown-reader workspace package
    prompt: |
      Create the new workspace package `@poe-code/markdown-reader` scaffolding
      only — no logic yet. Follow section 5 "New files":

      - `packages/markdown-reader/package.json` — name `@poe-code/markdown-reader`,
        `private: true`, `type: module`. Deps: `@poe-code/cmdkit`,
        `@poe-code/cmdkit-schema`, `@poe-code/design-system`. Scripts mirror
        `packages/cmdkit-openapi/package.json` (build, test, test:unit).
      - `packages/markdown-reader/tsconfig.json` extending workspace base,
        `outDir: dist`.
      - `packages/markdown-reader/src/index.ts` — empty barrel placeholder.
      - `packages/markdown-reader/src/testing/fixtures/` with `simple.md`,
        `nested.md`, `with-frontmatter.md`, `with-fenced-code.md` fixtures that
        the later unit tests will consume.

      Verify: `npm install` succeeds and `npm run build` at the root stays green.
      Do NOT write README yet (later task).

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: core-scan
    title: Implement scanMarkdown walker with numbering
    prompt: |
      Implement `packages/markdown-reader/src/core/scan.ts` per section 3
      "Walking the AST" and "Numbering rule", plus `scan.test.ts` per section 4
      "Test plan" (the scan.test.ts bullet list).

      Surface:
      ```ts
      export interface Section {
        depth: number;
        title: string;
        number: string | null;
        headingStart: number;
        bodyStart: number;
        bodyEnd: number;
        bodyEndNoChildren: number;
      }
      export function scanMarkdown(source: string): Section[];
      ```

      Rules to honor exactly:
      - Use `parse(source).ast.children` from `@poe-code/design-system`. Do not
        write a parallel scanner.
      - Numbering baseline = shallowest heading depth, unless a single leading
        depth-1 heading exists, then baseline = max(2, next-shallowest).
        Shallower-than-baseline headings → `number: null`.
      - Children reset per parent: 1, 1.1, 1.2, 2, 2.1, 2.1.1 …
      - Setext headings work via the shared parser (include a regression test).
      - Title text: flatten heading children (strip inlineCode/emphasis/strong/
        link markup) with a small local helper — do not pull in the renderer.

      Tests (vitest, colocated):
      - Scan the plan itself (fixture) — assert exact TOC; body slices round-trip
        source byte-for-byte.
      - Leading h1 + h2 body → baseline 2, title `null`.
      - Only h3s → baseline 3, first h3 numbered `1`.
      - h2→h3→h4 nesting → 1, 1.1, 1.1.1.
      - Setext `===` heading → depth 1, body slice round-trips.
      - Empty input → `[]`.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: core-resolve
    title: Implement resolveSection (numeric-then-title)
    prompt: |
      Implement `packages/markdown-reader/src/core/resolve.ts` plus
      `resolve.test.ts` per section 3 "Section resolution" and section 4
      "resolve.test.ts".

      Surface:
      ```ts
      export function resolveSection(sections: Section[], id: string): Section;
      ```

      Order of attempts:
      1. Exact numeric path match on computed `number`.
      2. Exact title match after trimming.

      Errors (throw `UserError`):
      - No match → `no section matching "<id>" (try 'read-markdown' to see the
        table of contents)`.
      - Multiple title hits → `multiple sections match "<id>" (use numeric path
        e.g. 2.1)`.

      No fuzzy matching. No slugs.

      Tests:
      - Resolves by number and by title on the same section.
      - Missing id → UserError naming the id.
      - Ambiguous title → UserError suggesting the numeric path.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: core-orchestrators
    title: Implement readMarkdown and readSection orchestrators
    prompt: |
      Implement `packages/markdown-reader/src/core/read-markdown.ts` and
      `src/core/read-section.ts` plus their tests per section 2 (JSON shapes),
      section 3 "Edge cases", and section 4 "read-markdown.test.ts" /
      "read-section.test.ts".

      SDK surface (already spec'd in section 4):
      ```ts
      export interface ReadMarkdownParams { file: string; depth?: number; }
      export interface TocEntry { depth: number; number: string | null; title: string; }
      export interface ReadMarkdownResult {
        file: string;
        frontmatter: Record<string, unknown>;
        sections: TocEntry[];
      }
      export function readMarkdown(params: ReadMarkdownParams): Promise<ReadMarkdownResult>;

      export interface ReadSectionParams {
        file: string;
        section: string;
        includeChildren?: boolean;
      }
      export interface ReadSectionResult {
        file: string;
        section: TocEntry;
        markdown: string;
      }
      export function readSection(params: ReadSectionParams): Promise<ReadSectionResult>;
      ```

      Behavior:
      - File I/O via injectable `fs` (tests use `memfs` per CLAUDE.md — tests must
        not touch disk).
      - Accept relative and absolute paths; resolve relatives against
        `process.cwd()`.
      - `readSection` always includes the heading line itself. `includeChildren`
        defaults to `true`.
      - Frontmatter comes from `parse(source).frontmatter`.

      UserError cases:
      - Missing file → `file not found: <path>`.
      - Unreadable → bubble errno as `UserError`.
      - Malformed YAML frontmatter → `invalid frontmatter in <path>: <reason>`.
      - Empty file / frontmatter-only → empty sections; `readSection` throws
        from the resolver.
      - `--depth 0` → empty TOC; depth < 1 not rejected.

      Tests (memfs):
      - Happy path read on a fixture (snapshot).
      - `depth: 2` filter.
      - Missing file → UserError.
      - `readSection` by number and by title return identical `markdown`.
      - `includeChildren: false` stops at next heading of any depth.
      - Body slice preserves fenced code blocks and trailing blank lines
        exactly.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: mcp-server
    title: Implement standalone markdown-reader MCP server
    prompt: |
      Implement the standalone MCP server per section 2 "Command:
      `plan markdown-reader-mcp`", section 3 "Where the code lives", and
      section 4 "MCP tool and group shape". Mirror
      `packages/terminal-pilot-mcp/src/index.ts`.

      Files:
      - `packages/markdown-reader/src/mcp/tools.ts` — `readTool` and
        `readSectionTool` using cmdkit `defineCommand` with `scope: ["mcp"]`.
        Params use cmdkit-schema `S.Object`/`S.String`/`S.Number`/`S.Optional`.
        Handlers call `readMarkdown` / `readSection`.
      - `packages/markdown-reader/src/mcp/group.ts` —
        `markdownGroup = defineGroup({ name: "markdown-reader", scope: ["mcp"],
        children: [readTool, readSectionTool] })`.
      - `packages/markdown-reader/src/mcp/run.ts` —
        `runMarkdownReaderMcp()` calling `runMCP(markdownGroup, { name:
        "markdown-reader", version })` from `@poe-code/cmdkit/mcp`.

      Exposed tool names (derived by cmdkit from group + command name):
      - `markdown_reader__read` — params `{ file, depth? }`.
      - `markdown_reader__read_section` — params `{ file, section,
        includeChildren? }`.

      Unit tests: mock stdio transport, assert the tool list contains exactly
      the two names, and one `tools/call` on `markdown_reader__read` succeeds.

      IMPORTANT: do NOT register this in `src/cli/mcp-server.ts`. It is a
      standalone server only. This is a locked decision.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: sdk-barrel
    title: Wire SDK barrel exports
    prompt: |
      Finalize `packages/markdown-reader/src/index.ts` as the public SDK barrel
      per section 3 internal layout and section 4 module boundaries:

      ```ts
      export { readMarkdown } from "./core/read-markdown.js";
      export { readSection } from "./core/read-section.js";
      export { markdownGroup } from "./mcp/group.js";
      export { runMarkdownReaderMcp } from "./mcp/run.js";
      export type {
        ReadMarkdownParams, ReadMarkdownResult,
        ReadSectionParams, ReadSectionResult,
        TocEntry,
      } from "./core/read-markdown.js"; // adjust per actual type locations
      ```

      Verify: `npm run build --workspace=@poe-code/markdown-reader` succeeds
      and a fresh `import { readMarkdown, readSection } from
      "@poe-code/markdown-reader"` typechecks from another package.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: cli-wiring
    title: Wire plan markdown-read / markdown-read-section / markdown-reader-mcp
      commander subcommands
    prompt: |
      Wire the three new commander subcommands into the existing `plan` group
      per section 2 "User-facing shape" and section 5 "Files to change".

      In `src/cli/commands/plan.ts`:
      - Add `import { readMarkdown, readSection, runMarkdownReaderMcp } from
        "@poe-code/markdown-reader";`.
      - Inside `registerPlanCommand`, add three `plan.command(...)` blocks
        alongside the existing `browse` / `view` / `edit` / `archive` /
        `delete` / `install` / `list`:
        - `markdown-read <file>` with `--depth <n>` and `--output <format>`.
          Default output: `terminal`. Action: call `readMarkdown`, print via
          existing `writeOutput` + `resolveOutputOption` helpers.
        - `markdown-read-section <file> <section>` with
          `--no-include-children` and `--output <format>`. Default output:
          `markdown`. Action: call `readSection`.
        - `markdown-reader-mcp` — no flags. Action: `await
          runMarkdownReaderMcp()`.

      In `src/cli/program.ts` `ROOT_HELP_COMMAND_SPECS`, add three rows under
      the `plan` prefix:
      - `{ path: ["plan", "markdown-read"], args: "<file>" }`
      - `{ path: ["plan", "markdown-read-section"], args: "<file> <section>" }`
      - `{ path: ["plan", "markdown-reader-mcp"] }`

      Do NOT touch `src/cli/mcp-server.ts` — standalone only.

      Verify:
      - `npm run build` at the root is green.
      - `npm run dev -- plan --help` lists the three new subcommands beside
        the existing ones.
      - `npm run dev -- plan markdown-read docs/plans/markdown-reader.md`
        prints a TOC that includes `2.1    Command: plan markdown-read`.
      - `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md
        2.1` prints a body starting with ``### Command: `plan markdown-read` ``.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: readme
    title: Write packages/markdown-reader/README.md
    prompt: |
      Write `packages/markdown-reader/README.md` per CLAUDE.md's "Package must
      have own readme" rule and section 5 "New files" → README bullet.

      Sections required:
      - Overview (what the package does, one paragraph).
      - SDK usage: import + call example for `readMarkdown` and `readSection`.
      - MCP tool names: `markdown_reader__read`, `markdown_reader__read_section`.
      - Standalone server invocation: `poe-code plan markdown-reader-mcp`.
      - Example agent configuration snippet (Claude Code `~/.claude.json` or
        `.mcp.json`) — mirror the JSON block in section 2.

      No env vars and no config to document. Do not pad the README with
      content not covered by the plan.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: acceptance
    title: Run full acceptance checklist and MCP handshake smoke test
    prompt: |
      Execute the acceptance checklist exactly as section 4 "Autonomy
      checklist" / "Acceptance criteria" demands. All must pass before marking
      done.

      Commands to run (exact):
      - `npm run build --workspace=@poe-code/markdown-reader`
      - `npm test --workspace=@poe-code/markdown-reader` — ≥90% line coverage
        on `src/core/**`.
      - `npm run build` at repo root.
      - `npm test` at repo root.
      - `npm run lint`.
      - `npm run dev -- plan markdown-read docs/plans/markdown-reader.md` —
        TOC must include `2.1    Command: plan markdown-read`.
      - `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md
        2.1` — body starts with ``### Command: `plan markdown-read` ``.
      - `npm run dev -- plan markdown-read-section docs/plans/markdown-reader.md
        "Command: plan markdown-read"` — same body.
      - `npm run dev -- plan markdown-read missing.md` — non-zero exit,
        `UserError`-style message (no stack trace).
      - `npm run dev -- plan --help` — shows three new subcommands.
      - MCP handshake smoke test against `npm run dev -- plan
        markdown-reader-mcp`: `initialize` returns capabilities; `tools/list`
        returns exactly `markdown_reader__read` and
        `markdown_reader__read_section`; `tools/call` on
        `markdown_reader__read` with `{ file:
        "docs/plans/markdown-reader.md" }` returns a TOC. Pattern to copy:
        `packages/terminal-pilot-mcp/scripts/smoke-test.ts`.
      - `npm run screenshot-poe-code -- plan markdown-read
        docs/plans/markdown-reader.md` — visually validate.

      Stop and escalate (per section 4) if:
      - Adding `range` broke the terminal renderer's snapshots or forced a
        non-additive change to `parse()`.
      - `parse()` regressed on previously-working frontmatter.
      - `ROOT_HELP_COMMAND_SPECS` registration pattern changed mid-flight.
      - A name collision surfaces on `npm install`.

      Full design context:
      {{plan_doc}}
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

# Context

This pipeline drives the build of `@poe-code/markdown-reader` — a cmdkit-powered
package that reads markdown files section-by-section and exposes three
surfaces: CLI subcommands under `poe-code plan`, a standalone stdio MCP server,
and a typed SDK.

The full design doc (problem, user-facing shape, implementation details,
interfaces and test plan, and code plan) lives at
[docs/plans/markdown-reader.md](markdown-reader.md) and is injected into every
task prompt via the `plan_doc` var. Each task is self-contained — the task
prompt names exactly which sections of the design doc are load-bearing for
that step.

## Build order rationale

The task order mirrors section 5 "Build order" which is designed to keep the
branch green at every step:

1. `extend-ast-range` lands first and in isolation — it's the one change
   outside the new package, and it must be additive (locked decision).
2. `scaffold-package` creates the empty workspace package so subsequent tasks
   can land inside it.
3. `core-scan` → `core-resolve` → `core-orchestrators` build the SDK bottom-up
   with colocated tests.
4. `mcp-server` wraps the SDK as cmdkit MCP commands.
5. `sdk-barrel` finalizes the public entry point.
6. `cli-wiring` surfaces everything through `poe-code plan`.
7. `readme` documents the result.
8. `acceptance` gates the whole thing behind the checklist plus MCP smoke
   test and visual screenshot.

## Locked decisions (do not relitigate)

From section 4 "Decisions already locked":

- Package name `@poe-code/markdown-reader`; command names `plan markdown-read`,
  `plan markdown-read-section`, `plan markdown-reader-mcp`.
- Parser strategy: extend `@poe-code/design-system`'s AST with `range` and
  walk it — no parallel scanner.
- Numbering baseline rule as described in section 3.
- ATX and Setext headings both supported (inherited from shared parser).
- Resolver precedence: numeric, then title, no slugs, no fuzzy.
- No caching.
- Standalone MCP server — NOT registered in `poe-code mcp serve`.

## Acceptance gate

The `acceptance` task is the only one that declares the work done. Earlier
tasks may pass their own tests but must not claim overall completion.
