---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft Markdown Code Highlighting

Add opt-in structured syntax highlighting for fenced code blocks rendered by Toolcraft Markdown.

## 1. What we're building

`toolcraft-design` should add lightweight, opt-in syntax highlighting to Markdown fenced code blocks.

Consumers enable the behavior with a boolean option:

```ts
renderMarkdownHtml(markdown, { syntaxHighlight: true });
renderMarkdown(markdown, { syntaxHighlight: true });
```

Default rendering stays off and should preserve current output as closely as practical:

```ts
renderMarkdownHtml(markdown);
renderMarkdown(markdown);
```

HTML code block source text remains escaped. When highlighting is enabled, Toolcraft may emit only neutral `<span>` wrappers with stable token classes inside the escaped code content. The feature must not ship, inject, or require CSS. Without consumer CSS, highlighted HTML output should still look like ordinary code.

Terminal code block source text should be styled with Toolcraft's existing ANSI theme only when `syntaxHighlight: true` is passed. The terminal code block border, indentation, spacing, and width behavior should remain the same.

The architecture should be parser/AST aware, not an HTML-string post-processor. Fenced code blocks remain `code` nodes, and highlighting is represented as structured token data that a `code` node renderer can consume. HTML and terminal renderers consume the same token stream.

The tokenizer should use fast heuristic scanning, language-specific presets, no runtime execution, and graceful fallback on malformed code.

The first supported languages are:

- `js`, `ts`, `jsx`, `tsx`
- `json`
- `yaml`, `yml`
- `css`
- `sh`, `bash`
- `python`
- `sql`

Unknown languages fall back to current plain code rendering.

Explicit non-goals:

- Do not change default `renderMarkdownHtml(markdown)` or `renderMarkdown(markdown)` behavior.
- Do not add public highlighting modes, themes, inline-style options, callbacks, or bundled CSS.
- Do not emit tags with default visual styling such as `<strong>`, `<em>`, or `<q>` for highlighted HTML tokens.
- Do not replace the existing Markdown parser or add a second Markdown parser.
- Do not implement a full grammar/parser for each language.
- Do not post-process rendered HTML to add highlighting.
- Do not use language auto-detection.
- Do not update README without explicit user permission.

## 2. User-facing shape

HTML callers use the existing renderer with one extra boolean:

```ts
import { renderMarkdownHtml } from "toolcraft/design";

const html = renderMarkdownHtml('```ts\nconst value = "hello";\n```', {
  syntaxHighlight: true
});
```

Default HTML output stays plain escaped code:

```ts
renderMarkdownHtml('```js\nconst x = "hello";\n```');
```

```html
<pre><code class="language-js">const x = &quot;hello&quot;;</code></pre>
```

Highlighted HTML output keeps the same wrapper and adds neutral spans inside `<code>`:

```ts
renderMarkdownHtml('```js\nconst x = "hello";\n```', { syntaxHighlight: true });
```

```html
<pre><code class="language-js"><span class="tc-token-keyword">const</span> x = <span class="tc-token-string">&quot;hello&quot;</span>;</code></pre>
```

Consumers that want colors can target stable classes:

```css
.tc-token-keyword { color: var(--code-keyword); }
.tc-token-string { color: var(--code-string); }
.tc-token-comment { color: var(--code-comment); }
```

Token classes use hyphenated CSS naming with a `tc-token-` namespace.

Terminal callers use the existing renderer with the same boolean:

```ts
import { renderMarkdown } from "toolcraft/design";

const terminal = renderMarkdown('```js\nconst x = "hello";\n```', {
  syntaxHighlight: true
});
```

Terminal highlighting keeps the existing code-block shape:

```text
 ─────────────────
 const x = "hello";
 ─────────────────
```

Token styling is sensible and restrained:

- Keywords, types, tags, commands, decorators: accent + bold.
- Strings and templates: success color.
- Numbers, booleans, nulls, parameters: number/info styling.
- Comments: muted.
- Properties, keys, attributes, variables, functions, anchors, directives: info/accent styling.
- Regexes, colors, `!important`, flags: warning styling.
- Operators, punctuation, selectors: muted.
- Plain text and whitespace: unchanged.

Unknown languages fall back even when highlighting is enabled:

```ts
renderMarkdownHtml("```brainfuck\n++[>++<-]\n```", { syntaxHighlight: true });
```

```html
<pre><code class="language-brainfuck">++[&gt;++&lt;-]</code></pre>
```

