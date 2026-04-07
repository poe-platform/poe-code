# cmdkit

Define once. Run as CLI, interactive prompt, MCP tool, or SDK function.

## The Problem

Every CLI tool reimplements the same pattern: parse args, validate, prompt for missing values, format output. When you add MCP support, you duplicate the schema. When you add an SDK, you duplicate the types. Three interfaces, three sources of truth.

## The Solution

```typescript
import { defineCommand, S } from 'cmdkit';

const deploy = defineCommand({
  name: 'deploy',
  description: 'Deploy a service to production',

  params: S.Object({
    service: S.String({ description: 'Service name' }),
    region:  S.Enum(['us-east-1', 'eu-west-1', 'ap-south-1'], { description: 'AWS region' }),
    replicas: S.Number({ default: 2, description: 'Number of replicas' }),
    dry_run: S.Boolean({ default: false, description: 'Preview without deploying' }),
  }),

  secrets: {
    aws_key: { env: 'AWS_ACCESS_KEY_ID' },
    aws_secret: { env: 'AWS_SECRET_ACCESS_KEY' },
  },

  handler: async ({ params, secrets, fetch }) => {
    // ... your logic
    return { service: params.service, status: 'deployed', replicas: params.replicas };
  },
});
```

One definition. Four interfaces.

## Usage

### CLI

```bash
$ mycli deploy --service api --region us-east-1 --replicas 3
```

```
── Deploy ──────────────
  Service:  api
  Region:   us-east-1
  Replicas: 3
  Dry run:  false
? Proceed? (Y/n) y

  Service:  api
  Status:   deployed
  Replicas: 3
```

### Interactive

```bash
$ mycli deploy

? Service: api
? Region: (use arrows)
  > us-east-1
    eu-west-1
    ap-south-1
? Replicas [2]: 3

── Deploy ──────────────
  Service:  api
  Region:   us-east-1
  Replicas: 3
  Dry run:  false
? Proceed? (Y/n) y
```

### Non-interactive (CI)

```bash
$ mycli deploy --service api --region us-east-1 --yes --output json
{"service":"api","status":"deployed","replicas":2}
```

### MCP Tool

```typescript
import { runMCP } from 'cmdkit/mcp';
runMCP([deploy], { name: 'deploy-tools', version: '1.0.0' });
```

The command becomes an MCP tool. `params` becomes `inputSchema` (JSON Schema). Any MCP client can call it.

### SDK (TypeScript)

```typescript
import { deploy } from 'my-tools';

const result = await deploy({
  service: 'api',
  region: 'us-east-1',
  replicas: 3,
});
// result is typed: { service: string, status: string, replicas: number }
```

### SDK (Any Language via WASM - future)

```bash
$ cmdkit build    # compiles handlers to .wasm
$ cmdkit generate python  # generates typed Python wrapper
```

```python
from my_tools import deploy

result = deploy(service="api", region="us-east-1", replicas=3)
```

## Presets

Save common configurations as JSON files:

```json
// presets/staging-api.json
{
  "service": "api",
  "region": "us-east-1",
  "replicas": 1
}
```

```bash
$ mycli deploy --preset staging-api.json
$ mycli deploy --preset staging-api.json --replicas 5  # override
```

Layering order: preset defaults -> CLI flags -> interactive prompts for missing required.

## Output Formats

Every command renders in three formats automatically:

| Format | Flag | When |
|---|---|---|
| Rich CLI | `--output rich` (default) | Human at a terminal |
| Markdown | `--output md` | LLMs, docs, piping |
| JSON | `--output json` | Programmatic, CI |

The framework infers rendering from the return value shape:

| Return shape | Rich CLI | Markdown | JSON |
|---|---|---|---|
| `object` | Key-value table | Key-value list | As-is |
| `array of objects` | Table with columns | Markdown table | As-is |
| `string` | Printed | Printed | `{"result":"..."}` |
| `null/void` | "Done." | "Done." | `{"ok":true}` |

### Auto-rendering rules

The framework inspects the return value and delegates to `@poe-code/design-system`:

- **Rich CLI**: Uses `renderTable()` with theme, `intro()`/`outro()`, `logger.resolved()` for key-value pairs
- **Markdown**: `renderTable()` in markdown mode, `## heading`, `- key: value` lists
- **JSON**: `renderTable()` in JSON mode, or raw `JSON.stringify`

Override when the defaults aren't enough:

```typescript
const getUser = defineCommand({
  // ...
  handler: async ({ params, fetch }) => { ... },

  render: {
    rich: (result, { theme, logger }) => {
      logger.intro('get-user');
      logger.resolved('Name', result.name);
      logger.resolved('Role', result.role);
      logger.resolved('Email', result.email);
    },
    // markdown and json stay automatic
  },
});
```

