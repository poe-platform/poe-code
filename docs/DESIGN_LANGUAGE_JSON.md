# Design Language JSON

Text reference for poe-code CLI design elements rendered in JSON mode.

This document is auto-generated. Run `npm run generate:design-docs:json` to regenerate.

## Package Overview

The public `toolcraft/design` export provides consistent visual styling for the poe-code CLI.

```typescript
// Import components
import { text, symbols, intro, outro, log } from "toolcraft/design";

// Import tokens for advanced customization
import { brand, dark, light, spacing, typography, widths } from "toolcraft/design";
```

## Design Tokens

Foundational values that ensure consistency:

| Token               | Value     | Description                      |
| ------------------- | --------- | -------------------------------- |
| `brand`             | `#a200ff` | Primary brand color (Poe purple) |
| `spacing.sm`        | `1`       | Small spacing unit               |
| `spacing.md`        | `2`       | Medium spacing unit              |
| `spacing.lg`        | `4`       | Large spacing unit               |
| `widths.header`     | `60`      | Header line width                |
| `widths.helpColumn` | `24`      | Help text column width           |
| `widths.maxLine`    | `80`      | Maximum line width               |

## Theme Palettes

The design system supports dark and light themes, auto-detected from environment:

```typescript
import { getTheme, resolveThemeName } from "toolcraft/design";

const themeName = resolveThemeName(); // 'dark' or 'light'
const palette = getTheme();
console.log(palette.header("Title"));
```

**Environment variables checked (in order):**

- `POE_CODE_THEME` - explicit override ('dark' or 'light')
- `APPLE_INTERFACE_STYLE` - macOS appearance
- `VSCODE_COLOR_THEME_KIND` - VS Code theme
- `COLORFGBG` - terminal color hint

Each example below shows the NDJSON output captured with `OUTPUT_FORMAT=json`.

## Layout Patterns

Standard command layout patterns. These show complete UI flows from start to finish.

### layout-basic

Core layout: intro banner, info messages, resolved prompts, success message

```typescript
import { intro, outro, log, symbols } from "toolcraft/design";

intro("Configure");
log.message("Configuring...", { symbol: symbols.info });
log.message("Provider\n   claude", { symbol: symbols.resolved });
log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
outro("Configuration complete.");
```

```json
{"level":"info","message":"Configuring claude-code..."}
{"level":"message","message":"Provider\n   claude"}
{"level":"message","message":"API Key\n   poe-abc...xyz"}
{"type":"outro","message":"Configuration complete."}
```

### layout-expanded

Full layout with note and outro: intro, resolved prompts, success, note box, outro

```typescript
import { intro, outro, note, log, symbols } from "toolcraft/design";

intro("configure claude-code");
log.message("Claude Code default model\n   Claude-Opus-4.6", { symbol: symbols.resolved });
log.message("Configured Claude Code.", { symbol: symbols.success });
note("If using VSCode...\nvscode://settings/...", "Next steps.");
outro("Problems? https://...");
```

```json
{"level":"message","message":"Claude Code default model\n   Claude-Opus-4.6"}
{"level":"success","message":"Configured Claude Code."}
{"type":"note","title":"Next steps.","message":"If using VSCode - Open the Disable Login Prompt setting and check the box.\nvscode://settings/claudeCode.disableLoginPrompt"}
{"type":"outro","message":"Problems? https://github.com/poe-platform/poe-code/issues"}
```

## Text Styles

Semantic text styling functions for consistent CLI output. Import from `toolcraft/design`.

### intro

Prominent introductory banners with brand background

```typescript
import { text } from "toolcraft/design";
text.intro("Configure");
```

```json

```

### heading

Section headings with brand accent color

```typescript
import { text } from "toolcraft/design";
text.heading("Available Commands");
```

```json
Available Commands
```

### section

Bold text for subsection labels

```typescript
import { text } from "toolcraft/design";
text.section("Options:");
```

```json
Options:
```

### command

CLI command names in accent color

```typescript
import { text } from "toolcraft/design";
text.command("poe-code configure");
```

```json
poe-code configure
```

### argument

Command arguments (dimmed)

```typescript
import { text } from "toolcraft/design";
text.argument("<provider>");
```

```json
<provider>
```

### option

CLI flags and options in yellow

```typescript
import { text } from "toolcraft/design";
text.option("--dry-run");
```

```json
--dry-run
```

### example

Example text (dimmed)

```typescript
import { text } from "toolcraft/design";
text.example("$ poe-code configure claude");
```

```json
$ poe-code configure claude
```

### usageCommand

Commands in usage examples (green)

```typescript
import { text } from "toolcraft/design";
text.usageCommand("npm install -g poe-code");
```

```json
npm install -g poe-code
```

### link

Hyperlinks and references

```typescript
import { text } from "toolcraft/design";
text.link("https://poe.com");
```

```json
https://poe.com
```

### muted

De-emphasized text

