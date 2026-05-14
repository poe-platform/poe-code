---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Design-system own prompts (drop @clack/prompts)

Replace `@clack/prompts` with an in-repo prompts implementation so `poe-code` runs on Node 18.

## 1. What we're building

Remove the `@clack/prompts` (and transitive `@clack/core`) dependency. Roll our own interactive prompts inside `@poe-code/design-system`, heavily inspired by clack's UX (same glyphs, same key handling), but written against Node 18-compatible APIs only.

Non-goals:
- Do not change the public API surface exported from `@poe-code/design-system`. All current callers (in `src/cli/**`, `packages/**`) keep working without edits.
- Do not implement prompt variants we don't already use: autocomplete, group-multiselect, date, select-by-key. Only `text`, `password`, `confirm`, `select`, `multiselect`.
- Do not change the already-in-house primitives: `intro`, `outro`, `note`, `log`, `spinner`, `cancel`. Only the inputs that still proxy to clack get replaced.

## 2. User-facing shape

Identical to today — same import paths, same signatures, same on-screen rendering.

```ts
import { text, confirm, select, multiselect, password, isCancel } from "@poe-code/design-system";

const name = await text({ message: "Project name?", placeholder: "my-app" });
if (isCancel(name)) process.exit(0);

const ok = await confirm({ message: "Continue?", initialValue: true });

const pick = await select({
  message: "Choose a model",
  options: [
    { value: "opus", label: "Claude Opus 4.7" },
    { value: "sonnet", label: "Claude Sonnet 4.6", hint: "faster" }
  ]
});

const picks = await multiselect({
  message: "Workflows to enable",
  options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
  required: true
});

const token = await password({ message: "API key" });
```

Rendered terminal output keeps the clack look:

```
┌  Configure
│
◆  Project name?
│  my-app_
└

◇  Continue? · yes / no
│
●  opus    Claude Opus 4.7
○  sonnet  Claude Sonnet 4.6 (faster)
```

Cancellation: Ctrl-C / Esc resolves the prompt with a sentinel `Symbol("poe.cancel")`. `isCancel(value)` returns `true` for that symbol.

Node engine: `engines.node` becomes `">=18.18"` in the root and design-system `package.json`.

## 3. Implementation details and technical decisions

**Where the code lives**

```
packages/design-system/src/prompts/
  index.ts                        # public wrappers — already exists; rewire to local impls
  theme.ts                        # already exists
  primitives/                     # already exists (intro/outro/note/log/spinner/cancel)
    cancel.ts                     # stop re-exporting isCancel from @clack/prompts
  interactive/                    # NEW — owned input prompts
    core.ts                       # base Prompt class (render loop, keypress, raw mode)
    keys.ts                       # keypress → action mapping (up/down/space/enter/cancel)
    text.ts
    password.ts
    confirm.ts
    select.ts
    multiselect.ts
    glyphs.ts                     # unicode/ASCII glyphs (◆ ◇ ● ○ ■ ▲ │ └ ┌)
    width.ts                      # visible-width helper (uses stripAnsi + basic CJK widths)
    cancel-symbol.ts              # export const CANCEL = Symbol.for("poe.cancel"); isCancel
```

**Dependencies**

- Add: `sisteransi` (cursor/erase escape sequences; already a transitive dep of clack — pull it in directly).
- Keep: `chalk` (already a peer dep of design-system).
- Reuse: existing `stripAnsi` helper at `packages/design-system/src/internal/strip-ansi.ts`.
- Drop: `@clack/prompts` from root `package.json`, `packages/design-system/package.json`, and any other workspace package listing it.

No `node:util` `styleText` or `stripVTControlCharacters` (those are the Node 22-only APIs that block Node 18). All color via `chalk`; all VT-strip via the existing `stripAnsi`.

**Core prompt loop (`interactive/core.ts`)**