AST-first callers use the same boolean on `renderHtml` and `render`:

```ts
import { parse, render, renderHtml } from "toolcraft-design";

const { ast } = parse(markdown);
const html = renderHtml(ast, { syntaxHighlight: true });
const terminal = render(ast, { syntaxHighlight: true });
```

No syntax highlighting is added unless `syntaxHighlight: true` is passed.

## 3. Implementation details and technical decisions

Autonomy audit:

- No credentials are required.
- No network access is required for implementation.
- No running services are required.
- No sample data is required beyond inline fixtures in unit tests.
- No new package dependency is required for the first implementation.
- No README update is planned unless the user explicitly approves it.

Issue check:

- GitHub issue `#437` is open and has no comments.
- A GitHub issue search for `toolcraft-design markdown syntax highlight renderMarkdownHtml` found only `#437`.
- The issue is HTML-focused. This plan adds terminal/CLI support because the user explicitly expanded the scope.

Existing architecture:

- `packages/toolcraft-design/src/terminal-markdown/parser/block.ts` parses fenced code into `{ type: "code", lang?, meta?, value }`.
- `packages/toolcraft-design/src/terminal-markdown/ast.ts` owns the `MdNode` union.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts` renders code blocks today with `escapeHtml(node.value)`.
- `packages/toolcraft-design/src/terminal-markdown/renderer.ts` renders terminal code blocks with a muted border, strips user-provided ANSI, and writes raw code text inside the border.
- `packages/toolcraft-design/src/terminal-markdown/index.ts` exposes `renderHtml`, `renderMarkdownHtml`, `render`, `renderMarkdown`, `HtmlRenderOptions`, and `RenderOptions`.
- `packages/toolcraft-design/src/render-markdown-html.ts` and `packages/toolcraft/src/design/render-markdown-html.ts` are flat re-export files.

Architecture decision:

- Add a parser-adjacent code-token layer under `packages/toolcraft-design/src/terminal-markdown/parser/`.
- Keep Markdown parsing responsible for recognizing fenced code blocks and preserving `lang`, `meta`, and raw `value`.
- Represent highlighting as structured token data that belongs to a code node, not as rendered HTML or terminal text.
- Keep default `parse(markdown)` output compatible by not eagerly attaching tokens unless highlighting is requested.
- Make HTML and terminal rendering consume the same code tokens when `syntaxHighlight` asks a renderer to enrich a code node.
- Never regex over rendered HTML.
- Never run user code or invoke language runtimes.
- Never rely on language auto-detection; fence language controls preset selection.

The code node type becomes:

```ts
export type CodeTokenKind =
  | "anchor"
  | "at-rule"
  | "attribute"
  | "boolean"
  | "color"
  | "command"
  | "comment"
  | "decorator"
  | "directive"
  | "flag"
  | "function"
  | "identifier"
  | "important"
  | "key"
  | "keyword"
  | "null"
  | "number"
  | "operator"
  | "parameter"
  | "plain"
  | "property"
  | "punctuation"
  | "regex"
  | "selector"
  | "string"
  | "tag"
  | "template"
  | "type"
  | "variable";

export type CodeToken = {
  kind: CodeTokenKind;
  value: string;
};

type CodeNode = {
  type: "code";
  lang?: string;
  meta?: string;
  value: string;
  tokens?: CodeToken[];
};
```

`tokens` is optional so existing AST snapshots remain unchanged by default.

Shared rendering rules:

- Preserve whitespace exactly by leaving whitespace in token `value` strings and rendering it directly.
- Use a `plain` token or raw text for unstyled gaps.
- Unsupported languages return `undefined` from tokenization and render through the current plain code path.
- Empty code blocks render exactly as today.
- Malformed code never throws.

HTML rendering rules:

- Escape every token value with the existing HTML escaping helper.
- Use spans only for non-plain tokens.
- Emit stable classes formatted as `tc-token-${kind}`.
- Keep `class="language-${lang}"` on `<code>`.
- `allowRawHtml` never affects code token escaping.
- Highlighted output must not contain `style=`.

Terminal rendering rules:

- Strip user-provided ANSI before tokenization, then apply Toolcraft-owned ANSI styling to token values.
- Compute border width from unstyled, stripped source text so token styling cannot widen the border.
- Preserve existing indentation, border, blank-line, and block spacing behavior.
- Unknown languages fall back to current stripped plain terminal code output.

Internal flow:

```ts
export function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string {
  const { ast } = parse(markdown);
  return renderHtml(ast, options);
}

