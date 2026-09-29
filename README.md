<div align="center">
  <h1>Poe Code ⚡</h1>

<a href="https://poe.com"><img src="https://img.shields.io/badge/Poe-Sign up-purple?logo=poe&logoColor=white&color=5D5CDE&style=for-the-badge" alt="Discord"></a>
<a href="https://www.npmjs.com/package/poe-code"><img alt="NPM version" src="https://img.shields.io/npm/v/poe-code.svg?&style=for-the-badge&color=09B16B"></a>
<a href="https://discord.gg/joinpoe"><img src="https://img.shields.io/badge/Discord-Join-purple?logo=discord&logoColor=white&color=FF44D3&style=for-the-badge" alt="Discord"></a>

</div>

Power your favorite coding agents (Claude Code, Codex, OpenCode, and more) with your Poe subscription—**no need to handle multiple providers/accounts.** Poe Code routes everything through the [Poe API](https://poe.com/api) .

Configure an agent once and use its normal CLI or desktop app, or spawn one-off prompts through Poe.

## Quickstart

### Set it as your default (works with CLIs and desktop apps)

This updates the provider’s config files and continue using your tools normally.

```bash
# Start the interactive setup
npx poe-code@latest configure

# Setup a specific agent
npx poe-code@latest configure codex # (or claude, opencode, goose)
```

### Unconfigure (remove overrides)

```bash
npx poe-code@latest unconfigure claude
```

## Authentication

Poe Code uses your [Poe API key](https://poe.com/api) for authentication. On first run, you'll be prompted to log in via your browser (OAuth). You can also provide your key directly:

```bash
# Interactive login (opens browser)
npx poe-code@latest login

# Or pass your API key directly
npx poe-code@latest login --api-key <your-key>

# Or set it as an environment variable
export POE_API_KEY=<your-key>
```

Credentials are stored locally in `~/.poe-code/`. Use `poe-code auth status` to check your login state.

```bash
# Remove all configuration and credentials
npx poe-code@latest logout
```

## Quick links

- [Utilities](#utilities)
- [Usage and Billing](#usage--billing)
- [Models](#models)
- [SDK](#sdk)
- [Research Preview](#research-preview)
- [Poe API](https://poe.com/api)

## Utilities

Utilities are especially useful for scripting and CI/CD.

#### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello" --mode read
```

`--mode` is the permission mode: `yolo | auto | edit | read`.

#### Spawn against a GitHub repository

```bash
npx poe-code@latest spawn codex "Fix the failing tests" --cwd github://owner/repo --mode edit
npx poe-code@latest spawn codex "Review the auth module" --cwd github://owner/repo#main:packages/auth --mode read
```

#### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex --mode read
```

Stdin is piped here, so there is no TTY to prompt on — `--mode` is required.

#### Review a GitHub pull request

```bash
npx poe-code@latest code-review install
npx poe-code@latest code-review run "https://github.com/owner/repo/pull/123"
npx poe-code@latest code-review commit "https://github.com/owner/repo/pull/123" --dry-run
```

#### Test a configured service

```bash
npx poe-code@latest test codex
```

### Install agent CLIs

```bash
# Claude Code
npx poe-code@latest install claude-code

# Codex
npx poe-code@latest install codex

# OpenCode
npx poe-code@latest install opencode

# Goose
npx poe-code@latest install goose
```

### Optional flags

- `--dry-run` – show every mutation without touching disk.
- `--yes` – accept defaults for prompts.

## Usage & Billing

Check your compute points balance and review usage history.

```bash
# Show current balance
poe-code usage

# Show usage history (20 entries, then prompts to load more)
poe-code usage list

# Show a specific number of entries without prompting
poe-code usage list --limit 100

# Filter by model name
poe-code usage list --filter claude
```

## Models

List available Poe API models and filter them by provider, capabilities, modalities, and supported API endpoint.

```bash
# List all models
poe-code models

# Show only models that support the Responses API
poe-code models --endpoint /v1/responses

# Show only models that support Chat Completions
poe-code models --endpoint /v1/chat/completions

# Search by provider or model id
poe-code models --search claude
```

## SDK

Safe Bash hosts can use `onSnapshot` to inspect navigation response headers and recapture browser snapshots before output, with page URL and title refreshed afterward. See the [snapshot hook contract](packages/safe-bash/src/contracts/playwright-snapshot.md).

Workspace safe-bash browser snapshots have no byte limit; legacy `maxSnapshotBytes` settings are ignored. Command workspaces consistently expose `<name>Commands()`, `create<Name>Commands()`, `create<Name>Command()`, and `<Name>CommandsOptions`, with optional configuration. Shell `maxOutputBytes` limits cover command file writes as well as standard output. Workspace Git accepts piped or redirected input for `mktree`, `mktag`, `stripspace`, `hash-object --stdin`, `apply`, and `commit -F -`, preserves stdin for other invocations, honors request-scoped Git environment overrides, and supports quiet init/commit output.

SafeJS, safe-bash, the SafeJS harness, PowerPoint, and Pandoc are workspace tools and are not included in the published `poe-code` package. Workspace SafeJS budgets are unlimited unless explicitly configured. Workspace ssconvert `createEngine()` accepts omitted or partial options with built-in formats, locale `C` and timezone `UTC`, with injected `en_US` and UTF-8 locale variants also supported; formula and record budgets are unlimited by default; public `recalculateWorkbook` is asynchronous, and recalculation and solver work yield so timer-driven cancellation can run. The `bash` and `harness` commands, SafeJS binaries, sandbox SDK subpaths, `poe-code/pptx`, and `poe-code/pandoc` are unavailable in `poe-code`. Terminal automation is available through the separate `terminal-pilot` and `terminal-pilot-mcp` packages. Workspace safe-bash core and shell imports install a portable `Buffer` when the host has none, including Workers without Node compatibility. Workspace safe-bash exposes portable `ffmpeg` and `ffprobe` through its explicit `commands/ffmpeg` plugin. All private command plugins and their command factories are also exported from portable safe-bash `core`; optional spreadsheet, PDF, media, office and Git implementations load on first execution, with explicit command/family selection and a full optional profile. Workspace safe-bash includes `fd` for virtual file discovery with regex/glob patterns, metadata filters, ignore files, and literal command execution. Its opt-in `commands/git` plugin runs the Rust Git engine against safe-fs, including Workers without Node compatibility. Workspace safe-bash arithmetic supports array element reads and writes in expansions, commands, C-style loops, and `let`. Workspace safe-bash text, search, structured-query, directory, calendar, system-information, substitution, table/stream, browser policy/structure, and MCP resource budgets are unlimited unless explicitly configured. MCP artifacts use Web Crypto for integrity checks; parsing them requires `await parseRemoteMcpArtifact(value)`. Its Node Shell supports worker-backed `timeout -k` / `--kill-after` escalation for default agent commands; custom worker factories and finite shared interpreter quotas have explicit admission requirements. Its `mdq` command extracts Markdown sections and elements through shell pipelines with a bounded mdq v0.10.0 profile. The YAML/TOML `yq` reader defaults source-line, alias-reference, expanded-node, value-byte, and work budgets to `Infinity`; hosts can configure finite quotas before query selection. Its `diff` reads top-level character/FIFO inputs to EOF, supports `/dev/null` creation/deletion patches, accepts `--color`, and preserves explicit context widths across bare format selectors; conflicting explicit widths are rejected. Its `uniq` refuses aliased input/output files, `cut` preserves delimiters between adjacent ranges, and `chmod -r` removes read permissions. Its `printf` returns status 1 for invalid formats and options while retaining partial output. Its `awk` splits default fields on space, tab, and newline, preserving carriage returns in CRLF input. Its opt-in Worker preset also bounds archive input and ZIP input memory. Its `mkdir -m` accepts octal and symbolic permission modes. Its `diff` compares binary files, preserves non-UTF-8 text bytes, and follows symlinks unless `--no-dereference` selects link-target comparison. Its `patch` command requires a filesystem with atomic ancestry verification for mutation; dry-run remains available on other adapters. Named compression requires atomic identity- and ancestry-bound source removal unless `--keep` or stdout output is selected. Its `[[ … ]]` supports file identity, age, special-file, mode and nameref predicates; ownership checks in `[[ … ]]`, `test` and `[` accept explicit `capabilities.predicateIdentity` (`effectiveUid`, `effectiveGid`). Workspace Pandoc can execute trusted local Lua `Str` filters through an explicitly configured reader and its JavaScript Lua VM, including inline constructors and replacement lists. Safe Bash exposes `pandocCommands()` for document conversion through its main, core, and command entrypoints. Pandoc supports the `markdown` alias, XLSX headers and formulas, styled PDF text and aligned tables, with opt-in resource limits.

CSV tools and spreadsheet conversion are available through `poe-code/csvkit` and `poe-code/ssconvert` on Node.js 22 or newer. Their `csvkitCommands()` and `ssconvertCommands()` shell plugins accept portable defaults; database connections still require explicit host bindings. Spreadsheet engines and shell plugins accept `formats: [csvFormat, xlsxFormat]` to choose their installed formats. Import the neutral engine from `poe-code/ssconvert/core`, composable shell factories from `poe-code/ssconvert/commands`, and each selected format from `poe-code/ssconvert/formats/<format>` to exclude other codecs from the bundle; `adoptWorkbook` accepts independently edited ASTs. ODS time values with fractional seconds import as numeric day fractions, including durations longer than 24 hours; named formulas resolve base-sheet names without regard to case. See the [CSV](docs/csvkit/usage-draft.md) and [spreadsheet](docs/ssconvert/usage-draft.md) usage guides for configuration, supported formats and limits. Gnome Glossary timestamps preserve source timezone abbreviations for UTC, Los Angeles, Kolkata and Warsaw from 1970 through 2037; other timezone/date profiles are explicitly refused. The opt-in Safe Bash `csvkitCommands()` plugin supplies portable defaults and composes with dedicated `csvcutCommands()` and `csvgrepCommands()` plugins. CSV, Pandoc, spreadsheet and PDF resource limits default to `Infinity`; configure finite ceilings explicitly when needed. Explicit BIFF8 RC4/CryptoAPI and legacy ODF 1.2 AES256 export profiles require host password and cryptographic entropy callbacks. Encrypted BIFF and AES/Blowfish-encrypted OpenDocument imports accept passwords through an explicit host callback, LibreOffice Argon2id/AES-GCM encrypted packages support import and explicit export with host password, entropy and resource limits, encrypted Paradox tables import automatically, the optional Python sample binding includes bounded percent formatting and explicitly selected Unicode 15/16 rules (Unicode 16 by default), and the Perl sample binding includes bounded pattern substitution with literal replacements and lossless native byte values for qualified formulas and CSV output. LOWER/UPPER use captured Unicode 16 C-locale rules for native byte values; CLEAN, PROPER, REPT, REPLACE/REPLACEB, SUBSTITUTE, FIND/FINDB, SEARCH/SEARCHB and LENB/LEFTB/RIGHTB/MIDB also accept native byte values. Lotus WK1/WK3 named-range records import as workbook names, WK3 formulas resolve imported names, and modern direct references retain relative sheet targets. Lotus INDEX imports select from fixed sheet spans, including 256-sheet ranges. BIFF8 external names recalculate from supported on-file declarations without fetching linked workbooks. BIFF8 retains ordered label-range metadata and automatic lookup settings, and supported live row/column label formulas recalculate and reexport with their identity, quoting and relative/absolute addressing preserved; explicit BIFF8 radical labels also preserve their stored data area, addressing flags and ordered multiple-cell label members. Other formula formats and BIFF named-expression export still refuse live labels. BIFF2 import reads compact named and optimized-reference formulas, array constants and array-formula records. BIFF2–4 imports recognize original fixed-argument forms of FIXED, TRUNC, WEEKDAY, HLOOKUP, VLOOKUP and DAYS360. BIFF2–8 data tables import through TABLE recalculation, and BIFF7/8 export uses native data-table records; deleted-input flags retain explicit loss warnings. BIFF7/8 exports resolve sheet references without regard to case and preserve the exact spelling and scope of defined names. SDK formula moves preserve referenced cells across sheets. OpenFormula input retains relative sheet references through ODF and annotated XML/XLSX roundtrips; readers ignoring those annotations use fixed sheet targets. BIFF7/8 export uses fixed sheet targets with an explicit warning about lost relative-sheet behavior. The optional database binding routes EXECSQL/READDBTABLE through an explicit host query port. SDK runtime bindings preserve refusal diagnostics when used with the Shell command and can return bounded arrays and references to invocation-owned sheets. PDF export preserves styled cells' logical text while composing supported Latin, Greek and Cyrillic glyphs, applies persisted manual and data-slice row/column page breaks, and recomputes stored automatic breaks. XLSX conversion preserves row/column break axes and untouched bounds and flags; an explicit host font callback can supply bounded TrueType fonts and enables materialized default Gnumeric styles for blank cells and single-line text that fits its cell. Lotus name tokens stay live through definition edits and formula copies; native export of those tokens remains unsupported.

Use `poe-code` programmatically in your own code:

```typescript
import { spawn, getPoeApiKey, getPoeAuthIdentity } from "poe-code";

// Get stored API key
const apiKey = await getPoeApiKey();

// Fetch the authenticated Poe account identity
const identity = await getPoeAuthIdentity();

// Run a prompt through a provider
const result = await spawn("claude-code", {
  prompt: "Fix the bug in auth.ts",
  cwd: "/path/to/project",
  model: "claude-sonnet-4-6"
});

// Spawn against a GitHub repository
const { events, result: ghResult } = spawn("codex", {
  prompt: "Review the auth module",
  cwd: "github://owner/repo#main:packages/auth"
});

console.log(result.stdout);
```

Agent spawn activity timeouts and parallel concurrency limits are optional; set `activityTimeoutMs` or `maxConcurrent` explicitly when needed. Autonomous spawn retries have no ceiling unless `maxTimeoutRetries` is supplied.

For plugin-first agent composition, import the public agent builder from the
`poe-code/agent` subpath:

```typescript
import { agent, openaiResponsesPlugin, systemPromptPlugin } from "poe-code/agent";

const run = await agent()
  .model("gpt-5.5")
  .use(openaiResponsesPlugin())
  .use(systemPromptPlugin())
  .run("Summarize the current repository", {
    cwd: process.cwd()
  });

console.log(run.output);
```

### `spawn(service, options)`

Runs a single prompt through a configured service CLI.

- `service` – Service identifier (`claude-code`, `codex`, `opencode`, `goose`)
- `options.prompt` – The prompt to send
- `options.cwd` – Working directory or workspace locator (optional). Supports local paths and `github://owner/repo[#ref[:subdir]]` locators. See [@poe-code/workspace-resolver](packages/workspace-resolver/) for the full locator syntax.
- `options.model` – Model identifier override (optional)
- `options.mode` – Permission mode: `yolo`, `auto`, `edit`, or `read` (optional; defaults to `auto`. Agents without an auto mode fail clearly)
- `options.args` – Additional arguments forwarded to the CLI (optional)

Returns `{ stdout, stderr, exitCode }`.

### `spawn.pretty(service, options)`

Same as `spawn()`, but renders the ACP event stream to stdout with colored, formatted output — matching the CLI's visual style.

```typescript
import { spawn } from "poe-code";

const result = await spawn.pretty("codex", "Fix the bug in auth.ts");
console.log(result.exitCode);
```

Returns `Promise<{ stdout, stderr, exitCode }>`.

### `getPoeApiKey()`

Reads the Poe API key with the following priority:

1. `POE_API_KEY` environment variable
2. Credentials file (`~/.poe-code/credentials.enc`)

Throws if no credentials found.

### `getPoeAuthIdentity()`

Fetches the Poe account identity for the resolved API key.

```typescript
import { getPoeAuthIdentity } from "poe-code";

const identity = await getPoeAuthIdentity();
console.log(identity.name, identity.handle);
```

Uses `POE_API_KEY` or the stored credential and honors `POE_BASE_URL`. Throws an API error when Poe rejects the credential.

## Research Preview

These features are available but subject to breaking changes.

- **[SafeJS](packages/safe-js/README.md)** — A JavaScript interpreter with explicit host capabilities, portable filesystem adapters, configurable unlimited resource budgets, and resumable checkpoints.
- **[Pipeline](packages/pipeline/)** — Run task plans with configurable steps, live task progress, queued follow-up messages, and plans you can add while the TUI is running.
- **[Ralph](packages/ralph/)** — Agentic build loop that iterates on a markdown doc
- **[Experiment loop](packages/experiment-loop/)** — Karpathy-style optimize loop: agent changes code, eval script scores it, keep or discard via git, repeat.
- **[Poe Agent](packages/poe-agent/)** — Composable agent runtime with shared safe-fs access


### Update Poe Code

```sh
npx poe-code@latest update
npx poe-code@latest update --package-manager pnpm
```

For version checks, dry runs, and managed worktrees, see the [reference](docs/README_FULL.md#updates-and-managed-worktrees).
