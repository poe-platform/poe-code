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

This is the template foundation of the design rewrite. Other design components
and existing application integrations are not included yet. Rendering remains slower than the JavaScript implementation. In one Node 22
ARM64 measurement, a 256-item section takes about 216 µs through the data path,
765 µs through callbacks and 38 µs in JavaScript. Small views can cost more to
capture than callbacks save. No speedup over JavaScript or memory reduction is
claimed for these bindings. It uses self-contained native
artifacts and Node built-ins only.
