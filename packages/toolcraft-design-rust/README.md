# toolcraft-design-rust

Compose agent prompts and configuration templates with an own Rust core and no
npm runtime dependencies. This private additive package keeps your current design
system integrations intact.

Render consistent agent output with callable `color` chains, `text` helpers and
cached dark/light palettes. `configureTheme({brand: 'blue', label: 'Acme'})`
sets your brand and live intro label. Colors follow terminal support and
`FORCE_COLOR`/`NO_COLOR`; `withOutputFormat` switches text between terminal,
Markdown and JSON within an async context. Inline Markdown code and links escape
delimiters and flatten newlines.

`note(message, title?, write?)` frames multiline terminal notes, quotes them in
Markdown, or emits a JSON record. Pass a writer to capture the output in your UI.
`openExternal(url, options?)` opens a URL with the platform browser launcher and
rejects failed launches. Supply `spawnProcess` to control process creation.
Use `intro`, `introPlain`, `outro`, `cancel` and `log` for consistent prompt
messages in terminal, Markdown and JSON output. `log.message` also controls
guide symbols, spacing and continuation lines. `isCancel` recognizes the shared
prompt cancellation symbol across module instances.
`spinner()` exposes `start`, `message` and `stop` with live terminal frames,
plain non-TTY output and Markdown/JSON formats. It follows `POE_NO_SPINNER`.
`withSpinner({message, fn, stopMessage?, subtext?})` runs asynchronous work with
elapsed-time updates and clears its timers on success or failure. It returns
the task result and supports changing messages through a callback.

`symbols` provides live terminal, Markdown and JSON status marks, including
brand-aware resolved symbols. `spacing`, `widths` and the `tokens` namespace
share the same token objects across root and `tokens/*` imports. Symbol selection
and numeric defaults live in Rust; Node retains theme getters and mutable objects.

```ts
import {color, text, getTheme, configureTheme} from 'toolcraft-design-rust';

configureTheme({brand: 'blue', label: 'Acme'});
console.log(getTheme().intro('Agent ready'));
console.log(text.command('poe-agent'));
console.log(color.green.bold('Completed'));
```

`acp.formatAgentPlan(entries)` produces a compact checklist around the active
step and keeps the full checklist in `detail` when it is shortened. Previews
respect Unicode graphemes and terminal widths. Cursor controls and hidden terminal
strings become safe visible text. `acp.renderAgentPlan` uses the current output
format; `acp.withAcpWriter` routes rendered lines to your view throughout async work.

```ts
import {acp} from 'toolcraft-design-rust';

const entries = [{content: 'Review changes', status: 'in_progress' as const}];
console.log(acp.formatAgentPlan(entries).text);
const lines: string[] = [];
await acp.withAcpWriter(line => lines.push(line), async () => {
  acp.renderAgentPlan(entries);
});
```

```ts
import {renderTemplate,resolveTemplatePartials} from 'toolcraft-design-rust';

const prompt=renderTemplate('Fix {{issue.title}} in {{repo}}', {
  issue:{title:'Missing configuration'},repo:'acme/app'
}, {escape:'none'});

const layout=resolveTemplatePartials('Rules:\n  {{> rules}}\n{{yield}}', {
  rules:'Read project instructions first.\n'
});
const composed=renderTemplate(layout, {}, {escape:'none',yield:prompt});
```

