# frontmatter-rust

Read and write YAML frontmatter while preserving the Markdown body and original
source positions. This private, additive package provides a compatible
TypeScript API backed by the own Rust YAML parser.

| API | Use |
| --- | --- |
| `splitFrontmatterBlock` | Extract raw frontmatter and its UTF-16 source offsets |
| `parseFrontmatter` | Read mappings, arrays, scalars and block strings |
| `parseFrontmatterDocument` | Return diagnostics and source line positions |
| `stringifyFrontmatter` | Write frontmatter with typed root/cycle errors |

```ts
import {parseFrontmatter, stringifyFrontmatter} from '@poe-code/frontmatter-rust';

const {frontmatter, body} = parseFrontmatter('---\ntitle: Hello\n---\n# Body');
const updated = stringifyFrontmatter({...frontmatter, published: true}, body);
```

Duplicate keys keep their last value by default. Use `{uniqueKeys: true}` to
reject them. YAML 1.2 is the default schema; a YAML 1.1 directive selects that
schema. BOMs and CR, LF or CRLF fences are supported, and the body retains its
original line endings. `FrontmatterParseError` reports parsing or stringify
failures; `FrontmatterKindError` also carries expected and found document kinds.

One native addon includes parsing, fence policy and YAML serialization, with
zero npm runtime dependencies. The Rust core uses the standard library and own
path crates. Host adapters handle JavaScript dates, getters, toJSON hooks and
iterators. Existing packages and production integrations remain unchanged.

The parser and serializer bound configuration depth at 512. Current SDK unit
cases pass, but YAML warnings, complex-key behavior and every diagnostic text
or recovery case are not fully matched. Cyclic YAML aliases are bounded and
rejected; shared objects are repeated without aliases when stringifying.
Performance and memory use depend on the document; Python bindings are not
included.
