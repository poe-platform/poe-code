---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: scaffold-renderer-file
    title: Create plaintext-renderer.ts with options type and skeleton
    prompt: |
      Create the file
      packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts.

      The file must contain:

      1. The exported interface PlaintextRenderOptions:
           announceHeadings?: boolean   // default true
           announceCode?: boolean       // default true
           announceAlerts?: boolean     // default true
           showLinks?: boolean          // default false
           expandLinks?: boolean        // default false
           includeFrontmatter?: boolean // default false

      2. A non-exported interface PlaintextContext that holds the resolved
         options (all booleans already defaulted) and a footnotes map:
           resolved options (all booleans, not optional)
           footnoteDefinitions: Map<string, string>  — label → rendered text
           footnoteOrder: string[]                   — insertion order

      3. Two exported stub functions that compile but return "" for now:
           export function renderPlaintext(
             ast: MdNode,
             options?: PlaintextRenderOptions
           ): string { return ""; }

           export function renderMarkdownPlaintext(
             markdown: string,
             options?: PlaintextRenderOptions
           ): string { return ""; }

      Import MdNode from ./ast.js.
      Do NOT implement any rendering logic yet — just the types and stubs.
      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: implement-inline-nodes
    title: Implement inline node rendering (text, emphasis, strong, strikethrough, inlineCode, break, link, image, html)
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts,
      add a function renderInline(node: MdNode, ctx: PlaintextContext): string
      that handles every inline MdNode variant. It must return:

        text           → node.value verbatim
        emphasis       → renderChildren(node.children, ctx) — no markers
        strong         → renderChildren(node.children, ctx) — no markers
        strikethrough  → "" — always omitted, never spoken
        inlineCode     → node.value verbatim
        break          → " " — hard line break becomes a space
        html           → "" — raw HTML never spoken
        link           → if ctx.expandLinks: "{childText} {node.url}"
                         else if ctx.showLinks: "{childText} (link)"
                         else: "{childText}"
                         fallback when children render to "": use node.url
        image          → node.alt if node.alt is non-empty string, else ""
        any other type → ""  (safe default for unknown inline nodes)

      Add a private helper renderChildren(nodes: MdNode[], ctx): string
      that maps each node through renderInline and joins with "".

      Do not implement block nodes yet.
      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: implement-block-nodes
    title: Implement block node rendering (heading, paragraph, blockquote, alert, code, thematicBreak, root)
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts,
      add a function renderBlock(node: MdNode, ctx: PlaintextContext): string
      that handles block-level MdNode variants. It must return:

        root          → renderBlockChildren(node.children, ctx) trimmed
        paragraph     → renderChildren(node.children, ctx).trim() + "\n\n"
        thematicBreak → ""
        heading       → build prefix from node.depth and ctx.announceHeadings:
                          depth 1 + announceHeadings: "Section: "
                          depth 2 + announceHeadings: "Subsection: "
                          depth 3-6 + announceHeadings: "Topic: "
                          announceHeadings false: ""
                        return prefix + renderChildren(node.children, ctx).trim() + "\n\n"
        blockquote    → "Quote: " + renderBlockChildren(node.children, ctx).trim() + "\n\n"
        alert         → prefix = ctx.announceAlerts ? node.kind + ": " : ""
                        return prefix + renderBlockChildren(node.children, ctx).trim() + "\n\n"
        code          → body = node.value
                        return (ctx.announceCode ? "Code: " : "") + body + "\n\n"
        frontmatter   → if !ctx.includeFrontmatter return ""
                        convert each top-level key-value pair to "Key: value."
                        join with " " and append "\n\n"

      Add a private helper renderBlockChildren(nodes: MdNode[], ctx): string
      that maps each node through renderBlock or renderInline (use node type to
      decide which) and joins results with "".

      Wire renderPlaintext() and renderMarkdownPlaintext() to call renderBlock
      on the root node. Import parse from ./parser.js for renderMarkdownPlaintext.
      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: implement-list-nodes
    title: Implement list and listItem rendering
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts,
      extend renderBlock to handle list and listItem MdNode variants.

      listItem rules:
        - Render children with renderBlockChildren. Trim result.
        - If node.checked === true, prefix with "done: "
        - If node.checked === false, prefix with "to do: "
        - If node.checked === undefined, no prefix

      list rules:
        - Collect rendered text for each listItem child (call renderBlock on each).
        - Trim each item text.
        - If node.ordered is true, use English ordinal prefixes:
            item index 0 → "First, "
            item index 1 → "Second, "
            item index 2 → "Third, "
            item index 3+ → "Next, "
          Join items with " " and append "\n\n"
        - If node.ordered is false:
            3 or fewer items: join with ", "
            4 or more items:  join with "; "
          Append "\n\n"

      Nested lists: a listItem may contain another list as a child.
      renderBlockChildren already recurses, so nested lists produce
      their own text inline — no special handling needed.

      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: implement-table-nodes
    title: Implement table rendering
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts,
      extend renderBlock to handle table, tableRow, and tableCell MdNode variants.

      Table structure in the AST:
        table.children[0] is the header tableRow
        table.children[1..] are body tableRows
        each tableRow.children are tableCell nodes
        each tableCell.children are inline nodes

      Rendering rules:
        1. Extract header labels: render each cell in the first tableRow with
           renderChildren. These are the column names.
        2. For each body row, build a sentence per non-empty cell:
           "{header} is {value}." where header and value are both trimmed.
           Skip a cell entirely if its rendered value is empty string.
        3. Join all sentences from all body rows with " ".
        4. Append "\n\n".

      Example: headers ["Name", "Age"], row ["Alice", "30"]
        → "Name is Alice. Age is 30.\n\n"

      tableRow and tableCell used outside a table context → return ""
      (they are always rendered via the table handler above).

      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: implement-footnote-nodes
    title: Implement footnote reference and definition rendering
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.ts,
      extend the renderer to handle footnoteReference and footnoteDefinition
      MdNode variants.

      The MdNode type for footnotes (from ast.ts):
        { type: "footnoteReference"; label: string; identifier: string }
        { type: "footnoteDefinition"; label: string; children: MdNode[] }

      Strategy (mirrors how html-renderer.ts handles footnotes):

      1. Before rendering the root, walk all children to collect footnote
         definitions into ctx.footnoteDefinitions (label → rendered body text)
         and ctx.footnoteOrder (labels in document order of first reference).

      2. footnoteReference in renderInline:
         - Add label to ctx.footnoteOrder if not already present.
         - Look up the 1-based index: idx = ctx.footnoteOrder.indexOf(label) + 1
         - Return "[{idx}]"

      3. footnoteDefinition in renderBlock:
         - Return "" — definitions are collected in step 1, not rendered inline.

      4. At the end of renderBlock for root, if ctx.footnoteOrder is non-empty,
         append a footnote section:
           For each label in footnoteOrder:
             "Note {n}: {definitionText}."
           Joined with " ", preceded by "\n\n".

      Unused definitions (never referenced) must NOT appear in the output.
      Do NOT touch any other file.
    status:
      implement: open
      commit: open

  - id: wire-exports
    title: Wire exports through index.ts, toolcraft-design, and toolcraft
    prompt: |
      Wire the new plaintext renderer through the export chain, following
      the exact same pattern used for html-renderer. Steps:

      1. packages/toolcraft-design/src/terminal-markdown/index.ts
         Add these exports (do not remove anything existing):
           export { renderPlaintext, renderMarkdownPlaintext } from "./plaintext-renderer.js";
           export type { PlaintextRenderOptions } from "./plaintext-renderer.js";

      2. packages/toolcraft-design/src/index.ts
         Re-export renderPlaintext, renderMarkdownPlaintext, PlaintextRenderOptions
         from "./terminal-markdown/index.js" — same style as the existing
         renderMarkdownHtml / HtmlRenderOptions lines.

      3. Create packages/toolcraft-design/src/render-markdown-plaintext.ts
         Content (flat re-export module, no logic):
           export { renderMarkdownPlaintext, renderPlaintext } from
             "./terminal-markdown/index.js";
           export type { PlaintextRenderOptions } from
             "./terminal-markdown/index.js";

      4. packages/toolcraft-design/package.json
         Add the subpath export "./render-markdown-plaintext" pointing to
         the compiled file. Follow the same pattern as the existing
         "./render-markdown-html" entry.

      5. Create packages/toolcraft/src/design/render-markdown-plaintext.ts
         Re-export everything from "toolcraft-design/render-markdown-plaintext"
         — same style as toolcraft/src/design/render-markdown-html.ts.

      6. packages/toolcraft/package.json
         Add the subpath export "./design/render-markdown-plaintext" pointing
         to the compiled bridge file.

      Do NOT change renderer.ts, html-renderer.ts, or any test file.
    status:
      implement: open
      commit: open

  - id: tests-inline-and-text
    title: Tests — inline nodes (text, emphasis, strong, strikethrough, inlineCode, break, link, image, html)
    prompt: |
      Create packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts
      if it does not exist yet. Use vitest. Import parse from "./parser.js" and
      renderMarkdownPlaintext from "./plaintext-renderer.js". No mocks.

      Add a describe block "inline nodes" with these tests:

      PLAIN TEXT
        - "Hello world" → "Hello world"

      EMPHASIS / STRONG / NESTED
        - "*italic*" → "italic" (no asterisks)
        - "**bold**"  → "bold"
        - "***both***" → "both"
        - "~~strike~~" → "" (omitted)
        - "*outer **inner** end*" → "outer inner end"

      INLINE CODE
        - "`foo`" → "foo"
        - "` spaces `" → " spaces "
        - "`<div>&\"'`" → "<div>&\"'"

      HARD LINE BREAK
        - "line one  \nline two" (two trailing spaces) → contains "line one line two"
          (the break becomes a space, not a newline)

      LINKS — default options
        - "[Click here](https://example.com)" → "Click here" (no URL, no "(link)")

      LINKS — showLinks:true
        - "[Click here](https://example.com)" with { showLinks: true }
          → "Click here (link)"

      LINKS — expandLinks:true
        - "[Click here](https://example.com)" with { expandLinks: true }
          → "Click here https://example.com"

      LINKS — expandLinks overrides showLinks
        - "[foo](https://x.com)" with { expandLinks: true, showLinks: true }
          → "foo https://x.com"  (no "(link)" suffix)

      LINKS — empty text children fallback
        - "[](https://x.com)" → "https://x.com"
          (when child text is empty, fall back to URL)

      LINKS — nested bold child
        - "[**bold link**](https://x.com)" → "bold link"

      LINKS — mailto
        - "[email me](mailto:foo@bar.com)" with { expandLinks: true }
          → "email me mailto:foo@bar.com"

      IMAGES
        - "![a cat](cat.png)" → "a cat"
        - "![](cat.png)"      → "" (not "undefined")
        - "text ![dog](d.png) more" → "text dog more"

      HTML NODES
        - "<em>hi</em>" (inline HTML) → "hi" is NOT present;
          assert output does not contain "<em>" and does not contain "hi"
          (raw HTML is fully omitted)

      Each test uses expect(result).toBe(expected) or
      expect(result).not.toContain(forbidden). Name each it() with the
      markdown input so failures are self-describing.
    status:
      implement: open
      commit: open

  - id: tests-block-nodes
    title: Tests — block nodes (heading, paragraph, blockquote, alert, code, thematicBreak)
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts,
      add a describe block "block nodes" with these tests:

      HEADINGS
        - "# Title" with default options → starts with "Section: Title"
        - "## Sub" with default options  → starts with "Subsection: Sub"
        - "### Deep" with default options → starts with "Topic: Deep"
        - "#### Four" with default options → starts with "Topic: Four"
        - "# Title" with { announceHeadings: false } → starts with "Title" (no prefix)
        - "# Code `x` here" → result contains "Code x here" (inline code verbatim)
        - "# [link](http://x.com) text" with default options
          → result contains "link text" (URL absent)
        - "# **bold** and *italic*" → result contains "bold and italic"

      PARAGRAPHS
        - "Hello." → "Hello."
        - "Line one.\nLine two." (soft wrap) → contains "Line one."
        - paragraph ending with "\n\n" in output (test trimmed result ends with ".")

      BLOCKQUOTES
        - "> quoted text" → starts with "Quote: quoted text"
        - "> > nested" → starts with "Quote: Quote: nested"
        - "> # heading\n> para" → result contains "Quote: " and "Section: heading"
        - "> - item a\n> - item b" → result contains "Quote: " and "item a"

      ALERTS (GitHub-style > [!NOTE] etc.)
        - "> [!NOTE]\n> body" with default options → starts with "NOTE: body"
        - "> [!TIP]\n> t"     → starts with "TIP: t"
        - "> [!IMPORTANT]\n> i" → starts with "IMPORTANT: i"
        - "> [!WARNING]\n> w"  → starts with "WARNING: w"
        - "> [!CAUTION]\n> c"  → starts with "CAUTION: c"
        - "> [!NOTE]\n> body" with { announceAlerts: false } → starts with "body" (no prefix)

      CODE BLOCKS
        - "```\nfoo\n```" with default options → starts with "Code: foo"
        - "```\nfoo\n```" with { announceCode: false } → starts with "foo" (no "Code:")
        - "```ts\nconst x = 1;\n```" → does NOT contain "ts" in output
          (language tag never spoken)
        - "```\nline1\nline2\n```" → output contains "line1" and "line2"
        - "```\n\n```" (empty block, announceCode:true) → does NOT contain "Code: \n"
          (no trailing garbage after "Code:" when value is empty)

      THEMATIC BREAKS
        - "---" alone → "" or only whitespace
        - "text\n\n---\n\nmore" → result contains "text" and "more"
          but does NOT contain "---"

      Each test: expect(result).toBe / .toContain / .not.toContain.
      Trim output before asserting when checking "starts with".
    status:
      implement: open
      commit: open

  - id: tests-lists
    title: Tests — list rendering (ordered, unordered, task lists, nested)
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts,
      add a describe block "lists" with these tests:

      UNORDERED
        - "- a" → result contains "a"
        - "- a\n- b" → "a, b"
        - "- a\n- b\n- c" → "a, b, c"
        - "- a\n- b\n- c\n- d" → "a; b; c; d"
          (4+ items switch from ", " to "; ")
        - 5 items → joined with "; "

      ORDERED
        - "1. a" → starts with "First, a"
        - "1. a\n2. b" → "First, a Second, b"
        - "1. a\n2. b\n3. c" → "First, a Second, b Third, c"
        - "1. a\n2. b\n3. c\n4. d" → ends with "Next, d"
        - 10-item ordered list → last item prefixed "Next, "
          (only indices 0,1,2 get First/Second/Third; all others get Next)

      TASK LISTS
        - "- [ ] todo item" → contains "to do: todo item"
        - "- [x] done item" → contains "done: done item"
        - "- [x] done\n- [ ] todo" → contains both "done: done" and "to do: todo"
        - "- [ ] a\n- [x] b\n- [ ] c" (mixed) → contains "to do: a" and "done: b"

      NESTED LISTS
        - "- parent\n  - child a\n  - child b"
          → result contains "parent" and "child a" and "child b"
          → result does NOT contain "-" or "*" or "•" or "·"
        - ordered list with unordered sub-list:
          "1. first\n   - x\n   - y\n2. second"
          → contains "First, first" and "x" and "Second, second"

      LIST ITEMS WITH PARAGRAPH CHILDREN
        - "- \n  multi\n  line\n  item"
          → item text present, no crash

      Each test: expect(result.trim()).toBe(expected) or .toContain/.not.toContain.
    status:
      implement: open
      commit: open

  - id: tests-tables
    title: Tests — table rendering
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts,
      add a describe block "tables" with these tests.

      Reference format: header cells become the label, body cells become the value.
      Each non-empty (header, value) pair emits "Header is Value."

      BASIC
        - 2 columns, 1 body row:
          "| Name | Age |\n|------|-----|\n| Alice | 30 |"
          → "Name is Alice. Age is 30."

        - 2 columns, 2 body rows:
          "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |"
          → "Name is Alice. Age is 30. Name is Bob. Age is 25."

      EMPTY CELLS
        - cell value is empty string:
          "| A | B |\n|---|---|\n| foo |  |"
          → result contains "A is foo."
          → result does NOT contain "B is ." (empty cell skipped)

      ALIGNMENT ANNOTATIONS (should not affect output)
        - table with :---:, ---:, :--- alignments → same output as unaligned table

      INLINE FORMATTING IN CELLS
        - "| Name |\n|------|\n| **Alice** |" → "Name is Alice." (no asterisks)
        - "| Url |\n|-----|\n| [site](https://x.com) |" with default options
          → "Url is site." (URL absent)

      SINGLE COLUMN
        - "| Item |\n|------|\n| Foo |" → "Item is Foo."

      EMPTY HEADER CELLS
        - "| | B |\n|---|---|\n| 1 | 2 |"
          → result contains "B is 2."
          → result does NOT contain " is 1." (empty header skipped)

      Each test: expect(result.trim()).toContain(expected) or
      expect(result.trim()).not.toContain(forbidden).
    status:
      implement: open
      commit: open

  - id: tests-footnotes-frontmatter
    title: Tests — footnotes and frontmatter
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts,
      add describe blocks "footnotes" and "frontmatter".

      FOOTNOTES
        - paragraph with one reference + one definition:
          "See note[^1].\n\n[^1]: This is the note."
          → result contains "[1]"
          → result contains "Note 1: This is the note."

        - two references in order:
          "A[^a] and B[^b].\n\n[^a]: Alpha.\n\n[^b]: Beta."
          → result contains "[1]" and "[2]"
          → result contains "Note 1: Alpha."
          → result contains "Note 2: Beta."

        - reference order determines note number (not definition order):
          "B[^b] then A[^a].\n\n[^a]: Alpha.\n\n[^b]: Beta."
          → result contains "Note 1: Beta." (^b referenced first)
          → result contains "Note 2: Alpha."

        - unused definition:
          "No refs here.\n\n[^unused]: Never referenced."
          → result does NOT contain "Note 1" and does NOT contain "Never referenced"

      FRONTMATTER
        - includeFrontmatter:false (default):
          "---\ntitle: Hello\n---\nBody text."
          → result does NOT contain "title"
          → result contains "Body text."

        - includeFrontmatter:true:
          "---\ntitle: Hello\n---\nBody."
          → result contains "title: Hello"

        - multiple keys:
          "---\ntitle: T\ndate: 2025-01-01\n---\nBody."
          with { includeFrontmatter: true }
          → result contains "title: T"
          → result contains "date: 2025-01-01"

        - frontmatter with array value:
          "---\ntags:\n  - a\n  - b\n---\nBody."
          with { includeFrontmatter: true }
          → does not throw; result contains "Body."

      Each test: .toBe / .toContain / .not.toContain.
    status:
      implement: open
      commit: open

  - id: tests-edge-cases
    title: Tests — unicode, edge inputs, and option combinations
    prompt: |
      In packages/toolcraft-design/src/terminal-markdown/plaintext-renderer.test.ts,
      add describe blocks "unicode and special chars", "edge inputs", and
      "option combinations".

      UNICODE AND SPECIAL CHARS
        - "Hello 🎉 world" → result contains "🎉"
        - Arabic text: "مرحبا" → result contains "مرحبا"
        - CJK: "你好世界" → result contains "你好世界"
        - "foo—bar" (em-dash) → result contains "—"
        - "foo–bar" (en-dash) → result contains "–"
        - " zero" (null byte in input) → does not throw; result is a string
        - "[31mred[0m" (ANSI escape in source text)
          → result does NOT contain ""
          (ANSI is stripped from text nodes — test actual behavior)

      EDGE INPUTS
        - "" (empty string) → ""
        - "   " (whitespace only) → "" or only whitespace (no crash)
        - "---" (only thematic break) → "" or whitespace (no markdown chars)
        - deeply nested: "- > - > text"
          → result contains "text" and does not throw
        - unclosed bold: "**unclosed"
          → does not throw; result is a string
        - broken link: "[text]()" → result contains "text" (best-effort)
        - very long line: "a".repeat(10001) as paragraph
          → result.length >= 10001 (no truncation) and does not throw
        - document with only an image (no text nodes):
          "![a dog](dog.png)" → result.trim() === "a dog"

      OPTION COMBINATIONS — no markdown syntax artifacts
        Use this realistic multi-element document as input:
          "# Title\n\n**bold** and *italic* and ~~strike~~\n\n"
          + "- item a\n- item b\n\n"
          + "[link text](https://example.com)\n\n"
          + "```js\nconst x = 1;\n```\n\n"
          + "| H1 | H2 |\n|----|----|\n| v1 | v2 |\n\n"
          + "> [!WARNING]\n> watch out\n"

        With all defaults:
          → result does not contain "#"
          → result does not contain "*"
          → result does not contain "`"
          → result does not contain "~~"
          → result does not contain ">"  (blockquote / alert syntax)
          → result does not contain "|"  (table syntax)
          → result does not contain "["  (link/footnote syntax — only "[1]" from
            footnotes is allowed; assert none here since no footnotes in doc)

        With { expandLinks: true, announceHeadings: false, announceCode: false }:
          → result contains "https://example.com"
          → result does NOT start with "Section:"
          → result does NOT contain "Code: "

      Each test: .toBe / .toContain / .not.toContain.
    status:
      implement: open
      commit: open
---

# Context

Add a markdown-to-plaintext renderer to `toolcraft-design` that produces
natural, speakable output with no markdown syntax artifacts. The primary
use case is TTS (text-to-speech) pipelines that consume poe-code output.

The renderer follows the same architecture as the existing `html-renderer.ts`:
it walks the `MdNode` AST produced by the shared parser and emits a plain
string. It never changes the parser or the terminal renderer.

Key design choices:
- Strikethrough and raw HTML are silently omitted (not spoken).
- Lists use English ordinals ("First, Second, Third, Next") for ordered lists
  and comma/semicolon join for unordered, instead of bullet symbols.
- Headings get spoken prefixes ("Section:", "Subsection:", "Topic:") by default
  so the listener understands document structure without visual cues.
- Links hide URLs by default; `expandLinks` exposes them for cases where the
  caller wants the full reference read aloud.
- Code blocks are prefixed with "Code:" by default to signal a shift in register.
- All options default to the most TTS-friendly setting; callers opt out explicitly.
