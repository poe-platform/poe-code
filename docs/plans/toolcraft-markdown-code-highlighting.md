---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft Markdown Code Highlighting

Add opt-in structured syntax highlighting for fenced code blocks rendered by Toolcraft Markdown.

## 1. What we're building

`toolcraft-design` should add no-dependency, opt-in syntax highlighting to Markdown fenced code blocks rendered by both Toolcraft Markdown renderers:

```ts
renderMarkdownHtml(markdown, { syntaxHighlight: true });
renderMarkdown(markdown, { syntaxHighlight: true });
```

Default rendering stays off:

```ts
renderMarkdownHtml(markdown);
renderMarkdown(markdown);
```

Default output should remain byte-for-byte unchanged where practical.

HTML code block source text remains escaped. When highlighting is enabled, Toolcraft may emit only neutral `<span>` wrappers with stable Toolcraft-owned token classes inside the escaped code content. The feature must not ship, inject, or require CSS. Without consumer CSS, highlighted HTML output should still look like ordinary code.

Terminal code block source text should be styled with Toolcraft's existing ANSI theme only when `syntaxHighlight: true` is passed. The terminal code block border, indentation, spacing, and width behavior should remain the same.

The architecture should be parser/AST aware, not an HTML-string post-processor. Fenced code blocks remain `code` nodes. Highlighting is represented as structured token data that a `code` node renderer can consume. HTML and terminal renderers consume the same token stream.

No new dependencies are allowed. That means this plan does not implement real TextMate grammars, does not add Shiki, does not add `vscode-textmate`, does not add Prism, and does not add highlight.js. The implementation is a small Toolcraft-owned tokenizer layer inspired by the separation used by lightweight libraries: parse code text into generic token categories, then let renderers decide how those tokens appear.

Because there is no grammar dependency, "support all languages Code supports" must be split into two layers:

- Language recognition: Toolcraft should recognize Code/VS Code built-in language ids and common Markdown fence aliases in a data-driven registry, including plain-text aliases.
- Highlighting capability: Toolcraft should highlight the language families it has no-dependency tokenizers for. Known-but-not-tokenized languages deliberately fall back to plain code instead of throwing or pretending to be highlighted.

If the product requirement later becomes "semantic highlighting for every VS Code grammar," that is a separate dependency-backed project. Without adding or vendoring a grammar engine and grammar data, full grammar parity is not technically credible.

Initial no-dependency highlighting tiers:

- Tier 1, must be good:
  - ECMAScript basics: `js`, `javascript`, `mjs`, `cjs`, `jsx`, `ts`, `typescript`, `mts`, `cts`, `tsx`
  - Data/config basics: `json`, `jsonc`, `jsonl`, `yaml`, `yml`
  - Styles basics: `css`
- Tier 2, implement only while still small:
  - Shell basics: `sh`, `bash`, `shell`, `shellscript`, `zsh`, `fish`
  - Python basics: `py`, `python`
  - SQL basics: `sql`, `ddl`, `dml`
  - Line-oriented formats: `diff`, `dockerfile`, `docker`, `ini`, `toml`
- Tier 3, fallback unless nearly free:
  - Markup/docs: `html`, `xml`, `svg`, `md`, `markdown`
  - Style dialects: `scss`, `sass`, `less`, `postcss`

All other recognized Code language ids are supported as safe, stable, plain-code fallback.

Complexity budget:

- It is acceptable to leave a language family or a syntax feature out if supporting it would make the tokenizer ugly, fragile, or hard to test.
- Fallback to plain rendering is a valid outcome, not a failure, as long as it is explicit in the registry and covered by tests.
- Prefer a smaller set of polished tokenizers over a broad set of suspicious ones.
- For partially supported families, tokenize the obvious lexical surface and leave complex nested constructs plain.
- Never contort the architecture to make a difficult syntax "kind of work."
- Treat Tier 2 and Tier 3 as optional implementation surface, not acceptance-critical surface.
- Do not expand the first PR beyond Tier 1 if Tier 1 already exercises the architecture well.

Explicit non-goals:

- Do not change default `renderMarkdownHtml(markdown)` or `renderMarkdown(markdown)` behavior.
- Do not add public highlighting modes, themes, inline-style options, callbacks, bundled CSS, or consumer-provided class maps.
- Do not emit tags with default visual styling such as `<strong>`, `<em>`, or `<q>` for highlighted HTML tokens.
- Do not replace the existing Markdown parser or add a second Markdown parser.
- Do not post-process rendered HTML to add highlighting.
- Do not use language auto-detection.
- Do not add a dependency for grammar parsing or highlighting.
- Do not vendor a large grammar registry under a different name.
- Do not hand-author full grammars. Tokenizers are lexical and intentionally approximate.
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

Consumers that want colors can target stable Toolcraft classes:

```css
.tc-token-keyword { color: var(--code-keyword); }
.tc-token-string { color: var(--code-string); }
.tc-token-comment { color: var(--code-comment); }
.tc-token-at-rule { color: var(--code-at-rule); }
```

