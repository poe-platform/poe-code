---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Design-system own prompts (drop @clack/prompts)

Replace `@clack/prompts` with an in-repo prompts implementation so `poe-code` runs on Node 18.

## 1. What we're building

Remove the `@clack/prompts` (and transitive `@clack/core`) dependency. Roll our own interactive prompts inside `toolcraft-design`, heavily inspired by clack's UX (same glyphs, same key handling, same render-diffing strategy), but written against Node 18-compatible APIs only.

The single API blocker for Node 18 is `node:util`'s `styleText` and `stripVTControlCharacters`, both used unconditionally by `@clack/core@1.2.0` and `@clack/prompts@1.2.0`. `styleText` landed in Node 20.12; `stripVTControlCharacters` in 16.9 but is paired with `styleText` calls inside clack. Replacing those two with `chalk` (already a peer dep) and our existing `stripAnsi` helper unlocks Node 18.

Non-goals:

- Do not change the public API surface exported from `toolcraft-design`. All current callers (in `src/cli/**`, `packages/**`) keep working without edits.
- Do not implement prompt variants we don't already use: `autocomplete`, `autocompleteMultiselect`, `groupMultiselect`, `date`, `selectKey`, `path`, `progress`, `taskLog`, `group`, `tasks`, `box`, `stream`. Only `text`, `password`, `confirm`, `select`, `multiselect`.
- Do not change the already-in-house primitives: `intro`, `outro`, `note`, `log`, `spinner`, `cancel`. Only the inputs that still proxy to clack get replaced.

## 2. User-facing shape

Identical to today — same import paths, same signatures, same on-screen rendering.

```ts
import { text, confirm, select, multiselect, password, isCancel } from "toolcraft-design";

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

Rendered terminal output keeps the clack look (glyphs, two-space gutter, cyan/green/red/yellow state colors):

```text
┌  Configure
│
◆  Project name?
│  my-app_
└

◇  Continue?
│  ● Yes / ○ No
└