The `render` override receives the design system primitives - same components the rest of poe-code uses. No new rendering API to learn.

## Schema API (cmdkit-schema)

The schema module is standalone - use it independently for typed JSON Schema.

```typescript
import { S } from 'cmdkit-schema';

// Primitives
S.String({ description: 'Name' })
S.Number({ default: 0 })
S.Boolean()

// Enums
S.Enum(['admin', 'user', 'guest'])

// Arrays
S.Array(S.String())
S.Array(S.Number(), { default: [1, 2, 3] })

// Nested objects
S.Object({
  host: S.String(),
  port: S.Number({ default: 5432 }),
})

// Optional (any type)
S.Optional(S.String())

// Every schema produces JSON Schema
const schema = S.Object({ name: S.String() });
// { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }

// TypeScript infers the type
type Params = Static<typeof schema>;
// { name: string }
```

## Secrets

Secrets are always resolved from environment variables. They are never passed as CLI flags or prompted for interactively.

```typescript
secrets: {
  api_key: { env: 'API_KEY', description: 'Get it from https://example.com/keys' },
}
```

If a secret is missing, the framework prints the error with the description:

```
Error: Missing required secret API_KEY
  Get it from https://example.com/keys
```

## Groups and Nesting

Commands are organized in a tree using `defineGroup`. Groups hold commands or more groups, to any depth. Like `gh repo create`, `gh pr list`.

```typescript
import { defineGroup } from 'cmdkit';

export const generate = defineGroup({
  name: 'generate',
  aliases: ['g'],
  requires: { auth: true },
  secrets: { poe_api_key: { env: 'POE_API_KEY' } },
  children: [text, image, video],
});
```

Everything on a group (`requires`, `secrets`) inherits down to all children. A child can add its own on top.

### Default command

A group can designate one of its children as the default command. When the first token after the group name doesn't match any child's name or alias, it is forwarded to the default command as a positional argument instead of producing an error.

```typescript
export const gh = defineGroup({
  name: 'gh',
  default: run,          // handles: poe-code gh <name>
  children: [run, list, install, uninstall, exec],
});

export const run = defineCommand({
  name: 'run',
  positional: ['name'],
  params: S.Object({
    name:  S.String({ description: 'Automation name' }),
    agent: S.Optional(S.String()),
    model: S.Optional(S.String()),
    interactive: S.Optional(S.Boolean({ short: 'i' })),
  }),
  handler: async ({ params }) => { /* ... */ },
});
```

```bash
poe-code gh github-issue-opened          # forwarded to run, name='github-issue-opened'
poe-code gh run github-issue-opened      # explicit, same result
poe-code gh list                         # normal subcommand, not forwarded
```

The default command must be listed in `children` as well — `default` is just a pointer, not a separate registration.

### File structure mirrors command structure

```
src/commands/
  index.ts              ← root group
  login.ts
  usage.ts
  generate/
    index.ts            ← defineGroup({ children: [text, image, video] })
    text.ts             ← defineCommand
    image.ts            ← defineCommand
    video.ts            ← defineCommand
  bot/
    index.ts            ← defineGroup({ children: [create, list, delete, settings] })
    create.ts
    list.ts
    delete.ts
    settings/
      index.ts          ← defineGroup({ children: [get, set] })
      get.ts
      set.ts
```

Each command is its own file. Each group is a folder with an index that imports its children:

```typescript
// src/commands/generate/text.ts
import { defineCommand, S } from 'cmdkit';

export const text = defineCommand({
  name: 'text',
  description: 'Generate text',
  params: S.Object({
    prompt: S.String(),
    model:  S.String({ default: 'GPT-4.1' }),
  }),
  handler: async ({ params, secrets, fetch }) => {
    // secrets.poe_api_key inherited from generate group
    // ...
  },
});

// src/commands/generate/index.ts
import { defineGroup } from 'cmdkit';
import { text } from './text.js';
import { image } from './image.js';
import { video } from './video.js';

export const generate = defineGroup({
  name: 'generate',
  aliases: ['g'],
  requires: { auth: true },
  secrets: { poe_api_key: { env: 'POE_API_KEY' } },
  children: [text, image, video],
});

// src/commands/index.ts
import { defineGroup } from 'cmdkit';
import { generate } from './generate/index.js';
import { bot } from './bot/index.js';
import { login } from './login.js';
import { usage } from './usage.js';

export const root = defineGroup({
  name: 'poe-code',
  children: [generate, bot, login, usage],
});
```