Token classes use hyphenated CSS naming with a `tc-token-` namespace. CSS-style dashed names are preferred for multi-word kinds, for example `tc-token-at-rule`.

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

- Keywords, types, tags, commands, decorators, directives, and at-rules: accent + bold.
- Strings and templates: success color.
- Numbers, booleans, nulls, and parameters: number/info styling.
- Comments: muted.
- Properties, keys, attributes, variables, functions, anchors, and labels: info/accent styling.
- Regexes, colors, important markers, invalid tokens, and flags: warning/error styling.
- Operators, punctuation, selectors, and delimiters: muted.
- Plain text and whitespace: unchanged.

Unknown languages fall back even when highlighting is enabled:

```ts
renderMarkdownHtml("```unknown-language\n<x>\n```", { syntaxHighlight: true });
```

```html
<pre><code class="language-unknown-language">&lt;x&gt;</code></pre>
```

Known-but-not-tokenized Code languages also fall back:

```ts
renderMarkdownHtml("```ruby\nputs '<x>'\n```", { syntaxHighlight: true });
```

```html
<pre><code class="language-ruby">puts '&lt;x&gt;'</code></pre>
```

Plain-text language labels such as `text`, `txt`, `plain`, and `plaintext` deliberately render as plain code.

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
- No running services are required.
- No sample data is required beyond inline fixtures in unit tests.
- No new package dependencies are allowed.
- No runtime network access is allowed.
- No README update is planned unless the user explicitly approves it.

Issue check:

- GitHub issue `#437` is open.
- As of June 24, 2026, the issue has no comments.
- The issue is HTML-focused and initially suggests a simple tokenizer.
- This plan adds terminal/CLI support because the user explicitly expanded the scope.
- This plan keeps the no-dependency tokenizer direction because the user explicitly ruled out new dependencies.

Existing architecture:

- `packages/toolcraft-design/src/terminal-markdown/parser/block.ts` parses fenced code into `{ type: "code", lang?, meta?, value }`.
- `packages/toolcraft-design/src/terminal-markdown/ast.ts` owns the `MdNode` union.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts` renders code blocks today with `escapeHtml(node.value)`.
- `packages/toolcraft-design/src/terminal-markdown/renderer.ts` renders terminal code blocks with a muted border, strips user-provided ANSI, and writes raw code text inside the border.
- `packages/toolcraft-design/src/terminal-markdown/index.ts` exposes `renderHtml`, `renderMarkdownHtml`, `render`, `renderMarkdown`, `HtmlRenderOptions`, and `RenderOptions`.
- `packages/toolcraft-design/src/render-markdown-html.ts` and `packages/toolcraft/src/design/render-markdown-html.ts` are flat re-export files.
- `toolcraft-design` is ESM and currently exposes synchronous render functions. The highlighting design preserves that shape.

Architecture decision:

- Add a parser-adjacent code-token layer under `packages/toolcraft-design/src/terminal-markdown/parser/`.
- Keep Markdown parsing responsible for recognizing fenced code blocks and preserving `lang`, `meta`, and raw `value`.
- Represent highlighting as Toolcraft `CodeToken[]`, not as HTML.
- Resolve fence languages through a data-driven registry.
- Select no-dependency tokenizers by registry family, not by renderer branches.
- Make HTML and terminal rendering consume the same Toolcraft token stream.
- Never regex over rendered HTML.
- Never run user code or invoke language runtimes.
- Never rely on language auto-detection; fence language controls language selection.
- Never throw for user-provided code text or broken syntax.

Answer to "how do we do grammars?":

- We do not do real grammars in this iteration.
- A real grammar system needs a grammar engine plus grammar data. Without dependencies, the only alternatives are to vendor that machinery or rebuild it, both of which are worse than adding a dependency and violate the stated constraint.
- Instead, Toolcraft uses small lexical tokenizers with explicit states. They classify enough common syntax to make rendered Markdown useful while preserving source exactly.
- If a grammar feature needs deep parsing to be correct, leave it plain.
- The architecture keeps this replaceable: a future grammar-backed provider can be inserted behind the same `CodeToken[]` interface if dependency policy changes.

No-dependency tokenizer design:

```ts
type CodeHighlightFamily = "lexical" | "data" | "style" | "line";

type CodeLanguageInfo = {
  id: string;
  aliases: readonly string[];
  family?: CodeHighlightFamily;
  spec?: string;
  plain?: boolean;
};

type CodeTokenizer = (source: string, language: CodeLanguageInfo) => CodeToken[];
```

Implementation quality bar:

- The code should feel small, deliberate, and boring to maintain.
- No giant tokenizer function that knows every language.
- No dense regex wall. Tiny local character checks are fine; broad matching should come from scanner state and keyword sets.
- No generated-looking tables that nobody can review.
- No cleverness that makes broken syntax hard to reason about.
- No fake abstractions that only call one other function.
- No renderer branching by language.
- No dependency-shaped code hidden in the repo by vendoring grammar data.

Scanner toolkit:

Build one tiny scanner toolkit and compose language tokenizers from it. The toolkit should be internal and focused on source-preserving lexical scanning:

```ts
type Scanner = {
  readonly source: string;
  readonly index: number;
  peek(offset?: number): string;
  startsWith(value: string): boolean;
  eof(): boolean;
};

