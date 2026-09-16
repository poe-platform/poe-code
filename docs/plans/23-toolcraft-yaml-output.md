---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Toolcraft YAML Output

Add a first-class YAML output mode to Toolcraft CLI rendering.

## 1. What We're Building

Toolcraft already supports structured command results:

- `defineCommand({ result: ... })` feeds MCP `outputSchema`.
- MCP calls with `result:` return validated `structuredContent`.
- CLI output modes are currently `rich`, `md`, and `json`.
- `packages/toolcraft` already depends on `yaml`.

This plan adds `yaml` as an explicit CLI output mode:

```sh
toolcraft-command --output yaml
toolcraft-command --yaml
```

YAML mode is for human-readable structured data in terminals, docs, and agent
transcripts. It is not a replacement for `--json`.

## 2. User-Facing Shape

Supported output selectors:

| Selector                                                 | Mode   |
| -------------------------------------------------------- | ------ |
| default                                                  | `rich` |
| `--json`                                                 | `json` |
| `--md`, `--markdown`, `--output md`, `--output markdown` | `md`   |
| `--yaml`, `--output yaml`                                | `yaml` |

Rendering rules:

- objects and arrays render as YAML in `yaml` mode;
- strings render as plain strings;
- `null` and `undefined` render as `ok: true`, matching the current JSON-mode success shape;
- BigInt values render as strings, matching existing JSON behavior;
- custom command renderers may add `render.yaml` later, but v1 can use the automatic renderer only.

MCP text content stays JSON for typed results. Existing MCP clients and tests
already rely on the JSON text backstop next to `structuredContent`.

## 3. Implementation Details

Touch only `packages/toolcraft`.

Required changes:

- Extend `OutputMode` in `packages/toolcraft/src/renderer.ts` to include `yaml`.
- Add a `stringifyYaml` helper that uses the existing `yaml` dependency and keeps the BigInt string conversion behavior.
- Update `autoRender` so `output === "yaml"` renders structured values with YAML.
- Add `--yaml` as a root output flag.
- Update `resolveOutput`, `resolveOutputFromArgv`, and `resolveHelpOutput` to accept `yaml`.
- Map `yaml` to a design-system output format. Use `markdown` unless the design system grows a dedicated YAML mode.
- Update `packages/toolcraft/README.md` output rendering docs.

Do not change MCP structured output behavior in this plan.

## 4. Interfaces And Tests

TDD targets:

- `packages/toolcraft/src/renderer.test.ts`
  - renders plain objects as YAML;
  - renders arrays as YAML;
  - renders BigInt values as strings;
  - renders `null`/`undefined` as `ok: true`;
  - preserves current `rich`, `md`, and `json` output.
- `packages/toolcraft/src/cli.test.ts`
  - `--yaml` selects YAML mode;
  - `--output yaml` selects YAML mode;
  - `--output=YAML` is rejected or ignored consistently with other invalid values;
  - help output recognizes `--output yaml`.
- Existing MCP runtime tests must stay green and continue expecting JSON text next to `structuredContent`.

Validation:

```sh
npx vitest run packages/toolcraft/src/renderer.test.ts packages/toolcraft/src/cli.test.ts packages/toolcraft/src/mcp-runtime-options.test.ts
npm run lint:packages
```

Manual spot check after implementation:

```sh
npm run dev -- <toolcraft-backed-command> --output yaml
```

## 5. Code Plan

1. Add failing renderer tests for YAML mode.
2. Add failing CLI flag tests for `--yaml` and `--output yaml`.
3. Extend `OutputMode`, CLI parsing, and design-system output mapping.
4. Implement YAML rendering in `autoRender`.
5. Update Toolcraft README.
6. Run the targeted tests and package lint.