Adding a new command: create the file, import it in the parent index. Nothing else to wire.

## Scope

MCP is **opt-in**. Commands are only exposed as MCP tools when explicitly scoped. This prevents accidental exposure of commands to LLMs.

Default scope is `['cli', 'sdk']`. To expose a command as an MCP tool, add `'mcp'` to its scope - or to the parent group, which inherits down:

```typescript
// login - CLI only, never in MCP
export const login = defineCommand({
  name: 'login',
  // scope defaults to ['cli', 'sdk'] - no mcp
  handler: async ({ params }) => { ... },
});

// create - explicitly added to MCP
export const createBot = defineCommand({
  name: 'create',
  scope: ['cli', 'mcp', 'sdk'],
  handler: async ({ params, secrets, fetch }) => { ... },
});

// Whole group in MCP - all children inherit
export const bot = defineGroup({
  name: 'bot',
  scope: ['cli', 'mcp', 'sdk'],  // create, list, delete all become MCP tools
  children: [createBot, listBots, deleteBot],
});
```

| Scope | CLI | MCP | SDK |
|---|---|---|---|
| `['cli', 'sdk']` (default) | Yes | No | Yes |
| `['cli']` | Yes | No | No |
| `['cli', 'mcp', 'sdk']` | Yes | Yes | Yes |
| `['cli', 'mcp']` | Yes | Yes | No |
| `['mcp']` | No | Yes | No |

Runners silently skip commands outside their scope. No runtime errors, they just don't appear.

Two-level filtering for MCP:

| Level | Where | Purpose |
|---|---|---|
| `scope` on command/group | Command definition | Hard gate - command can never appear in MCP |
| `tools` in `runMCP` | Runner config | Runtime filter - which scoped tools to expose in this server instance |

A command must have `'mcp'` in scope AND be listed in `tools` (or have an ancestor listed) to appear as an MCP tool.

## Auto-generated Help

Help is fully derived from the schema, group structure, and descriptions. No manual help text.

```bash
$ poe-code --help
```

```
poe-code

  Generate content, manage bots, and more via Poe API.

Commands:
  generate (g)   Generate content via Poe API
  bot (b)        Manage Poe bots
  login          Authenticate with Poe
  usage          Display balance and usage

Global options:
  --yes          Accept defaults, skip prompts
  --output       Output format (rich, md, json)
  --help         Show help
  --version      Show version
```

```bash
$ poe-code generate --help
```

```
poe-code generate

  Generate content via Poe API.
  Requires: authentication

Commands:
  text           Generate text
  image          Generate an image
  video          Generate a video
```

```bash
$ poe-code generate text --help
```

```
poe-code generate text

  Generate text.

Options:
  --prompt <string>          Generation prompt (required)
  --model <string>           Model identifier (default: GPT-4.1)
  --param <string[]>         Additional key=value parameters

Secrets (via environment):
  POE_API_KEY                Inherited from generate group
```

Everything comes from what's already declared:

| Source | Generates |
|---|---|
| `name`, `description` on command/group | Command listing, header |
| `params` schema (type, description, default, optional) | Options table |
| `secrets` (env, description) | Secrets section |
| `requires` | "Requires: authentication" note |
| `aliases` | Shown next to command name |
| Group nesting | Breadcrumb (`poe-code generate text`) |
| `scope` | Only shows commands available in current runner |

MCP tool descriptions are generated the same way - the `description` field on the tool concatenates the command description with a summary of its parameters.

## Wiring It Up

```typescript
// cli.ts
import { runCLI } from 'cmdkit/cli';
import { root } from './commands/index.js';
runCLI(root);

// mcp.ts - pass tools filter to expose only a specific subset
import { runMCP } from 'cmdkit/mcp';
import { root } from './commands/index.js';

// Expose only usage
runMCP(root, { name: 'poe-usage', version: '1.0.0', tools: ['usage'] });

// Expose a whole group (all children)
runMCP(root, { name: 'poe-generate', version: '1.0.0', tools: ['generate'] });

// Expose specific tools across groups
runMCP(root, { name: 'poe-tools', version: '1.0.0', tools: ['usage', 'generate', 'bot.create', 'bot.list'] });

// sdk.ts - mirrors the nesting
import { createSDK } from 'cmdkit/sdk';
import { root } from './commands/index.js';
export const poeCode = createSDK(root);
// poeCode.generate.text({ prompt: 'hello' })
// poeCode.bot.settings.get({ key: 'model' })
```

## Fixtures

The handler executes fully, but all services are replaced with pre-recorded responses. Triggered by environment variable - no CLI flag, no pollution of the public API surface.