type TokenEmitter = {
  push(kind: CodeTokenKind, start: number, end: number): void;
  pushPlain(start: number, end: number): void;
};
```

Useful shared helpers:

- `readWhitespace`
- `readIdentifier`
- `readNumber`
- `readQuotedString`
- `readLineComment`
- `readBlockComment`
- `readUntilLineEnd`
- `readBalancedLike`
- `readEscapedUntil`
- `classifyWord`
- `mergeAdjacentPlainTokens`

The helpers should operate on indexes and source slices, not by mutating strings. Every helper must make forward progress or stop. Tests should include an invariant that the scanner cannot loop forever on malformed input.

Language tokenizer shape:

```ts
type KeywordSets = {
  keywords?: ReadonlySet<string>;
  types?: ReadonlySet<string>;
  constants?: ReadonlySet<string>;
};

type StatefulTokenizer = {
  family: CodeHighlightFamily;
  tokenize(source: string, language: CodeLanguageInfo, helpers: ScannerHelpers): CodeToken[];
};
```

Most language files should read like:

- declarative keyword sets;
- a small loop over source characters;
- shared helper calls for strings/comments/numbers/identifiers;
- a few family-specific state transitions.

That is the "pretty/clever" target: shared scanner mechanics, compact language modules, and no dependency.

Best complexity-budget shape:

- Prefer one generic lexical tokenizer over many bespoke language tokenizers.
- Language entries provide tiny specs: comments, string delimiters, keyword sets, type names, constants, and a small number of feature flags.
- Specialized tokenizers are allowed only when they are obviously simpler than forcing the generic tokenizer to understand the format.
- Tier 1 can be implemented as:
  - `lexical` spec for JS/TS/JSX/TSX basics;
  - `data` spec for JSON/JSONC/YAML basics;
  - `style` spec for CSS basics.
- Tier 2 can reuse the same infrastructure:
  - shell and Python through `lexical` specs with different comment/string rules;
  - SQL through a `lexical` spec with SQL keywords and quoted identifiers;
  - diff/Dockerfile/INI/TOML through `line`/`data` specs.
- Tier 3 should remain fallback unless the implementation falls out naturally from existing helpers.

Registry behavior:

- Keep registry data in one file and keep it declarative.
- Use canonical Code/VS Code language ids where practical.
- Include common Markdown fence aliases in `aliases`.
- Use `family` only for languages with implemented tokenizers.
- Use `plain: true` for explicit plain-text languages.
- Known languages without `family` are safe known fallback.
- Unknown languages are unknown fallback.
- Empty language labels are plain fallback.
- Lookup is case-insensitive for fence labels, but rendered HTML preserves the original `class="language-${lang}"`.

Initial registry examples:

```ts
const codeLanguages = [
  { id: "javascript", aliases: ["js", "javascript", "mjs", "cjs", "es6"], family: "lexical", spec: "javascript" },
  { id: "javascriptreact", aliases: ["jsx"], family: "lexical", spec: "jsx" },
  { id: "typescript", aliases: ["ts", "typescript", "mts", "cts"], family: "lexical", spec: "typescript" },
  { id: "typescriptreact", aliases: ["tsx"], family: "lexical", spec: "tsx" },
  { id: "json", aliases: ["json"], family: "data", spec: "json" },
  { id: "jsonc", aliases: ["jsonc"], family: "data", spec: "jsonc" },
  { id: "yaml", aliases: ["yaml", "yml"], family: "data", spec: "yaml" },
  { id: "css", aliases: ["css"], family: "style", spec: "css" },
  { id: "scss", aliases: ["scss"] },
  { id: "less", aliases: ["less"] },
  { id: "shellscript", aliases: ["sh", "bash", "shell", "shellscript", "zsh", "fish"] },
  { id: "python", aliases: ["py", "python"] },
  { id: "sql", aliases: ["sql", "ddl", "dml"] },
  { id: "html", aliases: ["html"] },
  { id: "xml", aliases: ["xml", "svg"] },
  { id: "markdown", aliases: ["md", "markdown"] },
  { id: "diff", aliases: ["diff", "patch"] },
  { id: "dockerfile", aliases: ["dockerfile", "docker"] },
  { id: "ini", aliases: ["ini", "properties"] },
  { id: "toml", aliases: ["toml"] },
  { id: "plaintext", aliases: ["text", "txt", "plain", "plaintext"], plain: true },
  { id: "ruby", aliases: ["rb", "ruby"] },
  { id: "go", aliases: ["go", "golang"] },
  { id: "java", aliases: ["java"] },
  { id: "c", aliases: ["c"] },
  { id: "cpp", aliases: ["cpp", "c++", "cc", "cxx"] },
  { id: "csharp", aliases: ["cs", "csharp", "c#"] },
  { id: "rust", aliases: ["rs", "rust"] },
  { id: "php", aliases: ["php"] }
] as const;
```

The registry can include more known Code ids than the examples above. Those entries do not need tokenizers to be useful: they make fallback intentional and testable.

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
  | "invalid"
  | "key"
  | "keyword"
  | "label"
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
- Concatenating token values must exactly reproduce the source string used for tokenization.
- Use a `plain` token or raw text for unstyled gaps.
- Unsupported, empty, plain-text, or unknown languages render through the current plain code path.
- Empty code blocks render exactly as today.
- Malformed code never throws.

HTML rendering rules:

- Escape every token value with the existing HTML escaping helper.
- Use spans only for non-plain tokens.
- Emit stable classes formatted as `tc-token-${kind}`.
- Keep `class="language-${lang}"` on `<code>`.
- `allowRawHtml` never affects code token escaping.
- Highlighted output must not contain `style=`.
- No provider-generated HTML, line wrappers, classes, or inline styles exist.

Terminal rendering rules:

- Strip user-provided ANSI before tokenization, then apply Toolcraft-owned ANSI styling to token values.
- Compute border width from unstyled, stripped source text so token styling cannot widen the border.
- Preserve existing indentation, border, blank-line, and block spacing behavior.
- Unknown and plain-text languages fall back to current stripped plain terminal code output.

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

- Keep tokenization separate from rendering. The tokenizer returns `CodeToken[]`; HTML and terminal renderers decide how to display those tokens.
- Preserve source by construction. Concatenating token values must exactly reproduce the source string that was tokenized.
- Without dependencies, real grammar parity is out of scope. Use stateful lexical tokenizers and honest fallback.
- The right no-dependency architecture is a scanner microkernel plus small language classifiers, not one-off parsers copied per language.
- The best complexity tradeoff is registry breadth with tokenizer restraint: recognize many language labels, highlight a few families well, and render the rest plainly.
- Keep class names Toolcraft-owned. Do not inherit external class names, inline styles, line wrapper conventions, theme contracts, or auto-detection behavior.
- Use syntax categories that can serve both HTML and terminal output. The token kind is semantic enough for styling but not so specific that each language needs a separate public class vocabulary.
- Treat malformed code as displayable text, never as an error.
- Keep language resolution isolated. The public contract is `syntaxHighlight: true` plus `tc-token-*` classes, not a grammar provider.
- Prefer registry tables over language `if` or `switch` branches in renderers.
- The useful lesson from sugar-high is the separation between token classification and output formatting. Toolcraft should borrow that architecture, not sugar-high's class names, HTML output shape, or limited language scope.

Tokenizer selection:

```ts
const tokenizers: Record<CodeHighlightFamily, CodeTokenizer> = {
  lexical: tokenizeLexical,
  data: tokenizeData,
  style: tokenizeStyle,
  line: tokenizeLine
};
```

This is a family dispatch, not provider branching. Renderers do not know families.

Tokenizer behavior by tier:

- Tier 1 lexical JS/TS/JSX/TSX:
  - Handles JS, TS, JSX, and TSX with one state machine.
  - Comments: `//` and `/* */`.
  - Strings: `'`, `"`, and template literals.
  - Keywords include ECMAScript and TypeScript keywords.
  - Built-in type names render as `type`.
  - Numbers include decimal, separators, hex, binary, octal-looking forms, and BigInt-looking forms.
  - Properties after `.` render as `property`.
  - Regex literals render as `regex` when distinguishable from division.
  - JSX/TSX tag names render as `tag`; attributes render as `attribute`.
  - Complex nested TypeScript types and ambiguous JSX/generic syntax can remain partially plain if clean support gets messy.
  - Broken strings, comments, templates, and tags consume to a safe boundary or EOF.