| API | Use |
| --- | --- |
| `renderTemplate` | Names, dotted paths, sections, inverted sections, lambdas, HTML/raw escaping, partials, yield and validation |
| `getTemplatePartialNames` | Discover referenced partials in first-encounter order |
| `resolveTemplatePartials` | Expand nested partials with standalone indentation |
| `TemplateParseError` | Read the malformed tag and UTF-16 line/column |
| `computeDashboardLayout` | Calculate clipped pane, footer and compact summary rectangles |
| `dashboard.limitOutputPreview` | Keep the latest output within a 16,384-code-unit preview |
| `dashboard.createOutputPreviewBuffer` | Retain bounded live deltas in the Rust core |
| `createTerminalStringFilter` | Filter split OSC/DCS strings while retaining complete CSI controls |
| `createLogger`, `logger` | Emit coherent terminal, Markdown or JSON messages |
| `withOutputFormat` | Scope an output format across asynchronous work |
| `renderTable`, `loggerTableWidth` | Render width-budgeted tables or detail rows in terminal, Markdown and JSON |
| `formatCommandNotFound`, `formatCommandNotFoundPanel` | Show unknown commands, suggestions and a help hint with consistent styling |
| `renderFileChanges` | Show file status, conflicts, rename paths or unified diffs in terminal and Markdown |
| `helpFormatter`, `helpFormatterPlain` | Align command and option help, wrap descriptions and preserve nested hanging indents |
| `renderCatalog` | Present grouped values with metrics, optional descriptions and per-item tones |
| `renderResourceBrowser` | Browse grouped resources with metadata, previews, badges, empty hints and footer actions |
| `createCommandRegistry` | Share command discovery and enabled keyboard dispatch, rejecting duplicate IDs and keys |
| `createOverlayManager` | Track overlay focus and abort each overlay's signal when it closes |
| `createViewport`, `selectViewportTail` | Retain live items, hold scrollback and select wrapped rows without rendering the full history |
| `explorer/render/text` | Fit, center and pad text by terminal cells while retaining grapheme offsets |
| `dashboard/terminal-width` | Measure graphemes, expand tabs and truncate terminal text |
| `createNotices`, `renderNotice` | Retain bounded, expiring notices and render status markers |
| `createMetric` | Retain rolling samples and render compact sparklines |
| `renderProgressGroup` | Show clipped progress rows with known or indeterminate completion |
| `createEventGroups`, `renderEventGroupRows` | Retain grouped output, expand errors and render a bounded row window |
| `createTaskTree`, `renderTaskRows` | Index task hierarchies, collapse subtrees and render status/duration rows |
| `createRenderPerformanceMonitor`, `formatRenderPerformance` | Track repaint rates, rolling percentiles, input latency and coalesced updates |
| `staticRender`, `renderMenu`, `renderSpinnerFrame`, `renderSpinnerStopped` | Render menus and spinner snapshots in terminal, Markdown or JSON |
| `escape-terminal-text` | Expose terminal controls and directional marks as visible Unicode escapes |
| `renderPlaintext` | Turn a Markdown AST into readable text with announcements, table sentences and numbered footnotes |
| `renderHtml` | Render a Markdown AST with escaped HTML, checked lists, aligned tables, footnotes and optional code highlighting |
| `render` | Render a Markdown AST for terminals with styled blocks, width-aware wrapping, tables and code highlighting |
| `Screen` | Draw styled text into a resizable cell buffer and emit ANSI frame differences |
| `screen/ansi-text` | Convert styled terminal output and cursor edits into grapheme-aware screen cells |
| `terminal/output` | Write synchronized frames and restore terminal modes on close, signals and fatal errors |
| `terminal/input` | Parse chunked UTF-8, navigation, modifiers, paste, mouse wheel and timed Escape events |
| `createTerminalDriver` | Connect input, synchronized output, resize notifications and terminal restoration |

Only own view properties are visible. Lazy getters, lambda receivers, array
iterator overrides and iterator cleanup preserve host behavior. Partial cycles
reject explicitly, and partial nesting is bounded to 100. Token ownership,
section rendering and partial composition use work stacks instead of recursive
trees. The Rust core accepts a caller-supplied environment and is independent of
Node. Plain data views use a flat graph transfer so lookups, scopes and array
sections stay in Rust; shared references, cycles, sparse arrays, undefined,
nonfinite numbers and BigInt survive the transfer. Getters, functions, proxies
and custom iterators use the host callback environment. Standalone Rust callers
can use `data::Graph` and a fresh `data::DataEnvironment` for each render.

This supplies template composition, dashboard geometry, bounded output ownership and log formatting. The complete dashboard
renderer, interactive controls and existing application integrations remain in
the original package. Rendering remains slower than the JavaScript implementation. In one Node 22
ARM64 measurement, a 256-item section takes about 216 µs through the data path,
765 µs through callbacks and 38 µs in JavaScript. Small views can cost more to
capture than callbacks save. No speedup over JavaScript or memory reduction is
claimed for these bindings. It uses self-contained native
artifacts and Node built-ins only.

```ts
import { computeDashboardLayout } from 'toolcraft-design-rust';

const layout = computeDashboardLayout({ totalWidth: 80, totalHeight: 24 });
console.log(layout.leftPane, layout.rightPane, layout.footer);
```

Wide terminals retain a separate stats pane; narrow terminals use a compact
summary above full-width output. Pane rectangles clip to the available space,
including very small terminals. Optional `rightPaneWidth`, `footerHeight` and
`borderWidth` match the existing layout policy. The portable core calculates
geometry; the Node binding retains JavaScript numeric coercion and property-read
behavior. This API does not start a terminal renderer or modify terminal state.