```bash
# Run with first fixture scenario
CMDKIT_FIXTURE=1 poe-code bot create --handle Foo

# Run a named scenario
CMDKIT_FIXTURE="update existing bot" poe-code bot create --handle Foo
```

```
── bot create (fixture) ──────────────
  Action: created
  URL:    https://poe.com/Foo
──────────────────────────────────────
```

Fixture file is co-located with the command file:

```
src/commands/bot/
  create.ts
  create.fixture.json
```

```json
// create.fixture.json
[
  {
    "name": "create new bot",
    "services": {
      "fetch": [
        { "request": { "method": "GET",  "url": "https://api.poe.com/bots/Foo" }, "response": { "status": 404 } },
        { "request": { "method": "POST", "url": "https://api.poe.com/bots" },     "response": { "status": 200, "body": { "handle": "Foo", "id": "abc-123" } } }
      ]
    }
  },
  {
    "name": "update existing bot",
    "services": {
      "fetch": [
        { "request": { "method": "GET",   "url": "https://api.poe.com/bots/Foo" }, "response": { "status": 200, "body": { "handle": "Foo" } } },
        { "request": { "method": "PATCH", "url": "https://api.poe.com/bots/Foo" }, "response": { "status": 200, "body": { "handle": "Foo" } } }
      ]
    }
  }
]
```

Services not mentioned in the fixture scenario fall back to a safe no-op (reads return null, writes succeed silently). No secrets needed in fixture mode.

## Confirmation

Confirmation is a runner concern, not a handler concern. Declare it at the command level:

```typescript
const deploy = defineCommand({
  name: 'deploy',
  confirm: true,  // CLI runner shows params + "Proceed?" before calling handler
  // ...
});
```

| Mode | `confirm: true` | `confirm: false` (default) |
|---|---|---|
| Rich CLI | Shows params preview + "Proceed? (Y/n)" | Runs immediately |
| Rich CLI + `--yes` | Skips confirmation | Runs immediately |
| MCP | Ignored | Runs immediately |
| SDK | Ignored | Runs immediately |

## Requirements

Commands can declare prerequisites. The runner checks them before prompting for params or calling the handler.

```typescript
const generate = defineCommand({
  name: 'generate',
  requires: {
    auth: true,                    // must be logged in (API key present)
    apiVersion: '>=2.0.0',         // minimum API version
  },
  // ...
});
```

If a requirement fails, the runner shows a clear error:

```
Error: Command "generate" requires authentication.
  Run 'poe-code login' first.
```

Built-in requirement checks:

| Requirement | What it checks |
|---|---|
| `auth: true` | API key is present (env var or keychain) |
| `apiVersion: '>=X'` | Server API version satisfies semver range |

Custom requirements via a function:

```typescript
requires: {
  auth: true,
  check: async ({ secrets, env }) => {
    // Custom check - e.g. verify account has media generation enabled
    const res = await fetch('https://api.poe.com/account', {
      headers: { Authorization: `Bearer ${secrets.poe_api_key}` },
    });
    const account = await res.json();
    if (!account.features.includes('media')) {
      return { ok: false, message: 'Media generation not enabled on this account.' };
    }
    return { ok: true };
  },
},
```

## Handler Context

The handler is a pure function. All I/O comes through injected services spread flat on the context - swappable in fixture mode and WASM-ready.

```typescript
handler: async ({ params, secrets, fetch, fs, db, stripe }) => {
  // params:   fully typed, all values resolved
  // secrets:  env vars, resolved
  // fetch:    built-in HTTP client
  // fs:       built-in filesystem
  // db, stripe, ...: custom services declared in the runner
}
```

### Built-in services

| Service | Type | What it is |
|---|---|---|
| `fetch` | `typeof globalThis.fetch` | HTTP client |
| `fs` | `{ readFile, writeFile, exists, ... }` | Filesystem |
| `env` | `{ get(key): string \| undefined }` | Environment variables |

### Custom services

Declare in the runner. Every command in the tree receives them:

```typescript
// cli.ts
runCLI(root, {
  services: {
    db:     createDbClient(process.env.DATABASE_URL),
    cache:  createRedisClient(process.env.REDIS_URL),
    stripe: new Stripe(process.env.STRIPE_KEY),
  },
});
```

```typescript
// src/commands/payment/charge.ts
import type { AppServices } from '../../services.js';

export const charge = defineCommand<AppServices>({
  name: 'charge',
  params: S.Object({
    amount:   S.Number({ description: 'Amount in cents' }),
    customer: S.String(),
  }),
  handler: async ({ params, stripe, db }) => {  // fully typed from AppServices
    const result = await stripe.charges.create({ amount: params.amount, customer: params.customer });
    await db.query('INSERT INTO charges ...', [result.id]);
    return { id: result.id, status: result.status };
  },
});
```

