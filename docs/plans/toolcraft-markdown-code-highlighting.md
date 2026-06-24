---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft Markdown Code Highlighting

Add opt-in structured syntax highlighting for fenced code blocks rendered by `renderMarkdownHtml`.

## 1. What we're building

`toolcraft-design` should add lightweight, opt-in syntax highlighting to `renderMarkdownHtml` for fenced code blocks.

Consumers enable the behavior with a boolean option:

```ts
renderMarkdownHtml(markdown, { syntaxHighlight: true });
```

Default rendering stays off and should preserve current code-block output as closely as practical:

```ts
renderMarkdownHtml(markdown);
```

Code block source text remains escaped. When highlighting is enabled, Toolcraft may emit only neutral `<span>` wrappers with stable token classes inside the escaped code content. The feature must not ship, inject, or require CSS. Without consumer CSS, highlighted output should still look like ordinary code.

The architecture should be parser/AST aware, not an HTML-string post-processor. Fenced code blocks remain `code` nodes, and highlighting is represented as structured token data that a `code` node renderer can consume. The HTML renderer renders spans from that token data; it must not regex over already-rendered HTML.

The tokenizer should follow the lightweight shape used by `sugar-high`: a fast heuristic scanner that returns token categories, with language-specific presets expressed as keyword sets and small comment/string rules. Toolcraft should borrow that conceptual split, not `sugar-high`'s HTML output conventions, inline styles, or `sh__*` class names.

The first supported languages are:

- `js`, `ts`, `jsx`, `tsx`
- `json`
- `yaml`, `yml`
- `css`
- `sh`, `bash`
- `python`
- `sql`

Unknown languages fall back to the current escaped plain code output.

Explicit non-goals:

- Do not change default `renderMarkdownHtml(markdown)` behavior.
- Do not add public highlighting modes, themes, inline-style options, callbacks, or bundled CSS.
- Do not emit tags with default visual styling such as `<strong>`, `<em>`, or `<q>` for highlighted tokens.
- Do not replace the existing markdown parser or broaden the terminal markdown renderer behavior.
- Do not implement a full grammar/parser for each language.
- Do not post-process rendered HTML to add highlighting.

## 2. User-facing shape

The public API remains a boolean option on the existing Markdown HTML renderer:

```ts
import { renderMarkdownHtml } from "toolcraft/design";

const html = renderMarkdownHtml('```ts\nconst value = "hello";\n```', {
  syntaxHighlight: true
});
```

Default output stays plain escaped code:

```ts
renderMarkdownHtml('```js\nconst x = "hello";\n```');
```

```html
<pre><code class="language-js">const x = &quot;hello&quot;;</code></pre>
```

Highlighted output keeps the same `<pre><code class="language-*">` wrapper and only adds neutral spans inside the code element:

```ts
renderMarkdownHtml('```js\nconst x = "hello";\n```', { syntaxHighlight: true });
```

```html
<pre><code class="language-js"><span class="tc-token-keyword">const</span> x = <span class="tc-token-string">&quot;hello&quot;</span>;</code></pre>
```

Consumers that do not provide CSS see ordinary code because `<span>` has no default visual styling. Consumers that want colors can target stable token classes:

```css
.tc-token-keyword { color: var(--code-keyword); }
.tc-token-string { color: var(--code-string); }
.tc-token-comment { color: var(--code-comment); }
```

Unknown languages fall back to the current plain escaped code output even when highlighting is enabled:

```ts
renderMarkdownHtml("```brainfuck\n++[>++<-]\n```", { syntaxHighlight: true });
```

```html
<pre><code class="language-brainfuck">++[&gt;++&lt;-]</code></pre>
```

AST-first callers use the same boolean on `renderHtml`:

```ts
import { parse, renderHtml } from "toolcraft-design";

const { ast } = parse(markdown);
const html = renderHtml(ast, { syntaxHighlight: true });
```

The existing terminal renderer remains unchanged:

```ts
import { renderMarkdown } from "toolcraft-design";

renderMarkdown('```js\nconst x = "hello";\n```');
```

No syntax highlighting is added to terminal output by this feature.

## 3. Implementation details and technical decisions

Autonomy audit:

- No credentials are required.
- No network access is required for implementation. `sugar-high` research has already been inspected from GitHub and npm.
- No running services are required.
- No sample data is required beyond inline Markdown/code fixtures in unit tests.
- No README update is planned unless the user explicitly approves it. This feature adds no env vars and only one existing-options-field API.
- No new package dependency is required. `sugar-high` is MIT-licensed and useful as design research, but Toolcraft needs a different token contract, different class names, no inline styles, and several languages that `sugar-high` does not ship.