- Tier 1 data JSON/JSONC:
  - Object keys before `:` render as `key`.
  - Strings render as `string`.
  - Numbers render as `number`.
  - `true` and `false` render as `boolean`.
  - `null` renders as `null`.
  - Punctuation and `:` render as `punctuation`/`operator`.
  - `jsonc` accepts comments; `json` can still tokenize comments defensively if present.
  - Invalid JSON still tokenizes heuristically and never throws.
- Tier 1 data YAML:
  - `#` comments outside quoted strings and block scalars.
  - Mapping keys before `:` render as `key`.
  - Block scalar bodies for `|` and `>` render as `string` while preserving embedded newlines and indentation.
  - Booleans, nulls, numbers, anchors, aliases, tags, and directives are classified.
  - URLs such as `https://example.com/a:b` do not cause `https` to become a key.
- Tier 1 style CSS:
  - Covers plain CSS at a lexical level.
  - `/* */` comments.
  - At-rules render as `at-rule`.
  - Property names before `:` inside declaration blocks render as `property`.
  - Custom properties such as `--brand-color` render as `property`; `var(--x)` references render as `variable`.
  - Selectors before `{` render as `selector`.
  - Strings, numbers, colors, functions, and `!important` are classified.
  - Do not classify `#id` selectors as colors.
  - Sass/Less/PostCSS stay fallback unless the CSS scanner handles them naturally without extra complexity.
