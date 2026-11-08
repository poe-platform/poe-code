# toolcraft-template-rust

Render prompt and configuration templates with an own Rust core and no npm runtime
dependencies. This private package provides the template engine shared by the
additive Rust design and configuration packages.

| API | Use |
| --- | --- |
| `renderTemplate` | Render escaped variables, sections, lambdas and partials |
| `getTemplatePartialNames` | Discover referenced partials in encounter order |
| `resolveTemplatePartials` | Expand nested partials with cycle diagnostics |

```ts
import {renderTemplate} from 'toolcraft-template-rust';

const prompt = renderTemplate('Hello {{name}}', {name: 'Ada'});
const config = renderTemplate('{{value}}', {value: '<raw>'}, {escape: 'none'});
```

`TemplateParseError` carries the description, line and column of malformed syntax.
The UTF-16 core preserves JavaScript string positions; host adapters retain
getters, coercion, lambda receivers and iterator cleanup. The Rust library and
shared native binding can be embedded without depending on the design package.
