---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Shared frontmatter library

One `@poe-code/frontmatter` package wrapping the `yaml` library, used everywhere, replacing the seven duplicated frontmatter parsers.

## 1. What we're building

A shared `@poe-code/frontmatter` package that wraps the `yaml` library and becomes the single frontmatter parser used across the repo, replacing the duplicated implementations and removing the hand-rolled subset parser.

The bug this kills: two parsers disagreeing on the same file. The `toolcraft-design` `YamlSubsetParser` cannot read YAML block scalars (`|`) that the `yaml`-backed `github-workflows` parser reads fine. The maestro daemon loads `WORKFLOW.md` through the subset parser (via `markdown-reader`) while the `tasks` CLI loads the same file through the `yaml`-backed parser — so a config the CLI accepts, the daemon rejects.

Current parsers (all parse the same `--- ... ---` frontmatter shape):

| Module | Export(s) | YAML engine |
| --- | --- | --- |
| `packages/toolcraft-design/src/terminal-markdown/parser/frontmatter.ts` | `extractFrontmatter`, via `parse` | hand-rolled `YamlSubsetParser` (no dep) |
| `packages/markdown-reader/src/core/document.ts` | `loadMarkdownDocument` | `toolcraft-design` `parse` + `yaml` `parseDocument` (errors only) |
| `packages/github-workflows/src/frontmatter.ts` | `parseFrontmatter` | `yaml` |
| `packages/memory/src/frontmatter.ts` | `parseFrontmatter`, `serializeFrontmatter`, `parseSourceRef`, `serializeSourceRef` | `yaml` (parse + stringify) |
| `packages/ralph/src/frontmatter/frontmatter.ts` | `parseFrontmatter`, `writeFrontmatter`, `parseFrontmatterData` | `yaml` (parse + stringify) |
| `packages/superintendent/src/document/parse.ts` | `parseSuperintendentDoc`, `readExplicitBuilderAgent` | `yaml` `parseDocument` (line-aware) |
| `packages/agent-script/src/loader/frontmatter.ts` | `splitFrontmatter` | `js-yaml` |

Non-goals:

- Not replacing domain schema validation. `superintendent` and `ralph` keep their `JsonSchema` definitions and validators; the shared library returns parsed data only.
- Not writing a new YAML parser. The shared library wraps `yaml`; it does not reimplement YAML.
- Not changing `toolcraft-design`'s markdown AST or terminal rendering beyond how it obtains frontmatter.
- Not preserving the `{ raw: <block> }` fallback shape. Malformed frontmatter throws a typed error instead.

This plan removes the temporary block-scalar support added to `YamlSubsetParser` to unblock maestro; the subset parser is deleted entirely.

## 2. User-facing shape

Library import and usage:

```ts
import { parseFrontmatter, stringifyFrontmatter } from "@poe-code/frontmatter";

// parse: split fences, parse YAML, return body verbatim
const { frontmatter, body } = parseFrontmatter(source);
// frontmatter: Record<string, unknown>  (empty object when no frontmatter block)
// body: string                          (the markdown after the closing fence, verbatim)

// stringify: serialize a frontmatter object + body back to a document
const doc = stringifyFrontmatter({ title: "Hello" }, "# Body\n");
// "---\ntitle: Hello\n---\n# Body\n"
```

Block scalars work because `yaml` handles them:

```ts
parseFrontmatter("---\nprompt: |\n  line one\n\n  line two\n---\nBody").frontmatter;
// { prompt: "line one\n\nline two\n" }
```

Line-aware parsing for callers that report positions (superintendent):

```ts
import { parseFrontmatterDocument } from "@poe-code/frontmatter";

const doc = parseFrontmatterDocument(source);
// { frontmatter, body, errors: YamlError[], lineCounter }  — wraps yaml's Document
```

Error shape:

```ts
import { FrontmatterParseError } from "@poe-code/frontmatter";

try {
  parseFrontmatter(badSource);
} catch (e) {
  // e instanceof FrontmatterParseError; e.message includes the yaml reason
}
```

README documents: the three entry points, that the body is returned byte-for-byte, that an absent frontmatter block yields `{ frontmatter: {}, body: source }`, and that `__proto__` keys are kept as own properties without prototype mutation.

## 3. Implementation details and technical decisions