- Tier 2 lexical shell:
  - Shebang and comments.
  - Single quotes, double quotes, ANSI-C `$'...'`, and backticks.
  - Variables like `$HOME`, `${HOME}`, `$1`, `$?`, `$$`, `$@`, `$*`, `$-`.
  - Control words as `keyword`.
  - Command position words as `command`.
  - Flags as `flag`, while negative numbers do not become flags.
  - Common shell operators and heredocs.
  - Complex shell expansion parsing is out of scope; tokenize obvious variables/strings/comments/commands and leave the rest plain.
- Tier 2 lexical Python:
  - Comments, reserved words, soft keywords, decorators, numbers, and strings.
  - Supports prefixes `r`, `u`, `b`, `br`, `rb`, `f`, `fr`, `rf`.
  - Supports single/double quotes and triple quotes.
  - F-strings render as `string` in the first pass; recursive expression highlighting is optional.
- Tier 2 lexical SQL:
  - Generic SQL keywords.
  - `--` and `/* */` comments.
  - Single-quoted strings and double-quoted identifiers.
  - Parameters such as `$1`, `?`, `:name`, and `@user_id`.
  - Numbers and punctuation.
  - If the previous non-whitespace token is `.`, do not classify the following word as `keyword`.
- Tier 3 markup:
  - HTML/XML/SVG tags, attributes, quoted attributes, comments, doctypes, entities, and closing tags.
  - Text children can remain plain.
  - Broken tags do not throw.
- Tier 3 Markdown:
  - Headings, blockquotes, list markers, fenced code delimiters, links, images, inline code, emphasis markers, and HTML comments.
  - Embedded fenced-code tokenization inside Markdown code snippets is out of scope for the first pass.
- Tier 2 line diff:
  - Added, removed, header, hunk, and context lines.
  - Line prefixes render as `operator` or `punctuation`; content can remain plain.
- Tier 2 line Dockerfile:
  - Instructions such as `FROM`, `RUN`, `COPY`, `ENV`, `ARG`, `CMD`, `ENTRYPOINT` render as `keyword`.
  - Comments, strings, variables, flags, and shell-ish RUN content get basic classification.
- Tier 2 data/line INI/TOML:
  - Section headers, keys, comments, strings, booleans, nulls where applicable, dates/times as `number` or `string`, arrays, and punctuation.

Edge cases:

- Source text containing `<script>`, `</code>`, `&`, quotes, and unicode remains escaped in HTML.
- Whitespace and newlines inside code blocks are preserved exactly.
- Unclosed strings, comments, templates, blocks, tags, heredocs, or partial syntax must not throw.
- Unknown languages return plain escaped code or current terminal plain code.
- Known Code languages without tokenizers return plain escaped code or current terminal plain code.
- `showFrontmatter: true` currently renders frontmatter as YAML code. With `syntaxHighlight: true`, that YAML path should use the same code-block rendering helper so frontmatter can be highlighted without duplicating behavior.
- Terminal highlighting does not change border width, block spacing, or wrapping behavior.
- Terminal highlighting does not leak user-supplied ANSI codes.

## 4. Interfaces and test plan

Public interface changes:

```ts
export const CodeHighlightLanguage = {
  JavaScript: "javascript",
  JavaScriptReact: "javascriptreact",
  TypeScript: "typescript",
  TypeScriptReact: "typescriptreact",
  Json: "json",
  Jsonc: "jsonc",
  Yaml: "yaml",
  Css: "css",
  PlainText: "plaintext"
} as const;

export type CodeHighlightLanguage =
  (typeof CodeHighlightLanguage)[keyof typeof CodeHighlightLanguage];

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

Public language enum rules:

- Export an enum-shaped `CodeHighlightLanguage` value for callers that want stable autocomplete-safe language ids.
- The enum contains canonical ids for languages with implemented highlighting plus `PlainText`.
- Do not include every known fallback language in the enum; that would imply highlighting support.
- If the codebase strongly prefers real TypeScript enums during implementation, use `export enum CodeHighlightLanguage` with the same string values. Otherwise prefer the `as const` object plus union type because the package currently does not appear to use TS enums.
- Renderer options still accept Markdown fence strings from parsed code blocks; callers do not need to pass the enum to enable highlighting.

Internal interfaces:

```ts
export type CodeTokenKind = /* token kind union from level 3 */;

export interface CodeToken {
  kind: CodeTokenKind;
  value: string;
}

export interface CodeLanguageInfo {
  id: CodeHighlightLanguage | string;
  aliases: readonly string[];
  family?: CodeHighlightFamily;
  plain?: boolean;
}