### Name collision guard

Custom service names cannot collide with reserved context keys. The runner throws at startup:

```
Error: Service name "params" is reserved. Choose a different name.
Error: Service name "fetch" conflicts with a built-in service. Use a different name or omit the built-in.
```

Reserved names: `params`, `secrets`, `fetch`, `fs`, `env`.

### Fixture mocking per service

Each service gets its own section in the fixture file:

```json
{
  "name": "successful charge",
  "services": {
    "fetch": [
      { "request": { "method": "POST", "url": "https://api.stripe.com/v1/charges" },
        "response": { "status": 200, "body": { "id": "ch_123", "status": "succeeded" } } }
    ],
    "fs": {
      "readFile": { "/config.json": "{\"maxAmount\": 10000}" }
    },
    "db": {
      "query": [{ "sql": "INSERT INTO charges%", "result": { "rowCount": 1 } }]
    }
  }
}
```

Services not in the fixture fall back to a safe no-op (reads return null, writes succeed silently).

## Error Handling

The framework distinguishes two error types:

```typescript
import { UserError } from 'cmdkit';

handler: async ({ params, fetch }) => {
  const res = await fetch(`https://api.poe.com/bots/${params.handle}`);
  if (res.status === 401) throw new UserError('Invalid API key. Run poe-code login.');
  if (!res.ok) throw new UserError(`API error: ${res.status} ${res.statusText}`);
  // Anything else thrown is a system error - shown with stack trace in verbose mode
}
```

| Error type | Rich CLI | JSON | MCP |
|---|---|---|---|
| `UserError` | Red message, no stack trace | `{"error":"...","code":"user"}` | MCP error response |
| Unhandled throw | Red message + hint to use `--verbose` | `{"error":"...","code":"internal"}` | MCP error response |
| Missing required param | "Option --handle is required" | `{"error":"...","code":"validation"}` | MCP error response |
| Ctrl+C in prompt | "Aborted." | - | - |
| Missing secret | "Missing required secret FOO" | `{"error":"...","code":"config"}` | Error before handler runs |

## Progress

Handlers can report progress during long-running operations via the `progress` context helper:

```typescript
handler: async ({ params, fetch, progress }) => {
  progress('Uploading files...');
  await uploadFiles();
  progress('Deploying service...');
  await deploy();
  return { status: 'deployed' };
}
```

| Mode | Behaviour |
|---|---|
| Rich CLI | Updates spinner subtext |
| JSON | Noop |
| MCP | Noop |
| SDK | Noop (caller can subscribe if needed) |

## CLI Flag Conventions

**Param name casing**: configurable per runner. Schema always uses `snake_case` internally.

```typescript
runCLI(root, { casing: 'kebab' });   // --model-name  (default for CLI)
runCLI(root, { casing: 'snake' });   // --model_name
runMCP(root, { casing: 'snake' });   // tool params as model_name (default for MCP)
```

| Runner | Default casing | Example |
|---|---|---|
| CLI | `kebab` | `--model-name` |
| MCP | `snake` | `model_name` |
| SDK | `camel` | `modelName` |

**Nested param dot-notation**: `S.Object` nested params map to dot-notation flags:

```bash
--database.host prod-db.internal
--database.port 5432
```

## Interactive Behaviour

**Array input**: comma or space-separated, user can enter multiple values:

```
? Input modalities [text]: text, image
```

**Optional vs default**:

| Schema | Interactive behaviour |
|---|---|
| `S.String()` (required) | Always prompted |
| `S.String({ default: 'GPT-4.1' })` | Prompted with `[GPT-4.1]` shown, enter to accept |
| `S.Optional(S.String())` | Skipped (not prompted, value is `undefined`) |

**TTY detection**: when stdin is not a TTY (piped input, CI), interactive prompts are disabled. Missing required params produce an error. Output format auto-switches to JSON when stdout is not a TTY.

## Conditional Secrets

Secrets can be marked optional. The handler is responsible for asserting what's needed:

```typescript
secrets: {
  cf_token:  { env: 'CLOUDFLARE_API_TOKEN', optional: true },
  aws_key:   { env: 'AWS_ACCESS_KEY_ID',    optional: true },
  aws_secret:{ env: 'AWS_SECRET_ACCESS_KEY', optional: true },
},