```ts
import { dashboard } from 'toolcraft-design-rust';

const output = dashboard.createOutputPreviewBuffer();
output.push('Starting run\n');
output.push('Latest progress\n');
console.log(output.text());
```

Previews preserve the latest complete lines, add a truncation notice when needed,
and avoid cutting a UTF-16 surrogate pair or retaining partial CSI parameters.
Streaming filters remove OSC/DCS payloads across chunks, preserve complete styling
controls, and cap pending controls at 1,024 code units. Rust owns live preview
chunks; Node supplies string ingress and returned snapshots. Input and temporary
conversion memory are outside the retained-state budget. Unlike the original
helper, a negative-infinite tail budget terminates safely for ANSI text.

```ts
import { logger, withOutputFormat } from 'toolcraft-design-rust';

logger.info('Agent started');
logger.resolved('Runtime', 'host');
withOutputFormat('json', () => logger.warn('Authorization required'));
```

`createLogger(emitter)` sends messages directly to your callback. Without an emitter,
Rust formats terminal guides, Markdown lines and structured JSON. The host writes
stdout, preserves asynchronous format scopes and observes color/theme settings.
Small plain Markdown/JSON messages use a host path with Rust-supplied prefixes to
avoid native transfer overhead. `stripAnsi` follows the original log cleanup policy;
use the streaming preview filter when OSC/DCS payloads can span chunks.

Stream partial agent output into stable dashboard rows:

```ts
import { createStreamingDashboardLineBuffer } from 'toolcraft-design-rust';

const buffer = createStreamingDashboardLineBuffer((text, id) => {
  updateRow(id, text);
});
buffer.push("Working");
buffer.push("…done\n");
buffer.flush();
```

The buffer suppresses unchanged previews, removes hidden terminal strings, and
limits retained partial output to 16,384 UTF-16 units.

Report agent tool activity and usage through the same scoped writer:

```ts
import { acp } from 'toolcraft-design-rust';

acp.withAcpWriter(line => appendAgentOutput(line), () => {
  acp.renderToolStart('read', 'Inspect package');
  acp.renderToolComplete('read');
  acp.renderUsage({ input: 1500, output: 350, cached: 800, costUsd: 0.01 });
});
```

Tool, reasoning, usage, permission and error events support terminal, Markdown
and JSON output. Terminal agent-message Markdown rendering is still unavailable.

Render rows with the same table contract as the original design package:

```ts
import { getTheme, renderTable } from 'toolcraft-design-rust';

console.log(renderTable({
  theme: getTheme(),
  columns: [
    { name: 'agent', title: 'Agent', alignment: 'left', maxLen: 20 },
    { name: 'status', title: 'Status', alignment: 'left', maxLen: 16 }
  ],
  rows: [{ agent: 'codex', status: 'Ready' }],
  maxWidth: 60
}));
```

`variant: 'detail'` uses the first two columns for labels and wrapped values.
`withOutputFormat` also controls tables. `toolcraft-design-rust/render-table`
exports the renderer and its types; `toolcraft-design-rust/components/table`
also exports `loggerTableWidth()` for the logger's three-column gutter.
Rust owns column admission, alignment, width budgeting, ANSI scanning,
display-width rules, truncation and wrapping decisions. Node retains ICU grapheme
segmentation, observable array/string methods, theme callbacks and output templates.
This binding preserves getters, callback receivers and thrown values; native
resource limits and pathological reentrancy still need replacement qualification.

`formatCommandNotFound({unknownCommand, helpCommand, suggestions})` returns
`{label, hint}`. `formatCommandNotFoundPanel` accepts an optional `title` and returns
`{title, label, footer}` for your error panel. Both are also available from
`toolcraft-design-rust/components/command-errors`. Diagnostic composition and
defaults live in Rust; styling uses the same mutable text and typography helpers
as the original package.

Render changes without accessing the filesystem:

```ts
import { renderFileChanges } from 'toolcraft-design-rust';

console.log(renderFileChanges([
  { kind: 'modified', path: 'agent.ts', oldContent: 'old\n', newContent: 'new\n' }
], { mode: 'diff' }));
```

The default `status` mode includes ordered counts and conflict markers. Diff mode
uses the original single-hunk policy with three context lines; renamed paths and
added/deleted files retain their original headers. Set `format: 'markdown'` for a
fenced block. The root and `components/file-changes` entry points share one renderer.
Rust chooses status styles, paths, summary details and hunk ranges; Node retains
observable array/Map/string operations and color callbacks.