export function renderMarkdown(markdown: string, options?: RenderOptions): string {
  const { ast } = parse(markdown);
  return render(ast, options);
}
```

Code rendering derives tokens from parsed `code` nodes:

```ts
function renderCodeBlock(node: CodeNode, context: RenderContext): string {
  const tokens = context.syntaxHighlight ? node.tokens ?? highlightCodeBlock(node) : undefined;
  return renderCodeElement(node, tokens, context);
}
```

This may derive tokens without mutating the AST. It still fits the parser model because `highlightCodeBlock(node)` consumes a parsed `code` node and returns code-node token data; it does not operate on rendered output.

Implementation learnings:

- Keep tokenization separate from rendering. The scanner returns `CodeToken[]`; HTML and terminal renderers decide how to display those tokens.
- Preserve source by construction. Concatenating token values must exactly reproduce the source string that was tokenized.
- Use small language presets instead of full grammars. Presets define aliases, keyword sets, comment rules, string rules, and optional family-specific state machines.
- Prefer a streaming scanner with explicit states over broad replacements. Useful states include strings, comments, template literals, JSX tags, YAML block scalars, shell heredocs, and SQL quoted identifiers.
- Treat malformed code as displayable text, never as an error. Unterminated strings/comments/templates/heredocs/scalars consume to a safe boundary or EOF.
- Keep class names Toolcraft-owned. Do not inherit external class names, inline styles, line wrapper conventions, theme contracts, or auto-detection behavior.
- Use syntax categories that can serve both HTML and terminal output. The token kind is semantic enough for styling but not so specific that each language needs a separate public class vocabulary.
- Do not add a highlighter dependency in the first implementation. Toolcraft needs a narrow boolean API, stable classes, exact whitespace preservation, no CSS injection, and terminal rendering from the same token stream.

Toolcraft scanner design:

```ts
type CodeHighlightFamily = "js" | "json" | "yaml" | "css" | "shell" | "python" | "sql";

type CodeHighlightPreset = {
  aliases: readonly string[];
  family: CodeHighlightFamily;
  keywords?: ReadonlySet<string>;
  typeKeywords?: ReadonlySet<string>;
  lineComment?: string;
  blockComment?: { open: string; close: string };
  stringQuotes?: readonly string[];
  templateQuotes?: readonly string[];
  jsx?: boolean;
};

function tokenizeCode(value: string, preset: CodeHighlightPreset): CodeToken[];
function highlightCodeBlock(node: Extract<MdNode, { type: "code" }>): CodeToken[] | undefined;
function resolveCodeHighlightPreset(lang: string | undefined): CodeHighlightPreset | undefined;
```

Language resolution:

- Normalize language names to lowercase.
- Map aliases declaratively through preset metadata, not ad hoc `if`/`switch` branches.
- `js`, `javascript`, `mjs`, `cjs` resolve to JS.
- `ts`, `typescript`, `mts`, `cts` resolve to TS.
- `jsx` resolves to JS with JSX mode.
- `tsx` resolves to TS with JSX mode.
- `json` resolves to JSON.
- `yaml`, `yml` resolve to YAML.
- `css` resolves to CSS.
- `sh`, `bash`, `shell` resolve to shell.
- `py`, `python` resolve to Python.
- `sql` resolves to SQL.

HTML token classes:

- Every non-plain token renders as `tc-token-${kind}`.
- `plain` renders escaped text with no wrapper.
- Source text never influences the class name.

Terminal token styles:

- `keyword`, `type`, `tag`, `at-rule`, `command`, `decorator`: `typography.bold(context.theme.accent(text))`.
- `string`, `template`: `context.theme.success(text)`.
- `number`, `boolean`, `null`, `parameter`: `context.theme.number(text)`.
- `comment`: `context.theme.muted(text)`.
- `property`, `key`, `attribute`, `variable`, `function`, `anchor`, `directive`: `context.theme.info(text)`.
- `regex`, `color`, `important`, `flag`: `context.theme.warning(text)`.
- `operator`, `punctuation`, `selector`: `context.theme.muted(text)`.
- `identifier`, `plain`: unchanged.

Language-specific behavior:

- JS:
  - Comments: `//` to EOL and `/* */`.
  - Strings: `'`, `"`, template literals.
  - Keywords include common ECMAScript keywords and literals.
  - Numbers include decimal, numeric separators, hex/binary/octal-looking forms, and BigInt-looking forms.
  - Properties after `.` render as `property`.
  - Regex literals render as `regex` when distinguishable from division.
  - Dotted keywords such as `api.return.value` do not classify `return` as a keyword.
  - Private identifiers like `#value` do not break scanning.