export function listCodeHighlightLanguages(): readonly CodeLanguageInfo[];
export function resolveCodeHighlightLanguage(lang: string | undefined): CodeLanguageInfo | undefined;
export function isPlainTextLanguage(lang: string | undefined): boolean;
export function supportsCodeHighlightLanguage(lang: string | undefined): boolean;
export function highlightCodeBlock(node: Extract<MdNode, { type: "code" }>): CodeToken[] | undefined;
```

TDD order:

1. Add failing HTML renderer tests for default-off behavior and `HtmlRenderOptions.syntaxHighlight`.
2. Add failing terminal renderer tests for default-off behavior and `RenderOptions.syntaxHighlight`.
3. Add failing registry tests for alias resolution, plain-text aliases, known fallback, unknown fallback, and original class preservation.
4. Add failing shared token renderer tests with hand-authored token arrays.
5. Add failing tokenizer tests for ECMAScript and JSON.
6. Implement the token model, registry, and shared token renderer helpers.
7. Wire HTML rendering from tokens.
8. Wire terminal rendering from the same tokens.
9. Implement tokenizers one family at a time with tests.
10. Stop adding a family when the next family would require nontrivial parser complexity; mark it as known fallback instead.
11. Add representative dummy-file fixtures for every implemented tokenizer family.
12. Add known-but-unsupported Code language fallback tests.
13. Add frontmatter and AST-first rendering tests.
14. Run package tests/lint/build.

Layered fixture strategy:

- Add `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.fixtures.ts`.
- Fixtures are committed TypeScript data, not files created by tests at runtime.
- Each fixture represents a small dummy file with:
  - `name`: e.g. `component.tsx`, `config.yaml`, `query.sql`.
  - `lang`: fence language.
  - `source`: exact source text, including whitespace and malformed syntax.
  - `mustContainKinds`: token kinds that must appear.
  - `mustNotContainRawHtml`: unsafe substrings such as `<script>` that must never appear in rendered HTML.
  - `plainTextInvariant`: expected source text after stripping HTML tags/terminal ANSI and decoding entities where applicable.
- Tests consume the same fixture matrix at every layer:
  - tokenizer: returns Toolcraft tokens, preserves source when token values are concatenated, never throws.
  - HTML token renderer: escapes source, uses only `tc-token-*` classes, never emits `style=`.
  - terminal token renderer: strips user ANSI first, then applies Toolcraft styling, preserves stripped source after ANSI removal.
  - Markdown integration: fenced Markdown parses to a `code` node and renders through the same path.
  - public API: `renderMarkdownHtml`, `renderHtml`, `renderMarkdown`, and `render` all obey the same option semantics.

Registry coverage:

- Every initial supported alias resolves to the expected family.
- Every highlighted canonical language id is represented in `CodeHighlightLanguage`.
- Every `CodeHighlightLanguage` value resolves through the registry.
- Known fallback languages are not exported from `CodeHighlightLanguage`.
- Plain aliases `text`, `txt`, `plain`, `plaintext`, no language, and empty language return no tokens.
- Known-but-unsupported Code ids such as `ruby`, `go`, `java`, `c`, `cpp`, `csharp`, `rust`, and `php` resolve as known but render plain.
- Unknown languages render plain.
- Case-insensitive lookup works for fence labels.
- Original fence labels are preserved in `class="language-${lang}"`.
- Alias collision tests: `tsx` must not resolve to `typescript`; `jsx` must not resolve to `javascript`; `sh`/`bash` resolve to shell family.

Representative dummy fixture coverage:

- JS/TS/JSX/TSX:
  - keywords, strings, numbers, comments, properties, regex literals, division, template literals, private fields, interfaces, type aliases, generic functions, JSX tags, dashed attributes, expressions, and broken tags.
- JSON/JSONC:
  - properties, strings, numbers, booleans, nulls, arrays, comments, missing braces, unclosed strings, and HTML-ish strings.
- YAML:
  - keys, comments, booleans, nulls, anchors, tags, directives, block scalars, dangling quotes, dangling anchors, and URLs with multiple colons.
- CSS/SCSS/Less/PostCSS:
  - at-rules, selectors, properties, custom properties, variables, colors, functions, `!important`, comments, hash selector/color ambiguity, Sass variables, Less variables, and broken blocks.
- HTML/XML/SVG:
  - tags, attributes, comments, doctypes, entities, raw HTML-like text, and unclosed tags.
- Markdown:
  - headings, lists, blockquotes, links, images, inline code, fenced code delimiters, emphasis markers, and HTML comments.
- Shell:
  - shebang, variables, commands, flags, operators, comments, heredocs, unclosed quotes, `$()` text, `#` inside quotes, and negative numbers.
- Python:
  - decorators, keywords, comments, strings, raw/bytes/f/triple strings, malformed strings, binary/octal/hex numbers, underscores, floats, exponents, and imaginary suffixes.
- SQL:
  - keywords, strings, quoted identifiers, comments, parameters, numbers, keyword-after-dot behavior, unclosed strings, and unclosed block comments.
- Diff/Dockerfile/INI/TOML:
  - representative syntax, malformed syntax, comments, strings, keys, numbers, and HTML-ish text.

Robustness invariants for every fixture:

- Tokenization is total: `highlightCodeBlock` must never throw for user Markdown input.
- Concatenating token values exactly equals the input source used for tokenization.
- Unsupported and plain-text languages return `undefined` tokens and use plain rendering.
- Empty strings, whitespace-only code, and newline-only code do not throw.
- Broken syntax does not throw.
- Embedded HTML-ish text such as `<script>`, `</code>`, `<img onerror=x>`, `&`, quotes, and unicode remains safe in HTML output.
- `allowRawHtml: true` never changes code block escaping.
- `syntaxHighlight: false` and omitted options match current output exactly.
- `syntaxHighlight: true` never changes the visible source text, only wraps/styles tokens.
- Terminal highlighting never leaks user-provided ANSI escapes.
- Terminal highlighting never changes code block border width.

