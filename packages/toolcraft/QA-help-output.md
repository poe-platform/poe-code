# Help Output QA

This is a manual QA walkthrough. It is not a test runner and should be executed by a human.

## Example Consumer

Run from the `packages/toolcraft` package:

```sh
cd packages/toolcraft
npm run build
npm run build -w tiny-stdio-mcp-test-server
```

Create this temporary one-file consumer as `QA-help-example.ts` inside `packages/toolcraft`. It uses only local workspace packages and does not depend on `ashby-mcp`.

```ts
import { fileURLToPath } from "node:url";
import { S, defineCommand, defineGroup } from "./src/index.js";
import { runCLI } from "./src/cli.js";

const serverCli = fileURLToPath(
  new URL("../tiny-stdio-mcp-test-server/dist/cli.js", import.meta.url)
);

const daily = defineCommand({
  name: "daily",
  description:
    "Build a daily operational report with a deliberately long description so wrapping can be inspected at narrow terminal widths.",
  positional: ["accountId"],
  params: S.Object({
    accountId: S.String({
      description: "Account id to inspect"
    }),
    includeArchived: S.Boolean({
      description: "Include archived records in the report",
      default: false
    }),
    date: S.String({
      description:
        "Report date used for selecting records and aligning all time-based metrics in the generated output.",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$"
    })
  }),
  secrets: {
    reportToken: {
      env: "TOOLCRAFT_QA_TOKEN",
      description: "Token used by the report backend."
    }
  },
  handler: async ({ params }) => ({
    accountId: params.accountId,
    date: params.date,
    includeArchived: params.includeArchived
  })
});

const renderString = defineCommand({
  name: "string",
  description: "Return a plain string.",
  params: S.Object({}),
  handler: async () => "plain string"
});

const renderLines = defineCommand({
  name: "lines",
  description: "Return multiple lines.",
  params: S.Object({}),
  handler: async () => ["first line", "second line"]
});

const renderObject = defineCommand({
  name: "object",
  description: "Return an object.",
  params: S.Object({}),
  handler: async () => ({ status: "ok", count: 2, nested: { enabled: true } })
});

const renderErrorEnvelope = defineCommand({
  name: "error-envelope",
  description: "Return an MCP CallToolResult with isError true.",
  params: S.Object({}),
  handler: async () => ({
    content: [{ type: "text", text: "upstream failure" }],
    isError: true
  })
});

const reports = defineGroup({
  name: "reports",
  description: "Report commands",
  children: [daily]
});

const render = defineGroup({
  name: "render",
  description: "Renderer examples",
  children: [renderString, renderLines, renderObject, renderErrorEnvelope]
});

const upstream = defineGroup({
  name: "upstream",
  description: "Local MCP proxy examples",
  mcp: {
    transport: "stdio",
    command: process.execPath,
    args: [serverCli, "serve", "word-of-the-day"]
  },
  children: []
});

const root = defineGroup({
  name: "toolcraft-qa",
  description: "Help output QA fixture",
  children: [reports, render, upstream]
});

await runCLI(root, {
  presets: true,
  rootDisplayName: "toolcraft-qa",
  rootUsageName: "toolcraft-qa",
  version: "0.1.0"
});
```

Use this command shape for all examples below:

```sh
npm exec -- tsx QA-help-example.ts -- <args>
```

When finished, remove the temporary file and local MCP cache:

```sh
rm -f QA-help-example.ts
rm -rf .toolcraft
```

## Help Capture

For each width below, resize the terminal to the target width and confirm it with `tput cols`. Capture the screen or terminal output for all three commands.

### 60 Columns

```sh
tput cols
npm exec -- tsx QA-help-example.ts -- --help
npm exec -- tsx QA-help-example.ts -- reports --help
npm exec -- tsx QA-help-example.ts -- reports daily --help
```

### 100 Columns

```sh
tput cols
npm exec -- tsx QA-help-example.ts -- --help
npm exec -- tsx QA-help-example.ts -- reports --help
npm exec -- tsx QA-help-example.ts -- reports daily --help
```

### 160 Columns

```sh
tput cols
npm exec -- tsx QA-help-example.ts -- --help
npm exec -- tsx QA-help-example.ts -- reports --help
npm exec -- tsx QA-help-example.ts -- reports daily --help
```

## Help Acceptance Checklist

Apply this checklist to every captured root, group, and leaf help screen.

- [ ] Heading is `<program> — <description>` with no leading space and no blank heading line
- [ ] `Usage:` line is present
- [ ] Section header is `Commands` / `Options` / `Secrets (environment)` — no trailing colons
- [ ] `-h, --help` is NOT listed under Options
- [ ] `--preset` is listed only when `presets:true` was passed
- [ ] `--version` is listed only when `version` is set
- [ ] Boolean flags render as `--flag`, not `--flag [value]`
- [ ] Pattern-constrained scalar renders the human token, such as `<YYYY-MM-DD>`, not `<string>`
- [ ] Description column wraps at the right edge; continuation lines align with the description column

## Run Output

Set the required report secret once before running output checks:

```sh
export TOOLCRAFT_QA_TOKEN=qa-secret
```

Run a command whose handler returns a string:

```sh
npm exec -- tsx QA-help-example.ts -- render string
```

Run a command whose handler returns `string[]`:

```sh
npm exec -- tsx QA-help-example.ts -- render lines
```

Run a command whose handler returns an object:

```sh
npm exec -- tsx QA-help-example.ts -- render object
```

Run a command whose handler is an MCP proxy returning a `CallToolResult`:

```sh
npm exec -- tsx QA-help-example.ts -- upstream word-of-the-day
```

Run a command whose handler returns `isError:true`:

```sh
npm exec -- tsx QA-help-example.ts -- render error-envelope
echo $?
```

## Run Output Acceptance Checklist

- [ ] `string` -> printed as-is
- [ ] `string[]` -> one per line
- [ ] `object` -> YAML
- [ ] MCP envelope -> unwrapped to its payload, then rendered per the rules above
- [ ] `isError` -> payload to stderr, process exit code 1
