# Terminal Markdown

## Summary

A new `terminal-markdown` module inside `@poe-code/design-system` that parses markdown into an AST and renders it with ANSI styling for terminal display. Lives in `packages/design-system/src/terminal-markdown/` — co-located with the design system's tokens, symbols, and components it consumes. **Zero external dependencies** — parser, frontmatter extraction, and renderer all built from scratch using existing design-system primitives.

Full **GitHub Flavored Markdown (GFM)** support including tables, task lists, strikethrough, autolink literals, footnotes, and GitHub alerts/admonitions.

## Research: Top 3 JS Markdown Parsers

| Aspect | marked | markdown-it | remark/micromark |
|--------|--------|-------------|------------------|
| Downloads | ~35M/week | ~10-21M/week | ~12M/week |
| Approach | Regex + recursive | Rule chains | State machine |
| Output | Token tree | Flat token stream (open/close) | Proper AST (mdast) |
| CommonMark | ~60% | 100% | 100% |
| Size | ~12 KB | ~43 KB | ~19.5 KB + deps |

**Decision:** Borrow markdown-it's two-phase block-then-inline architecture and rule priority ordering, but produce a proper AST (like remark's mdast) since we need structural traversal for rendering. No regex for core parsing — use string scanning with position tracking.

## Architecture

```
Markdown string
  → Frontmatter extraction (custom YAML-subset parser)
  → Block parser (line-by-line rule chain)
  → Inline parser (character scanning with delimiter stack)
  → AST (MdNode tree)
  → Renderer (AST → ANSI-styled string)
```

### Location: `packages/design-system/src/terminal-markdown/`

```
packages/design-system/src/terminal-markdown/
├── index.ts              # public API: parse(), render(), renderMarkdown()
├── ast.ts                # MdNode types
├── parser/
│   ├── block.ts          # block-level rule chain
│   ├── inline.ts         # inline-level parsing + delimiter stack
│   └── frontmatter.ts    # custom YAML-subset frontmatter parser
├── renderer.ts           # AST → ANSI string
├── parser.test.ts        # parser tests
├── renderer.test.ts      # renderer tests
└── integration.test.ts   # end-to-end markdown → ANSI tests
```

Exported from design-system's root `index.ts`:
```typescript
// Terminal markdown
export { parse, render, renderMarkdown } from "./terminal-markdown/index.js";
export type { MdNode, RenderOptions } from "./terminal-markdown/index.js";
```

This gives consumers a single import: `import { renderMarkdown } from "@poe-code/design-system"`.

### AST Node Types

```typescript
type MdNode =
  | { type: "root"; children: MdNode[] }
  | { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MdNode[] }
  | { type: "paragraph"; children: MdNode[] }
  | { type: "blockquote"; children: MdNode[] }
  | { type: "code"; lang?: string; meta?: string; value: string }
  | { type: "list"; ordered: boolean; start?: number; children: MdNode[] }
  | { type: "listItem"; checked?: boolean; children: MdNode[] }
  | { type: "thematicBreak" }
  | { type: "table"; align: Array<"left" | "center" | "right" | null>; children: MdNode[] }
  | { type: "tableRow"; children: MdNode[] }
  | { type: "tableCell"; children: MdNode[] }
  | { type: "html"; value: string }
  | { type: "text"; value: string }
  | { type: "emphasis"; children: MdNode[] }
  | { type: "strong"; children: MdNode[] }
  | { type: "strikethrough"; children: MdNode[] }
  | { type: "inlineCode"; value: string }
  | { type: "link"; url: string; title?: string; children: MdNode[] }
  | { type: "image"; url: string; alt: string; title?: string }
  | { type: "break" }
  | { type: "frontmatter"; data: Record<string, unknown> }
  // GFM extensions
  | { type: "alert"; kind: "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION"; children: MdNode[] }
  | { type: "footnoteDefinition"; label: string; children: MdNode[] }
  | { type: "footnoteReference"; label: string }
```