handler: async ({ params, secrets, fetch }) => {
  if (params.provider === 'cloudflare' && !secrets.cf_token) {
    throw new UserError('CLOUDFLARE_API_TOKEN is required for Cloudflare provider.');
  }
  // ...
}
```

Required secrets (default) are validated before the handler runs. Optional secrets pass through as `undefined` if missing.

## Return Type

The handler's TypeScript return type is inferred automatically - no explicit output schema needed:

```typescript
handler: async ({ params }) => {
  return { action: 'created', url: `https://poe.com/${params.handle}` };
  //       ↑ inferred: { action: string, url: string }
}

// SDK call is fully typed:
const result = await createBot({ handle: 'Foo', ... });
result.url   // string ✓
result.typo  // TS error ✓
```

The auto-renderer uses the runtime shape of the return value (not the static type) to decide how to render.

## Packages

```
packages/cmdkit-schema   Zero deps. Schema builder + TS inference + JSON Schema export.
packages/cmdkit          Depends on cmdkit-schema + commander. defineCommand + runners.
```

Both live in the poe-code monorepo as internal packages. Not published to npm.

---

## Example Commands

### 1. Poe Bot Management

```typescript
import { defineCommand, S } from 'cmdkit';

export const createBot = defineCommand({
  name: 'create-bot',
  description: 'Create or update a Poe bot',

  params: S.Object({
    handle:           S.String({ description: 'Poe Bot Handle' }),
    model_name:       S.String({ description: 'Model identifier (e.g. accounts/fireworks/models/kimi-k2p5)' }),
    base_url:         S.String({ description: 'API base URL' }),
    api_type:         S.Enum(['chat_completions_api', 'custom'], { default: 'chat_completions_api' }),
    context_size:     S.Number({ description: 'Context window size in tokens' }),
    max_input_tokens: S.Number({ description: 'Max input tokens' }),
    input_modalities: S.Array(S.String(), { default: ['text'] }),
    output_modalities:S.Array(S.String(), { default: ['text'] }),
    features:         S.Optional(S.Array(S.String(), { description: 'Supported features' })),
    pricing: S.Object({
      uncached_input: S.Number({ default: 0, description: '$/1M uncached input tokens' }),
      cached_input:   S.Number({ default: 0, description: '$/1M cached input tokens' }),
      output:         S.Number({ default: 0, description: '$/1M output tokens' }),
    }),
  }),

  secrets: {
    poe_api_key:       { env: 'POE_API_KEY', description: 'https://poe.com/api/keys' },
    fireworks_api_key: { env: 'FIREWORKS_API_KEY' },
  },

  confirm: true,

  handler: async ({ params, secrets, fetch }) => {
    const { handle, pricing, ...settings } = params;

    const headers = {
      Authorization: `Bearer ${secrets.poe_api_key}`,
      'Content-Type': 'application/json',
    };

    const toPerToken = (perMillion: number) => (perMillion / 1_000_000).toFixed(10);
    const botSettings = {
      ...settings,
      api_key: secrets.fireworks_api_key,
      pricing: {
        prompt: toPerToken(pricing.uncached_input),
        completion: toPerToken(pricing.output),
        input_cache_reads: toPerToken(pricing.cached_input),
      },
    };

    const existing = await fetch(`https://api.poe.com/bots/${handle}`, { headers });

    if (existing.ok) {
      const res = await fetch(`https://api.poe.com/bots/${handle}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ api_bot_settings: botSettings }),
      });
      return { action: 'updated', bot: await res.json(), url: `https://poe.com/${handle}` };
    }

    const res = await fetch('https://api.poe.com/bots', {
      method: 'POST',
      headers,
      body: JSON.stringify({ handle, api_bot_settings: botSettings }),
    });
    return { action: 'created', bot: await res.json(), url: `https://poe.com/${handle}` };
  },
});
```

```bash
# Full CLI
$ poe-tools create-bot \
    --handle Kimi-K2.5-FW \
    --model-name accounts/fireworks/models/kimi-k2p5 \
    --base-url https://api.fireworks.ai/inference/v1 \
    --context-size 262144 \
    --max-input-tokens 245760 \
    --input-modalities text image \
    --features tools

# From preset
$ poe-tools create-bot --preset presets/kimi-k2p5.json

# Interactive
$ poe-tools create-bot
? Handle: Kimi-K2.5-FW
? Model name: accounts/fireworks/models/kimi-k2p5
? Base URL: https://api.fireworks.ai/inference/v1
? API type: chat_completions_api
? Context size: 262144
? Max input tokens: 245760
? Input modalities [text]: text, image
? Output modalities [text]: ↵
? Features: tools
? Pricing ($/1M tokens)
    ? Uncached input [0]: ↵
    ? Cached input [0]: ↵
    ? Output [0]: ↵

── create-bot ──────────────────────
  Handle:           Kimi-K2.5-FW
  Model:            accounts/fireworks/models/kimi-k2p5
  Base URL:         https://api.fireworks.ai/inference/v1
  Context Size:     262,144
  Max Input Tokens: 245,760
  Input:            text, image
  Output:           text
  Features:         tools
  Pricing:          $0.00 / $0.00 / $0.00
? Proceed? (Y/n) y

  Action: created
  URL:    https://poe.com/Kimi-K2.5-FW
```

### 2. GitHub Release

```typescript
export const createRelease = defineCommand({
  name: 'create-release',
  description: 'Create a GitHub release with changelog',

  params: S.Object({
    repo:       S.String({ description: 'owner/repo' }),
    tag:        S.String({ description: 'Tag name (e.g. v1.2.0)' }),
    title:      S.Optional(S.String({ description: 'Release title (defaults to tag)' })),
    draft:      S.Boolean({ default: false }),
    prerelease: S.Boolean({ default: false }),
    generate_notes: S.Boolean({ default: true, description: 'Auto-generate release notes' }),
  }),

  secrets: {
    github_token: { env: 'GITHUB_TOKEN' },
  },

  confirm: true,

  handler: async ({ params, secrets, fetch }) => {
    const { repo, tag, title, ...opts } = params;
    const [owner, name] = repo.split('/');

    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/releases`, {
      method: 'POST',
      headers: {
        Authorization: `token ${secrets.github_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tag_name: tag,
        name: title ?? tag,
        draft: opts.draft,
        prerelease: opts.prerelease,
        generate_release_notes: opts.generate_notes,
      }),
    });

    const release = await res.json();
    return { id: release.id, url: release.html_url, tag, draft: opts.draft };
  },
});
```

```bash
$ my-tools create-release --repo myorg/api --tag v2.1.0
$ my-tools create-release --repo myorg/api --tag v2.1.0-beta.1 --prerelease
$ my-tools create-release  # interactive: prompts for repo, tag, etc.
```

### 3. Database Migration

```typescript
export const migrate = defineCommand({
  name: 'migrate',
  description: 'Run database migrations',

  params: S.Object({
    direction: S.Enum(['up', 'down'], { default: 'up' }),
    steps:     S.Optional(S.Number({ description: 'Number of migrations to run' })),
    database: S.Object({
      host:     S.String({ default: 'localhost' }),
      port:     S.Number({ default: 5432 }),
      name:     S.String({ description: 'Database name' }),
      ssl:      S.Boolean({ default: false }),
    }),
  }),

  secrets: {
    db_user:     { env: 'DB_USER' },
    db_password: { env: 'DB_PASSWORD' },
  },

  confirm: true,

  handler: async ({ params, secrets }) => {
    const { direction, steps, database } = params;

    const pending = await getPendingMigrations(database, secrets, direction);
    const toRun = steps ? pending.slice(0, steps) : pending;

    const results = [];
    for (const migration of toRun) {
      await runMigration(migration, direction, database, secrets);
      results.push({ name: migration.name, status: 'applied' });
    }

    return results;
  },
});
```

```bash
# CLI
$ db-tools migrate --direction up --database.name myapp --database.host prod-db.internal