- **Location:** `packages/frontmatter`. Runtime dep: `yaml`. No other deps.
- **Fence handling:** one implementation of fence detection (`---` open/close), BOM stripping, and CRLF/CR normalization, replacing the several `readLine`/`startsWithFrontmatterFence` copies. Body is sliced from immediately after the closing fence and returned unchanged.
- **Parse:** `yaml.parse` for the data path; `yaml.parseDocument` behind `parseFrontmatterDocument` for the line-aware path. Non-object frontmatter (a bare scalar or array between fences) is a `FrontmatterParseError`.
- **Stringify:** `yaml.stringify` for the frontmatter block, re-fenced and concatenated with the body. Covers `memory.serializeFrontmatter` and `ralph.writeFrontmatter`.
- **Prototype safety:** parsed mappings must expose `__proto__` as an own property without mutating the prototype (preserve `toolcraft-design`'s existing guarantee). Verify `yaml`'s output and, if needed, rebuild the top-level object with `Object.defineProperty`.
- **toolcraft-design:** `extractFrontmatter` delegates to `@poe-code/frontmatter`; `YamlSubsetParser` and its tokenizer are deleted. This adds `@poe-code/frontmatter` (transitively `yaml`) to `toolcraft-design`, which today depends only on `@clack/prompts`. Accepted tradeoff: correctness over a lean dependency set; `yaml` is dependency-free.
- **markdown-reader:** drops the `parse` + `parseDocument`-for-errors dance; calls the shared library directly and keeps returning `{ frontmatter, sections }`.
- **agent-script:** migrates off `js-yaml`; the `js-yaml` dependency is removed.
- **Edge cases:** empty document; no frontmatter block; empty frontmatter block (`---\n---`); frontmatter with trailing/leading blank lines; cyclic objects passed to stringify (let `yaml` throw, wrap as `FrontmatterParseError`); duplicate keys (yaml's default — last wins, no throw).
- No flags, env vars, or config. Pure library.

## 4. Interfaces and test plan

Module boundary:

```ts
export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}
export function parseFrontmatter(source: string): ParsedFrontmatter;
export function stringifyFrontmatter(frontmatter: Record<string, unknown>, body: string): string;

export interface ParsedFrontmatterDocument extends ParsedFrontmatter {
  errors: readonly { message: string; pos?: [number, number] }[];
}
export function parseFrontmatterDocument(source: string): ParsedFrontmatterDocument;

export class FrontmatterParseError extends Error {}
```

Tests:

- **Unit (`packages/frontmatter`):** simple scalars/typed values; nested objects + arrays; quoted + special-character scalars; double-quoted escape decoding; literal block scalars `|`, `|-`, `|+`; folded `>`; `__proto__` own-property safety; cyclic-data stringify error; round-trip `parse(stringify(x)) === x`; no-frontmatter and empty-frontmatter inputs. Port the existing `extractFrontmatter` cases from `toolcraft-design` so coverage is not lost. Proves the shared parser matches prior behavior and adds block scalars.
- **Integration (per migrated consumer):** existing suites for `toolcraft-design`, `markdown-reader`, `github-workflows`, `memory`, `ralph`, `superintendent`, `agent-script` pass unchanged against the new import. Proves no behavioral regression.
- **Regression (maestro):** parsing the `gh-issues` `WORKFLOW.md` with block-scalar prompts through `markdown-reader` returns the expected `states`. Proves the original bug is fixed.
- Tests use `memfs` where files are read; no real LLM calls.

Rollout / migration: land the package first, then migrate one consumer per commit (each green), then delete `YamlSubsetParser` and drop unused `yaml`/`js-yaml` direct deps in migrated packages. `package-lint` confirms no package imports a YAML engine directly except `@poe-code/frontmatter`.

Autonomy checklist:

- New package builds under `turbo run build` and is added to the workspace.
- Each consumer's existing test command passes after migration.
- `npm run dev -- maestro run --config maestro/github-issues/WORKFLOW.md --dry-run` validates.
- No direct `from "yaml"` / `from "js-yaml"` imports remain outside `@poe-code/frontmatter` (assert via `package-lint`/grep).
- `toolcraft-design` no longer references `YamlSubsetParser`.

## 5. Code plan

Create:

- `packages/frontmatter/package.json` — name `@poe-code/frontmatter`, dep `yaml`.
- `packages/frontmatter/README.md` — entry points, body-verbatim guarantee, env/config (none).
- `packages/frontmatter/src/fences.ts` — `splitFrontmatterBlock(source): { raw: string; body: string } | { body: string }`, BOM/CRLF handling.
- `packages/frontmatter/src/parse.ts` — `parseFrontmatter`, `parseFrontmatterDocument`, `FrontmatterParseError`, prototype-safety normalization.
- `packages/frontmatter/src/stringify.ts` — `stringifyFrontmatter`.
- `packages/frontmatter/src/index.ts` — public exports.
- `packages/frontmatter/src/*.test.ts` — unit suites above.

Change:

- `packages/toolcraft-design/.../frontmatter.ts` — `extractFrontmatter` delegates to `@poe-code/frontmatter`; delete `YamlSubsetParser`, `tokenizeYamlBlock`, `parseKeyValue`, `parseScalar`, and helpers (including the temporary block-scalar bridge). Add dep.
- `packages/markdown-reader/src/core/document.ts` — use shared library; drop `parseDocument`-for-errors logic.
- `packages/github-workflows/src/frontmatter.ts` — re-export or thin-wrap shared `parseFrontmatter`; keep `ParsedFrontmatter` name for callers.
- `packages/memory/src/frontmatter.ts` — `parseFrontmatter`/`serializeFrontmatter` delegate; keep `parseSourceRef`/`serializeSourceRef`.
- `packages/ralph/src/frontmatter/frontmatter.ts` — `parseFrontmatter`/`writeFrontmatter` delegate; keep `RalphFrontmatter` schema + `parseFrontmatterData`.
- `packages/superintendent/src/document/parse.ts` — use `parseFrontmatterDocument` for line-aware errors; keep schema + domain mapping.
- `packages/agent-script/src/loader/frontmatter.ts` — `splitFrontmatter` delegates; remove `js-yaml`.

Build order (branch stays green):

1. Create `@poe-code/frontmatter` with full tests.
2. Migrate `github-workflows`, `memory`, `ralph`, `agent-script` (leaf consumers), one commit each.
3. Migrate `markdown-reader`, then `toolcraft-design`; delete `YamlSubsetParser`.
4. Migrate `superintendent`.
5. Drop now-unused `yaml`/`js-yaml` direct deps; add `package-lint` assertion.
