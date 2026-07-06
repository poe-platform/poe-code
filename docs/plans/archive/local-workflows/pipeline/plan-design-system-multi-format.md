---
kind: pipeline
version: 1
mcp:
  terminal-pilot:
    command: npx
    args:
      - tsx
      - packages/terminal-pilot/src/mcp-server.ts
tasks:
  - id: foundation
    title: stripAnsi util + withOutputFormat scoped override
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 1)


      Package: `packages/design-system/src/`


      Two changes:


      1. Extract `stripAnsi` to `src/internal/strip-ansi.ts`.
         Currently duplicated in `src/components/table.ts` (line ~18) and `src/prompts/index.ts` (line ~7).
         Export it from the new file and replace both inline copies with imports.

      2. Add `withOutputFormat` to `src/internal/output-format.ts`.
         Use `AsyncLocalStorage` from `node:async_hooks` to store a scoped format override.
         `resolveOutputFormat()` must check the scoped store first, then fall back to env/cache.
         Export `withOutputFormat<T>(format: OutputFormat, fn: () => T): T`.

         ```typescript
         // output-format.ts additions
         import { AsyncLocalStorage } from "node:async_hooks";

         const formatStorage = new AsyncLocalStorage<OutputFormat>();

         export function resolveOutputFormat(env = process.env): OutputFormat {
           const scoped = formatStorage.getStore();
           if (scoped) return scoped;
           if (cached) return cached;
           const raw = env.OUTPUT_FORMAT?.toLowerCase();
           cached = VALID_FORMATS.has(raw as OutputFormat) ? (raw as OutputFormat) : "terminal";
           return cached;
         }

         export function withOutputFormat<T>(format: OutputFormat, fn: () => T): T {
           return formatStorage.run(format, fn);
         }
         ```

      Export `withOutputFormat` from `src/index.ts`.

      Tests: scoping (override applies inside fn), nesting (inner wins), async (AsyncLocalStorage
      propagates through await).
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: own-prompt-types
    title: Own interface definitions for interactive prompt types
    prompt: |
      Plan: `docs/plans/design-system-multi-format.md` (Phase 2 — type ownership)

      Package: `packages/design-system/src/prompts/`

      Currently our exported prompt types are hacked from clack internals:
      ```typescript
      export type SelectOptions<Value> = Parameters<typeof clack.select<Value>>[0];
      export type TextOptions = Parameters<typeof clack.text>[0];
      export type ConfirmOptions = Parameters<typeof clack.confirm>[0];
      export type PasswordOptions = Parameters<typeof clack.password>[0];
      ```

      Replace all four with explicit owned interfaces in `src/prompts/index.ts`:

      ```typescript
      export interface SelectOptions<Value> {
        message: string;
        options: Array<{ value: Value; label: string; hint?: string }>;
        initialValue?: Value;
      }
      export interface TextOptions {
        message: string;
        placeholder?: string;
        defaultValue?: string;
        initialValue?: string;
        validate?: (value: string) => string | undefined;
      }
      export interface ConfirmOptions {
        message: string;
        initialValue?: boolean;
      }
      export interface PasswordOptions {
        message: string;
        validate?: (value: string) => string | undefined;
      }
      ```

      The runtime implementations still call clack — only the exported types change.
      Verify TypeScript compiles cleanly (`npm run build -w @poe-code/design-system`).
      No test changes needed — this is a type-only change.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: primitive-log-cancel
    title: Own log and cancel primitives
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 2 — primitives)


      Package: `packages/design-system/src/prompts/primitives/`


      Create two files that replace the corresponding clack APIs. The terminal output must be

      visually identical to clack's current output — same box-drawing characters, same symbol

      placement, same spacing. We are replacing the implementation, not the design.


      **`src/prompts/primitives/log.ts`** — replaces `clack.log.message`, `clack.log.warn`,
      `clack.log.error`


      Terminal format (must match clack exactly):

      - `message(msg, symbol)`: writes `${symbol}  ${line}\n│  ${continuationLine}\n` for multi-line

      - `warn(msg)`: writes `▲  ${msg}\n` in yellow

      - `error(msg)`: writes `✕  ${msg}\n` in red


      Markdown format:

      - `message(msg, symbol)`: `- ${plainMsg}\n`

      - `warn(msg)`: `- **warning:** ${msg}\n`

      - `error(msg)`: `- **error:** ${msg}\n`


      JSON format (NDJSON):

      - `message(msg, symbol)`: `{"level":"message","message":"${stripped}"}\n`

      - `warn(msg)`: `{"level":"warn","message":"${msg}"}\n`

      - `error(msg)`: `{"level":"error","message":"${msg}"}\n`


      All functions write to `process.stdout.write`. Use `resolveOutputFormat()` to dispatch.

      Use the shared `stripAnsi` from `src/internal/strip-ansi.ts`.


      **`src/prompts/primitives/cancel.ts`** — replaces `clack.cancel` and `clack.isCancel`


      `isCancel(value)`: clack uses a Symbol to mark cancelled values. Import and re-export

      `isCancel` directly from `@clack/prompts` — we keep using clack's cancel symbol since

      it originates from clack's interactive prompts.


      `cancel(msg)`: terminal: writes `│\n└  ${msg}\n` in dim. Other formats: silent.


      Export both from `src/prompts/primitives/log.ts` and `src/prompts/primitives/cancel.ts`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: primitive-display
    title: Own intro, outro, note primitives
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 2 — primitives)


      Package: `packages/design-system/src/prompts/primitives/`


      Create three files. Terminal output must be visually identical to clack's current output.


      **`src/prompts/primitives/intro.ts`** — replaces `clack.intro`


      Terminal: writes `┌  ${styledText}\n` — the styled text comes from `text.intro(title)`.

      Markdown: writes `# ${stripped}\n\n`

      JSON: silent (no output)


      **`src/prompts/primitives/outro.ts`** — replaces `clack.outro`


      Terminal: writes `└  ${message}\n` in dim

      Markdown: writes `---\n${stripped}\n`

      JSON: writes `{"type":"outro","message":"${stripped}"}\n` (NDJSON)


      **`src/prompts/primitives/note.ts`** — replaces `clack.note`


      Terminal: renders a boxed note with `╭`, `│`, `╰` border characters. Title on top border.
        ```
        ╭  Title ──────────╮
        │  message line 1  │
        │  message line 2  │
        ╰──────────────────╯
        ```
      Markdown: writes blockquote:
        ```
        > **Title**
        > message line 1
        > message line 2
        ```
      JSON: writes `{"type":"note","title":"${title}","message":"${stripped}"}\n` (NDJSON)


      All functions use `resolveOutputFormat()` to dispatch and `stripAnsi` from
      `src/internal/strip-ansi.ts`.

      All write via `process.stdout.write`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: primitive-spinner
    title: Own spinner primitive
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 2 — primitives)


      Package: `packages/design-system/src/prompts/primitives/spinner.ts`


      Replaces `clack.spinner()`. The existing `withSpinner` in `src/prompts/index.ts` wraps

      clack's spinner and adds timer logic and fallback handling. Extract the spinner itself

      into an owned primitive that maintains the same interface as `clack.spinner()`:

      `{ start(message?): void; stop(message?, code?): void; message(message?): void }`


      The spinner uses these frames (already defined in `src/static/spinner.ts`): `["◒", "◐", "◓",
      "◑"]`


      Terminal:

      - `start(msg)`: renders animated frame using `setInterval` (16ms), clearing line on each tick
        via `\r\x1b[K`. Frame format: `${frame}  ${msg}\n`
      - `message(msg)`: updates the displayed message in-place

      - `stop(msg, code)`: clears spinner line, writes final line:
        - code 0 (success): `◆  ${msg}` in green
        - code non-zero (error): `■  ${msg}` in red
        - no code: `◆  ${msg}` in green

      Non-TTY / `POE_NO_SPINNER=1` fallback: no animation, just write start message then stop
      message.


      JSON: `start`/`message` are silent; `stop` writes NDJSON:
      `{"type":"spinner","state":"stopped","message":"${msg}"}\n`


      Markdown: `start` writes `- ${msg}...\n`; `stop` writes `- ${msg}\n`


      Note: `withSpinner` in `src/prompts/index.ts` contains the timer interval logic and

      format dispatch for the full async wrapper — keep that logic there, just replace the

      underlying `clack.spinner()` call with the new own spinner.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: wire-primitives
    title: Wire own primitives into prompts/index.ts and logger, screenshot validation
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 2 — wiring + regression check)


      Package: `packages/design-system/`


      Update `src/prompts/index.ts`:

      - Replace `clack.intro(...)` calls with the own `intro` primitive from
      `src/prompts/primitives/intro.ts`

      - Replace `clack.outro(...)` with own `outro` primitive

      - Replace `clack.note(...)` with own `note` primitive

      - Replace `clack.cancel(...)` with own cancel primitive

      - Replace `clack.isCancel(...)` with own `isCancel` from cancel primitive

      - Replace `clack.spinner()` inside `withSpinner` with own spinner primitive

      - Keep `clack.select`, `clack.text`, `clack.confirm`, `clack.password` — these stay on clack

      - Keep `export { isCancel, cancel, log } from "@clack/prompts"` only for the parts still on
      clack
        (actually `isCancel` now comes from own primitive — update this export too)

      Update `src/components/logger.ts`:

      - Replace `import { log } from "@clack/prompts"` with own log primitive

      - Replace `log.message(...)`, `log.warn(...)`, `log.error(...)` calls with own primitive

      - The format dispatch in logger (currently `if (resolveOutputFormat() !== "terminal")`) can
        be removed since the own log primitive handles all formats internally

      Also update the demo scripts (`scripts/demo.ts`, `layouts/*.ts`) to not import from

      `@clack/prompts` directly — use our own prompts exports instead.


      **Visual regression check — MUST pass before committing:**


      Run all design element screenshots and compare to baseline:

      ```sh

      npm run generate:design-docs

      ```

      Then run poe-code command screenshots:

      ```sh

      npm run screenshot-poe-code -- --help

      npm run screenshot-poe-code -- configure --yes

      npm run screenshot-poe-code -- models

      ```


      The terminal output must look identical to pre-change screenshots.

      Fix any visual differences before committing.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: text-symbols-format
    title: Format-aware text.* and symbols
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 3)


      Files:

      - `packages/design-system/src/components/text.ts`

      - `packages/design-system/src/components/symbols.ts`


      **text.ts** — each function dispatches on `resolveOutputFormat()`:


      | Function | terminal | markdown | json |

      |----------|----------|----------|------|

      | `intro(s)` | `theme.intro(s)` | `**${s}**` | `s` |

      | `heading(s)` | `theme.header(s)` | `## ${s}` | `s` |

      | `section(s)` | `typography.bold(s)` | `**${s}**` | `s` |

      | `command(s)` | `theme.accent(s)` | `` `${s}` `` | `s` |

      | `argument(s)` | `theme.muted(s)` | `<${s}>` | `s` |

      | `option(s)` | `chalk.yellow(s)` | `` `${s}` `` | `s` |

      | `example(s)` | `theme.muted(s)` | `` `${s}` `` | `s` |

      | `usageCommand(s)` | `chalk.green(s)` | `` `${s}` `` | `s` |

      | `link(s)` | `theme.accent(s)` | `[${s}](${s})` | `s` |

      | `muted(s)` | `theme.muted(s)` | `*${s}*` | `s` |

      | `badge(s)` | `theme.badge(s)` | `[${s}]` | `s` |

      | `selectLabel(l,d)` | current | `${l} — ${d}` | `${l} — ${d}` |


      Pattern for each function:

      ```typescript

      heading(content: string): string {
        const format = resolveOutputFormat();
        if (format === "json") return content;
        if (format === "markdown") return `## ${content}`;
        return getTheme().header(content);
      },

      ```


      **symbols.ts** — each getter/property dispatches on format:


      | Symbol | terminal | markdown | json |

      |--------|----------|----------|------|

      | `info` | `chalk.magenta("●")` | `(i)` | `info` |

      | `success` | `chalk.magenta("◆")` | `[ok]` | `success` |

      | `resolved` | `theme.resolvedSymbol` | `>` | `resolved` |

      | `errorResolved` | `theme.errorSymbol` | `[!]` | `error` |

      | `warning` | `▲` | `[!]` | `warning` |

      | `active` | `◆` | `[x]` | `active` |

      | `inactive` | `○` | `[ ]` | `inactive` |

      | `bar` | `│` | `\|` | `` (empty string) |


      `help-formatter` and `command-errors` delegate to `text.*` so get format support
      automatically.


      After implementing: re-run baseline screenshots for `--help` and `configure --yes` to confirm

      terminal output is unchanged. Then verify markdown output:

      ```sh

      OUTPUT_FORMAT=markdown npm run dev -- --help

      ```
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: acp-static-format
    title: Format dispatch for acp/components and static renderers
    prompt: |
      Plan: `docs/plans/design-system-multi-format.md` (Phase 4)

      Files:
      - `packages/design-system/src/acp/components.ts`
      - `packages/design-system/src/static/spinner.ts`
      - `packages/design-system/src/static/menu.ts`

      **acp/components.ts** — add `resolveOutputFormat()` dispatch to every render function.
      Currently all write directly to stdout with chalk. Add format branching:

      Markdown format:
      ```
      renderAgentMessage(text)  → "- **agent:** ${text}\n"
      renderToolStart(kind, title) → "- *→ ${kind}: ${title}*\n"
      renderToolComplete(kind)  → "- *✓ ${kind}*\n"
      renderReasoning(text)     → "- *thinking:* ${truncated}\n"
      renderUsage(tokens)       → "- **tokens:** ${input} in → ${output} out${cost}\n"
      renderError(message)      → "- **error:** ${message}\n"
      ```

      JSON format (NDJSON):
      ```
      renderAgentMessage(text)     → {"type":"agent","message":"..."}\n
      renderToolStart(kind, title) → {"type":"tool_start","kind":"...","title":"..."}\n
      renderToolComplete(kind)     → {"type":"tool_complete","kind":"..."}\n
      renderReasoning(text)        → {"type":"reasoning","text":"..."}\n
      renderUsage(tokens)          → {"type":"usage","input":N,"output":N,"cached":N,"costUsd":N}\n
      renderError(message)         → {"type":"error","message":"..."}\n
      ```

      **static/spinner.ts** — add format branches to `renderSpinnerFrame` and `renderSpinnerStopped`:

      Markdown:
      - `renderSpinnerFrame({message, timer})` → `- ${message}${timer ? ` [${timer}]` : ''}...\n`
      - `renderSpinnerStopped({message, timer})` → `- ${message}${timer ? ` [${timer}]` : ''}\n`

      JSON:
      - `renderSpinnerFrame(opts)` → `{"type":"spinner","state":"running","message":"...","timer":"..."}\n`
      - `renderSpinnerStopped(opts)` → `{"type":"spinner","state":"stopped","message":"...","timer":"..."}\n`

      **static/menu.ts** — add format branches to `renderMenu`:

      Markdown:
      ```
      **${message}**
      - [x] Selected option
      - [ ] Other option
      ```

      JSON:
      ```json
      {"type":"menu","message":"...","options":[{"value":"...","label":"...","hint":"..."}],"selected":0}
      ```

      All dispatch via `resolveOutputFormat()`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: design-docs-multiformat
    title: Generate DESIGN_LANGUAGE_MARKDOWN and DESIGN_LANGUAGE_JSON docs
    prompt: >
      Plan: `docs/plans/design-system-multi-format.md` (Phase 5)


      Package: `packages/design-system/scripts/generate-docs.ts`


      The existing script at `packages/design-system/scripts/generate-docs.ts` generates

      `docs/DESIGN_LANGUAGE.md` with terminal-format screenshots by running each demo element

      via `npm run screenshot -- --no-header -o <path> npm run demo ...`.


      Extend it to also generate:

      - `docs/DESIGN_LANGUAGE_MARKDOWN.md` — text output of all demo elements with
      `OUTPUT_FORMAT=markdown`

      - `docs/DESIGN_LANGUAGE_JSON.md` — text output of all demo elements with `OUTPUT_FORMAT=json`


      For markdown/json variants, don't take screenshots — capture plain text output instead

      (since there's no color to render). Run each demo element with the env var set and embed

      the output in a fenced code block in the doc.


      Pattern:

      ```typescript

      function captureTextOutput(demoArgs: string, format: "markdown" | "json"): string {
        const result = execSync(
          `npm run demo -w @poe-code/design-system -- ${demoArgs}`,
          { cwd: ROOT_DIR, env: { ...process.env, OUTPUT_FORMAT: format } }
        );
        return result.toString();
      }

      ```


      The markdown doc sections mirror DESIGN_LANGUAGE.md structure but use code blocks for output.

      The json doc shows NDJSON output for each element.


      Also add `generate:design-docs:markdown` and `generate:design-docs:json` scripts to

      `packages/design-system/package.json`, and a combined `generate:design-docs:all` that

      runs all three. Update root `package.json` to expose `generate:design-docs:all`.


      After generating, visually review each doc to confirm the outputs make sense.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# design system multi format

Archived local pipeline plan converted from YAML during docs cleanup.