A tiny base class adapted from clack-core. Responsibilities:
- Set raw mode on `process.stdin` (TTY only). Enable `readline.emitKeypressEvents`. Hide cursor with `sisteransi`.
- Maintain `state: "initial" | "active" | "submit" | "cancel" | "error"`.
- On each keypress: update internal value, run `validate` if present (on Enter), call `render()`, and diff the previous frame so we only repaint the changed lines (use `sisteransi.cursor.move` + `erase.lines`).
- On Ctrl-C / Esc: set `state = "cancel"`, restore TTY, resolve with the `CANCEL` symbol.
- On Enter: set `state = "submit"`, restore TTY, resolve with `value`.
- Always restore raw mode and show cursor in a `finally` so a thrown render or external abort doesn't wedge the terminal.
- Non-TTY fallback: detect `!process.stdin.isTTY` and either (a) for `text`/`password`, read one line with `readline.createInterface` (no masking for password — same behavior as today since clack does the same in CI); (b) for `select`/`confirm`/`multiselect`, return `initialValue` (or first option) when `POE_NO_PROMPT=1`, otherwise throw a clear error explaining the prompt needs a TTY.

**Cancel sentinel**

`Symbol.for("poe.cancel")` (registry symbol) so equality works across module instances if duplicated in node_modules. `isCancel(v): v is symbol` checks `typeof v === "symbol" && v === CANCEL`.

**Edge cases**

- Windows: keep `setRawMode(false)` no-op safe; do not call `setRawMode` if `!stdin.isTTY`.
- SIGINT during a prompt: install a one-shot listener that calls our cancel path, then `process.exit(130)` if no prompt is active (match clack semantics).
- Resize: re-render on `process.stdout.on("resize")`.
- Long options lists in `select` / `multiselect`: paginate with a fixed window (default 10 visible) and `…` markers, matching the current clack behavior closely enough that users don't notice the swap.
- `validate` returning a non-string truthy value: coerce via `String(err)` like clack does.
- `text` `defaultValue`: applied on submit when the buffer is empty (matches clack).
- `password` masking: render `•` per char; `validate` runs on submit; never echo to stdout in non-TTY mode beyond a single newline.

**Config / env vars**

- `POE_NO_SPINNER=1` — already exists, unchanged.
- `POE_NO_PROMPT=1` — NEW. When set in non-TTY contexts, prompts return their default/initial value instead of throwing. Used by CI.
- No new config schema entries.

## 4. Interfaces and test plan

**Module-boundary types** (unchanged from today — keep `packages/design-system/src/prompts/index.ts` signatures intact)

```ts
// In packages/design-system/src/prompts/interactive/cancel-symbol.ts
export const CANCEL: unique symbol;
export function isCancel(value: unknown): value is typeof CANCEL;

// In packages/design-system/src/prompts/interactive/core.ts
export interface PromptOptions<T> {
  render: (state: PromptState<T>) => string;
  initialValue?: T;
  validate?: (value: T) => string | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}
export interface PromptState<T> {
  state: "initial" | "active" | "submit" | "cancel" | "error";
  value: T;
  error: string;
  cursor: number;
  userInput: string;
}
export class Prompt<T> {
  constructor(opts: PromptOptions<T>);
  prompt(): Promise<T | typeof CANCEL>;
}

// In each interactive/*.ts file (one per prompt type)
export function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL>;
export function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL>;
export function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
export function selectPrompt<V>(opts: SelectOptions<V>): Promise<V | typeof CANCEL>;
export function multiselectPrompt<V>(opts: MultiselectOptions<V>): Promise<V[] | typeof CANCEL>;
```

The wrappers in `prompts/index.ts` continue to export `select`, `text`, `confirm`, `password`, `multiselect` with the same signatures as today — they just call the local `*Prompt` instead of `clack.*`. `MultiselectOptions` type loses its `Parameters<typeof clack.multiselect>` derivation and becomes an explicit interface; same for `TextOptions`.

**Tests**

Unit (`packages/design-system/src/prompts/interactive/*.test.ts`) — vitest, no real TTY. Drive each prompt with a `PassThrough` for stdin and a buffer-capturing writable for stdout. For each prompt type:

- `text`: typing characters → submit returns string; empty + defaultValue → returns default; validate failure → state goes to "error", error message rendered, next Enter re-validates.
- `password`: keystrokes render as `•`; submit returns the actual buffer; validate runs on submit.
- `confirm`: arrow keys flip value; y / n shortcuts work; Enter submits; default value applied on initial render.
- `select`: up/down cycle; cursor wraps at boundaries; Enter returns the focused option's value; disabled options skip.
- `multiselect`: space toggles; `required: true` blocks empty submit with the standard error string; Enter submits the array.
- All five: Ctrl-C / Esc → resolved value is `CANCEL` and `isCancel(result) === true`.

Unit (`packages/design-system/src/prompts/interactive/cancel-symbol.test.ts`): `isCancel(CANCEL) === true`; `isCancel("foo") === false`; `Symbol.for("poe.cancel") === CANCEL`.

Update existing `packages/design-system/src/prompts/prompts.test.ts`: drop `vi.mock("@clack/prompts", ...)` and mock the new local primitives instead. The `confirmOrCancel` tests still exercise the same wrapper behavior.

Engine check: add a smoke script `packages/design-system/scripts/check-node18.mjs` that imports the prompts module and runs `text` against a piped stdin under `nvm exec 18.18 node` — wired into CI later, not required for first merge. Manual run documented in the package README.

Manual QA (`docs/plans/qa/27-design-system-own-prompts.md`): list of terminal sessions to walk through — happy path for each prompt, cancel via Ctrl-C, validate error, resize mid-prompt, non-TTY pipe-in. Markdown checklist, no script.

**Rollout**

- One PR. Public API unchanged ⇒ no migration for consumers.
- After merge, bump `engines.node` to `>=18.18` in root and design-system `package.json`, drop the Node 22 floor from any workflow `setup-node` actions that pin newer.

**Autonomy checklist**

- Build green: `npm run build` (turbo) and `npm run lint:types`.
- Test green: `npm run test` and `(cd packages/design-system && npm test)`.
- `grep -rn "@clack/prompts" packages src` returns no matches.
- `npm ls @clack/prompts` is empty.
- `npm run dev -- configure` walks through prompts visually.
- `npm run screenshot-poe-code -- configure --help` regenerates cleanly.

## 5. Code plan

**New files**

- `packages/design-system/src/prompts/interactive/cancel-symbol.ts` — `CANCEL` symbol + `isCancel`.
- `packages/design-system/src/prompts/interactive/keys.ts` — `mapKey(name, sequence): Action` for up/down/left/right/space/enter/cancel + aliases (k/j/h/l, esc).
- `packages/design-system/src/prompts/interactive/width.ts` — `visibleWidth(s)`, thin wrapper over the existing `stripAnsi` plus an `Intl.Segmenter`-based fallback when available.
- `packages/design-system/src/prompts/interactive/glyphs.ts` — `GLYPHS = { active, inactive, selected, error, bar, barStart, barEnd, ... }` with Unicode/ASCII variants gated on `process.env.CI`/`TERM`.
- `packages/design-system/src/prompts/interactive/core.ts` — `Prompt<T>` base class (render loop, raw mode, keypress dispatch, frame diffing, signal/abort handling, non-TTY fallback).
- `packages/design-system/src/prompts/interactive/text.ts` — `textPrompt(opts)`; subclass of `Prompt<string>`.
- `packages/design-system/src/prompts/interactive/password.ts` — `passwordPrompt(opts)`; subclass of `Prompt<string>`, masks render.
- `packages/design-system/src/prompts/interactive/confirm.ts` — `confirmPrompt(opts)`; subclass of `Prompt<boolean>`.
- `packages/design-system/src/prompts/interactive/select.ts` — `selectPrompt<V>(opts)`; subclass of `Prompt<V>`.
- `packages/design-system/src/prompts/interactive/multiselect.ts` — `multiselectPrompt<V>(opts)`; subclass of `Prompt<V[]>`.
- `packages/design-system/src/prompts/interactive/*.test.ts` — one test file per prompt type plus one for the cancel symbol.
- `docs/plans/qa/27-design-system-own-prompts.md` — manual QA checklist.