Existing architecture:

- `packages/toolcraft-design/src/terminal-markdown/parser/block.ts` parses fenced code into `{ type: "code", lang?, meta?, value }`.
- `packages/toolcraft-design/src/terminal-markdown/ast.ts` owns the `MdNode` union.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts` renders code blocks today with `escapeHtml(node.value)`.
- `packages/toolcraft-design/src/terminal-markdown/index.ts` exposes `renderHtml`, `renderMarkdownHtml`, and `HtmlRenderOptions`.
- `packages/toolcraft-design/src/render-markdown-html.ts` and `packages/toolcraft/src/design/render-markdown-html.ts` are flat re-export files.

Architecture decision:

- Add a parser-adjacent code-token layer under `packages/toolcraft-design/src/terminal-markdown/parser/`.
- Keep Markdown parsing responsible for recognizing fenced code blocks and preserving `lang`, `meta`, and raw `value`.
- Represent highlighting as structured token data that belongs to a code node, not as rendered HTML.
- Keep default `parse(markdown)` output compatible by not eagerly attaching tokens unless highlighting is requested.
- Make HTML rendering consume code tokens when present or when `syntaxHighlight` asks the renderer to enrich a code node.
- Never regex over rendered HTML.

The code node type becomes:

```ts
export type CodeTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "identifier"
  | "property"
  | "tag"
  | "attribute"
  | "punctuation"
  | "plain";

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

Rendering rules:

- Preserve whitespace exactly by leaving whitespace in token `value` strings and rendering it directly after HTML escaping.
- Escape every token value with the existing HTML escaping helper.
- Use spans only for non-plain tokens.
- Emit plain whitespace and plain text without spans when possible.
- Use stable classes formatted as `tc-token-${kind}`.
- Keep `class="language-${lang}"` on `<code>`.
- Unknown languages return `undefined`/`null` from tokenization and render as `escapeHtml(node.value)`.
- Empty code blocks render exactly as today.

Internal flow:

```ts
export function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string {
  const { ast } = parse(markdown);
  return renderHtml(ast, options);
}
```

`renderHtml` receives `syntaxHighlight` in `HtmlRenderOptions`. When rendering a `code` node:

```ts
function renderCodeBlock(node: CodeNode, context: RenderContext): string {
  const tokens = context.syntaxHighlight ? node.tokens ?? highlightCodeBlock(node) : undefined;
  return renderCodeElement(node, tokens);
}
```

The implementation may avoid mutating the AST by deriving tokens at render time. Conceptually, this still fits the parser model because `highlightCodeBlock(node)` consumes a parsed `code` node and returns code-node token data; it does not operate on HTML.

`sugar-high` research:

- `sugar-high` has a generic one-pass tokenizer and small language presets.
- Token categories are display-oriented: `identifier`, `keyword`, `string`, `class`, `property`, `entity`, `jsxliterals`, `sign`, `comment`, `break`, `space`.
- Presets customize keyword sets, type keyword sets, comment start/end hooks, quote hooks, and optional line classes.
- JS/TS/JSX is the most complex part: core logic handles strings, template literals, regex literals, comments, JSX tags, JSX attributes, JSX text, and TS generic arrow ambiguity.
- Python only needs keywords plus `#` to end-of-line comments for the tested behavior.
- CSS only needs block comments and shallow at-rule handling in `sugar-high`; Toolcraft should improve CSS enough to distinguish properties, strings, comments, punctuation, and numbers.
- C/Go/Java use the same C-like comment hooks plus language keyword/type keyword sets.
- Rust uses a quote hook so lifetimes and char literals do not get swallowed as JS-style strings.
- `sugar-high` output uses inline styles and `sh__*` classes. Toolcraft must not copy that output contract.

Toolcraft scanner design:

```ts
type CodeHighlightPreset = {
  aliases: readonly string[];
  keywords?: ReadonlySet<string>;
  typeKeywords?: ReadonlySet<string>;
  lineComment?: string;
  blockComment?: { open: string; close: string };
  stringQuotes?: readonly string[];
  templateQuotes?: readonly string[];
  jsx?: boolean;
  properties?: "json" | "yaml" | "css" | "none";
};

function tokenizeCode(value: string, preset: CodeHighlightPreset): CodeToken[];
function highlightCodeBlock(node: CodeNode): CodeToken[] | undefined;
function resolveCodeHighlightPreset(lang: string | undefined): CodeHighlightPreset | undefined;
```

Language resolution:

- Normalize language names to lowercase.
- Strip common leading dots only if the parser ever supplies them in `lang`; otherwise preserve current parser behavior.
- Map aliases declaratively through preset metadata, not `if`/`switch` branches.
- `js`, `javascript`, `mjs`, `cjs` resolve to the JS-family preset.
- `ts`, `typescript`, `mts`, `cts` resolve to the TS-family preset.
- `jsx` resolves to JS-family with JSX mode.
- `tsx` resolves to TS-family with JSX mode.
- `json`, `jsonc` resolve to data-style JSON. `jsonc` can recognize comments; `json` should not require comments.
- `yaml`, `yml` resolve to YAML.
- `css` resolves to CSS.
- `sh`, `bash`, `shell`, `zsh` resolve to shell.
- `py`, `python` resolve to Python.
- `sql` resolves to SQL.

Token class mapping:

- `keyword` -> `<span class="tc-token-keyword">`
- `string` -> `<span class="tc-token-string">`
- `number` -> `<span class="tc-token-number">`
- `comment` -> `<span class="tc-token-comment">`
- `identifier` -> `<span class="tc-token-identifier">`
- `property` -> `<span class="tc-token-property">`
- `tag` -> `<span class="tc-token-tag">`
- `attribute` -> `<span class="tc-token-attribute">`
- `punctuation` -> `<span class="tc-token-punctuation">`
- `plain` -> escaped text with no wrapper

Initial language behavior:

- JS:
  - Keywords: common ECMAScript keywords including `const`, `let`, `var`, `function`, `return`, `if`, `else`, `for`, `while`, `class`, `extends`, `import`, `export`, `from`, `async`, `await`, `try`, `catch`, `throw`, `new`, `this`, `true`, `false`, `undefined`, `null`.
  - Comments: `//` to EOL and `/* */`.
  - Strings: `'`, `"`, and template literals.
  - Numbers: simple decimal/hex/binary/octal-looking numeric tokens are `number`.
  - Properties: identifier after `.` is `property`.
  - Regex literals may be treated as `string` using the same heuristic style as `sugar-high`; perfect JS parsing is not required.
- TS:
  - Extends JS keywords with `type`, `interface`, `enum`, `implements`, `readonly`, `declare`, `namespace`, `module`, `private`, `protected`, `public`, `override`, `keyof`, `infer`, `is`, `asserts`, `satisfies`, `as`, `unknown`, `never`, `any`.
  - Built-in type names such as `number`, `string`, `boolean`, `bigint`, `symbol`, and `object` render as `keyword` unless a cleaner `type` token is later introduced.
  - Avoid treating generic arrow function type parameters as JSX tags in `ts` and `tsx`.
- JSX/TSX:
  - Tag names render as `tag`.
  - Attribute names render as `attribute`.
  - Text children render as `plain`.
  - Expressions inside `{}` reuse JS/TS tokenization.
  - The scanner only needs common JSX; it does not need a full balanced AST.
- JSON:
  - Object keys before `:` render as `property`.
  - Strings render as `string`.
  - Numbers render as `number`.
  - `true`, `false`, and `null` render as `keyword`.
  - Braces, brackets, commas, and colons render as `punctuation`.
  - Invalid JSON should still tokenize heuristically and never throw.
- YAML:
  - `#` to EOL renders as `comment`.
  - Mapping keys before `:` render as `property`.
  - Quoted strings render as `string`.
  - Common scalars `true`, `false`, `null`, `yes`, `no`, numbers render as `keyword`/`number`.
  - `-`, `:`, `{`, `}`, `[`, `]`, `,` render as `punctuation`.
- CSS:
  - `/* */` renders as `comment`.
  - At-rules such as `@media`, `@import`, `@keyframes`, `@font-face`, `@supports`, and `@page` render as `keyword`.
  - Property names before `:` inside declaration blocks render as `property`.
  - Strings and numeric values render as `string` and `number`.
  - Selectors can remain `identifier`/`punctuation`; full selector parsing is not required.
- Shell:
  - `#` to EOL renders as `comment` unless inside quotes.
  - Strings: `'`, `"`, and backticks render as `string`.
  - Variables like `$HOME`, `${HOME}`, `$1`, and `$?` render as `property`.
  - Command words and flags can render as `identifier` and `punctuation` without a large builtin command list.
  - Shell keywords such as `if`, `then`, `else`, `fi`, `for`, `do`, `done`, `case`, `esac`, `function`, `export`, `local`, `return`, `exit` render as `keyword`.