- TS:
  - Extends JS with TS keywords such as `type`, `interface`, `enum`, `implements`, `readonly`, `declare`, `namespace`, `private`, `protected`, `public`, `override`, `keyof`, `infer`, `is`, `asserts`, `satisfies`, `as`, `unknown`, `never`, `any`.
  - Built-in type names such as `number`, `string`, `boolean`, `bigint`, `symbol`, and `object` render as `type`.
  - Generic arrow function type parameters should not be treated as JSX tags.
- JSX/TSX:
  - Tag names render as `tag`.
  - Attribute names render as `attribute`.
  - Text children can remain plain.
  - Expressions inside `{}` reuse JS/TS tokenization.
  - The scanner only needs common JSX; it does not need a full balanced AST.
- JSON:
  - Object keys before `:` render as `property`.
  - Strings render as `string`.
  - Numbers render as `number`.
  - `true` and `false` render as `boolean`.
  - `null` renders as `null`.
  - Braces, brackets, and commas render as `punctuation`; colons render as `operator`.
  - JSONC comments are a follow-up; plain `json` does not need comments.
  - Invalid JSON still tokenizes heuristically and never throws.
- YAML:
  - `#` to EOL renders as `comment` outside quoted strings and block scalar content.
  - Mapping keys before `:` render as `key`.
  - Quoted strings render as `string`.
  - Block scalar bodies for `|` and `>` render as `string` while preserving embedded newlines and indentation.
  - `true`, `false`, `yes`, `no`, `on`, `off` render as `boolean`.
  - `null` and `~` render as `null`.
  - Numbers render as `number`.
  - Anchors and aliases such as `&name` and `*name` render as `anchor`.
  - Tags such as `!Tag`, `!!str`, and `!<tag:...>` render as `tag`.
  - Directives such as `%YAML 1.2` render as `directive`.
  - URLs such as `https://example.com/a:b` do not cause `https` to become a key.
- CSS:
  - `/* */` renders as `comment`.
  - At-rules such as `@media`, `@import`, `@keyframes`, `@font-face`, `@supports`, `@page`, `@layer`, `@container`, and vendor-prefixed at-rules render as `at-rule`.
  - Property names before `:` inside declaration blocks render as `property`.
  - Custom properties such as `--brand-color` render as `property` in declarations and `variable` inside `var(...)`.
  - Selectors before `{` render as `selector`.
  - Strings and numeric values render as `string` and `number`.
  - Hex colors such as `#fff`, `#ffffff`, and `#ffffffff` render as `color` in value context.
  - CSS functions such as `url(`, `calc(`, `rgb(`, `color-mix(`, `minmax(`, and `env(` render as `function`.
  - `!important` renders as `important`, case-insensitive.
  - Do not classify `#id` selectors as colors.
- Shell:
  - `#` to EOL renders as `comment` only when unquoted and at line start or after whitespace/operator.
  - Shebang on the first line renders as `comment`.
  - Single quotes, double quotes, ANSI-C `$'...'`, and backticks render as `string`.
  - Variables like `$HOME`, `${HOME}`, `${name:-fallback}`, `$1`, `$?`, `$$`, `$@`, `$*`, `$-` render as `variable`.
  - Shell control words such as `if`, `then`, `else`, `elif`, `fi`, `for`, `in`, `do`, `done`, `case`, `esac`, `while`, `until`, `function`, `select`, `time` render as `keyword`.
  - Command names render as `command` when they are the first non-assignment, non-redirection word at command position.
  - Flags such as `--flag`, `--flag=value`, `-a`, and `-abc` render as `flag`; negative numbers like `-1` do not become flags.
  - Operators include `&&`, `||`, `|&`, `|`, `;`, `;;`, `&`, `<`, `>`, `>>`, `2>`, `2>&1`, `>&`, `<&`, `<<`, `<<-`, `<<<`.
  - Heredoc bodies can render as `string` if implemented in the first pass; computed delimiters are out of scope.