◆  Choose a model
│  ● opus    Claude Opus 4.7
│  ○ sonnet  Claude Sonnet 4.6 (faster)
└
```

Cancellation: Ctrl-C / Esc resolves the prompt with a sentinel `Symbol.for("poe.cancel")`. `isCancel(value)` returns `true` for that symbol.

Node engine: `engines.node` becomes `">=18.18"` in the root and design-system `package.json`.

## 3. Implementation details and technical decisions

### 3.1 Where the code lives

```text
packages/toolcraft-design/src/prompts/
  index.ts                        # public wrappers — already exists; rewire to local impls
  theme.ts                        # already exists
  primitives/                     # already exists (intro/outro/note/log/spinner/cancel)
    cancel.ts                     # stop re-exporting isCancel from @clack/prompts
  interactive/                    # NEW — owned input prompts
    core.ts                       # base Prompt class (render loop, keypress, raw mode, diffing)
    keys.ts                       # keypress → action mapping (up/down/space/enter/cancel + aliases)
    text.ts                       # text prompt + render
    password.ts                   # password prompt + render
    confirm.ts                    # confirm prompt + render
    select.ts                     # select prompt + render
    multiselect.ts                # multiselect prompt + render
    pagination.ts                 # limitOptions equivalent for select/multiselect
    glyphs.ts                     # unicode/ASCII glyphs + state-colored symbols
    wrap.ts                       # wrap-text-with-prefix helper (uses fast-wrap-ansi)
    cancel-symbol.ts              # export const CANCEL; isCancel
  interactive/*.test.ts           # one test per file
```

### 3.2 Dependencies

Add to `toolcraft-design` `dependencies`:

- `sisteransi` (cursor / erase escape sequences; trivially small, no engines floor)
- `fast-wrap-ansi` (ANSI-aware hard-wrap; matches clack's rendering exactly)
- `fast-string-width` (visual width of strings with wide chars / ANSI; matches clack)

Keep: `chalk` (already a peer dep). Reuse: existing `stripAnsi` helper at `packages/toolcraft-design/src/internal/strip-ansi.ts`. Drop: `@clack/prompts` from root `package.json` and `packages/toolcraft-design/package.json`. Verify `@clack/core` disappears from the lockfile after the change (it's only a transitive dep).

No `node:util` `styleText` or `stripVTControlCharacters`. All color via `chalk`; all VT-strip via the existing `stripAnsi`.

### 3.3 Research: how `@clack/core@1.2.0` works (verbatim)

The base `Prompt<T>` class in `@clack/core/dist/index.mjs` is the contract we are reimplementing. Every subclass (`TextPrompt`, `PasswordPrompt`, `ConfirmPrompt`, `SelectPrompt`, `MultiSelectPrompt`) plugs into the same render loop.

#### 3.3.1 Constructor and lifecycle

`constructor({ input = process.stdin, output = process.stdout, render, initialValue, validate, signal, ... }, trackValue = true)` — `_track` controls whether `userInput` mirrors `readline`'s internal line buffer (text/password set `_track=true`; confirm/select/multiselect set `_track=false`).

`prompt(): Promise<T | typeof CANCEL>` does, in order:

1. If `signal?.aborted` → set state="cancel", call `close()`, resolve with CANCEL symbol.
2. Otherwise, register `signal.addEventListener("abort", ...)` with `{ once: true }` to cancel mid-prompt.
3. Create `readline.createInterface({ input, tabSize: 2, prompt: "", escapeCodeTimeout: 50, terminal: true })`. The `escapeCodeTimeout: 50` matters — without it, a lone Escape press waits up to 500ms to see if it's the start of an arrow-key sequence.
4. Call `rl.prompt()`.
5. If `opts.initialUserInput` provided, call `_setUserInput(initialUserInput, true)` which writes the value into the readline buffer (so the cursor sits at the end and backspace works).
6. `input.on("keypress", onKeypress)`.
7. `setRawMode(input, true)` (TTY only — guarded by `input.isTTY === true`).
8. `output.on("resize", render)` — re-renders on terminal resize.
9. Initial `render()` is called (which hides the cursor on first render via `sisteransi.cursor.hide`).
10. Register `once("submit", ...)` and `once("cancel", ...)` listeners that show the cursor, unsubscribe resize, restore raw mode, and resolve the Promise (with `value` or CANCEL).

#### 3.3.2 Closing

`close()`: `input.unpipe()`, remove the keypress listener, write a final `\n` to output, `setRawMode(input, false)` (skipped on Windows because Node's tty resets oddly there — clack literally checks `Y = process.platform.startsWith("win")` and does NOT call `setRawMode(false)` on win32 to avoid wedging the terminal), close the readline interface, emit the terminal state event (`submit` or `cancel`) with the value, then `unsubscribe()` all listeners.

#### 3.3.3 Subscribers

Custom pubsub: `setSubscriber(event, { cb, once? })`, `on`, `once`, `emit`. Subscribers can register multiple times for the same event. Events emitted: `initial | active | cancel | submit | error | cursor | key | value | userInput | confirm | finalize | beforePrompt`.

#### 3.3.4 Keypress handling

`onKeypress(char, key)` runs the following steps in order:

1. If `_track && key.name !== "return"`:
   - If `key.name && _isActionKey(char, key)` (default: char === `\t`) → write `{ctrl:true, name:"h"}` (backspace) to the readline so the action char never appears in the buffer. This is why Tab doesn't insert a tab.
   - Update `_cursor = rl.cursor`, call `_setUserInput(rl.line)`.
2. If state was `error` → flip to `active`.
3. If `key.name` is in default aliases and `_track === false` → emit `cursor` with the mapped action (default aliases: `k→up, j→down, h→left, l→right`).
4. If `key.name` is in actions set (`up, down, left, right, space, enter, cancel`) → emit `cursor` with the action name.
5. If `char` is `y` or `n` (case-insensitive) → emit `confirm` with the boolean. `ConfirmPrompt` listens for this and short-circuits to submit.
6. Emit `key(char.toLowerCase(), keyMeta)` for subclasses.
7. If `key.name === "return"`: if `opts.validate` is set, call it with `value`. If it returns a string/Error, set `error = message`, state = `error`, and write the saved `userInput` back to the readline (so the user keeps editing the same text). If no error, state = `submit`.
8. If the keypress maps to a `cancel` action (Ctrl-C, Escape, or `^C` raw byte) → state = `cancel`.
9. If state became `submit` or `cancel` → emit `finalize`.
10. Call `render()`.
11. If state is `submit`/`cancel` → call `close()`.

#### 3.3.5 Default aliases and actions

```text
k → up
j → down
h → left
l → right
\x03 (Ctrl-C) → cancel
escape → cancel
```

Actions set: `up, down, left, right, space, enter, cancel`.

`Prompt._isActionKey(char, key)` returns `char === "\t"`. `AutocompletePrompt` overrides to also include `space` when `multiple && isNavigating`. Our subclasses won't need to override.

#### 3.3.6 Render diffing

`render()`:

- Build new frame: `wrapAnsi(this._render(this) ?? "", process.stdout.columns, { hard: true, trim: false })`.
- If new frame === prev frame, do nothing.
- If state === "initial": write `cursor.hide` first, then write the whole frame. Flip state to "active".
- Otherwise compute `diffLines(prev, new)`: splits both by `\n`, walks line indices, returns `{ lines: changedLineIndices, numLinesBefore, numLinesAfter, numLines }`.
- `restoreCursor()`: counts wrapped lines in `prev` (using `wrapAnsi(prev, columns, {hard:true, trim:false}).split("\n").length - 1`) and calls `output.write(cursor.move(-999, -count))` to land at the top of the previous frame.
- If no diff lines exist within visible viewport: just store the new frame (nothing to repaint).
- If exactly one line changed: `cursor.move(0, lineIndex - prevLines)`, `erase.lines(1)`, write the new line, `cursor.move(0, totalLines - lineIndex - 1)`.
- If multiple lines changed: move to the first changed line, `erase.down()`, write the rest of the frame from that line.
- Else (no diff struct, fresh state): just `erase.down()` and rewrite the whole frame.
- Maintain `_prevFrame = newFrame`.

This minimizes flicker for live updates (e.g. arrow-key navigation in a long select list).

#### 3.3.7 Cancel sentinel in clack

`const C = Symbol("clack:cancel")`. Bare, NOT registry. `isCancel(v) === v === C`. Equality only works if you import the same instance — usually fine in deduplicated installs. **We diverge here**: use `Symbol.for("poe.cancel")` so equality survives duplicate module instances.

#### 3.3.8 Subclass behaviors

`TextPrompt`:

- `_track = true`.
- `constructor(opts)`: forwards `initialUserInput = opts.initialUserInput ?? opts.initialValue` to base. Subscribes `on("userInput", v => _setValue(v))`. Subscribes `on("finalize", () => { value ||= opts.defaultValue; if (value === undefined) value = "" })`.
- `userInputWithCursor` getter: if `submit`, returns the buffer; else inserts an `inverse`-styled character at `cursor` position. If cursor is past the end, appends `█` (full block).

`PasswordPrompt`:

- `_track = true` (inherits — uses base via subclass).
- `_mask = opts.mask ?? "•"`.
- `on("userInput", v => _setValue(v))`.
- `masked` getter: `userInput.replaceAll(/./g, mask)`.
- `userInputWithCursor` getter: identical to text but built off `masked`.
- `clear()`: `_clearUserInput()` which sends `{ctrl:true, name:"u"}` (kill-to-start) to the readline.
- Prompts wrapper supports `clearOnError: boolean` which calls `this.clear()` inside the error render branch.

`ConfirmPrompt`:

- `_track = false`.
- `value = !!opts.initialValue`.
- `cursor` getter: `value ? 0 : 1`.
- Listeners:
  - `on("userInput", () => { value = _value })` — `_value` returns `cursor === 0`. Triggered when the user types anything (not bound to navigation).
  - `on("confirm", boolValue => { output.write(cursor.move(0, -1)); value = boolValue; state = "submit"; close(); })` — short-circuit on Y/N keypress.
  - `on("cursor", () => { value = !value })` — any arrow key flips the value.

`SelectPrompt`:

- `_track = false`.
- `options = opts.options`.
- Initial cursor: `Math.max(options.findIndex(o => o.value === initialValue), 0)`. If that option is `disabled`, walk with helper `findNonDisabled(index, +1, options)` which moves and wraps; on a list with no enabled options returns the input index.
- `on("cursor", action)`:
  - `left`/`up` → cursor = findNonDisabled(cursor, -1, options).
  - `down`/`right` → cursor = findNonDisabled(cursor, +1, options).
  - After move, `value = options[cursor].value`.
- Submit on Enter — value already tracks cursor.

`MultiSelectPrompt`:

- `_track = false`.
- `options = opts.options`, `value = [...(opts.initialValues ?? [])]`.
- Initial cursor: index of `cursorAt` or 0; advance past disabled.
- `on("key", ch)`:
  - `ch === "a"` → toggleAll (select all enabled if not all selected; otherwise clear).
  - `ch === "i"` → toggleInvert (replace value with enabled options not currently selected).
- `on("cursor", action)`:
  - `up`/`left` → advance past disabled in -1 direction.
  - `down`/`right` → +1.
  - `space` → toggleValue (add/remove `options[cursor].value` in `value`).

#### 3.3.9 block() helper

Used by spinner code in `@clack/prompts`, not by prompt classes themselves. We do NOT need to port it — our spinner code already lives in `primitives/spinner.ts` and doesn't use it.

### 3.4 Research: how `@clack/prompts@1.2.0` renders each prompt

Every prompt wrapper in `prompts/dist/index.mjs` instantiates the matching core prompt with a custom `render()` function. The render functions all follow the same pattern.

#### 3.4.1 State to symbol mapping

`symbol(state)`:

- initial/active → `chalk.cyan("◆")`
- cancel → `chalk.red("■")`
- error → `chalk.yellow("▲")`
- submit → `chalk.green("◇")`

`symbolBar(state)`:

- initial/active → `chalk.cyan("│")`
- cancel → `chalk.red("│")`
- error → `chalk.yellow("│")`
- submit → `chalk.green("│")`

#### 3.4.2 Glyphs (with ASCII fallbacks)

```text
S_STEP_ACTIVE     ◆  *
S_STEP_CANCEL     ■  x
S_STEP_ERROR      ▲  x
S_STEP_SUBMIT     ◇  o
S_BAR_START       ┌  T
S_BAR             │  |
S_BAR_END         └  —
S_RADIO_ACTIVE    ●  >
S_RADIO_INACTIVE  ○  (space)
S_CHECKBOX_ACTIVE ◻  [•]
S_CHECKBOX_SELECTED ◼ [+]
S_CHECKBOX_INACTIVE ◻ [ ]
S_PASSWORD_MASK   ▪  •
S_BAR_H           ─  -
S_CORNER_TOP_RIGHT  ╮  +
S_CONNECT_LEFT    ├  +
S_CORNER_BOTTOM_RIGHT ╯ +
S_CORNER_BOTTOM_LEFT  ╰ +
S_CORNER_TOP_LEFT ╭  +
S_INFO            ●  •
S_SUCCESS         ◆  *
S_WARN            ▲  !
S_ERROR           ■  x
```

#### 3.4.3 Unicode detection

(clack's `Ze()` function):

- Non-Windows: `process.env.TERM !== "linux"`.
- Windows: enabled when any of CI, WT_SESSION, TERMINUS_SUBLIME, ConEmuTask=`{cmd::Cmder}`, TERM_PROGRAM in (Terminus-Sublime, vscode), TERM in (xterm-256color, alacritty), TERMINAL_EMULATOR=JetBrains-JediTerm.

We already have a theme/symbol layer in `packages/toolcraft-design/src/components/symbols.ts`. Reuse where it overlaps; otherwise add a `glyphs.ts` for prompt-only glyphs.

#### 3.4.4 Frame template

Used by every prompt's render:

```text
{barStart-grey} {symbol} {message}
{bar-state-color}  {body}
{barEnd-state-color}
```

"Guide" mode (`withGuide`, default true) toggles whether the leading `│` and trailing `└` are emitted. Some callers disable it.

#### 3.4.5 Text render (`Ot` in the source)

- Header: `┌` then two spaces (grey) on initial; symbol on submit/cancel/error.
- Placeholder: `inverse(placeholder[0]) + dim(placeholder.slice(1))` when buffer empty; else `userInputWithCursor`. If no placeholder and empty: `inverse hidden "_"`.
- Submit: `{message}\n{│ grey}  {value dim}`.
- Cancel: `{message}\n{│ grey}  {value strikethrough+dim}`.
- Error: `{message}\n{│ yellow}  {input}\n{└ yellow}  {error yellow}`.
- Default: `{message}\n{│ cyan}  {input}\n{└ cyan}`.

#### 3.4.6 Password render (`bt`)

- Same skeleton but uses `userInputWithCursor` over the masked string.
- Submit/cancel: masked value dimmed (and struck on cancel).
- Error: shows masked value + yellow error; if `clearOnError`, calls `this.clear()` before rendering.

#### 3.4.7 Confirm render (`ot`)

- `active = opts.active ?? "Yes"`, `inactive = opts.inactive ?? "No"`.
- Header: `{symbol}  {wrapTextWithPrefix(output, message, "│  ", state-symbol)}`.
- Default body:

  ```text
  {│ cyan}  {● Yes / ○ No} (active bright, the other dim, joined by " / ")
  {└ cyan}
  ```

- `vertical: true` stacks Yes / No on separate lines, each indented with `│ cyan`.
- Submit/cancel: the chosen label rendered dim (or strikethrough+dim on cancel).

#### 3.4.8 Select render (`_t` near end of file)

- Header: `{symbol}  {wrapTextWithPrefix message}`.
- Body: built via `limitOptions(...)` (pagination) joined with a state-colored bar prefix.
- Option renderer:
  - `active`: `chalk.green("●") + " " + label + (hint ? dim(" (hint)") : "")`.
  - `inactive`: `dim("○") + " " + dim(label)`.
  - `disabled`: `gray("○") + " " + strikethrough+gray(label)` + hint.
  - `selected` (submit): `dim(label)`.
  - `cancelled` (cancel): `strikethrough+dim(label)`.
- Footer: `└ cyan` on active; on submit a `│ grey` continuation line.

#### 3.4.9 Multiselect render (`yt`)

- Header same.
- Option renderer:
  - `disabled`: `gray("◻") + " " + strikethrough+gray(label)` + hint.
  - `selected`: `green("◼") + " " + dim(label)` + hint.
  - `active`: `cyan("◻") + " " + label` + hint.
  - `active-selected`: `green("◼") + " " + label` + hint.
  - `inactive`: `dim("◻") + " " + dim(label)`.
  - `submitted`: `dim(label)`.
  - `cancelled`: `strikethrough+dim(label)`.
- Required-error message:

  ```text
  Please select at least one option.
  Press SPACE to select, ENTER to submit
  ```

  rendered with `gray/bgWhite/inverse` key chips.

- Body via `limitOptions(...)`.

#### 3.4.10 Pagination algorithm (`limitOptions = Y`)

- Inputs: `cursor, options, style(option, isActive)`, `output`, `maxItems = ∞`, `columnPadding = 0`, `rowPadding = 4`.
- `c = getColumns(output) - columnPadding`. `a = getRows(output)`. `l = dim("...")`.
- `$ = max(a - rowPadding, 0)`. `y = max(min(maxItems, $), 5)` — always at least 5 visible.
- Page start `p = 0`; if `cursor >= y - 3` then `p = max(min(cursor - y + 3, options.length - y), 0)` — keep cursor near the bottom of visible window when scrolling down.
- Top indicator `m = y < options.length && p > 0`. Bottom indicator `g = y < options.length && p + y < options.length`.
- Style each visible option, hard-wrap with `fast-wrap-ansi` to width `c`.
- If wrapped line count exceeds row budget, trim wrapped lines from above the cursor first (if top indicator present) or below (if bottom indicator present) using helper `et()`.
- Prepend `"..."` if `m`, append if `g`.

#### 3.4.11 Helpers

`wrapTextWithPrefix(output, text, prefix, startPrefix = prefix)`:

- `wrapAnsi(text, columns - prefix.length, { hard: true, trim: false })` split by `\n`, prepend `startPrefix` to line 0 and `prefix` to the rest.

`getColumns(output)` = `output.columns ?? 80`. `getRows(output)` = `output.rows ?? 20`.

### 3.5 What we are NOT porting

- `box`, `path`, `progress`, `taskLog`, `tasks`, `stream`, `group`, `selectKey`, `groupMultiselect`, `autocomplete`, `autocompleteMultiselect`, `date` — none are used by any caller in this repo (verified with `grep -rn "toolcraft-design" --include="*.ts"` then filtered).
- `clearOnError` for password (no caller uses it; if a caller emerges, easy to add).
- Configurable `active`/`inactive` labels on `confirm` (no caller passes them; we hardcode "Yes"/"No").
- `vertical: true` on `confirm` (no caller).
- `cursorAt` on `multiselect` (no caller).
- `withGuide: false` (no caller — all renders assume guide bars on).

We DO keep the hjkl vim aliases — costs nothing and matches user expectation.

### 3.6 Edge cases we explicitly handle

- **Windows raw-mode**: do NOT call `setRawMode(false)` on close on `process.platform === "win32"`. Match clack's quirk to avoid leaving the terminal in a bad state.
- **Escape key latency**: pass `escapeCodeTimeout: 50` to `readline.createInterface` so a lone Esc cancels immediately instead of waiting 500ms for a possible arrow-sequence.
- **Tab in text/password**: suppress tab insertion by sending a backspace to the readline buffer in the keypress handler (matches clack's `_isActionKey === "\t"` path).
- **AbortSignal**: both pre-aborted (resolve CANCEL synchronously after `prompt()`) and mid-prompt (one-shot listener flips to cancel and closes).
- **Resize**: re-render on `output.on("resize", render)`. The diffing algo handles the new width because we always rewrap to current columns.
- **Validate failure**: set state=error, write the previously-typed buffer back into the readline (so the user keeps editing), keep value, re-render. Validate may return `string | Error | undefined`; coerce `Error` → `err.message`.
- **Defaults applied on submit**: text prompt sets `value ||= defaultValue ?? ""`.
- **Empty options for select/multiselect**: throw a typed error eagerly (clack just renders an empty list and hangs — we improve here).
- **Disabled options**: skipped during cursor navigation; non-selectable in multiselect's space toggle.
- **Required multiselect**: validation runs on submit; error message includes the standard "Press SPACE to select, ENTER to submit" hint.
- **Long option lists**: paginate exactly like clack — min 5 visible rows, `…` markers at top/bottom, cursor stays near bottom while scrolling down.
- **Wide chars / emoji in labels**: width measured via `fast-string-width` (same as clack).
- **Non-TTY input** (`!process.stdin.isTTY`):
  - `text` / `password`: read one line via `readline.createInterface().once("line")`. Password does NOT mask in non-TTY (matches clack — there's no way to disable echo on a piped fd).
  - `confirm` / `select` / `multiselect`: if `POE_NO_PROMPT=1`, return `initialValue` (or first non-disabled option, or `initialValues ?? []`). Otherwise throw `new Error("Interactive prompt requires a TTY. Set POE_NO_PROMPT=1 to accept defaults non-interactively.")`. Today clack just hangs in this case — we improve.
- **SIGINT**: handled via the keypress mapping (Ctrl-C → cancel action → resolve CANCEL). We do NOT install a global SIGINT handler — caller code decides whether to `process.exit(130)` after `isCancel(...)` is true.

### 3.7 Config / env vars

- `POE_NO_SPINNER=1` — already exists, unchanged.
- `POE_NO_PROMPT=1` — NEW. When set in non-TTY contexts, `confirm`/`select`/`multiselect` return default/initial value instead of throwing. Used by CI.
- No new config-schema entries.

## 4. Interfaces and test plan

### 4.1 Module-boundary types

The public `prompts/index.ts` signatures stay byte-identical to today. New internal contracts:

```ts
// interactive/cancel-symbol.ts
export const CANCEL: unique symbol;
export function isCancel(value: unknown): value is typeof CANCEL;

// interactive/keys.ts
export type Action = "up" | "down" | "left" | "right" | "space" | "enter" | "cancel";
export function mapKey(name: string | undefined, char: string | undefined): Action | undefined;

// interactive/wrap.ts
export function wrapTextWithPrefix(
  output: NodeJS.WritableStream,
  text: string,
  prefix: string,
  startPrefix?: string
): string;
export function getColumns(output: NodeJS.WritableStream): number;
export function getRows(output: NodeJS.WritableStream): number;

// interactive/pagination.ts
export interface PaginationOptions<O> {
  cursor: number;
  options: O[];
  style: (option: O, active: boolean) => string;
  output: NodeJS.WritableStream;
  maxItems?: number;
  columnPadding?: number;
  rowPadding?: number;
}
export function limitOptions<O>(opts: PaginationOptions<O>): string[];

// interactive/core.ts
export interface PromptOptions<T> {
  render: (state: PromptState<T>) => string;
  initialValue?: T;
  initialUserInput?: string;
  validate?: (value: T | undefined) => string | Error | undefined;
  signal?: AbortSignal;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}
export type PromptStateName = "initial" | "active" | "submit" | "cancel" | "error";
export interface PromptState<T> {
  state: PromptStateName;
  value: T | undefined;
  error: string;
  cursor: number;
  userInput: string;
}
export class Prompt<T> {
  state: PromptStateName;
  value: T | undefined;
  error: string;
  userInput: string;
  protected _cursor: number;
  constructor(opts: PromptOptions<T>, trackValue?: boolean);
  prompt(): Promise<T | typeof CANCEL>;
  on(event: "key" | "cursor" | "userInput" | "value" | "confirm" | "finalize", cb: (...args: any[]) => void): void;
  once(event: "submit" | "cancel" | "finalize", cb: (...args: any[]) => void): void;
}

// One per prompt file (these stay internal; index.ts wraps them)
export function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL>;
export function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL>;
export function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
export function selectPrompt<V>(opts: SelectOptions<V>): Promise<V | typeof CANCEL>;
export function multiselectPrompt<V>(opts: MultiselectOptions<V>): Promise<V[] | typeof CANCEL>;
```

The wrappers in `prompts/index.ts` continue to export `select`, `text`, `confirm`, `password`, `multiselect` with the same signatures as today — they just call the local `*Prompt` instead of `clack.*`. `MultiselectOptions` and `TextOptions` lose their `Parameters<typeof clack.*>` derivations and become explicit interfaces mirroring the fields callers actually use:

- `TextOptions`: `message, placeholder?, defaultValue?, initialValue?, validate?`
- `PasswordOptions`: `message, validate?`
- `ConfirmOptions`: `message, initialValue?`
- `SelectOptions<V>`: `message, options: { value, label, hint?, disabled? }[], initialValue?, maxItems?`
- `MultiselectOptions<V>`: `message, options: ..., initialValues?, required?, maxItems?`

### 4.2 Tests

Unit tests in `packages/toolcraft-design/src/prompts/interactive/*.test.ts` — vitest, no real TTY. Drive each prompt with a `PassThrough` for stdin and a buffer-capturing writable for stdout. Set `input.isTTY = true` on the PassThrough so the prompt enters interactive mode.

Per-prompt coverage:

- `text`: typing characters → submit returns the string; empty buffer + `defaultValue` → returns default; `validate` failure → state goes to "error", error rendered, next Enter re-validates after edit; placeholder rendered when buffer empty.
- `password`: keystrokes render as `•`; cursor visible at correct position; submit returns the actual buffer (not the mask); validate runs on submit.
- `confirm`: arrow keys flip value; y → submit true; n → submit false; Enter submits current value; default value applied on initial render.
- `select`: up/down cycle through options; cursor wraps at boundaries; disabled options skipped; Enter returns focused value; `initialValue` sets initial cursor; `maxItems` paginates with `…` markers (test the visible-window math).
- `multiselect`: space toggles; `a` toggles all; `i` inverts; `required: true` blocks empty submit with the standard error string; `initialValues` populates value; Enter submits the array.
- All five: Ctrl-C (raw byte `\x03`) → resolved value is `CANCEL` and `isCancel(result) === true`; Escape → same; AbortSignal (pre-aborted) → resolves CANCEL synchronously; AbortSignal (aborted mid-prompt) → resolves CANCEL.
- Resize: emit `output.emit("resize")` mid-prompt → render is called.
- Non-TTY: pipe a string into stdin, call `text` → returns the piped line; call `select` without `POE_NO_PROMPT` → rejects with the documented error.

Cancel-symbol tests in `packages/toolcraft-design/src/prompts/interactive/cancel-symbol.test.ts`:

- `isCancel(CANCEL) === true`.
- `isCancel("foo") === false`.
- `Symbol.for("poe.cancel") === CANCEL` (registry symbol survives duplicate module instances).

Pagination tests in `packages/toolcraft-design/src/prompts/interactive/pagination.test.ts`:

- 3 options, maxItems=5 → no markers, all visible.
- 10 options, maxItems=5, cursor=0 → bottom marker only.
- 10 options, cursor=9 → top marker only.
- 10 options, cursor=5 → both markers.
- Long option wraps to 2 lines → wrap budget enforced.

Update existing `packages/toolcraft-design/src/prompts/prompts.test.ts`:

- Drop `vi.mock("@clack/prompts", ...)`. Mock `./interactive/confirm.js` instead (the only local primitive `confirmOrCancel` invokes).

Engine smoke: add `packages/toolcraft-design/scripts/check-node18.mjs` that imports `toolcraft-design` and runs `text` against a piped stdin. Document in the design-system README how to run under Node 18 (`nvm exec 18.18 node …`). Not gated in CI for first merge.

Manual QA (`docs/plans/qa/27-design-system-own-prompts.md`): happy path for each prompt, cancel via Ctrl-C, cancel via Esc, validate error in text & password, resize mid-prompt, non-TTY pipe-in with and without `POE_NO_PROMPT`, narrow terminal (40 cols) for wrap behavior, long option list (30 items) for pagination markers.

### 4.3 Rollout

- One PR. Public API unchanged ⇒ no migration for consumers.
- After merge, bump `engines.node` to `>=18.18` in root and design-system `package.json`. Drop any `setup-node` actions in workflows that pin newer than 18.

### 4.4 Autonomy checklist

- Build green: `npm run build` (turbo) and `npm run lint:types`.
- Test green: `npm run test` and `(cd packages/toolcraft-design && npm test)`.
- `grep -rn "@clack/prompts" packages src` returns no matches.
- `npm ls @clack/prompts` is empty (and `@clack/core` too).
- `npm run dev -- configure` walks through prompts visually (compare to a screenshot of pre-change behavior; pixel-perfect not required, glyph and color parity is).
- `npm run screenshot-poe-code -- configure --help` regenerates cleanly.
- Smoke under Node 18: `nvm exec 18.18 node dist/bin.cjs configure --help` succeeds without crashing.

## 5. Code plan

### 5.1 New files

- `packages/toolcraft-design/src/prompts/interactive/cancel-symbol.ts` — `CANCEL = Symbol.for("poe.cancel")` + `isCancel`.
- `packages/toolcraft-design/src/prompts/interactive/keys.ts` — `Action` type + `mapKey(name, char)` returning the action or undefined. Includes hjkl aliases and Ctrl-C / Escape → cancel.
- `packages/toolcraft-design/src/prompts/interactive/glyphs.ts` — unicode-detection (port of clack's `Ze` function), exports `GLYPHS = { stepActive, stepCancel, stepError, stepSubmit, bar, barStart, barEnd, radioActive, radioInactive, checkboxActive, checkboxSelected, checkboxInactive, passwordMask }` with ASCII fallbacks, plus `symbol(state)` and `symbolBar(state)` helpers returning the colored glyph.
- `packages/toolcraft-design/src/prompts/interactive/wrap.ts` — `wrapTextWithPrefix`, `getColumns`, `getRows`. Internally calls `fast-wrap-ansi` with `{hard:true, trim:false}`.
- `packages/toolcraft-design/src/prompts/interactive/pagination.ts` — `limitOptions` port of clack's algorithm (windowing, `…` markers, wrap-aware trimming).
- `packages/toolcraft-design/src/prompts/interactive/core.ts` — `Prompt<T>` base class. Constructor, `prompt()`, `close()`, `onKeypress`, `render()`, `restoreCursor()`, `diffLines` helper, `_setUserInput`, `_clearUserInput`, subscribers map.
- `packages/toolcraft-design/src/prompts/interactive/text.ts` — `TextPromptImpl` extends `Prompt<string>` with `userInputWithCursor` getter; `textPrompt(opts)` builds it and returns `.prompt()`. Render function matches §3.4.5.
- `packages/toolcraft-design/src/prompts/interactive/password.ts` — `PasswordPromptImpl` extends `Prompt<string>` with `masked` / `userInputWithCursor` getters and `clear()`; `passwordPrompt(opts)` + render.
- `packages/toolcraft-design/src/prompts/interactive/confirm.ts` — `ConfirmPromptImpl` extends `Prompt<boolean>`; `confirmPrompt(opts)` + render.
- `packages/toolcraft-design/src/prompts/interactive/select.ts` — `SelectPromptImpl<V>` extends `Prompt<V>`; `selectPrompt(opts)` + render using `limitOptions`.
- `packages/toolcraft-design/src/prompts/interactive/multiselect.ts` — `MultiselectPromptImpl<V>` extends `Prompt<V[]>`; `multiselectPrompt(opts)` + render with `space`/`a`/`i` keys.
- `packages/toolcraft-design/src/prompts/interactive/{core,text,password,confirm,select,multiselect,pagination,cancel-symbol,wrap}.test.ts`.
- `docs/plans/qa/27-design-system-own-prompts.md` — manual QA checklist.

### 5.2 Files to change

- `packages/toolcraft-design/src/prompts/index.ts`:
  - Remove `import * as clack from "@clack/prompts"`.
  - Import local `textPrompt`, `confirmPrompt`, `selectPrompt`, `multiselectPrompt`, `passwordPrompt` and `isCancel` / `CANCEL` from `./interactive/index.js`.
  - Replace `clack.select`, `clack.multiselect`, `clack.text`, `clack.confirm`, `clack.password` with the local equivalents inside the existing wrapper functions.
  - Drop `Parameters<typeof clack.*>` type derivations; declare explicit `TextOptions`, `PasswordOptions`, `ConfirmOptions`, `SelectOptions<V>`, `MultiselectOptions<V>` interfaces (fields listed in §4.1).
- `packages/toolcraft-design/src/prompts/primitives/cancel.ts`:
  - Remove `export { isCancel } from "@clack/prompts"`. Re-export from `../interactive/cancel-symbol.js` instead.
- `packages/toolcraft-design/src/prompts/prompts.test.ts`:
  - Drop the `vi.mock("@clack/prompts", ...)` block.
  - Mock `./interactive/confirm.js` (the function `confirmOrCancel` calls) and `./primitives/cancel.js` directly.
- `packages/toolcraft-design/package.json`:
  - Remove `@clack/prompts` from `peerDependencies`.
  - Add `sisteransi`, `fast-wrap-ansi`, `fast-string-width` to `dependencies`.
  - Add `"engines": { "node": ">=18.18" }`.
- Root `package.json`:
  - Remove `@clack/prompts` (it's listed at the root since some workspace packages still import it transitively today via design-system).
  - Add `"engines": { "node": ">=18.18" }`.
- `package-lock.json` regenerated by `npm install` after both changes.

### 5.3 New function signatures

```ts
// interactive/cancel-symbol.ts
export const CANCEL: unique symbol;
export function isCancel(value: unknown): value is typeof CANCEL;

// interactive/keys.ts
export type Action = "up" | "down" | "left" | "right" | "space" | "enter" | "cancel";
export function mapKey(name: string | undefined, char: string | undefined): Action | undefined;

// interactive/wrap.ts
export function wrapTextWithPrefix(
  output: NodeJS.WritableStream, text: string, prefix: string, startPrefix?: string
): string;
export function getColumns(output: NodeJS.WritableStream): number;
export function getRows(output: NodeJS.WritableStream): number;

// interactive/pagination.ts
export function limitOptions<O>(opts: PaginationOptions<O>): string[];

// interactive/glyphs.ts
export const UNICODE: boolean;
export const GLYPHS: Readonly<Record<string, string>>;
export function symbol(state: PromptStateName): string;
export function symbolBar(state: PromptStateName): string;

// interactive/core.ts
export class Prompt<T> {
  constructor(opts: PromptOptions<T>, trackValue?: boolean);
  prompt(): Promise<T | typeof CANCEL>;
  protected setValue(value: T | undefined): void;
  protected setError(message: string): void;
  on(event: string, cb: Function): void;
  once(event: string, cb: Function): void;
}

// One factory per prompt
export function textPrompt(opts: TextOptions): Promise<string | typeof CANCEL>;
export function passwordPrompt(opts: PasswordOptions): Promise<string | typeof CANCEL>;
export function confirmPrompt(opts: ConfirmOptions): Promise<boolean | typeof CANCEL>;
export function selectPrompt<V>(opts: SelectOptions<V>): Promise<V | typeof CANCEL>;
export function multiselectPrompt<V>(opts: MultiselectOptions<V>): Promise<V[] | typeof CANCEL>;
```

### 5.4 Build order (keeps the branch green at every step)

1. **Glue scaffolding**: add `interactive/cancel-symbol.ts`, `interactive/keys.ts`, `interactive/glyphs.ts`, `interactive/wrap.ts`, `interactive/pagination.ts` + tests. Nothing wired yet. Replace `primitives/cancel.ts`'s `isCancel` re-export with the local one.
2. **Core**: add `interactive/core.ts` + test (drive base class with mock stdin/stdout, assert render diffing, raw-mode toggling, cancel via abort signal).
3. **Text**: add `interactive/text.ts` + test. Rewire `text` wrapper in `prompts/index.ts`. Run full suite + `npm run dev -- configure`.
4. **Password**: add `interactive/password.ts` + test. Rewire `password` wrapper. Verify the OAuth/token input path (`packages/toolcraft-openapi/src/auth/bearer-token-auth.ts`).
5. **Confirm**: add `interactive/confirm.ts` + test. Rewire `confirm` wrapper. Verify `confirmOrCancel` tests still pass.
6. **Select**: add `interactive/select.ts` + test. Rewire `select` wrapper.
7. **Multiselect**: add `interactive/multiselect.ts` + test. Rewire `multiselect` wrapper.
8. **Drop clack**: remove `@clack/prompts` from package.jsons, add `sisteransi`/`fast-wrap-ansi`/`fast-string-width` deps, bump `engines.node`. Run `npm install`, full test suite, `npm run build`.
9. **Manual QA + Node 18 smoke**: walk through `docs/plans/qa/27-design-system-own-prompts.md` and run a smoke under `nvm exec 18.18 node`.