HTML renderer tests in `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`:

- `renderMarkdownHtml(markdown)` keeps existing code block output by default.
- `syntaxHighlight: false` exactly matches default output.
- `renderMarkdownHtml(markdown, { syntaxHighlight: true })` emits token spans for implemented language families.
- Highlighted code still escapes `<`, `>`, `&`, `"`, and `'`.
- Whitespace is preserved exactly for indentation, blank lines, and trailing spaces where current rendering preserves them.
- Unknown language falls back to plain escaped code.
- Known-but-not-tokenized language falls back to plain escaped code.
- Plain-text aliases fall back to plain escaped code.
- `renderHtml(ast, { syntaxHighlight: true })` highlights AST-first code nodes.
- `showFrontmatter: true` plus `syntaxHighlight: true` highlights YAML frontmatter through the shared code renderer.
- `allowRawHtml: true` does not allow raw HTML inside code tokens.
- Highlighted HTML output contains no `style=`.
- Highlighted HTML output contains only `tc-token-*` token classes inside code spans.
- Fixture matrix: every supported dummy file renders safe HTML and preserves text after stripping tags.

Terminal renderer tests in `packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts`:

- `renderMarkdown(markdown)` keeps current code block rendering by default.
- `syntaxHighlight: false` exactly matches default output.
- `renderMarkdown(markdown, { syntaxHighlight: true })` styles code tokens while keeping the same border and indentation.
- User-provided ANSI in code is stripped before tokenization and does not leak into output.
- Highlighting does not change visible-width-based border sizing.
- Unknown languages fall back to current stripped plain terminal code output.
- Known-but-not-tokenized languages fall back to current stripped plain terminal code output.
- Plain-text aliases fall back to current stripped plain terminal code output.
- `showFrontmatter: true` plus `syntaxHighlight: true` highlights rendered YAML frontmatter if frontmatter code rendering is shared.
- Fixture matrix: every supported dummy file renders terminal output without throwing and preserves stripped source text inside the existing code block shape.

Tokenizer tests in `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`:

- Registry and alias tests listed above.
- ECMAScript: `const value = "hello"; // comment` classifies keyword, string, and comment.
- ECMAScript: `console.log(value)` classifies `log` as property after `.`.
- ECMAScript: regex versus division is distinguished for `/foo\/bar/g.test(input)` and `total / count`.
- ECMAScript: template literals with `${...}` do not throw.
- TypeScript: `type Point = { x: number }` classifies `type` as keyword and `number` as type.
- TSX: `const id = <T,>(value: T) => value;` does not classify `<T,>` as JSX.
- JSX: `<Button data-id="x">{label}</Button>` classifies tag, attribute, string, and expression identifier.
- JSON: `{"name":"poe","ok":true,"none":null,"count":2}` classifies key, string, boolean, null, number, operator, and punctuation.
- YAML: keys, comments, block scalars, anchors, tags, directives, booleans, nulls, and URL colon handling.
- CSS: at-rules, selectors, properties, custom properties, variables, colors, functions, `!important`, comments, URL strings, and hash selector/color ambiguity.
- Shell: comments, quotes, variables, command position, flags, negative numbers, operators, and heredocs if implemented.
- Python: comments, prefixes, triple strings, f-strings as strings, decorators, keywords, soft keywords, and numeric literals.
- SQL: keywords, strings, quoted identifiers, comments, parameters, numbers, and keyword-after-dot behavior.
- Markup: tags, attributes, comments, entities, doctypes, and broken tags.
- Markdown: headings, links, inline code, list markers, and fenced code delimiters.
- Diff/Dockerfile/INI/TOML: representative tokens.
- Fixture matrix: every dummy file concatenates back to the exact source text.
- Broken syntax matrix: every malformed fixture returns tokens or `undefined` and never throws.

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