- Python:
  - `#` to EOL renders as `comment`, including apostrophes inside the comment.
  - Keywords include Python reserved words and soft keywords `match` and `case`.
  - Strings render as `string`; support prefixes `r`, `u`, `b`, `br`, `rb`, `f`, `fr`, `rf`, single/double quotes, and triple quotes.
  - F-strings render as a single `string` token in the first implementation; recursive highlighting inside replacement fields is out of scope.
  - Decorators at line start after indentation render as `decorator`.
  - Numbers render as `number`, including decimal, binary/octal/hex prefixes, underscores, floats, exponents, and imaginary suffixes.
  - Leading signs stay operators/punctuation, not part of the number token.
- SQL:
  - Keywords include common generic SQL keywords such as `select`, `from`, `where`, `join`, `insert`, `update`, `delete`, `create`, `alter`, `drop`, `table`, `values`, `set`, `group`, `order`, `limit`, `having`, `and`, `or`, `not`, `null`, `case`, `when`, `then`, `else`, `end`, `as`, `distinct`, `union`, `with`, `returning`.
  - `--` to EOL and `/* */` render as `comment`.
  - Single-quoted strings render as `string`; doubled single quotes stay inside the same string.
  - Double-quoted identifiers render as `identifier`, not `string`.
  - Parameters such as `$1`, `?`, `:name`, and `@user_id` render as `parameter`.
  - Numbers render as `number`, including common decimal and exponent forms; leading signs stay operators.
  - If the previous non-whitespace token is `.`, do not classify the following word as `keyword`.

Edge cases:

- Source text containing `<script>`, `</code>`, `&`, quotes, and unicode remains escaped in HTML.
- Whitespace and newlines inside code blocks are preserved exactly.
- Unclosed strings/comments must not throw; render the remaining text as that token kind or plain text.
- Unsupported languages return plain escaped code or current terminal plain code.
- `showFrontmatter: true` currently renders frontmatter as YAML code. With `syntaxHighlight: true`, that YAML path should use the same code-block rendering helper so frontmatter can be highlighted without duplicating behavior.
- Terminal highlighting does not change border width, block spacing, or wrapping behavior.
- Terminal highlighting does not leak user-supplied ANSI codes.

## 4. Interfaces and test plan

Public interface changes:

```ts
export interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
  syntaxHighlight?: boolean;
}

export interface RenderOptions {
  width?: number;
  showFrontmatter?: boolean;
  syntaxHighlight?: boolean;
}
```

Existing public signatures remain:

```ts
function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string;
function renderHtml(ast: MdNode, options?: HtmlRenderOptions): string;
function renderMarkdown(markdown: string, options?: RenderOptions): string;
function render(ast: MdNode, options?: RenderOptions): string;
function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode };
```

Internal interfaces:

```ts
export type CodeHighlightFamily = "js" | "json" | "yaml" | "css" | "shell" | "python" | "sql";
export type CodeTokenKind = /* token kind union from level 3 */;

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

export interface CodeHighlightPreset {
  aliases: readonly string[];
  family: CodeHighlightFamily;
  keywords?: ReadonlySet<string>;
  typeKeywords?: ReadonlySet<string>;
  lineComment?: string;
  blockComment?: { open: string; close: string };
  stringQuotes?: readonly string[];
  templateQuotes?: readonly string[];
  jsx?: boolean;
}

export function resolveCodeHighlightPreset(lang: string | undefined): CodeHighlightPreset | undefined;
export function highlightCodeBlock(node: Extract<MdNode, { type: "code" }>): CodeToken[] | undefined;
export function tokenizeCode(value: string, preset: CodeHighlightPreset): CodeToken[];
```

TDD order:

1. Add failing HTML renderer tests for default-off behavior and `HtmlRenderOptions.syntaxHighlight`.
2. Add failing terminal renderer tests for default-off behavior and `RenderOptions.syntaxHighlight`.
3. Add failing tokenizer unit tests for JS and JSON.
4. Implement the token model, preset resolver, and shared token renderer helpers.
5. Implement HTML rendering from tokens.
6. Implement terminal rendering from the same tokens.
7. Add language-specific tests one preset at a time.
8. Add frontmatter and AST-first rendering tests.
9. Add robustness fixtures for malformed and mixed-language dummy file contents.
10. Run package tests/lint/build.

Layered fixture strategy:

