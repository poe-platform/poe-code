# @poe-code/frontmatter

Shared YAML frontmatter parsing for poe-code packages.

## API

```ts
import {
  FrontmatterParseError,
  parseFrontmatter,
  parseFrontmatterDocument,
  stringifyFrontmatter
} from "@poe-code/frontmatter";
```

- `parseFrontmatter(source)` returns `{ frontmatter, body }`.
- `parseFrontmatterDocument(source)` returns `{ frontmatter, body, errors, lineCounter }` for callers that need YAML diagnostics.
- `stringifyFrontmatter(frontmatter, body)` writes `---` fences, YAML, and the body.
- `FrontmatterParseError` is thrown for malformed frontmatter, invalid YAML, non-object frontmatter, and stringify failures.

When no leading frontmatter block exists, parsing returns `{ frontmatter: {}, body: source }`.
The returned `body` is sliced from the original input and is otherwise byte-for-byte unchanged.
YAML mappings that contain `__proto__` keep it as an own property without changing the object's prototype.

Duplicate mapping keys use YAML's last-wins behavior by default, matching the
legacy frontmatter readers. Callers that need strict YAML mappings can pass
`{ uniqueKeys: true }` to `parseFrontmatter` or `parseFrontmatterDocument`.

## Environment Variables

This package reads no environment variables.

## Configuration Options

This package has no configuration options.
