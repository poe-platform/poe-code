# toolcraft-design

Shared terminal design system for Toolcraft applications. It provides design tokens, ANSI-aware text and layout components, interactive prompts, dashboards, explorers, terminal Markdown rendering, and deterministic static renderers from one package.

## Install

```sh
npm install toolcraft-design
```

Import from the package root:

```ts
import { configureTheme, promptText, renderMarkdown, renderTable, text } from "toolcraft-design";
```

The package does not expose public subpath imports.

## Public API

### Tokens

- `tokens`: namespace containing the token exports.
- `brand`: the default purple brand color.
- `dark`, `light`: built-in purple `ThemePalette` values.
- `brands`: mutable registry of available brands.
- `spacing`, `typography`, `widths`: shared design token collections.
- Types: `Brand`, `ThemeName`, `ThemePalette`.

### Components

- `text`, `color`, `symbols`: text styles, color helpers, and terminal symbols.
- `createLogger`, `logger`: styled logger creation and the default logger.
- `helpFormatter`, `helpFormatterPlain`: styled and plain help formatting APIs.
- `formatColumns`, `formatCommand`, `formatUsage`, `formatOption`, `formatCommandList`, `formatOptionList`: individual help-formatting functions.
- `formatCommandNotFound`, `formatCommandNotFoundPanel`: command error rendering.
- `renderTable`, `renderDetailCard`, `renderInspectorCard`, `renderResourceBrowser`: tabular, detail-card, inspector-panel, and grouped resource-browser rendering.
- `getTemplatePartialNames`, `renderTemplate`, `resolveTemplatePartials`: template rendering utilities.
- `openExternal`: opens a URL or file with the platform browser command.
- Types: `Color`, `LoggerOutput`, `CommandInfo`, `OptionInfo`, `FormatColumnsOptions`, `TableColumn`, `RenderTableOptions`, `DetailCardRow`, `DetailCardSection`, `RenderDetailCardOptions`, `RenderTemplateOptions`, `TemplateEscape`.

### Prompts

- `prompts`: namespace containing the prompt exports.
- `intro`, `introPlain`, `outro`, `note`: prompt flow presentation.
- `select`, `multiselect`, `promptText`, `confirm`, `confirmOrCancel`, `password`: interactive inputs. The prompt text function is exported as `promptText` at the package root and as `text` on `prompts`.
- `spinner`, `withSpinner`: spinner APIs.
- `isCancel`, `cancel`, `log`, `PromptCancelledError`: cancellation and prompt logging utilities.
- `promptTheme`: the brand-aware prompt theme.
- Types: `SelectOptions`, `MultiselectOptions`, `TextOptions`, `ConfirmOptions`, `PasswordOptions`, `SpinnerOptions`, `WithSpinnerOptions`.

### Dashboard

- `dashboard`: namespace containing the complete dashboard API.
- `createDashboard`, `shouldUseInteractiveDashboard`: root-level dashboard exports.
- Root-level types: `Dashboard`, `DashboardOptions`.
- The namespace also exports `renderDashboardSnapshot`, `defaultHints`, and the dashboard snapshot, state, output, command, statistics, and footer-hint types.

### Explorer

- `explorer`: namespace containing the complete explorer API.
- `runExplorer`, `runTwoPaneExplorer`, `singleDetail`: root-level explorer exports.
- Root-level types: `Row`, `DetailItem`, `Detail`, `DetailCtx`, `Action`, `ActionContext`, `ExplorerConfig`, `ReorderContext`, `Tone`, `TwoPaneExplorerConfig`, `TwoPaneRow`, `TwoPaneAction`, `TwoPaneActionContext`.
- The namespace also exports `createInitialState`, `resolveBindings`, and the remaining explorer event, binding, layout, size, state, and effect types.

`runTwoPaneExplorer` renders two independently selectable panes with action shortcuts, refresh support, and active-pane switching. The explorer uses framed `Plans` and `Preview` panes; detail previews render Markdown content before fitting it into the terminal. Use `renderResourceBrowser` and `renderInspectorCard` for deterministic non-interactive snapshots that match the interactive browser language.

### Terminal Markdown