- Add `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.fixtures.ts`.
- Fixtures are committed TypeScript data, not files created by tests at runtime.
- Each fixture represents a small "dummy file" with:
  - `name`: e.g. `component.tsx`, `config.yaml`, `query.sql`.
  - `lang`: fence language.
  - `source`: exact source text, including whitespace and malformed syntax.
  - `mustContainKinds`: token kinds that must appear.
  - `mustNotContainRawHtml`: unsafe substrings such as `<script>` that must never appear in rendered HTML.
  - `plainTextInvariant`: expected source text after stripping HTML tags/terminal ANSI and decoding entities where applicable.
- Tests consume the same fixture matrix at every layer:
  - tokenizer: returns tokens, preserves source when token values are concatenated, never throws.
  - HTML token renderer: escapes source, uses only `tc-token-*` classes, never emits `style=`.
  - terminal token renderer: strips user ANSI first, then applies Toolcraft styling, preserves stripped source after ANSI removal.
  - Markdown integration: fenced Markdown parses to a `code` node and renders through the same path.
  - public API: `renderMarkdownHtml`, `renderHtml`, `renderMarkdown`, and `render` all obey the same option semantics.

Robustness invariants for every supported language fixture:

- Tokenization is total: `highlightCodeBlock` and `tokenizeCode` must never throw.
- Concatenating token values exactly equals the input source used for tokenization.
- Unsupported languages return `undefined` tokens and use plain rendering.
- Empty strings, whitespace-only code, and newline-only code do not throw.
- Unclosed strings, comments, template literals, heredocs, block scalars, JSX tags, JSON objects, CSS blocks, Python triple strings, and SQL block comments do not throw.
- Embedded HTML-ish text such as `<script>`, `</code>`, `<img onerror=x>`, `&`, quotes, and unicode remains safe in HTML output.
- `allowRawHtml: true` never changes code block escaping.
- `syntaxHighlight: false` and omitted options match current output exactly.
- `syntaxHighlight: true` never changes the visible source text, only wraps/styles tokens.
- Terminal highlighting never leaks user-provided ANSI escapes.
- Terminal highlighting never changes code block border width.

HTML renderer tests in `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`:

- `renderMarkdownHtml(markdown)` keeps existing code block output by default.
- `syntaxHighlight: false` exactly matches default output.
- `renderMarkdownHtml(markdown, { syntaxHighlight: true })` emits token spans for supported languages.
- Highlighted code still escapes `<`, `>`, `&`, `"`, and `'`.
- Whitespace is preserved exactly for indentation, blank lines, and trailing spaces where current rendering preserves them.
- Unknown language falls back to plain escaped code.
- `renderHtml(ast, { syntaxHighlight: true })` highlights AST-first code nodes.
- `showFrontmatter: true` plus `syntaxHighlight: true` highlights YAML frontmatter through the shared code renderer.
- `allowRawHtml: true` does not allow raw HTML inside code tokens.
- Highlighted HTML output contains no `style=`.
- Fixture matrix: every supported dummy file renders safe HTML and preserves text after stripping tags.

Terminal renderer tests in `packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts`:

- `renderMarkdown(markdown)` keeps current code block rendering by default.
- `syntaxHighlight: false` exactly matches default output.
- `renderMarkdown(markdown, { syntaxHighlight: true })` styles code tokens while keeping the same border and indentation.
- User-provided ANSI in code is stripped before tokenization and does not leak into output.
- Highlighting does not change visible-width-based border sizing.
- Unknown languages fall back to current stripped plain terminal code output.
- `showFrontmatter: true` plus `syntaxHighlight: true` highlights rendered YAML frontmatter if frontmatter code rendering is shared.
- Fixture matrix: every supported dummy file renders terminal output without throwing and preserves stripped source text inside the existing code block shape.

Tokenizer tests in `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`:

- JS: `const value = "hello"; // comment` classifies keyword, string, and comment.
- JS: `console.log(value)` classifies `log` as property after `.`.
- JS: regex versus division is distinguished for `/foo\/bar/g.test(input)` and `total / count`.
- JS: template literals with `${...}` do not throw.
- TS: `type Point = { x: number }` classifies `type` as keyword and `number` as type.
- TSX: `const id = <T,>(value: T) => value;` does not classify `<T,>` as JSX.
- JSX: `<Button data-id="x">{label}</Button>` classifies tag, attribute, string, and expression identifier.
- JSON: `{"name":"poe","ok":true,"none":null,"count":2}` classifies property, string, boolean, null, number, operator, and punctuation.
- YAML: keys, comments, block scalars, anchors, tags, directives, booleans, nulls, and URL colon handling.
- CSS: at-rules, selectors, properties, custom properties, variables, colors, functions, `!important`, comments, URL strings, and hash selector/color ambiguity.
- Shell: comments, quotes, variables, command position, flags, negative numbers, operators, and heredocs if implemented.
- Python: comments, prefixes, triple strings, f-strings as strings, decorators, keywords, soft keywords, and numeric literals.
- SQL: keywords, strings, quoted identifiers, comments, parameters, numbers, and keyword-after-dot behavior.
- Unsupported language resolver returns `undefined`.
- Alias resolver maps every initial alias to the intended preset through declarative metadata.
- Fixture matrix: every dummy file concatenates back to the exact source text.
- Broken syntax matrix: every malformed fixture returns tokens or `undefined` and never throws.

Dummy fixture coverage:

- JS dummy files:
  - `basic.js`: keywords, strings, numbers, comments, properties.
  - `regex-vs-division.js`: regex literal and division expression in one file.
  - `template-broken.js`: template literal with interpolation plus an unclosed template.
  - `private-fields.js`: `#private`, class fields, comments containing HTML.
- TS dummy files:
  - `types.ts`: interfaces, type aliases, generic functions, built-in type names.
  - `generic-arrow.ts`: `<T,>(value: T) => value` and malformed generic-like text.
- JSX/TSX dummy files:
  - `component.jsx`: tags, attributes, dashed attributes, child text, expressions.
  - `component-broken.tsx`: unclosed tag, generic arrow, string props containing `<script>`.
- JSON dummy files:
  - `config.json`: properties, strings, numbers, booleans, nulls, arrays.
  - `broken.json`: missing braces, unclosed string, HTML-ish string.
- YAML dummy files:
  - `config.yaml`: keys, comments, booleans, null, anchors, tags, directives.
  - `block-scalar.yml`: `|` and `>` block scalars with `<b>x</b>`.
  - `broken.yaml`: dangling quote, dangling anchor, URL with multiple colons.
- CSS dummy files:
  - `styles.css`: at-rules, selectors, custom properties, colors, functions, `!important`.
  - `hash-ambiguity.css`: `#id` selector and `#fff` color in the same file.
  - `broken.css`: unclosed comment, unclosed string, missing braces.
- Shell dummy files:
  - `script.sh`: shebang, variables, commands, flags, operators, comments.
  - `heredoc.sh`: heredoc and resumed highlighting after delimiter.
  - `broken.sh`: unclosed quotes, `$()` text, `#` inside quotes, negative numbers.
- Python dummy files:
  - `module.py`: decorators, keywords, comments, strings, numbers.
  - `strings.py`: raw/bytes/f/triple strings, malformed string, HTML-ish text.
  - `numbers.py`: binary/octal/hex, underscores, floats, exponents, imaginary suffixes.
- SQL dummy files:
  - `query.sql`: keywords, numbers, strings, comments.
  - `identifiers.sql`: quoted identifiers, keyword after dot, parameters.
  - `broken.sql`: unclosed string and unclosed block comment.

Real-world test:

1. Build the package:

```sh
npm run build -w toolcraft-design
```

2. Run an HTML renderer invocation:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```js\nconst x = \"hello\";\n```", { syntaxHighlight: true }))'
```

Expected output contains:

```html
<pre><code class="language-js"><span class="tc-token-keyword">const</span>
```

And:

```html
<span class="tc-token-string">&quot;hello&quot;</span>
```

3. Run a terminal renderer invocation:

```sh
node --input-type=module -e 'import { renderMarkdown } from "./packages/toolcraft-design/dist/render-markdown.js"; console.log(renderMarkdown("```js\nconst x = \"hello\";\n```", { syntaxHighlight: true }))'
```

Expected observation: output keeps the existing code block border and contains ANSI styling around at least `const` and `"hello"`.

4. Run an escaping check:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```js\nconst x = \"<script>\";\n```", { syntaxHighlight: true }))'
```

Expected observation: the output contains `&lt;script&gt;` and no literal `<script>`.

5. Run an unknown-language fallback check:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```unknown\n<x>\n```", { syntaxHighlight: true }))'
```

Expected output:

```html
<pre><code class="language-unknown">&lt;x&gt;</code></pre>
```

Must-work checklist:

- [ ] Default HTML code block rendering is unchanged; proof: focused HTML renderer unit test.
- [ ] Default terminal code block rendering is unchanged; proof: focused terminal renderer unit test.
- [ ] `syntaxHighlight: true` emits `tc-token-*` spans for supported HTML languages; proof: HTML renderer tests.
- [ ] `renderMarkdown(markdown, { syntaxHighlight: true })` styles terminal code blocks sensibly; proof: terminal renderer tests and real-world terminal command.
- [ ] Escaping remains safe inside highlighted tokens; proof: escaping unit test and real-world escaping command.
- [ ] Whitespace is preserved exactly; proof: whitespace unit tests.
- [ ] Unknown languages fall back to plain escaped/plain terminal code; proof: fallback tests and real-world fallback command.
- [ ] JS and JSON are covered; proof: tokenizer and renderer tests.
- [ ] YAML/frontmatter path uses the same code renderer; proof: frontmatter tests.
- [ ] No CSS is bundled or injected; proof: output tests assert no `style=` and no generated stylesheet.
- [ ] User-provided ANSI is stripped before terminal token styling; proof: terminal renderer test.

Validation commands:

```sh
npm run test -w toolcraft-design
npm run lint -w toolcraft-design
npm run build -w toolcraft-design
```

## 5. Code plan

Files to create:

- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.ts`
  - Owns token kinds, token objects, preset resolution, and scanners.
  - Exports internal functions for focused unit tests.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`
  - TDD coverage for preset resolution and language tokenization.
- `packages/toolcraft-design/src/terminal-markdown/code-renderer.ts`
  - Shared helpers for rendering `CodeToken[]` to safe HTML and styled terminal text.
  - Keeps token-to-class and token-to-terminal-style mappings in one place.

Files to change:

- `packages/toolcraft-design/src/terminal-markdown/ast.ts`
  - Add `CodeTokenKind`, `CodeToken`, and optional `tokens?: CodeToken[]` to the `code` node shape.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts`
  - Add `syntaxHighlight?: boolean` to `HtmlRenderOptions`.
  - Add `syntaxHighlight` to `RenderContext`.
  - Change `renderCodeBlock` to call a shared HTML code-token renderer.
  - Render token spans with `tc-token-*` classes when tokens are available.
  - Route `renderFrontmatter` through the same YAML code rendering helper.
- `packages/toolcraft-design/src/terminal-markdown/renderer.ts`
  - Add `syntaxHighlight?: boolean` to `RenderOptions`.
  - Add `syntaxHighlight` to `RenderContext`.
  - Strip user ANSI, derive tokens from the stripped source, style token text with Toolcraft theme functions, and keep current border/indent behavior.
  - Route `renderFrontmatter` through the same terminal code-token renderer if feasible.
- `packages/toolcraft-design/src/terminal-markdown/index.ts`
  - Re-export updated `HtmlRenderOptions` and `RenderOptions`.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`
  - Add option type assertion for `syntaxHighlight`.
  - Add HTML behavior tests listed above.
- `packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts`
  - Add terminal behavior tests listed above.
- `packages/toolcraft-design/src/index.test.ts`
  - Update type/export expectations only if existing assertions require the new option field.

Build order:

1. Add failing tests for `HtmlRenderOptions.syntaxHighlight`, `RenderOptions.syntaxHighlight`, and default-off rendering.
2. Add `CodeToken` types to `ast.ts`.
3. Create `code-highlighter.ts` with resolver and a minimal JS/JSON tokenizer.
4. Create shared code rendering helpers for HTML and terminal.
5. Wire `html-renderer.ts` to render highlighted tokens for code nodes.
6. Wire `renderer.ts` to render highlighted terminal code blocks.
7. Make JS and JSON tests pass.
8. Add YAML/frontmatter support and tests.
9. Add CSS, shell, Python, and SQL presets/tests.
10. Run `npm run test -w toolcraft-design`.
11. Run `npm run lint -w toolcraft-design`.
12. Run `npm run build -w toolcraft-design`.

Implementation guardrails:

- Keep the scanners lightweight and heuristic.
- Prefer data-driven preset tables over language `if`/`switch` branches.
- Keep tokenization independent from HTML escaping and terminal styling.
- Do not add a public theme/style API.
- Do not add a syntax-highlighting, grammar, parser, editor, or theme engine as a first-pass dependency.
- Do not change HTML or terminal Markdown rendering when `syntaxHighlight` is omitted or false.
- Do not update README without explicit user permission.