### Block Parser Rules (priority order, from markdown-it)

1. Fenced code blocks (```)
2. Frontmatter (--- yaml ---)
3. ATX headings (#)
4. Thematic breaks (---, ***, ___)
5. Blockquotes (>)
6. Lists (-, *, +, 1.)
7. HTML blocks
8. Alerts / admonitions (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`)
9. Tables (GFM pipe tables)
10. Footnote definitions (`[^label]: content`)
11. Setext headings (underline =, -)
12. Paragraphs (fallback)

### Inline Parser Rules

1. Escapes (\\)
2. Inline code (`)
3. Links [text](url) and images ![alt](url)
4. Autolinks (<url>)
5. HTML inline tags
6. Emphasis/strong (* and _) — delimiter stack algorithm
7. Strikethrough (~~)
8. Footnote references (`[^label]`)
9. Autolink literals (bare URLs: `www.example.com`, `https://example.com`, `user@example.com`)
10. Line breaks (trailing spaces / backslash)
11. Plain text (fallback)

### Renderer

Uses sibling design-system tokens exclusively — **no direct chalk usage**. Since it lives inside the design system, it imports tokens/primitives via relative paths (`../tokens/colors.js`, `../tokens/typography.js`, etc.):

| Element | Design-system mapping |
|---------|----------------------|
| H1 | `theme.header()` + `typography.bold()` + underline via `─` repeat |
| H2 | `theme.header()` + `typography.bold()` |
| H3-H6 | `typography.bold()`, H5-H6 add `theme.muted()` |
| Bold | `typography.bold()` |
| Italic | `typography.italic()` |
| Strikethrough | `typography.strikethrough()` |
| Code span | `theme.accent()` |
| Code block | `theme.muted()` for border, `spacing.sm` indent |
| Blockquote | `symbols.bar` prefix + `typography.dim()` |
| Link | children + `theme.accent()` on `(url)` |
| Image | `theme.muted("[image: alt]")` |
| List (unordered) | `spacing.sm` indent + `•` bullet |
| List (ordered) | `spacing.sm` indent + `n.` numbering |
| Task list | `symbols.active` / `symbols.inactive` |
| Table | `symbols.bar` separators, `spacing.sm` cell padding |
| HR | `theme.divider()` on `─` repeated to `widths` |
| Alert NOTE | `symbols.bar` prefix + `theme.info()` label |
| Alert TIP | `symbols.bar` prefix + `theme.success()` label |
| Alert IMPORTANT | `symbols.bar` prefix + `theme.info()` label (magenta) |
| Alert WARNING | `symbols.bar` prefix + `theme.warning()` label |
| Alert CAUTION | `symbols.bar` prefix + `theme.error()` label |
| Footnote ref | `typography.dim("[n]")` |
| Footnote def | Rendered at bottom, numbered, `spacing.sm` indent |
| Autolink | `theme.accent()` (same as link URL) |
| Frontmatter | `typography.dim()` key-value pairs, or hidden (configurable) |

The renderer accepts a `ThemePalette` so it works with both `dark` and `light` themes automatically via `getTheme()`.

### Public API

```typescript
// Parse markdown to AST
function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode };

// Render AST to ANSI string
function render(ast: MdNode, options?: RenderOptions): string;

// Convenience: parse + render
function renderMarkdown(markdown: string, options?: RenderOptions): string;

interface RenderOptions {
  width?: number;           // terminal width for wrapping (default: process.stdout.columns or 80)
  showFrontmatter?: boolean; // render frontmatter section (default: false)
}
```

## Test Cases (179 total)

### Block Parsing (30)

1. ATX heading level 1 (`# Heading`)
2. ATX heading level 2 (`## Heading`)
3. ATX heading level 3 (`### Heading`)
4. ATX heading level 4-6
5. ATX heading with closing hashes (`## Heading ##`)
6. ATX heading with inline formatting (`## **bold** heading`)
7. Setext heading with `=` underline
8. Setext heading with `-` underline
9. Fenced code block with backticks
10. Fenced code block with tildes
11. Fenced code block with language specifier
12. Fenced code block with language + meta string
13. Fenced code block containing markdown-like content (should not be parsed)
14. Indented code block (4 spaces)
15. Empty fenced code block
16. Thematic break with `---`
17. Thematic break with `***`
18. Thematic break with `___`
19. Thematic break with spaces between characters (`- - -`)
20. Blockquote single line
21. Blockquote multi-line
22. Nested blockquotes (`> > nested`)
23. Blockquote with other block elements inside (heading, list)
24. Unordered list with `-` marker
25. Unordered list with `*` marker
26. Unordered list with `+` marker
27. Ordered list starting at 1
28. Ordered list starting at arbitrary number
29. Nested lists (unordered inside unordered)
30. Mixed nested lists (ordered inside unordered)

### Inline Parsing (25)

31. Emphasis with asterisks (`*em*`)
32. Emphasis with underscores (`_em_`)
33. Strong with asterisks (`**strong**`)
34. Strong with underscores (`__strong__`)
35. Strong emphasis (`***both***`)
36. Emphasis inside a word (`foo*bar*baz`)
37. Underscore in middle of word is NOT emphasis (`foo_bar_baz`)
38. Inline code with single backtick
39. Inline code with double backticks (`` ` `` inside)
40. Inline code preserves spaces and doesn't parse inner markdown
41. Link with title (`[text](url "title")`)
42. Link without title (`[text](url)`)
43. Link with empty text (`[](url)`)
44. Autolink (`<https://example.com>`)
45. Image (`![alt](url)`)
46. Image with title (`![alt](url "title")`)
47. Nested emphasis inside link (`[**bold** link](url)`)
48. Escape sequences (`\*not emphasis\*`)
49. Escape of special characters (`\[`, `\]`, `\(`, `\)`, `\#`, `\>`)
50. Hard line break (trailing two spaces)
51. Hard line break (trailing backslash)
52. Strikethrough (`~~deleted~~`)
53. Inline HTML tags preserved (`<span>text</span>`)
54. Emphasis across line boundaries (`*em\ncontinued*`)
55. Nested strong inside emphasis (`*foo **bar** baz*`)

### Tables — GFM (10)

56. Simple 2-column table
57. Table with left/center/right alignment
58. Table with inline formatting in cells (`**bold** cell`)
59. Table with empty cells
60. Table with varying column counts (short rows padded)
61. Table with escaped pipes in cells (`\|`)
62. Table with no alignment row (should not parse as table)
63. Minimal table (header + separator + 1 row)
64. Table with leading/trailing pipes
65. Table without leading/trailing pipes

### Frontmatter (8)

66. YAML frontmatter with simple key-value pairs
67. YAML frontmatter with nested objects
68. YAML frontmatter with arrays
69. YAML frontmatter followed by markdown content
70. Document without frontmatter
71. Frontmatter with empty body (just `---\n---`)
72. Frontmatter-like content NOT at document start (should be treated as thematic break)
73. Frontmatter with special characters in values

### Task Lists (5)

74. Task list with checked items (`- [x] done`)
75. Task list with unchecked items (`- [ ] todo`)
76. Mixed task list
77. Task list with inline formatting (`- [x] **important** task`)
78. Nested task list

### Edge Cases & Combinations (16)

79. Empty document
80. Document with only whitespace
81. Document with only newlines
82. Multiple blank lines between blocks collapse
83. Paragraph continuation (no blank line between text lines)
84. Block-level content interrupts paragraph (heading after text)
85. List item with multiple paragraphs (blank line between)
86. List item continuation (indented text)
87. Code block inside blockquote
88. Link reference definitions (`[id]: url "title"`) — not rendered, used for references
89. Deeply nested blockquotes (4+ levels)
90. Extremely long lines (no wrapping in parser, renderer wraps)
91. Mixed block types in sequence (heading → paragraph → code → list → table)
92. Unicode content (emoji, CJK, RTL)
93. Tab characters in indentation
94. Windows line endings (CRLF)

### GitHub Alerts / Admonitions (8)

95. Alert NOTE (`> [!NOTE]`)
96. Alert TIP (`> [!TIP]`)
97. Alert IMPORTANT (`> [!IMPORTANT]`)
98. Alert WARNING (`> [!WARNING]`)
99. Alert CAUTION (`> [!CAUTION]`)
100. Alert with multi-line content
101. Alert with inline formatting inside (`> [!NOTE]\n> **bold** content`)
102. Alert with nested block elements (list inside alert)

### Footnotes (7)

103. Simple footnote definition and reference (`[^1]: text` / `[^1]`)
104. Footnote with multi-line content
105. Multiple footnotes in a document
106. Footnote reference without matching definition (render as literal text)
107. Footnote definition without any reference (still parsed, not rendered)
108. Footnote with inline formatting in definition
109. Footnote with alphanumeric label (`[^note1]`)

### Autolink Literals — GFM (5)

110. Bare URL with `https://` prefix
111. Bare URL with `http://` prefix
112. Bare URL with `www.` prefix (no protocol)
113. Email autolink (`user@example.com`)
114. Autolink not triggered inside code span or link

### Malformed / Half-Broken Input (25)

_Philosophy: never crash, always produce something readable. Treat broken syntax as literal text._

115. Unclosed fenced code block (``` without closing) — treat rest of doc as code
116. Unclosed emphasis (`*hello` without closing `*`) — render `*` as literal
117. Unclosed strong (`**hello` without `**`) — render `**` as literal
118. Unclosed strikethrough (`~~hello`) — render `~~` as literal
119. Unclosed link bracket (`[text` without `](url)`) — render `[text` as literal
120. Link with missing URL (`[text]()`) — render as text, empty link
121. Link with missing closing paren (`[text](url`) — render as literal
122. Image with missing alt/url (`![]()`) — graceful empty image node
123. Nested unclosed emphasis (`**bold *and italic` — no closing for either)
124. Mismatched emphasis markers (`*hello_`) — render markers as literal
125. Heading with no text after `#` — empty heading node
126. Heading with 7+ `#` signs (`####### text`) — treat as paragraph (max 6)
127. Table with inconsistent column counts across rows — pad/truncate gracefully
128. Table with only header row (no data rows) — render header only
129. Table separator row with wrong format (`|---|--`) — don't parse as table
130. Frontmatter with unclosed `---` (no closing fence) — treat `---` as thematic break
131. Frontmatter with invalid YAML (bad indentation, `: ` in values) — return raw string as data
132. Blockquote with trailing `>` on empty lines (`>\n>\n>`) — empty blockquote
133. List marker followed by nothing (`- \n- \n`) — empty list items
134. Ordered list with non-sequential numbers (`1. 5. 3.`) — preserve original numbers
135. Deeply nested broken structure (blockquote > list > blockquote > broken emphasis)
136. HTML-like content that isn't valid HTML (`<not a tag>`) — render as text
137. Alert with unknown type (`> [!UNKNOWN]`) — treat as regular blockquote
138. Footnote reference with no matching `[^1]` definition — render `[^1]` as literal
139. Bare `---` ambiguity: frontmatter fence vs thematic break vs setext heading (context-dependent)

### Common User Mistakes (15)

_Real patterns from copy-paste errors, editor artifacts, and markdown misunderstandings._

140. Indented heading (`  ## heading`) — should still parse as heading (up to 3 spaces)
141. Missing blank line before heading (paragraph then `# heading`) — heading wins
142. Missing blank line before code block (text then ```) — code block wins
143. Missing blank line before list (paragraph then `- item`) — list wins
144. Spaces inside emphasis markers (`* spaced *`) — not emphasis per CommonMark
145. Tabs mixed with spaces in list indentation — normalize tabs to 4 spaces
146. Trailing whitespace on every line (common in copy-paste)
147. Double-spaced lines (blank line between every line of a paragraph)
148. BOM (byte order mark) at start of document — strip silently
149. Link URL with spaces (`[text](url with spaces)`) — preserve, don't break
150. Link URL with parentheses (`[text](url_(with)_parens)`) — match parens correctly
151. Emphasis marker adjacent to punctuation (`"*hello*"`) — parse emphasis correctly
152. Code fence with trailing spaces (` ``` `) — still close the code block
153. List item with sub-item that looks like a thematic break (`  ---`) — context: thematic break in list
154. Angle brackets in text that aren't autolinks (`<not-a-url>`, `5 < 10`) — render as literal

### Real-World Document Patterns (15)

_Representative of actual markdown files encountered in the wild._

155. README with badges, headings, code blocks, and links (typical GitHub README structure)
156. API documentation: headings + parameter tables + code examples + notes
157. Changelog: `## [1.2.3] - 2024-01-15` headings + nested lists of changes
158. Blog post: frontmatter + headings + paragraphs + images + code blocks + blockquotes
159. GitHub issue template: frontmatter + headings + task list + code blocks
160. CLI `--help` output pasted into markdown (indented code blocks, no fencing)
161. LLM-generated markdown: often has inconsistent heading levels, extra blank lines, over-nested lists
162. Pipeline plan YAML frontmatter + structured markdown body (matches this project's plan format)
163. Markdown with mixed inline: `**bold _and italic_** and [link](url) with \`code\` and ~~strike~~`
164. Long code block (50+ lines) with syntax highlighting language tag
165. Document with 10+ footnotes scattered throughout, definitions at bottom
166. Nested blockquote conversation format (`> > > deeply quoted reply chain`)
167. Table-heavy document (5+ tables with varying column counts and alignments)
168. Document mixing all GitHub alert types with content between them
169. Large document (1000+ lines) — performance: should parse in <50ms

### Renderer-Specific (10)

170. Renderer respects `width` option for line wrapping
171. Renderer hides frontmatter by default
172. Renderer shows frontmatter when `showFrontmatter: true`
173. Renderer indents nested blockquotes correctly
174. Renderer aligns table columns
175. Renderer numbers ordered lists correctly
176. Code block renders with visible boundaries
177. Link renders as `text (url)` with color
178. Heading renders with appropriate visual weight per level
179. Empty nodes produce no output (no phantom newlines)

## Implementation Order

1. **AST types** — define `MdNode` union type
2. **Block parser** — line-by-line rule chain, tests for each rule
3. **Inline parser** — character scanning + delimiter stack, tests
4. **Frontmatter** — custom YAML-subset parser (strings, numbers, booleans, arrays, nested objects), tests
5. **Renderer** — AST → ANSI with design-system tokens, tests
6. **Integration** — end-to-end tests, public API
7. **README** — package documentation

## Dependencies

**Zero new dependencies.** Everything from scratch, using existing design-system internals:

- Parser — custom block + inline rule chains (pure string manipulation, no deps)
- Frontmatter — custom YAML-subset parser (strings, numbers, booleans, arrays, nested objects)
- Renderer — uses sibling tokens via relative imports:
  - `../tokens/colors.js` → `getTheme()` for `theme.header()`, `theme.accent()`, etc.
  - `../tokens/typography.js` → `typography.bold()`, `.dim()`, `.italic()`, etc.
  - `../tokens/spacing.js` → indent values
  - `../tokens/widths.js` → `maxLine` for wrapping
  - `../components/symbols.js` → `symbols.bar`, `.active`, `.inactive`, `.warning`
  - `../internal/theme-detect.js` → `getTheme()` for dark/light auto-detection
  - `../internal/output-format.js` → `resolveOutputFormat()` for multi-format support

No `gray-matter`, no `yaml`, no `chalk` — it's just design-system code using design-system primitives.