6. Run a known-but-not-tokenized fallback check:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("```ruby\nputs \"<x>\"\n```", { syntaxHighlight: true }))'
```

Expected output contains no `tc-token-*` spans and still escapes `<x>`.

Must-work checklist:

- [ ] Default HTML code block rendering is unchanged; proof: focused HTML renderer unit test.
- [ ] Default terminal code block rendering is unchanged; proof: focused terminal renderer unit test.
- [ ] `syntaxHighlight: true` emits `tc-token-*` spans for implemented HTML language families; proof: HTML renderer tests.
- [ ] `renderMarkdown(markdown, { syntaxHighlight: true })` styles terminal code blocks sensibly; proof: terminal renderer tests and real-world terminal command.
- [ ] Language recognition is registry-backed, not renderer branches; proof: registry tests.
- [ ] Known-but-not-tokenized Code languages fall back intentionally; proof: registry and renderer tests.
- [ ] Escaping remains safe inside highlighted tokens; proof: escaping unit test and real-world escaping command.
- [ ] Whitespace is preserved exactly; proof: whitespace unit tests.
- [ ] Unknown and plain-text languages fall back to plain escaped/plain terminal code; proof: fallback tests and real-world fallback command.
- [ ] YAML/frontmatter path uses the same code renderer; proof: frontmatter tests.
- [ ] No CSS is bundled or injected; proof: output tests assert no `style=` and no generated stylesheet.
- [ ] No new dependencies are added; proof: package diff.
- [ ] User-provided ANSI is stripped before terminal token styling; proof: terminal renderer test.
- [ ] Broken syntax never throws; proof: malformed fixture matrix.

Validation commands:

```sh
npm run test -w toolcraft-design
npm run lint -w toolcraft-design
npm run build -w toolcraft-design
```

If the implementation impacts CLI visual rendering, run an ad hoc screenshot validation:

```sh
npm run screenshot-poe-code -- --help
```

For this feature specifically, add a temporary CLI command invocation that renders highlighted Markdown through the terminal renderer and inspect the screenshot manually. Do not add screenshot tests.

## 5. Code plan

Files to create:

- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.ts`
  - Owns Toolcraft token kinds, registry resolution, tokenizer family dispatch, and the public internal `highlightCodeBlock` helper.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter-registry.ts`
  - Declarative Code language ids, aliases, families, and known fallback entries.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-scanner.ts`
  - Tiny source-preserving scanner toolkit shared by language tokenizers.
  - Owns cursor helpers, token emission helpers, and adjacent plain-token merging.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-tokenizers.ts`
  - Family tokenizer implementations composed from `code-scanner.ts`.
  - Split into sibling files only if this file becomes harder to read.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter-fixtures.ts`
  - Shared dummy-file fixture matrix for tokenizer, HTML, terminal, and integration tests.
- `packages/toolcraft-design/src/terminal-markdown/parser/code-highlighter.test.ts`
  - TDD coverage for registry resolution, tokenization, fixture robustness, and fallback behavior.
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
  - Re-export updated `HtmlRenderOptions`, `RenderOptions`, and `CodeHighlightLanguage`.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`
  - Add option type assertion for `syntaxHighlight`.
  - Add HTML behavior tests listed above.
- `packages/toolcraft-design/src/terminal-markdown/terminal-markdown.test.ts`
  - Add terminal behavior tests listed above.
- `packages/toolcraft-design/src/index.test.ts`
  - Update type/export expectations only if existing assertions require the new option field.

Build order:

1. Add failing tests for `HtmlRenderOptions.syntaxHighlight`, `RenderOptions.syntaxHighlight`, and default-off rendering.
2. Add the exported `CodeHighlightLanguage` enum-shaped value and tests that it matches highlighted registry entries.
3. Add `CodeToken` types to `ast.ts`.
4. Create `code-renderer.ts` with fake-token HTML and terminal rendering tests.
5. Create `code-highlighter-registry.ts` with language ids, aliases, plain fallback, known fallback, and family assignment tests.
6. Create `code-scanner.ts` with cursor, token emission, and source-preservation tests.
7. Create `code-highlighter.ts` with resolver and family dispatch that initially returns `undefined`.
8. Wire `html-renderer.ts` to render highlighted tokens for code nodes.
9. Wire `renderer.ts` to render highlighted terminal code blocks.
10. Implement ECMAScript and JSON tokenizers using the scanner toolkit.
11. Add YAML/frontmatter support and tests.
12. Add CSS, shell, Python, SQL, markup, Markdown, diff, Dockerfile, INI, and TOML tokenizers/tests only while each implementation stays small and clear.
13. Move any family that gets too complicated to known fallback and keep its fallback tests.
14. Add fixture matrix coverage.
15. Add known-but-not-tokenized fallback coverage.
16. Run `npm run test -w toolcraft-design`.
17. Run `npm run lint -w toolcraft-design`.
18. Run `npm run build -w toolcraft-design`.
19. Run screenshot validation if CLI rendering output changes in a user-visible way.

Implementation guardrails:

- Add no package dependencies.
- Do not implement a tokenizer family if it cannot stay small, source-preserving, and easy to test.
- Plain fallback is preferred over complex approximate parsing.
- Keep tokenizer logic in `code-tokenizers.ts` and `code-scanner.ts`; keep `code-highlighter.ts` as orchestration, not a parsing dump.
- Prefer data-driven registry tables over language `if`/`switch` branches in renderers.
- Use family dispatch only at the highlighter boundary.
- Keep scanner helpers source-preserving and forward-progress safe.
- Avoid broad regex-driven parsing; use explicit scanner state for language constructs that can be malformed.
- Keep tokenization independent from HTML escaping and terminal styling.
- Keep the public API to the boolean `syntaxHighlight` option.
- Do not add a public theme/style API.
- Do not emit non-Toolcraft CSS classes or inline styles.
- Do not change HTML or terminal Markdown rendering when `syntaxHighlight` is omitted or false.
- Do not update README without explicit user permission.
- If "highlight every Code language" becomes required, stop and revise the plan because that contradicts the no-dependency constraint.
