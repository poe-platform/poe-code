---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft Markdown To HTML

Add an HTML renderer for Toolcraft Design's existing markdown AST.

## 1. What we're building

Add markdown-to-HTML rendering to `toolcraft-design` alongside the existing terminal markdown renderer.

The feature reuses the existing parser and `MdNode` AST in `packages/toolcraft-design/src/terminal-markdown`, then adds an HTML rendering path that converts parsed markdown into safe HTML strings for browser or static-site use.

The renderer must be accessible through `toolcraft`, not only through the internal `toolcraft-design` package.

The design system export surface must support flat, individual component imports. Consumers should be able to import each design component directly instead of reaching through one large namespace or nested module object.

The feature should preserve the current terminal rendering API and behavior. Existing `renderMarkdown()` terminal output must not change.

Explicit non-goals:

- Do not replace the existing markdown parser.
- Do not add a second markdown parser dependency unless an implementation gap makes it unavoidable.
- Do not change `renderMarkdown()` from terminal output to HTML output.
- Do not add README content without user permission.

## 2. User-facing shape

Consumers can render terminal markdown exactly as they do today:

```ts
import { renderMarkdown } from "toolcraft/design";

process.stdout.write(renderMarkdown("# Status"));
```

Consumers can render markdown to HTML through `toolcraft`:

```ts
import { renderMarkdownHtml } from "toolcraft/design";

const html = renderMarkdownHtml("# Status\n\nReady.");
```

Expected HTML output:

```html
<h1>Status</h1>
<p>Ready.</p>
```

Consumers that already depend on `toolcraft-design` can use the same renderer there:

```ts
import { renderMarkdownHtml } from "toolcraft-design";

const html = renderMarkdownHtml("Use `poe-code configure`.");
```

AST-first callers can parse once and render into either target:

```ts
import { parse, render, renderHtml } from "toolcraft/design";

const { ast } = parse(markdown);
const terminal = render(ast);
const html = renderHtml(ast);
```

Flat individual design-system exports are available through both packages:

```ts
import { renderTable } from "toolcraft/design/render-table";
import { renderMarkdownHtml } from "toolcraft/design/render-markdown-html";
import { renderDetailCard } from "toolcraft/design/render-detail-card";
```

Equivalent direct design package imports also work:

```ts
import { renderTable } from "toolcraft-design/render-table";
import { renderMarkdownHtml } from "toolcraft-design/render-markdown-html";
import { renderDetailCard } from "toolcraft-design/render-detail-card";
```

The flat export names match the existing root export names in kebab-case subpaths. For example, `renderTable` is available from `*/render-table`, `renderResourceBrowser` from `*/render-resource-browser`, and `createDashboard` from `*/create-dashboard`.

## 3. Implementation details and technical decisions

Autonomy audit:

- No credentials are required.
- No network access is required.
- No running services are required.
- No sample data is required beyond inline markdown fixtures in unit tests.
- Browser access is only needed for manual HTML inspection; the implementation remains fully testable with unit tests and package build smoke checks.

Architecture:

- Keep markdown parsing in `packages/toolcraft-design/src/terminal-markdown/parser.ts` and the existing parser submodules.
- Add `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts` as the sibling renderer for `MdNode -> HTML`.
- Keep the existing terminal renderer in `packages/toolcraft-design/src/terminal-markdown/renderer.ts` unchanged except for any shared type/export wiring.
- Update `packages/toolcraft-design/src/terminal-markdown/index.ts` to export:
  - `renderHtml(ast, options?)`
  - `renderMarkdownHtml(markdown, options?)`
  - `HtmlRenderOptions`
- Update `packages/toolcraft-design/src/index.ts` to expose the new HTML renderer from the package root.
- Keep `packages/toolcraft/src/design.ts` as the root `toolcraft/design` bridge and ensure the new renderer is available through it.

HTML rendering rules:

- Escape all text node content.
- Escape all attribute values.
- Render raw markdown HTML nodes as escaped text by default.
- Add `allowRawHtml?: boolean` to `HtmlRenderOptions`; when true, pass `html` AST node values through unchanged.
- Default `showFrontmatter` to `false`, matching terminal markdown.
- When `showFrontmatter: true`, render frontmatter as a fenced-code-like HTML block: `<pre><code class="language-yaml">...</code></pre>`.
- Sanitize link and image URLs. Allow relative URLs, root-relative URLs, anchors, `http:`, `https:`, `mailto:`, and `tel:`. Omit unsafe `href` or `src` attributes rather than emitting `javascript:` or other executable schemes.
- Render image alt text even when `src` is omitted.
- Render code blocks as `<pre><code>` and include `class="language-<lang>"` when `lang` is present.
- Render tables as standard `<table><thead><tbody>...`.
- Render GFM task list items as disabled checkboxes inside `<li>`.
- Render alerts as semantic blocks with data attributes, for example `<blockquote data-alert="NOTE">...`.
- Render footnotes as a trailing `<section class="footnotes"><ol>...`.