- Python:
  - Keywords follow the `sugar-high` preset: `and`, `as`, `assert`, `async`, `await`, `break`, `class`, `continue`, `def`, `del`, `elif`, `else`, `except`, `finally`, `for`, `from`, `global`, `if`, `import`, `in`, `is`, `lambda`, `nonlocal`, `not`, `or`, `pass`, `raise`, `return`, `try`, `while`, `with`, `yield`.
  - `#` to EOL renders as `comment`, including apostrophes inside the comment.
  - Strings render as `string`; triple-quoted strings can be a follow-up if not needed for acceptance.
  - Numbers render as `number`.
- SQL:
  - Keywords include `select`, `from`, `where`, `join`, `left`, `right`, `inner`, `outer`, `on`, `insert`, `update`, `delete`, `create`, `alter`, `drop`, `table`, `view`, `index`, `values`, `set`, `group`, `by`, `order`, `limit`, `offset`, `having`, `and`, `or`, `not`, `null`, `is`, `in`, `exists`, `case`, `when`, `then`, `else`, `end`, `as`.
  - `--` to EOL and `/* */` render as `comment`.
  - Single-quoted and double-quoted strings render as `string`.
  - Numbers render as `number`.
  - Identifiers can remain `identifier`; SQL dialect-specific quoting is not required beyond simple quotes for the first pass.

Edge cases:

- Source text containing `<script>` or `&` remains escaped after highlighting.
- Token values can include quotes, angle brackets, ampersands, and unicode.
- Whitespace and newlines inside code blocks are preserved exactly.
- A token spanning a newline is allowed only if rendering preserves the newline exactly.
- Unclosed strings/comments must not throw; render the remaining text as that token kind or plain text.
- Unsupported languages return plain escaped code.
- `allowRawHtml` must not affect code token escaping.
- `showFrontmatter: true` currently renders frontmatter as YAML code. With `syntaxHighlight: true`, that YAML code path should use the same code-block rendering helper so frontmatter can be highlighted without duplicating behavior.

## 4. Interfaces and test plan

Public interface change:

```ts
export interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
  syntaxHighlight?: boolean;
}
```

Existing public signatures remain:

```ts
function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string;
function renderHtml(ast: MdNode, options?: HtmlRenderOptions): string;
function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode };
function renderMarkdown(markdown: string, options?: RenderOptions): string;
```

Internal interfaces:

```ts
export type CodeTokenKind =
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "identifier"
  | "property"
  | "tag"
  | "attribute"
  | "punctuation"
  | "plain";

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

export interface CodeHighlightPreset {
  aliases: readonly string[];
  keywords?: ReadonlySet<string>;
  typeKeywords?: ReadonlySet<string>;
  lineComment?: string;
  blockComment?: { open: string; close: string };
  stringQuotes?: readonly string[];
  templateQuotes?: readonly string[];
  jsx?: boolean;
  properties?: "json" | "yaml" | "css" | "none";
}

export function resolveCodeHighlightPreset(lang: string | undefined): CodeHighlightPreset | undefined;
export function highlightCodeBlock(node: Extract<MdNode, { type: "code" }>): CodeToken[] | undefined;
export function tokenizeCode(value: string, preset: CodeHighlightPreset): CodeToken[];
```

TDD order:

1. Add failing HTML renderer tests for default-off behavior and the `syntaxHighlight` option.
2. Add failing tokenizer unit tests for JS and JSON.
3. Implement the smallest token model and HTML rendering path.
4. Add language-specific tests one preset at a time.
5. Add frontmatter and AST-first rendering tests.
6. Run package tests/lint/build.

Unit tests in `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`:

- `renderMarkdownHtml(markdown)` keeps existing code block output by default.
- `renderMarkdownHtml(markdown, { syntaxHighlight: true })` emits token spans for JS.
- Highlighted code still escapes `<`, `>`, `&`, `"`, and `'`.
- Whitespace is preserved exactly for indentation, blank lines, and trailing spaces where current rendering preserves them.
- Unknown language falls back to plain escaped code.
- `renderHtml(ast, { syntaxHighlight: true })` highlights AST-first code nodes.
- `showFrontmatter: true` plus `syntaxHighlight: true` highlights YAML frontmatter through the shared code renderer.
- `allowRawHtml: true` does not allow raw HTML inside code tokens.

Tokenizer tests in a new `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`:

- JS: `const value = "hello"; // comment` classifies `const` as keyword, string as string, comment as comment.
- JS: `console.log(value)` classifies `log` as property after `.`.
- TS: `type Point = { x: number }` classifies `type` and `number` as keyword.
- JSX: `<Button disabled>{label}</Button>` classifies `Button` as tag, `disabled` as attribute, `label` as identifier.
- JSON: `{"name":"poe","ok":true,"count":2}` classifies keys as property, string as string, `true` as keyword, `2` as number.
- YAML: `name: poe\n# ok\ncount: 2` classifies `name` and `count` as property and comment as comment.
- CSS: `@media screen { .x { color: red; } }` classifies `@media` as keyword and `color` as property.
- Shell: `echo "$HOME" # ok` classifies `$HOME` as property and comment as comment.
- Python: `def f():\n    return "ok" # isn't` classifies `def`/`return` as keyword and the whole `# isn't` tail as comment.
- SQL: `select name from users where id = 1 -- ok` classifies SQL keywords and comment.
- Unsupported language resolver returns `undefined`.
- Alias resolver maps every initial alias to the intended preset without provider-style branching.

Type/export tests:

- Update the `HtmlRenderOptions` type assertion in `html-renderer.test.ts`.
- Add or extend root/subpath export tests only if new public types are exported from the flat module.

Real-world test:

1. Run a direct renderer invocation:

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

2. Run an escaping check:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```js\nconst x = \"<script>\";\n```", { syntaxHighlight: true }))'
```

Expected observation: the output contains `&lt;script&gt;` and no literal `<script>`.

3. Run an unknown-language fallback check:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```unknown\n<x>\n```", { syntaxHighlight: true }))'
```

Expected output:

```html
<pre><code class="language-unknown">&lt;x&gt;</code></pre>
```

Must-work checklist:

- [ ] Default code block rendering is unchanged; proof: existing/focused HTML renderer unit test.
- [ ] `syntaxHighlight: true` emits `tc-token-*` spans for supported languages; proof: HTML renderer unit test.
- [ ] Escaping remains safe inside highlighted tokens; proof: escaping unit test and real-world escaping command.
- [ ] Whitespace is preserved exactly; proof: whitespace unit test compares full output string.
- [ ] Unknown languages fall back to plain escaped code; proof: fallback unit test and real-world fallback command.
- [ ] JS and JSON are covered; proof: tokenizer and HTML renderer tests.
- [ ] YAML/frontmatter path uses the same code renderer; proof: frontmatter HTML renderer test.
- [ ] No CSS is bundled or injected; proof: output tests assert no `style=` and no generated stylesheet.

Validation commands:

```sh
npm run test -w toolcraft-design
npm run lint -w toolcraft-design
npm run build -w toolcraft-design
```

## 5. Code plan

Files to create:

- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.ts`
  - Owns token kinds, token objects, preset resolution, and the generic scanner.
  - Exports internal functions for focused unit tests.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`
  - TDD coverage for preset resolution and language tokenization.

Files to change:

- `packages/toolcraft-design/src/terminal-markdown/ast.ts`
  - Add `CodeTokenKind`, `CodeToken`, and optional `tokens?: CodeToken[]` to the `code` node shape.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts`
  - Add `syntaxHighlight?: boolean` to `HtmlRenderOptions`.
  - Add `syntaxHighlight` to `RenderContext`.
  - Change `renderCodeBlock` to call a shared `renderCodeElement(node, tokens?)`.
  - Render token spans with `tc-token-*` classes when tokens are available.
  - Route `renderFrontmatter` through the same YAML code rendering helper.
- `packages/toolcraft-design/src/terminal-markdown/index.ts`
  - Re-export updated `HtmlRenderOptions`.
  - No signature changes beyond the type.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`
  - Add option type assertion for `syntaxHighlight`.
  - Add HTML behavior tests listed above.
- `packages/toolcraft-design/src/index.test.ts`
  - Update type/export expectations only if the type assertion there needs the new field.

Build order:

1. Add failing tests for `HtmlRenderOptions.syntaxHighlight` and default-off rendering.
2. Add `CodeToken` types to `ast.ts`.
3. Create `code-highlighter.ts` with resolver and a minimal JS/JSON tokenizer.
4. Wire `html-renderer.ts` to render highlighted tokens for code nodes.
5. Make JS and JSON tests pass.
6. Add YAML/frontmatter support and tests.
7. Add CSS, shell, Python, and SQL presets/tests.
8. Run `npm run test -w toolcraft-design`.
9. Run `npm run lint -w toolcraft-design`.
10. Run `npm run build -w toolcraft-design`.

Implementation guardrails:

- Keep the scanner lightweight and heuristic.
- Prefer data-driven preset tables over language `if`/`switch` branches.
- Do not add a public theme/style API.
- Do not add `sugar-high` as a dependency for the first implementation.
- Do not change terminal markdown rendering.
- Do not update README without explicit user permission.