- `parse`: parses Markdown into `MdNode` values.
- `render`: renders parsed Markdown nodes for the terminal.
- `renderMarkdown`: parses and renders a Markdown string.
- Types: `MdNode`, `RenderOptions`.

### Static Rendering

- `staticRender`: namespace containing the static rendering exports.
- `SPINNER_FRAMES`, `renderSpinnerFrame`, `renderSpinnerStopped`: deterministic spinner rendering.
- `renderMenu`: deterministic menu rendering.
- Types: `SpinnerFrameOptions`, `SpinnerStoppedOptions`, `MenuOption`, `RenderMenuOptions`.

### ACP Rendering

- `acp`: namespace containing `renderAgentMessage`, `renderToolStart`, `renderToolComplete`, `renderReasoning`, `renderUsage`, `renderError`, `getAcpWriter`, and `withAcpWriter`.
- Namespace type: `AcpLineWriter`.

### Advanced Utilities

- `getTheme`, `resolveThemeName`, `resetThemeCache`: theme resolution and cache control.
- `configureTheme`, `getThemeConfig`, `resetTheme`: brand and label configuration.
- `resolveOutputFormat`, `resetOutputFormatCache`, `withOutputFormat`: terminal, Markdown, or JSON output-format selection.
- Types: `ThemeEnv`, `OutputFormat`.

## Brand Theme

The default configuration is `{ brand: "purple", label: "Poe" }`. Configure the package before producing design-system output:

```ts
import { configureTheme, getThemeConfig, resetTheme } from "toolcraft-design";

configureTheme({ brand: "blue", label: "Toolcraft" });

console.log(getThemeConfig());
// { brand: "blue", label: "Toolcraft" }

resetTheme();
```

`configureTheme` accepts either or both fields and merges them into the current configuration. It throws for an unknown brand. `getThemeConfig` returns a copy of the current configuration, and `resetTheme` restores the purple `Poe` defaults.

The built-in brands are:

- `purple`: `#a200ff`
- `blue`: `#2f6fed`
- `green`: `#1f9d57`

Register another brand by adding a `Brand` to the exported `brands` registry before selecting it:

```ts
import { brands, configureTheme, type Brand } from "toolcraft-design";

const orange: Brand = {
  name: "orange",
  primary: "#f97316"
};

brands.orange = orange;
configureTheme({ brand: "orange", label: "My CLI" });
```

The registry key and `Brand.name` should match. Brand primary colors are CSS-style hex strings used to build light and dark terminal palettes.

## Environment Variables

### Theme and Brand

- `POE_CODE_THEME`: forces the rendering mode when set to `light` or `dark`. It takes precedence over `POE_THEME` and automatic terminal theme detection.
- `POE_THEME`: legacy light/dark override used when `POE_CODE_THEME` is not set to a valid mode.
- `POE_BRAND`: debug-only built-in or registered brand override. An explicit `configureTheme({ brand })` call takes precedence. Unknown values are ignored.
- `APPLE_INTERFACE_STYLE`: automatic macOS theme hint used when no valid explicit light/dark override is present.
- `VSCODE_COLOR_THEME_KIND`: automatic VS Code theme hint used after the macOS hint.
- `COLORFGBG`: terminal foreground/background hint used after the macOS and VS Code hints. Rendering defaults to dark when no hint resolves a mode.

### Prompts

- `POE_NO_PROMPT`: when set to `1` in non-TTY contexts, `confirm`, `select`, and `multiselect` accept their default or initial values instead of throwing an interactive TTY error.

### Node 18 Smoke

After building the package, verify the prompt entrypoint under Node 18 with:

```sh
nvm exec 18.18 node packages/toolcraft-design/scripts/check-node18.mjs
```

### Output and Color

- `OUTPUT_FORMAT`: selects `terminal`, `markdown`, or `json` output for components that use the output-format resolver. Invalid or missing values default to `terminal`.
- `FORCE_COLOR`: enables color when present and not `0`, taking precedence over `NO_COLOR`.
- `NO_COLOR`: disables color when `FORCE_COLOR` does not enable it.
- `TERM`: participates in color support detection; an unset or `dumb` terminal disables color unless forced.
- `POE_NO_SPINNER`: uses non-animated spinner behavior when set to `1`.
