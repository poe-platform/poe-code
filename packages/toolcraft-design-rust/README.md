# toolcraft-design-rust

Compose agent prompts and configuration templates with an own Rust core and no
npm runtime dependencies. This private additive package keeps your current design
system integrations intact.

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

This supplies template composition, dashboard geometry and bounded output ownership. The complete dashboard
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