# Interactive
$ db-tools migrate
? Direction: up / down
? Database
    ? Host [localhost]: prod-db.internal
    ? Port [5432]: ↵
    ? Name: myapp
    ? SSL [false]: true

── migrate ──────────────────────────────
  Direction:  up
  Steps:      -
  Database:
    Host: prod-db.internal
    Port: 5432
    Name: myapp
    SSL:  true
? Proceed? (Y/n) y

┌─────────────────────┬─────────┐
│ Name                │ Status  │
├─────────────────────┼─────────┤
│ 001_create_users    │ applied │
│ 002_add_email_index │ applied │
│ 003_create_orders   │ applied │
└─────────────────────┴─────────┘
```

### 4. Multi-cloud DNS Record

```typescript
export const setDns = defineCommand({
  name: 'set-dns',
  description: 'Create or update a DNS record',

  params: S.Object({
    provider: S.Enum(['cloudflare', 'route53', 'gcp']),
    zone:     S.String({ description: 'DNS zone (e.g. example.com)' }),
    name:     S.String({ description: 'Record name (e.g. api)' }),
    type:     S.Enum(['A', 'AAAA', 'CNAME', 'TXT', 'MX'], { default: 'A' }),
    value:    S.String({ description: 'Record value' }),
    ttl:      S.Number({ default: 300 }),
    proxied:  S.Optional(S.Boolean({ description: 'Cloudflare proxy (Cloudflare only)' })),
  }),

  secrets: {
    cf_token:     { env: 'CLOUDFLARE_API_TOKEN', description: 'Required for Cloudflare' },
    aws_key:      { env: 'AWS_ACCESS_KEY_ID', description: 'Required for Route53' },
    aws_secret:   { env: 'AWS_SECRET_ACCESS_KEY', description: 'Required for Route53' },
    gcp_key_file: { env: 'GOOGLE_APPLICATION_CREDENTIALS', description: 'Required for GCP' },
  },

  confirm: true,

  handler: async ({ params, secrets, fetch }) => {
    // Provider-specific logic...
    const result = await setRecord(params, secrets, fetch);
    return { record: `${params.name}.${params.zone}`, type: params.type, value: params.value, ttl: params.ttl };
  },
});
```

```bash
$ dns set-dns --provider cloudflare --zone example.com --name api --value 1.2.3.4 --proxied
$ dns set-dns  # interactive: select provider, fill in fields

