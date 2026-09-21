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
const buffer = dashboard.createStreamingDashboardLineBuffer((text, id) => {
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