Flat export strategy:

- Add flat top-level re-export modules to `toolcraft-design/src` for each public design-system component or helper currently exported from `packages/toolcraft-design/src/index.ts`.
- Use kebab-case filenames that match public function or component names:
  - `render-markdown-html.ts`
  - `render-html.ts`
  - `render-markdown.ts`
  - `render-table.ts`
  - `render-detail-card.ts`
  - `render-inspector-card.ts`
  - `render-resource-browser.ts`
  - `create-dashboard.ts`
  - `run-explorer.ts`
  - `run-two-pane-explorer.ts`
  - `intro.ts`
  - `note.ts`
  - `outro.ts`
  - `log.ts`
  - `text.ts`
  - `symbols.ts`
  - `color.ts`
  - `get-theme.ts`
  - and the remaining public root exports using the same kebab-case rule.
- These files only re-export values and types; they do not add pass-through functions.
- Add package export patterns:
  - `toolcraft-design/* -> dist/*.js`
  - `toolcraft/design/* -> dist/design/*.js`
- Add matching `toolcraft/src/design/*.ts` flat bridge modules that re-export from `toolcraft-design/<name>`.
- Keep the existing root barrels intact for backward compatibility.

Package export constraints:

- Update `package.json` through normal JSON parsing/writing if automation is used; no ad hoc text editing.
- Keep `toolcraft` bundling `toolcraft-design` as it does today.
- Do not add README content unless the user explicitly approves it.

Edge cases:

- Empty markdown returns an empty string.
- Malformed markdown renders the parser's best-effort AST without throwing.
- Unclosed emphasis and broken links continue to degrade as literal text through the existing parser.
- Cyclic frontmatter values do not throw; reuse the terminal renderer's circular-safe frontmatter formatting behavior or extract it into a shared helper.
- Unicode text is escaped without losing grapheme content.
- Inline HTML tags are escaped by default and preserved only with `allowRawHtml: true`.

## 4. Interfaces and test plan

New public interfaces:

```ts
interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
}

function renderHtml(ast: MdNode, options?: HtmlRenderOptions): string;

function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string;
```

Existing interfaces that must remain unchanged:

```ts
function parse(markdown: string): { frontmatter?: Record<string, unknown>; ast: MdNode };
function render(ast: MdNode, options?: RenderOptions): string;
function renderMarkdown(markdown: string, options?: RenderOptions): string;
```

Unit tests:

- Add `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts`.
- Write tests first for headings, paragraphs, emphasis, strong, inline code, links, images, fenced code, lists, task lists, blockquotes, alerts, tables, thematic breaks, footnotes, frontmatter, escaped HTML, and `allowRawHtml`.
- Add URL sanitization tests for safe relative URLs and blocked `javascript:` URLs.
- Add unicode and malformed markdown cases mirroring the terminal renderer's resilience tests.
- Extend `packages/toolcraft-design/src/index.test.ts` to assert root exports for `renderHtml`, `renderMarkdownHtml`, and `HtmlRenderOptions`.
- Add flat subpath import tests for `toolcraft-design/render-markdown-html`, `toolcraft-design/render-table`, and representative prompt/dashboard/explorer exports.
- Extend `packages/toolcraft/src/package-exports.test.ts` to assert `./design/*` export support and representative exact import paths.
- Add compile-check tests or dynamic import tests proving `toolcraft/design/render-markdown-html` resolves after build.

Integration and build checks:

- Run `npm run test -w toolcraft-design`.
- Run `npm run lint -w toolcraft-design`.
- Run `npm run build -w toolcraft-design`.
- Run `npm run test -w toolcraft`.
- Run `npm run lint -w toolcraft`.
- Run `npm run build -w toolcraft`.

Real-world test:

1. Build both packages:

```sh
npm run build -w toolcraft-design
npm run build -w toolcraft
```

Expected observation: both packages compile and `toolcraft-design` postbuild smoke checks pass.

2. Import the HTML renderer through `toolcraft/design`:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft/dist/design.js"; console.log(renderMarkdownHtml("# Status\n\nReady."))'
```

Expected output:

```html
<h1>Status</h1>
<p>Ready.</p>
```

3. Import the flat `toolcraft` export:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft/dist/design/render-markdown-html.js"; console.log(renderMarkdownHtml("Use `poe-code configure`."))'
```