```typescript
import { text } from "toolcraft/design";
text.muted("(optional)");
```

```json
(optional)
```

## Symbols

Status indicators and visual markers. Use with `log.message()` for structured output.

### info

Information indicator (magenta dot)

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Configuring claude-code...", { symbol: symbols.info });
```

```json
{ "level": "message", "message": "info" }
```

### success

Success indicator (magenta diamond)

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Configuration complete!", { symbol: symbols.success });
```

```json
{ "level": "message", "message": "success" }
```

### resolved

Resolved/completed indicator (hollow diamond)

```typescript
import { log, symbols } from "toolcraft/design";
log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
```

```json
{ "level": "message", "message": "resolved" }
```

### errorResolved

Error with details indicator (red square)

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Config Failed\n   Missing API key", { symbol: symbols.errorResolved });
```

```json
{ "level": "message", "message": "errorResolved" }
```

## Log Messages

Structured logging with appropriate visual weight. Import `log` from the prompts module.

### log-info

Informational messages during operations

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Configuring claude-code...", { symbol: symbols.info });
```

```json
{ "level": "info", "message": "Configuring claude-code..." }
```

### log-success

Success confirmation messages

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Configuration complete!", { symbol: symbols.success });
```

```json
{ "level": "success", "message": "Configuration complete!" }
```

### log-warn

Warning messages for non-critical issues

```typescript
import { log } from "toolcraft/design";
log.warn("API key expires in 7 days");
```

```json
{ "level": "warn", "message": "API key expires in 7 days" }
```

### log-error

Error messages for failures

```typescript
import { log } from "toolcraft/design";
log.error("Failed to write config file");
```

```json
{ "level": "error", "message": "Failed to write config file" }
```

## Prompts

Interactive prompts for user input. Import from `toolcraft/design`.

### prompt-intro

Command intro banner with animation

```typescript
import { intro } from "toolcraft/design";
intro("Configure");
```

```json

```

### prompt-note

Boxed note for next steps or important info

```typescript
import { note } from "toolcraft/design";
note("Run poe-code test", "Next steps.");
```

```json
{
  "type": "note",
  "title": "Next steps.",
  "message": "Run the following command to test:\n  poe-code test claude-code"
}
```

### prompt-outro

Command outro with feedback link

```typescript
import { outro } from "toolcraft/design";
outro("Problems? https://...");
```

```json
{ "type": "outro", "message": "Problems? https://github.com/poe-platform/poe-code/issues" }
```

### prompt-resolved

Resolved prompt value display

```typescript
import { log, symbols } from "toolcraft/design";
log.message("API Key\n   poe-abc...xyz", { symbol: symbols.resolved });
```

```json
{ "level": "message", "message": "API Key\n   poe-abc...xyz\n   Expires: 2026-12-31" }
```

### prompt-errorResolved

Error with details display

```typescript
import { log, symbols } from "toolcraft/design";
log.message("Config Failed\n   Missing API key", { symbol: symbols.errorResolved });
```

```json
{
  "level": "message",
  "message": "Configuration Failed\n   Missing API key\n   Check your .env file or run poe-code login"
}
```

### menu

Interactive select prompt for choosing options

```typescript
import { select } from "toolcraft/design";
const choice = await select({
  message: "Pick an agent:",
  options: [
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex CLI" }
  ]
});
```

```json
{
  "type": "menu",
  "message": "Pick an agent:",
  "options": [
    { "value": "claude-code", "label": "Claude Code" },
    { "value": "codex", "label": "Codex CLI" },
    { "value": "aider", "label": "Aider" }
  ],
  "selected": 0
}
```

## Static Rendering

Utilities for rendering UI elements as static strings (for screenshots, tests, or non-interactive output).

### spinner-dots

Animated dots spinner for async operations

```typescript
import { spinner } from "toolcraft/design";
const s = spinner();
s.start("Configuring...");
await doWork();
s.stop("Done!");
```

```json
{"type":"spinner","state":"running","message":"Configuring claude-code..."}

{"type":"spinner","state":"stopped","message":"Configuration complete!","code":0,"subtext":"claude-code is ready to use"}
```

### spinner-timer

Timer spinner showing elapsed time

```typescript
import { renderSpinnerFrame, renderSpinnerStopped } from "toolcraft/design";
const frame = renderSpinnerFrame({ message: "Processing...", timer: "1s" });
const stopped = renderSpinnerStopped({ message: "Complete!", timer: "2s" });
```

```json
{"type":"spinner","state":"running","message":"Configuring claude-code...","timer":"1s"}

{"type":"spinner","state":"stopped","message":"Configuration complete!","code":0,"timer":"2s","subtext":"claude-code is ready to use"}
```

### table

Styled terminal table with themed borders and column alignment

```typescript
import { renderTable, getTheme } from "toolcraft/design";