# As MCP tool - an LLM can call this directly
# As SDK:
import { setDns } from 'dns-tools';
await setDns({ provider: 'cloudflare', zone: 'example.com', name: 'api', value: '1.2.3.4' });
```

### 5. poe-code generate (real-world migration)

This is what the existing 400-line `src/cli/commands/generate.ts` would look like as a cmdkit command:

```typescript
import { defineCommand, S } from 'cmdkit';

export const generateText = defineCommand({
  name: 'generate',
  description: 'Generate text via Poe API',
  aliases: ['g'],

  requires: {
    auth: true,
  },

  positional: ['prompt'],

  params: S.Object({
    prompt: S.String({ description: 'Generation prompt' }),
    model:  S.String({ default: 'GPT-4.1', description: 'Model identifier' }),
    param:  S.Optional(S.Array(S.String(), { description: 'Additional key=value parameters' })),
  }),

  secrets: {
    poe_api_key: { env: 'POE_API_KEY' },
  },

  handler: async ({ params, secrets, fetch }) => {
    const kvParams = parseKeyValues(params.param ?? []);

    const res = await fetch('https://api.poe.com/generate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.poe_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        ...kvParams,
      }),
    });

    const data = await res.json();
    return { model: params.model, content: data.content };
  },

  render: {
    rich: (result, { withSpinner }) => {
      // Custom: stream-style output with spinner
    },
  },
});

export const generateImage = defineCommand({
  name: 'generate image',
  description: 'Generate an image via Poe API',

  requires: {
    auth: true,
  },

  params: S.Object({
    prompt: S.String({ description: 'Generation prompt' }),
    model:  S.String({ default: 'gpt-image-1', description: 'Model identifier' }),
    output: S.Optional(S.String({ short: 'o', description: 'Output file path' })),
    param:  S.Optional(S.Array(S.String(), { description: 'Additional key=value parameters' })),
  }),

  secrets: {
    poe_api_key: { env: 'POE_API_KEY' },
  },

  handler: async ({ params, secrets, fetch }) => {
    const kvParams = parseKeyValues(params.param ?? []);

    const res = await fetch('https://api.poe.com/generate/image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.poe_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        ...kvParams,
      }),
    });

    const data = await res.json();
    return { model: params.model, url: data.url, saved: params.output };
  },
});
```

```bash
# Text generation
$ poe-code generate "Write a safe JSON parser" --model gpt-4.1
$ poe-code generate --model gpt-4.1 "Write a safe JSON parser" --param temperature=0.5

# Image generation
$ poe-code generate image "A rubber duck with sunglasses" -o duck.png
$ poe-code generate image "A rubber duck with sunglasses" --model gpt-image-1

# Interactive
$ poe-code generate
? Prompt: Write a safe JSON parser
? Model [GPT-4.1]: ↵

# SDK
import { generateText } from 'poe-code';
const result = await generateText({ prompt: 'Hello', model: 'gpt-4.1' });

# MCP - same command exposed as tool, LLM calls it directly
```

**What changed vs the current 400-line implementation:**
- No manual Commander wiring (30+ lines → declared in schema)
- No manual option resolution / parent merging (40+ lines → framework handles)
- No manual model resolution cascade (30+ lines → `default` + env in schema)
- No manual client initialization (20+ lines → `requires: { auth: true }` + injected `fetch`)
- No manual fixture setup (set `CMDKIT_FIXTURE=1` to run with mocked services)
- No manual error formatting (framework renders errors consistently)
- Business logic stays the same, boilerplate disappears