Expected output includes:

```html
<p>Use <code>poe-code configure</code>.</p>
```

4. Import the flat `toolcraft-design` export:

```sh
node --input-type=module -e 'import { renderMarkdownHtml } from "./packages/toolcraft-design/dist/render-markdown-html.js"; console.log(renderMarkdownHtml("[x](javascript:alert(1))"))'
```

Expected observation: the output does not contain `javascript:`.

Manual visual QA:

- Create a temporary HTML document that wraps `renderMarkdownHtml(getMarkdownDemo())`.
- Open it in a browser and inspect headings, tables, code blocks, alerts, footnotes, and task lists.
- Use a screenshot only for this ad hoc validation if the HTML output changes visible browser rendering. Do not add screenshot tests.

Must-work checklist:

- [ ] `renderMarkdown()` still returns terminal ANSI-oriented output; proof: existing terminal markdown tests pass.
- [ ] `renderMarkdownHtml("# Status")` returns `<h1>Status</h1>`; proof: HTML renderer unit test.
- [ ] Raw HTML is escaped by default; proof: unit test with `<script>`.
- [ ] Raw HTML can be passed through only with `allowRawHtml: true`; proof: unit test.
- [ ] Unsafe links do not emit executable URLs; proof: URL sanitization unit test.
- [ ] `toolcraft/design` exposes `renderMarkdownHtml`; proof: package export or dynamic import test.
- [ ] `toolcraft/design/render-markdown-html` resolves; proof: built dynamic import test.
- [ ] `toolcraft-design/render-markdown-html` resolves; proof: built dynamic import test.
- [ ] Representative flat component exports resolve for table, prompt, dashboard, and explorer components; proof: package export tests.
- [ ] No README changes are included; proof: git diff.

Rollout:

- This is additive.
- Existing imports continue to work.
- Existing markdown terminal rendering stays unchanged.
- The only new public surface is additional HTML rendering helpers and flat package subpath exports.

## 5. Code plan

Files to create:

- `packages/toolcraft-design/src/terminal-markdown/html-renderer.ts` — AST-to-HTML renderer and HTML escaping helpers.
- `packages/toolcraft-design/src/terminal-markdown/html-renderer.test.ts` — TDD coverage for the new renderer.
- `packages/toolcraft-design/src/render-markdown-html.ts` — flat re-export for `renderMarkdownHtml`.
- `packages/toolcraft-design/src/render-html.ts` — flat re-export for `renderHtml`.
- Additional `packages/toolcraft-design/src/<kebab-name>.ts` flat re-export modules for each public design-system component/helper.
- `packages/toolcraft/src/design/render-markdown-html.ts` — flat `toolcraft/design` bridge.
- `packages/toolcraft/src/design/render-html.ts` — flat `toolcraft/design` bridge.
- Additional `packages/toolcraft/src/design/<kebab-name>.ts` bridge modules matching the `toolcraft-design` flat exports.
- Package export tests for representative flat imports if existing tests are not enough.

Files to change:

- `packages/toolcraft-design/src/terminal-markdown/index.ts` — export `renderHtml`, `renderMarkdownHtml`, and `HtmlRenderOptions`.
- `packages/toolcraft-design/src/index.ts` — root export for new HTML renderer helpers.
- `packages/toolcraft-design/package.json` — add flat subpath export pattern.
- `packages/toolcraft-design/scripts/smoke-built-exports.mjs` — smoke-check the new HTML renderer and representative flat exports.
- `packages/toolcraft-design/src/index.test.ts` — root and flat export assertions.
- `packages/toolcraft/package.json` — add `./design/*` subpath export pattern.
- `packages/toolcraft/src/package-exports.test.ts` — assert flat design export support.

Function signatures:

```ts
export interface HtmlRenderOptions {
  showFrontmatter?: boolean;
  allowRawHtml?: boolean;
}

export function renderHtml(ast: MdNode, options?: HtmlRenderOptions): string;

export function renderMarkdownHtml(markdown: string, options?: HtmlRenderOptions): string;
```

Build order:

1. Add failing HTML renderer tests for the public API and core HTML output.
2. Implement `html-renderer.ts` against the existing `MdNode` AST.
3. Wire `terminal-markdown/index.ts` and `toolcraft-design/src/index.ts`.
4. Add and test flat `toolcraft-design` exports.
5. Add and test flat `toolcraft/design` bridge exports.
6. Extend smoke-built-exports checks.
7. Run package tests and lint/build commands.
8. Do manual browser inspection for the rendered demo HTML if output semantics changed enough to affect visual browser rendering.