const output = renderTable({
  theme: getTheme(),
  columns: [
    { name: "Model", title: "Model", alignment: "left", maxLen: 30 },
    { name: "Context", title: "Context", alignment: "right", maxLen: 9 }
  ],
  rows: [{ Model: "anthropic/claude-sonnet-4", Context: "200K" }]
});
```

```json
[
  {
    "Model": "anthropic/claude-sonnet-4",
    "Context": "200K",
    "Price": "$3.00/$15.00"
  },
  {
    "Model": "openai/gpt-4o",
    "Context": "128K",
    "Price": "$2.50/$10.00"
  },
  {
    "Model": "google/gemini-2.0-flash",
    "Context": "1M",
    "Price": "$0.10/$0.40"
  }
]
```

### diff

Unified diff display for file changes (used in --dry-run)

```typescript
import { color, log } from "toolcraft/design";
const diffLines = [
  color.gray("--- config.json"),
  color.red('-  "model": "gpt-4",'),
  color.green('+  "model": "claude-sonnet-4",')
];
log.message(diffLines.join("\n"), { symbol: color.yellow("~") });
```

```json
{
  "level": "message",
  "message": "--- config.json\n+++ config.json\n@@ -1,3 +1,5 @@\n {\n-  \"model\": \"gpt-4\",\n+  \"model\": \"claude-sonnet-4\",\n   \"temperature\": 0.7\n+  \"maxTokens\": 4096\n }"
}
```

## Dashboard

Full-screen interactive terminal dashboard with output pane, stats pane, and keyboard navigation. Used for monitoring long-running agent sessions.

### dashboard

Two-pane dashboard layout with scrollable output on the left, live stats on the right, and keyboard hints in the footer

```typescript
import { createDashboard } from "toolcraft/design";

const dashboard = createDashboard({
  title: "Agent Output",
  statsTitle: "Stats"
});

dashboard.start();
dashboard.appendOutput({ kind: "info", text: "Analyzing repository state", ts: Date.now() });
dashboard.updateStats({
  status: "running",
  iterations: 5,
  tokensIn: 685,
  tokensOut: 445,
  elapsedMs: 5000
});
```

```json
┌─ Agent Output ─────────────────────────────────────┬─ Stats ─────────────────┐
│◇  Analyzing repository state                       │Status            Running│
││  Running npm test -- --runInBand                  │Iteration               5│
│◆  Generated provider config                        │Elapsed          00:00:05│
│●  Streaming model response                         │                         │
│◇  Inspecting agent configuration                   │Tokens In             685│
││  Executing npm run lint:types                     │Tokens Out            445│
│■  Retrying transient network request               │Total               1,130│
│◆  Updated dashboard layout                         │                         │
│◇  Collecting recent command output                 │Current:                 │
│●  Waiting for follow-up task                       │  Executing tool call    │
│                                                    │                         │
│                                                    │                         │
│                                                    │                         │
│                                                    │                         │
│                                                    │                         │
│                                                    │                         │
├────────────────────────────────────────────────────┴─────────────────────────┤
│                   q Quit  e Edit  l Log  p Pause  r Retry                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Terminal Markdown

Reference demos for the terminal markdown renderer, covering both the full showcase and a minimal validation sample.

### terminal-markdown

Full markdown renderer showcase with headings, lists, tables, blockquotes, alerts, links, and footnotes.

```typescript
import { renderMarkdown } from "toolcraft/design";

const markdown = [
  "# Design System Markdown",
  "",
  "Paragraph with **bold** text and a [docs link](https://example.com/docs).",
  "",
  "- unordered item",
  "1. ordered item"
].join("\n");

process.stdout.write(renderMarkdown(markdown));
```

```json
Design System Markdown
──────────────────────

Overview

Renderer Features

Paragraph with bold, italic, strikethrough, code span, a docs link
(https://example.com/docs), an image [image: System diagram], and a footnote
reference[1].

 ─────────────────────────
 const agent = "poe-code";
 console.log(agent);
 ─────────────────────────

 Outer quote

  Nested quote

 • unordered item
 • another unordered item

 1. ordered item
 2. another ordered item

 active completed task
 inactive pending task

 Feature   Alignment  Status
├──────────┼───────────┼────────┤
 Headings   center     Ready
 Tables     aligned     100%

 Note
 Alerts are rendered as styled notes.

────────────────────────────────────────────────────────────────────────────────

 [1] Footnote definition for the markdown demo.
```

### terminal-markdown-minimal

Compact markdown renderer sample for quick validation of headings, prose, and fenced code blocks.

````typescript
import { renderMarkdown } from "toolcraft/design";

const markdown = [
  "# Markdown Minimal",
  "",
  "Quick validation",
  "",
  "```js",
  'console.log("demo");',
  "```"
].join("\n");

process.stdout.write(renderMarkdown(markdown));
````

```json
Markdown Minimal
────────────────

Quick validation paragraph.

 ────────────────────
 console.log("demo");
 ────────────────────
```