Use `formatColumns({rows, totalWidth})` for custom help layouts, or
`formatCommandList(commands)` and `formatOptionList(options)` for command menus.
Structured `nameTokens` and `flagTokens` style commands, arguments and options
individually. `formatUsage(command, args)` formats the usage line.
`helpFormatterPlain` provides ASCII output for plain terminals; the regular
formatter preserves Unicode, terminal hyperlinks and ANSI styling. Both are
also available through `components/help-formatter` and
`components/help-formatter-plain`. Rust owns wrapping, width rules, layout
validation and token selection; Node retains ICU segmentation and styling callbacks.

`renderCatalog({theme, title, metrics, groups})` aligns labels and values within
each group. `renderResourceBrowser({theme, title, groups, footer})` presents
resource rows with optional metadata, previews and badges. Both follow
`withOutputFormat` for terminal, Markdown and JSON output and are also available
from `components/catalog` and `components/resource-browser`. Rust controls
format selection, optional content and group composition; Node preserves
theme receivers, array methods, object spreads and JSON serialization.

`renderDetailCard({theme, title, prose, sections, width})` presents a resource
with badges, descriptions and aligned metadata rows. `renderInspectorCard`
adds a preview with `maxPreviewLines` clipping and accepts sections of `fields`.
Both preserve ANSI styling when values wrap and are available at the root and
`components/detail-card` or `components/inspector-card`.

Use `createCommandRegistry(commands)` to share the same command objects between
menus and key dispatch. Enablement is checked on each dispatch or list read.
`createOverlayManager(initialFocus)` returns an AbortSignal from `open(focus)`;
`close()` restores the previous focus and `dispose()` closes every overlay.

`createViewport({capacity})` retains items by ID. Calling `scroll(delta)` holds
the visible history while new arrivals increment `unseen()`; `follow()` returns
to the live items. Held arrays and item objects preserve their original identity.
`selectViewportTail(items, height, offset, renderRows)` renders from newest to
oldest and stops once the requested viewport is filled. These APIs are also
available from `command-registry`, `overlay-manager` and `viewport` subpaths.

Compose terminal-cell layouts with the explorer text helpers:

```ts
import {fitToWidth, padEndCells, splitGraphemeCells} from 'toolcraft-design-rust/explorer/render/text';

const label = fitToWidth('Compile documentation', 16);
const row = padEndCells(label, 20, ' ');
const cells = splitGraphemeCells('e\u0301 status');
```

`cellWidth`, `fitToWidth`, `centerCells`, `padEndCells` and `splitGraphemeCells`
accept a starting column for tab alignment. Grapheme records preserve UTF-16
start/end offsets. `dashboard/terminal-width` exposes `graphemes`, `graphemeWidth`,
`displayWidth`, `expandTabs` and `truncateToWidth` with the same width rules.
Rust owns width classification and layout; Node supplies ICU segmentation,
observable string/array methods and numeric coercions.

`createNotices({capacity, now})` coalesces notices by ID, expires them during reads
and returns isolated snapshots. Use `put(id, notice, durationMs)`, `dismiss(id)`
and `list()` to manage them; `renderNotice(notice, width)` clips the visible row.
`createMetric({capacity, unit})` retains the latest samples, treats nonfinite values
as missing and renders a cell-limited sparkline. `renderProgressGroup(items, width)`
combines labels, status marks and bounded percentages. These APIs are available
from the root and `inline-notice`, `metric` and `progress-group` subpaths. Rust owns
validation, selection, eviction and rendering policy; Node retains clocks, host
collections, observable methods and reentrant callbacks.

`createEventGroups({capacity, children})` bounds both groups and their retained
events. `append(groupId, event)` updates events by ID and expands groups containing
errors; `toggle(groupId)` changes visibility. `rows(offset, height)` selects a
window of headers and expanded children, and `renderEventGroupRows(rows, width)`
produces clipped terminal rows. Both functions are also exported from
`toolcraft-design-rust/event-groups`.

`createTaskTree({capacity})` indexes tasks by ID, rejects cycles and caps retained
nodes (10,000 by default). `upsert(node)` adds or reparents a task, `remove(id)`
removes its subtree and `toggle(id)` hides or reveals descendants.
`rows(offset, height)` returns snapshots with depth and collapse state;
`renderTaskRows(rows, width)` adds indentation, status marks and optional durations.
Both functions are also exported from `toolcraft-design-rust/task-tree`.