**Files to change**

- `packages/design-system/src/prompts/index.ts`
  - Remove `import * as clack from "@clack/prompts"`.
  - Import local `textPrompt`, `confirmPrompt`, `selectPrompt`, `multiselectPrompt`, `passwordPrompt` and `isCancel` / `CANCEL`.
  - Rewrite each wrapper to delegate to the local function. Drop the `Parameters<typeof clack.*>` type derivations; declare explicit `TextOptions`, `MultiselectOptions` interfaces (mirroring the fields we actually use: `message`, `placeholder`, `defaultValue`, `validate`, `initialValue` / `initialValues`, `options`, `required`, `maxItems`).
- `packages/design-system/src/prompts/primitives/cancel.ts`
  - Remove `export { isCancel } from "@clack/prompts"`. Re-export from `../interactive/cancel-symbol.js` instead.
- `packages/design-system/src/prompts/prompts.test.ts`
  - Drop the `vi.mock("@clack/prompts", ...)` block. Mock the local prompt functions used by `confirmOrCancel` (`./interactive/confirm.js`) and the cancel primitive directly.
- `packages/design-system/package.json`
  - Remove `@clack/prompts` from `peerDependencies`.
  - Add `sisteransi` to `dependencies`.
  - Add `"engines": { "node": ">=18.18" }`.
- Root `package.json`
  - Remove `@clack/prompts` from `dependencies` (or `devDependencies` if listed there).
  - Add `"engines": { "node": ">=18.18" }` if not present.
- `package-lock.json` regenerated by `npm install`.

**Function signatures (new code)**

```ts
// interactive/cancel-symbol.ts
export const CANCEL: unique symbol;
export function isCancel(value: unknown): value is typeof CANCEL;

// interactive/keys.ts
export type Action = "up" | "down" | "left" | "right" | "space" | "enter" | "cancel";
export function mapKey(name: string | undefined, sequence: string | undefined): Action | undefined;

// interactive/width.ts
export function visibleWidth(value: string): number;

// interactive/core.ts
export class Prompt<T> {
  constructor(opts: PromptOptions<T>);
  prompt(): Promise<T | typeof CANCEL>;
  protected render(): void;
  protected onKey(char: string | undefined, key: KeyEvent): void;
  protected setValue(value: T): void;
  protected setError(message: string): void;
}

// One per prompt file
export function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL>;
export function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL>;
export function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
export function selectPrompt<V>(opts: SelectOptions<V>): Promise<V | typeof CANCEL>;
export function multiselectPrompt<V>(opts: MultiselectOptions<V>): Promise<V[] | typeof CANCEL>;
```

**Build order (keeps the branch green at every step)**

1. Add `interactive/cancel-symbol.ts` + test. Update `primitives/cancel.ts` to re-export from it. Nothing else moves; clack still drives the inputs. Tests pass.
2. Add `interactive/keys.ts`, `interactive/width.ts`, `interactive/glyphs.ts`, `interactive/core.ts` + tests. Not wired yet.
3. Add `interactive/text.ts` + test. Rewire `text` wrapper in `prompts/index.ts` to use it. Run full test suite + `npm run dev -- configure` for visual check.
4. Add `interactive/password.ts` + test. Rewire `password` wrapper. Verify with `npm run dev -- configure poe` (token input path).
5. Add `interactive/confirm.ts` + test. Rewire `confirm` wrapper. Verify `confirmOrCancel` tests still pass.
6. Add `interactive/select.ts` + test. Rewire `select` wrapper.
7. Add `interactive/multiselect.ts` + test. Rewire `multiselect` wrapper.
8. Drop `@clack/prompts` from `peerDependencies` / `dependencies`. Add `sisteransi` to dependencies. Bump `engines.node`. Run `npm install`, full test suite, `npm run build`.
9. Add manual QA markdown and run the checklist.
