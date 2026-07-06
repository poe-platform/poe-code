---
kind: pipeline
version: 1
tasks:
  - id: ast-types
    title: Define MdNode AST union type and barrel index
    prompt: >
      Create `packages/design-system/src/terminal-markdown/ast.ts`.


      Define the `MdNode` discriminated union type exactly as specified in the plan at

      `docs/plans/cli-markdown-renderer.md` (section "AST Node Types"). The type must cover:


      - root, heading (depth 1-6), paragraph, blockquote, code (with lang/meta), list
      (ordered/unordered with start),
        listItem (with checked for task lists), thematicBreak
      - table, tableRow, tableCell

      - html, text, emphasis, strong, strikethrough, inlineCode

      - link (url, title, children), image (url, alt, title), break

      - frontmatter (data: Record<string, unknown>)

      - GFM extensions: alert (kind: NOTE|TIP|IMPORTANT|WARNING|CAUTION), footnoteDefinition
      (label), footnoteReference (label)


      Export `MdNode` as a named export. This is a types-only file — no runtime code.


      Also create `packages/design-system/src/terminal-markdown/index.ts` as a barrel with

      placeholder exports (just re-export `MdNode` for now, the `parse`/`render`/`renderMarkdown`

      functions will be added in later tasks).


      Write a basic type-level test in `packages/design-system/src/terminal-markdown/parser.test.ts`

      that creates nodes of each type to verify the type definitions compile correctly.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-scaffold
    title: Block parser scaffold with fenced code blocks
    prompt: |
      Create `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Implement the block parser scaffold: a function `parseBlocks(input: string): MdNode[]`
      that processes a markdown string line-by-line through a rule chain.

      Start with only the FIRST and highest-priority rule:
      - **Fenced code blocks** (``` and ~~~) — with language specifier and meta string support

      Everything else falls through to paragraph (consecutive non-blank lines → single text node).

      Import `MdNode` from `../ast.js`.

      No regex for core parsing — use string scanning with position tracking.

      Edge cases to handle:
      - Fenced code block with backticks and tildes (tests 9, 10)
      - Language specifier and meta string (tests 11, 12)
      - Code block containing markdown-like content — must NOT be parsed (test 13)
      - Indented code blocks (4 spaces) (test 14)
      - Empty fenced code block (test 15)
      - Unclosed fenced code block — treat rest of doc as code (test 115)
      - Code fence with trailing spaces still closes (test 152)
      - Empty document / whitespace-only / newline-only → empty children (tests 79-81)
      - CRLF line endings (test 94)
      - BOM at start of document — strip silently (test 148)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-headings-breaks
    title: Add ATX/setext headings and thematic breaks
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add these rules to the block parser chain (checked AFTER fenced code blocks):

      **ATX headings** (# through ######):
      - Level 1-6 (tests 1-4)
      - Closing hashes `## Heading ##` (test 5)
      - With inline formatting placeholder — leave children as raw text for now (test 6)
      - Heading with no text after `#` → empty heading node (test 125)
      - 7+ `#` signs → paragraph, not heading (test 126)
      - Indented heading (up to 3 spaces) still parses (test 140)
      - Missing blank line before heading — heading wins (test 141)

      **Thematic breaks** (---, ***, ___):
      - All three variants (tests 16-18)
      - With spaces between characters `- - -` (test 19)

      **Setext headings** (= and - underlines):
      - `=` underline → h1 (test 7)
      - `-` underline → h2 (test 8)

      Add paragraph continuation logic:
      - Multiple blank lines between blocks collapse (test 82)
      - Paragraph continuation — no blank line between text lines (test 83)
      - Block-level content interrupts paragraph (test 84)

      Write tests for all above in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-blockquotes
    title: Add blockquote parsing with nesting
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add blockquote parsing to the rule chain (after thematic breaks, before paragraphs):

      - Single-line blockquote (test 20)
      - Multi-line blockquote (test 21)
      - Nested blockquotes `> > nested` (test 22)
      - Blockquote with other block elements inside — headings, lists, code blocks (test 23)
      - Deeply nested blockquotes 4+ levels (test 89)
      - Code block inside blockquote (test 87)
      - Trailing `>` on empty lines → empty blockquote (test 132)

      The blockquote parser should recursively invoke the block parser on the stripped
      content (lines with `> ` prefix removed), enabling nested block structures.

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-lists
    title: Add list parsing with nesting and task lists
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add list parsing (after blockquotes in the rule chain):

      **Unordered lists:**
      - `-`, `*`, `+` markers (tests 24-26)

      **Ordered lists:**
      - Starting at 1 (test 27)
      - Starting at arbitrary number (test 28)
      - Non-sequential numbers preserved (test 134)

      **Nesting:**
      - Nested unordered inside unordered (test 29)
      - Mixed nested: ordered inside unordered (test 30)

      **Task lists:**
      - Checked items `- [x] done` (test 74)
      - Unchecked items `- [ ] todo` (test 75)
      - Mixed task list (test 76)
      - Task list with inline formatting — leave as raw text for now (test 77)
      - Nested task list (test 78)

      **Continuation and edge cases:**
      - List item with multiple paragraphs via blank line (test 85)
      - List item continuation via indented text (test 86)
      - Missing blank line before list — list wins (test 143)
      - Tabs mixed with spaces — normalize tabs to 4 spaces (test 145)
      - Empty list items `- \n- \n` (test 133)
      - List item with sub-item that looks like thematic break (test 153)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-alerts
    title: Add GitHub alert/admonition parsing
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add GitHub alert/admonition parsing. Alerts are a special case of blockquotes —
      when a blockquote starts with `[!TYPE]` on the first line, parse it as an alert
      instead. This rule must be checked BEFORE regular blockquotes.

      Alert types: NOTE, TIP, IMPORTANT, WARNING, CAUTION.

      - All five alert types (tests 95-99)
      - Alert with multi-line content (test 100)
      - Alert with inline formatting inside — leave as raw text for now (test 101)
      - Alert with nested block elements like lists (test 102)
      - Alert with unknown type `> [!UNKNOWN]` → treat as regular blockquote (test 137)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-tables
    title: Add GFM pipe table parsing
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add GFM pipe table parsing to the rule chain:

      - Simple 2-column table (test 56)
      - Table with left/center/right alignment from separator row (test 57)
      - Table with inline formatting in cells — leave as raw text for now (test 58)
      - Table with empty cells (test 59)
      - Varying column counts — short rows padded (test 60)
      - Escaped pipes in cells `\|` (test 61)
      - No alignment row → NOT a table (test 62)
      - Minimal table: header + separator + 1 row (test 63)
      - With and without leading/trailing pipes (tests 64-65)
      - Separator row with wrong format → don't parse as table (test 129)
      - Header-only table (no data rows) → render header only (test 128)
      - Inconsistent column counts → pad/truncate gracefully (test 127)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: block-parser-footnotes-html
    title: Add footnote definitions and HTML block parsing
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/block.ts`.

      Add the remaining block-level rules:

      **HTML blocks:**
      - Block-level HTML content
      - HTML-like content that isn't valid HTML `<not a tag>` → render as text (test 136)

      **Footnote definitions** (`[^label]: content`):
      - Simple footnote definition (test 103)
      - Footnote with multi-line content (test 104)
      - Multiple footnotes (test 105)
      - Footnote with alphanumeric label `[^note1]` (test 109)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: inline-parser-core
    title: Implement inline parser — escapes, code spans, links, images
    prompt: >
      Create `packages/design-system/src/terminal-markdown/parser/inline.ts`.


      Implement an inline-level parser: `parseInline(raw: string): MdNode[]`.

      Use character-by-character scanning. No regex for core parsing.


      Implement these rules (highest priority first):


      1. **Escapes** (`\` + special char) — tests 48-49

      2. **Inline code** (single/double backtick) — tests 38-40
         - Preserves spaces and doesn't parse inner markdown
      3. **Links** `[text](url "title")` and **images** `![alt](url "title")` — tests 41-47
         - Link with empty text `[](url)` (test 43)
         - Nested emphasis inside link `[**bold** link](url)` (test 47) — recurse inline parser for link children
         - Link URL with spaces — preserve (test 149)
         - Link URL with parentheses — match parens correctly (test 150)
         - Unclosed link bracket → literal (tests 119, 121)
         - Link with missing URL `[text]()` → empty link (test 120)
         - Image with missing alt/url `![]()` → graceful empty image (test 122)
      4. **Autolinks** `<url>` — test 44

      5. **HTML inline tags** — test 53


      Everything else falls through to plain text for now.


      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: inline-parser-emphasis
    title: Add emphasis, strong, strikethrough via delimiter stack
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/inline.ts`.

      Add emphasis/strong/strikethrough parsing using the delimiter stack algorithm:

      6. **Emphasis/strong** (* and _):
         - Emphasis with asterisks `*em*` and underscores `_em_` (tests 31-32)
         - Strong with asterisks `**strong**` and underscores `__strong__` (tests 33-34)
         - Strong emphasis `***both***` (test 35)
         - Emphasis inside a word `foo*bar*baz` (test 36)
         - Underscore in middle of word is NOT emphasis `foo_bar_baz` (test 37)
         - Emphasis across line boundaries (test 54)
         - Nested strong inside emphasis `*foo **bar** baz*` (test 55)
         - Emphasis marker adjacent to punctuation `"*hello*"` (test 151)
         - Spaces inside emphasis markers `* spaced *` → NOT emphasis per CommonMark (test 144)
         - Unclosed emphasis → literal (tests 116-117)
         - Nested unclosed emphasis (test 123)
         - Mismatched markers `*hello_` → literal (test 124)

      7. **Strikethrough** `~~deleted~~` (test 52)
         - Unclosed → literal `~~` (test 118)

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: inline-parser-autolinks-footnotes-breaks
    title: Add autolink literals, footnote refs, line breaks
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/parser/inline.ts`.

      Add the remaining inline rules:

      8. **Footnote references** `[^label]` — tests 103, 106, 108, 138
         - Reference without matching definition → render as literal text

      9. **Autolink literals** (bare URLs without angle brackets):
         - `https://example.com` (test 110)
         - `http://example.com` (test 111)
         - `www.example.com` (no protocol) (test 112)
         - `user@example.com` (email) (test 113)
         - Not triggered inside code span or link (test 114)

      10. **Line breaks:**
          - Trailing two spaces → hard break (test 50)
          - Trailing backslash → hard break (test 51)

      Then **integrate** the inline parser into the block parser: after block parsing,
      walk the AST and run inline parsing on all text content within paragraphs, headings,
      blockquote children, list item children, table cells, alert children, and footnote
      definitions. Code blocks, frontmatter, and HTML blocks must NOT have inline parsing applied.

      Update the block parser's public API to automatically apply inline parsing.

      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: frontmatter-parser
    title: Implement custom YAML-subset frontmatter parser
    prompt: >
      Create `packages/design-system/src/terminal-markdown/parser/frontmatter.ts`.


      Implement a custom YAML-subset parser. **Zero external dependencies**.


      Exported function:

      ```typescript

      function extractFrontmatter(markdown: string): {
        frontmatter?: Record<string, unknown>;
        body: string;
      }

      ```


      Must handle:

      - Simple key-value pairs: `key: value` (test 66)

      - Nested objects via indentation (test 67)

      - Arrays via `- item` syntax (test 68)

      - Value types: strings (quoted and unquoted), numbers, booleans (`true`/`false`), null

      - Special characters in values (test 73)

      - Frontmatter followed by markdown content (test 69)

      - Document without frontmatter (test 70)

      - Empty frontmatter body `---\n---` (test 71)

      - Frontmatter-like content NOT at document start → thematic break (test 72)

      - Unclosed `---` (no closing fence) → treat as thematic break (test 130)

      - Invalid YAML → return raw string as data (test 131)


      Integrate into block parser: call `extractFrontmatter` first, then parse the body.

      If frontmatter was found, prepend a `{ type: "frontmatter", data }` node to root children.


      Update `packages/design-system/src/terminal-markdown/index.ts`:

      ```typescript

      export function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode
      };

      ```


      Write tests in `packages/design-system/src/terminal-markdown/parser.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: renderer-headings-paragraphs-text
    title: Renderer — headings, paragraphs, text, emphasis, code spans
    prompt: >
      Create `packages/design-system/src/terminal-markdown/renderer.ts`.


      Implement a renderer that walks the `MdNode` AST and produces an ANSI-styled string.

      **No direct chalk usage** — only design-system primitives via relative imports:

      - `../tokens/colors.js` (not used directly, theme comes from theme-detect)

      - `../tokens/typography.js` → `typography.bold()`, `.dim()`, `.italic()`, `.underline()`,
      `.strikethrough()`

      - `../tokens/spacing.js` → `spacing.sm` for indentation

      - `../tokens/widths.js` → `widths.maxLine` for default width

      - `../internal/theme-detect.js` → `getTheme()` for the active theme palette


      Implement rendering for these node types first:

      | Element | Rendering |

      |---------|-----------|

      | H1 | `theme.header()` + `typography.bold()` + underline via `─` repeat |

      | H2 | `theme.header()` + `typography.bold()` |

      | H3-H4 | `typography.bold()` |

      | H5-H6 | `typography.bold()` + `theme.muted()` |

      | Paragraph | Rendered children + trailing blank line |

      | Text | Plain text passthrough |

      | Bold | `typography.bold()` |

      | Italic | `typography.italic()` |

      | Strikethrough | `typography.strikethrough()` |

      | Code span | `theme.accent()` |

      | Break | Newline |

      | Thematic break | `theme.divider()` on `─` repeated to width |

      | Root | Concatenated children |


      Accept `RenderOptions`:

      ```typescript

      interface RenderOptions {
        width?: number;           // terminal width (default: process.stdout.columns or 80)
        showFrontmatter?: boolean; // render frontmatter section (default: false)
      }

      function render(ast: MdNode, options?: RenderOptions): string;

      ```


      Tests:

      - Heading renders with appropriate visual weight per level (test 178)

      - Respects `width` option for line wrapping (test 170)

      - Empty nodes produce no output (test 179)


      Write tests in `packages/design-system/src/terminal-markdown/renderer.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: renderer-blocks
    title: Renderer — blockquotes, code blocks, lists, task lists
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/renderer.ts`.

      Add rendering for block-level structures:
      | Element | Rendering |
      |---------|-----------|
      | Code block | `theme.muted()` border, `spacing.sm` indent, preserve content verbatim |
      | Blockquote | `symbols.bar` prefix + `typography.dim()` on each line |
      | Unordered list | `spacing.sm` indent + `•` bullet |
      | Ordered list | `spacing.sm` indent + `n.` numbering |
      | Task list | `symbols.active` / `symbols.inactive` replacing bullet |

      Import `../components/symbols.js` → `symbols.bar`, `.active`, `.inactive`.

      Tests:
      - Code block renders with visible boundaries (test 176)
      - Indents nested blockquotes correctly (test 173)
      - Numbers ordered lists correctly (test 175)

      Write tests in `packages/design-system/src/terminal-markdown/renderer.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: renderer-links-images-html
    title: Renderer — links, images, HTML, frontmatter
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/renderer.ts`.

      Add rendering for:
      | Element | Rendering |
      |---------|-----------|
      | Link | children text + ` ` + `theme.accent()` on `(url)` |
      | Autolink | `theme.accent()` on the URL |
      | Image | `theme.muted("[image: alt]")` |
      | HTML | Rendered as plain text (pass through stripped of tags) |
      | Frontmatter | `typography.dim()` key-value pairs, or hidden (configurable) |

      Tests:
      - Link renders as `text (url)` with color (test 177)
      - Hides frontmatter by default (test 171)
      - Shows frontmatter when `showFrontmatter: true` (test 172)

      Write tests in `packages/design-system/src/terminal-markdown/renderer.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: renderer-tables-alerts-footnotes
    title: Renderer — tables, alerts, footnotes
    prompt: |
      Extend `packages/design-system/src/terminal-markdown/renderer.ts`.

      Add rendering for:
      | Element | Rendering |
      |---------|-----------|
      | Table | `symbols.bar` separators, `spacing.sm` cell padding, aligned columns |
      | Alert NOTE | `symbols.bar` prefix + `theme.info()` "Note" label |
      | Alert TIP | `symbols.bar` prefix + `theme.success()` "Tip" label |
      | Alert IMPORTANT | `symbols.bar` prefix + `theme.info()` "Important" label |
      | Alert WARNING | `symbols.bar` prefix + `theme.warning()` "Warning" label |
      | Alert CAUTION | `symbols.bar` prefix + `theme.error()` "Caution" label |
      | Footnote ref | `typography.dim("[n]")` |
      | Footnote def | Rendered at bottom, numbered, `spacing.sm` indent |

      Tests:
      - Aligns table columns (test 174)

      Write tests in `packages/design-system/src/terminal-markdown/renderer.test.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: public-api-exports
    title: Wire up public API and design-system root exports
    prompt: |
      Finalize `packages/design-system/src/terminal-markdown/index.ts`:

      ```typescript
      export type { MdNode } from "./ast.js";
      export { parse } from "...";  // wherever parse ended up
      export { render } from "./renderer.js";
      export type { RenderOptions } from "./renderer.js";

      export function renderMarkdown(markdown: string, options?: RenderOptions): string {
        const { ast } = parse(markdown);
        return render(ast, options);
      }
      ```

      Add exports to `packages/design-system/src/index.ts`:
      ```typescript
      // Terminal markdown
      export { parse, render, renderMarkdown } from "./terminal-markdown/index.js";
      export type { MdNode, RenderOptions } from "./terminal-markdown/index.js";
      ```

      Verify the design-system builds cleanly with `npm run build -w @poe-code/design-system`.
      Verify existing tests still pass with `npm test -w @poe-code/design-system`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: demo-script
    title: Add markdown demo to design-system demo script
    prompt: |
      Extend `packages/design-system/scripts/demo.ts` to add a `"markdown"` demo type.

      When invoked as `npm run demo -w @poe-code/design-system -- markdown`, it should
      render a representative markdown document using the new `renderMarkdown()` function.

      The demo document should showcase ALL renderer features in a single output:
      - H1, H2, H3 headings
      - Paragraph with **bold**, *italic*, ~~strikethrough~~, `code span`
      - A fenced code block with language tag
      - A blockquote (including nested)
      - An unordered list, an ordered list, and a task list
      - A GFM table with alignment
      - A link and an image
      - At least one GitHub alert (NOTE)
      - A thematic break
      - A footnote reference and definition

      Also add a `"markdown-minimal"` demo that renders a simple heading + paragraph + code
      block (for quick screenshot validation).

      The demo must use `renderMarkdown` imported from `../src/index.js`.

      Update the DemoType union and the switch statement in `main()`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshot-headings-text
    title: Screenshot test — headings and text styling
    prompt: >
      Take screenshots to visually validate heading and text rendering.


      Run these commands and verify the output looks correct in each screenshot:


      1. `npm run screenshot -- --no-header -o screenshots/terminal-markdown/headings.png npm run
      demo -w @poe-code/design-system -- markdown-minimal`
         → Should show a clean heading with visual weight, paragraph text, and code block

      2. `npm run screenshot -- --no-header -o screenshots/terminal-markdown/full.png npm run demo
      -w @poe-code/design-system -- markdown`
         → Should show the full markdown demo with all elements rendered

      Review each screenshot PNG using the Read tool. Verify:

      - H1 has underline and bold styling

      - H2 has bold styling but no underline

      - H3+ decrease in visual weight

      - Bold, italic, strikethrough, code span are visually distinct

      - Paragraph text wraps properly

      - No phantom newlines or broken ANSI sequences


      If any visual issues are found, fix them in the renderer and re-take the screenshots.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshot-blocks
    title: Screenshot test — blockquotes, code blocks, lists
    prompt: >
      Create a dedicated markdown test document for block-level elements. Write it to

      a temporary variable in the demo script or create a small helper that renders

      a focused block demo.


      Take screenshots to visually validate:


      1. **Code blocks** — `npm run screenshot -- --no-header -o
      screenshots/terminal-markdown/code-blocks.png ...`
         - Fenced code block with language tag has visible borders
         - Content inside is NOT styled (no ANSI in code content)
         - Indentation looks clean

      2. **Blockquotes** — `screenshots/terminal-markdown/blockquotes.png`
         - `│` bar prefix is visible
         - Nested blockquotes indent correctly with multiple bars
         - Content is dimmed

      3. **Lists** — `screenshots/terminal-markdown/lists.png`
         - Unordered: `•` bullets with consistent indent
         - Ordered: `1.`, `2.` numbering with consistent indent
         - Task lists: `◆` / `○` checkboxes
         - Nested lists indent further

      Review each screenshot PNG. Fix any visual issues and re-screenshot.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshot-tables-alerts
    title: Screenshot test — tables and GitHub alerts
    prompt: >
      Take screenshots to visually validate tables and alerts:


      1. **Tables** — `npm run screenshot -- --no-header -o screenshots/terminal-markdown/tables.png
      ...`
         - Columns align properly
         - `│` separators between columns
         - Left/center/right alignment visible in cell content
         - Header row is visually distinct from data rows

      2. **Alerts** — `screenshots/terminal-markdown/alerts.png`
         - Each alert type (NOTE, TIP, IMPORTANT, WARNING, CAUTION) renders
         - Each has the correct color for its label (info=magenta, success=green, warning=yellow, error=red)
         - `│` bar prefix is visible
         - Multi-line alert content is properly indented

      Review each screenshot PNG. Fix any visual issues and re-screenshot.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-interactive-render
    title: Terminal-pilot test — interactive rendering validation
    prompt: >
      Use the terminal-pilot MCP tools to interactively test the markdown renderer

      in a live terminal session.


      1. Create a terminal session: spawn `node` REPL

      2. Import the renderMarkdown function:
         ```
         const { renderMarkdown } = require("@poe-code/design-system");
         ```
         (or use dynamic import if ESM)
      3. Render a series of test documents and read the terminal screen after each:

         **Test A — Simple heading + paragraph:**
         ```
         console.log(renderMarkdown("# Hello World\n\nThis is a paragraph with **bold** and *italic*."))
         ```
         Read screen → verify heading is styled, bold/italic visible

         **Test B — Code block:**
         ```
         console.log(renderMarkdown("```js\nconst x = 1;\nconsole.log(x);\n```"))
         ```
         Read screen → verify code block has borders, content is verbatim

         **Test C — Nested list + task list:**
         ```
         console.log(renderMarkdown("- Item 1\n  - Nested\n- [x] Done\n- [ ] Todo"))
         ```
         Read screen → verify bullets, nesting, checkboxes

         **Test D — Table:**
         ```
         console.log(renderMarkdown("| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |"))
         ```
         Read screen → verify columns align, separators visible

         **Test E — Alert:**
         ```
         console.log(renderMarkdown("> [!WARNING]\n> This is a warning message"))
         ```
         Read screen → verify warning label and colored bar

         **Test F — Complex mixed document (from real README):**
         Render a ~50 line markdown document combining headings, paragraphs, code, lists,
         links, blockquotes, and a table. Read screen → verify no broken ANSI, no phantom
         newlines, readable output.

      4. Close the terminal session.


      If any rendering issues are found, fix them and re-test.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-width-wrapping
    title: Terminal-pilot test — width and wrapping behavior
    prompt: >
      Use the terminal-pilot MCP tools to test width-dependent rendering.


      1. Create a terminal session with specific dimensions:
         - 40 columns (narrow terminal)
         - Spawn node REPL

      2. Render markdown with long lines:
         ```
         console.log(renderMarkdown("# A Very Long Heading That Should Be Styled\n\nThis is a long paragraph that contains enough text to exceed forty columns and should wrap properly without breaking any ANSI escape sequences or words in awkward places.", { width: 40 }))
         ```
         Read screen → verify text wraps at ~40 chars, no broken words mid-ANSI

      3. Test table rendering in narrow terminal:
         ```
         console.log(renderMarkdown("| Column One | Column Two | Column Three |\n|---|---|---|\n| value 1 | value 2 | value 3 |", { width: 40 }))
         ```
         Read screen → verify table fits or gracefully handles narrow width

      4. Resize terminal to 120 columns:
         Use terminal_resize to change to 120 cols

      5. Re-render the same content with `{ width: 120 }`:
         Read screen → verify wider rendering, HR stretches to width

      6. Close the terminal session.


      Fix any wrapping or width-related issues found.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-malformed-input
    title: Terminal-pilot test — malformed and edge case inputs
    prompt: |
      Use the terminal-pilot MCP tools to test malformed and edge-case inputs
      that are hard to validate in unit tests alone.

      1. Create a terminal session, spawn node REPL, import renderMarkdown.

      2. Test each malformed input and verify no crashes, readable output:

         **Unclosed code block:**
         ```
         console.log(renderMarkdown("```js\nconst x = 1;\nno closing fence"))
         ```
         → Should render rest as code, no crash

         **Unclosed emphasis:**
         ```
         console.log(renderMarkdown("This has *unclosed emphasis and **unclosed strong"))
         ```
         → Should render `*` and `**` as literal characters

         **Broken link:**
         ```
         console.log(renderMarkdown("[broken link(no close paren"))
         ```
         → Should render as literal text

         **Empty document:**
         ```
         console.log(renderMarkdown(""))
         console.log(renderMarkdown("   \n\n  \n"))
         ```
         → Should produce empty or whitespace-only output, no crash

         **Unicode content:**
         ```
         console.log(renderMarkdown("# 你好世界 🌍\n\nParagraph with émojis 🎉 and ñ"))
         ```
         → Should render correctly, no broken characters

         **Deeply nested structure:**
         ```
         console.log(renderMarkdown("> > > > deeply nested\n> > > > blockquote"))
         ```
         → Should render with multiple bar prefixes, not crash

         **Very long code block (performance):**
         Generate a 100-line code block and verify it renders in reasonable time.

      3. Close the terminal session.

      Fix any crashes, broken output, or performance issues found.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: integration-tests-parsing
    title: Integration tests — real-world document parsing
    prompt: |
      Create `packages/design-system/src/terminal-markdown/integration.test.ts`.

      Write end-to-end tests that parse real-world markdown documents through
      `renderMarkdown()` and verify the output is non-empty, contains expected
      ANSI sequences, and does not crash.

      Test documents to cover (from `docs/plans/cli-markdown-renderer.md` tests 155-169):

      - README with badges, headings, code blocks, and links (test 155)
      - API documentation: headings + parameter tables + code examples (test 156)
      - Changelog: `## [1.2.3] - 2024-01-15` headings + nested lists (test 157)
      - Blog post: frontmatter + headings + paragraphs + images + code + blockquotes (test 158)
      - GitHub issue template: frontmatter + headings + task list + code (test 159)
      - CLI --help output pasted as indented code (test 160)
      - LLM-generated markdown: inconsistent heading levels, extra blank lines (test 161)
      - Pipeline plan YAML frontmatter + structured body (test 162)
      - Mixed inline: `**bold _italic_** [link](url) \`code\` ~~strike~~` (test 163)
      - Long code block (50+ lines) with language tag (test 164)
      - Document with 10+ footnotes scattered throughout (test 165)
      - Deeply nested blockquote conversation format (test 166)
      - Table-heavy document (5+ tables) (test 167)
      - Document mixing all GitHub alert types (test 168)
      - Large document (1000+ lines) — performance: parse in <50ms (test 169)

      Each test should construct a representative markdown string, call `renderMarkdown()`,
      and assert the result is a non-empty string without thrown errors. For the performance
      test, use a timing assertion.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: integration-tests-edge-cases
    title: Integration tests — edge cases and common user mistakes
    prompt: >
      Add more integration tests to
      `packages/design-system/src/terminal-markdown/integration.test.ts`.


      Cover remaining edge cases from the plan that span parser + renderer:


      - Paragraph continuation (test 83)

      - Block-level content interrupts paragraph (test 84)

      - Mixed block types in sequence (test 91)

      - Unicode content — emoji, CJK, RTL (test 92)

      - Tab characters in indentation (test 93)

      - Trailing whitespace on every line (test 146)

      - Double-spaced lines (test 147)

      - Deeply nested broken structure — blockquote > list > blockquote > broken emphasis (test 135)

      - Bare `---` ambiguity: frontmatter vs thematic break vs setext heading (test 139)

      - Angle brackets that aren't autolinks `<not-a-url>`, `5 < 10` (test 154)

      - Link reference definitions `[id]: url "title"` (test 88)

      - Footnote definition without any reference — still parsed (test 107)

      - Footnote with inline formatting in definition (test 108)


      Each test: construct markdown input → `renderMarkdown()` → assert non-empty string, no crash.

      Where possible, assert specific expected substrings in output.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: screenshot-full-documents
    title: Screenshot test — full real-world documents
    prompt: >
      Take screenshots of complete real-world markdown documents rendered through

      `renderMarkdown()` to validate the overall visual quality.


      Create a small script or extend the demo to accept a markdown file path, e.g.:

      `npm run demo -w @poe-code/design-system -- markdown-file <path>`


      Then screenshot these real documents from the repo:

      1. `npm run screenshot -- --no-header -o screenshots/terminal-markdown/readme.png npm run demo
      -w @poe-code/design-system -- markdown-file README.md`

      2. Pick 2-3 other `.md` files from `docs/` that exercise tables, alerts, frontmatter etc.


      Also render the full design showcase markdown from the `demo-script` task:

      3. `npm run screenshot -- --no-header -o screenshots/terminal-markdown/showcase.png npm run
      demo -w @poe-code/design-system -- markdown`


      Review all screenshots. Verify:

      - Overall visual coherence — looks like a well-designed CLI output

      - Consistent spacing between elements

      - No ANSI artifacts or broken escape sequences

      - Colors match the design-system theme

      - Tables, lists, and code blocks are properly framed


      Fix any issues and re-screenshot. This is the final visual quality gate.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: terminal-pilot-theme-validation
    title: Terminal-pilot test — dark and light theme rendering
    prompt: >
      Use terminal-pilot to validate the renderer works correctly with both dark and

      light themes.


      1. Create a terminal session, spawn node REPL.


      2. **Dark theme** (default):
         ```
         process.env.POE_THEME = "dark";
         const { renderMarkdown, resetThemeCache } = require("@poe-code/design-system");
         resetThemeCache();
         console.log(renderMarkdown("# Dark Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!NOTE]\n> This is a note\n\n| Col1 | Col2 |\n|------|------|\n| a | b |"));
         ```
         Read screen → verify dark theme colors are applied

      3. **Light theme**:
         ```
         process.env.POE_THEME = "light";
         resetThemeCache();
         console.log(renderMarkdown("# Light Theme\n\n**Bold** and *italic* with `code` and a [link](https://example.com)\n\n> [!WARNING]\n> This is a warning\n\n- Item 1\n- [x] Done\n- [ ] Todo"));
         ```
         Read screen → verify light theme colors are applied, distinct from dark

      4. Close session.


      Verify both themes produce readable, visually distinct output. Fix any issues.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: generate-design-docs
    title: Regenerate design-system docs with terminal-markdown showcase
    prompt: |
      Run `npm run generate:design-docs` to regenerate the design language documentation,
      which should now include the new `markdown` and `markdown-minimal` demo types.

      Verify the generated docs include terminal-markdown screenshots.

      Then run all tests one final time to ensure nothing is broken:
      ```
      npm test -w @poe-code/design-system
      npm run build -w @poe-code/design-system
      npm run lint -w @poe-code/design-system
      ```

      Fix any issues that surface.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# terminal markdown

Archived local pipeline plan converted from YAML during docs cleanup.