`createRenderPerformanceMonitor({now, sampleSize})` tracks repaint dispatches,
render duration, pending input latency and coalesced requests. Call
`request(kind)`, `begin()` and `end(startedAt, {changedCells})` around rendering;
`snapshot()` returns bounded rolling percentiles and cumulative hitch counts.
`formatRenderPerformance(stats, width)` creates a clipped diagnostics row. The
`render-performance` subpath exports both functions and their snapshot types.
Frame rate measures dispatch activity, not terminal presentation.

Use `renderMenu({message, options, selectedIndex})` to render a menu snapshot with
optional hints. `renderSpinnerFrame({message, frame, timer})` cycles the frozen
`SPINNER_FRAMES`; `renderSpinnerStopped({message, code, timer, subtext})` shows the
final status. They follow `withOutputFormat` and are available through
`staticRender`, `static/index`, `static/menu`, `static/spinner` and the matching
`render-*` entry points. These renderers do not start timers or read input.

`escapeTerminalText(text)` from `toolcraft-design-rust/escape-terminal-text`
turns control characters and directional marks into visible `\uXXXX` escapes
without hiding the original content. Ordinary Unicode, combining marks and literal
punctuation remain unchanged, making filenames and labels safe to display.

`renderPlaintext(ast, options)` renders the public `MdNode` contract as readable
text. It supports heading/code/alert announcements, checked and ordered lists,
header-labelled table sentences, link expansion, optional frontmatter and ordered
footnotes. `PlaintextRenderOptions`, `MdNode` and code-token types are standalone
root exports. Use `renderMarkdownPlaintext(markdown, options)` to parse and render
a Markdown string directly.

The internal Markdown code highlighter now tokenizes the supported lexical,
data, style, line and markup languages in Rust, preserving source code units and
supplied token arrays. `terminal-markdown/parser/code-highlight` exposes
`highlightCodeBlock`. Non-string source objects and modified built-ins remain
outside the verified parity scope. End-to-end tokenization is currently slower
than the JavaScript implementation, so this checkpoint is not a performance swap.

`renderHtml(ast, options)` renders the same `MdNode` contract as HTML. It escapes
text and attributes, applies the existing URL-scheme policy, and supports task
lists, aligned tables, alerts and linked footnotes. Set `syntaxHighlight: true`
for native code tokenization, `showFrontmatter: true` to include metadata, or
`allowRawHtml: true` to include raw HTML nodes. All three default to false.
`HtmlRenderOptions` is a standalone root type. Use
`renderMarkdownHtml(markdown, options)` to parse and render a string directly.

`render(ast, options)` renders the AST for terminals with themed headings, nested
styles, quotes, alerts, lists, tables, code blocks and numbered footnotes. Tables
switch to stacked fields when they exceed the available width. Set `width` to a
positive finite number, `syntaxHighlight: true` for code colors, and
`showFrontmatter: true` to include metadata. Width defaults to the terminal width
or the design-system fallback. The root exports standalone `RenderOptions`.
`renderMarkdown(markdown, options)` parses and renders a string directly. Exotic
text objects, modified string intrinsics and deep-recursion/resource behavior still
require qualification before this additive package can replace the original.

`parse(markdown)` returns `{ast, frontmatter?}` with hidden UTF-8 source ranges.
YAML frontmatter uses the own Rust configuration parser, preserving shared
metadata identity in the returned document and frontmatter AST node. Missing
closing delimiters remain ordinary Markdown. Parser and renderer helpers are
available under the matching `terminal-markdown/*` subpaths, and
`render-markdown-plaintext` exposes the plaintext functions and options.
Use `getMarkdownDemo(name)` from `terminal-markdown/demo-content` for the default,
minimal, code-block, blockquote, list, table and alert examples.

```ts
import {parse, renderMarkdownHtml} from 'toolcraft-design-rust';

const {ast, frontmatter} = parse('---\ntitle: Status\n---\n# Ready');
const html = renderMarkdownHtml('# Ready\n\n- [x] Complete');
```

`packStyle({bold, dim, underline, inverse, fg, bg})` creates a packed terminal
style, and `styleToSgrDelta(previous, next, colors?)` emits the ANSI changes needed
to move between styles. The default respects `NO_COLOR` and `TERM=dumb`.
The `screen/style` subpath also exposes the four flag constants and
`foreground`/`background` channel readers. `PackedStyle` is a standalone type.
