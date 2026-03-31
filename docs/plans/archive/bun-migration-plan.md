---
agent:
  - codex
  - claude-code
iterations: 10
status:
  state: completed
  iteration: 10
---
# Bun Migration Plan

## Goal

Fully migrate poe-code from Node.js + the previous package manager + esbuild to **Bun** as the sole runtime, package manager, bundler, and test runner.

## Non-Goals

- No feature changes — this is a runtime/tooling migration only.
- No dropping of existing CI checks — parity with current pipeline.

## Current Stack → Target

| Area             | Current                        | Target              |
|------------------|--------------------------------|---------------------|
| Runtime          | Node.js 20/22                  | Bun                 |
| Package manager  | previous lockfile setup        | bun + bun.lock      |
| Build/bundler    | tsc + esbuild + turbo          | bun build + turbo   |
| Test runner      | Vitest                         | bun:test            |
| Dev execution    | tsx                            | bun run             |
| Binary dist      | package (requires Node)    | bun build --compile |

## Compatibility Validation (Bun 1.3.11)

Validated against the actual codebase on 2026-03-30. Every item below was tested with playground code under Bun.

### Verified — no issues

| Area | What was tested | Result |
|------|-----------------|--------|
| **`node:crypto`** | `createCipheriv`, `createDecipheriv`, `scrypt`, `createHash`, `randomBytes`, `randomUUID` | ✅ Full encryption roundtrip passes |
| **`node:child_process`** | `spawn` (pipe + inherit), `exec`, `execSync`, env passing, `fork` with IPC | ✅ All pass, including `OUTPUT_FORMAT=json` env forwarding |
| **IPC serialization** | `fork()` with default (JSC) and `serialization: "json"` | ✅ Both work — no cross-runtime issue when child is also Bun |
| **`node:fs`** | Sync + async CRUD (`mkdir`, `writeFile`, `readFile`, `readdir`, `copyFile`, `rm`) | ✅ |
| **ESM** | `import.meta.url`, `fileURLToPath`, `import.meta.dirname`, `__dirname` in ESM | ✅ Bun provides `__dirname` in ESM natively |
| **`node:readline`** | `createInterface` + `question` with piped input | ✅ |
| **Text imports** | `.md`, `.hbs`, `.log` files via dynamic `import()` | ✅ Bun loads as text natively |
| **memfs** | `Volume.fromJSON`, sync ops, `vol.promises` async ops | ✅ Works unchanged under Bun |
| **`bun:test` API** | `mock()`, `mock.module()`, `spyOn()`, `mockReturnValue`, `mockImplementation`, `mockRestore`, matchers | ✅ All vitest equivalents present |
| **`bun build`** | Bundle to ESM, `--compile` to standalone binary | ✅ Both produce working output |
| **Workspace resolution** | `bun install --dry-run`, import of `@poe-code/agent-spawn`, `design-system`, `poe-code-config`, `agent-defs`, `poe-agent` | ✅ All 5 tested packages resolve |
| **Turbo** | Version check under Bun (2.8.3) | ✅ Installed and runs |
| **`.mjs` scripts** | Bun executes `.mjs` files | ✅ |

### Remaining work (not blockers, just migration tasks)

| Task | Scope | Notes |
|------|-------|-------|
| **Vitest → `bun:test` rewrite** | 100+ test files | Mechanical: `vi.fn()` → `mock()`, `vi.mock()` → `mock.module()`, `vi.spyOn()` → `spyOn()`, `vi.stubEnv()` → manual `process.env` + cleanup. All target APIs verified working. |
| **`freeze-cli` postinstall** | `packages/freeze-cli/package.json` — runs `node dist/download.js` | Change to runtime-agnostic invocation |
| **`engines` field** | Root `package.json`, `tiny-stdio-mcp-server`, `tiny-stdio-mcp-test-server` — all specify `"node": ">=18"` | Update to specify Bun |
| **`exports` condition resolution** | Workspace packages with `exports` field | Bun resolves `"node"` condition differently — verify third-party deps load correct entry |
| **Turbo `packageManager`** | `turbo.json` | Configure Turbo to use `bun run` for script execution |
| **`husky` prepare hook** | Root `package.json` — `"prepare": "husky"` | Verify under `bun install` lifecycle |
| **E2e test config** | `e2e/vitest.config.ts`, `e2e/setup.ts` | Migrate to Bun equivalents |

### Not an issue

- No native addons (`node-gyp`, `.node` binaries) — all pure JS/TS.
- No `node:v8` serialize/deserialize usage.
- No `node:cluster` usage.
- No `node:vm` usage.
- No `node-fetch` — can use Bun's native fetch.

## Approach

### 1) Package manager swap

- Replace `bun install --frozen-lockfile` / `bun install` with `bun install`.
- Delete `package-lock.json`, generate `bun.lock`.
- Update `packageManager` field in root `package.json` to `bun`.
- Verify all 24 workspace packages resolve correctly with Bun's resolver.
- Verify `husky` prepare hook fires correctly under `bun install`.

### 2) Build pipeline

- Replace `scripts/bundle.mjs` (esbuild) with `bun build` for the main bundle.
  - Target: single ESM bundle at `dist/index.js` (same output path).
  - Handle current esbuild plugins: shebang stripping, raw text imports (.md, .hbs, .log).
  - Bun supports text loaders natively via `bun build --loader`.
- Replace `tsc` compilation of workspace packages with `bun build` where applicable.
  - Keep `tsc --noEmit` for type checking only.
- Keep Turbo for orchestrating cross-package builds.
  - Verify Turbo uses `bun run` for script execution (set `packageManager` or `TURBO_PACKAGE_MANAGER`).
  - Verify task hashing and caching produce correct results with Bun's output.
- Remove `scripts/generate-bin-wrappers.mjs` — Bun-compiled binary replaces the CJS wrapper + Node version gate.

### 3) Test runner migration

- Migrate from Vitest to `bun:test`.
  - `describe`, `it`, `expect` — API is nearly identical.
  - Replace Vitest-specific imports across 100+ files:
    - `vi.fn()` → `mock()`
    - `vi.mock()` → `mock.module()`
    - `vi.spyOn()` → `spyOn()`
    - `vi.stubEnv()` → manual `process.env` manipulation with cleanup
  - Remove `vitest.config.ts` — Bun uses `bunfig.toml` for test config.
  - Migrate raw text plugin (`.hbs`, `.md`, `.log`) to Bun's built-in text loader.
  - Update `tests/setup.ts` for Bun's test lifecycle.
- Migrate `memfs` usage (58+ files) — verify compatibility, replace if needed.
- Migrate e2e tests:
  - Update `e2e/vitest.config.ts` and `e2e/setup.ts` to Bun equivalents.
  - Verify `e2e-docker-test-runner` works under Bun (uses `child_process`, `crypto`, `fs` heavily).
- Remove `vitest` dependency.

### 4) Dev workflow

- Replace `tsx` with `bun run` for `bun run dev`.
- Update `bun run screenshot-poe-code` and other dev scripts.
- Update `freeze-cli` postinstall to be runtime-agnostic.

### 5) Standalone binary

- Add `bun build --compile src/cli/index.ts` step producing platform binaries:
  - `poe-code-linux-x64`
  - `poe-code-linux-arm64`
  - `poe-code-darwin-x64`
  - `poe-code-darwin-arm64`
  - `poe-code-win-x64.exe`
- Replaces the current `dist/bin.cjs` Node version gate wrapper.
- Publish binaries as GitHub release assets alongside package.

### 6) CI/CD

- Replace `actions/setup-node` with `oven-sh/setup-bun` in all workflows.
- Update workflow steps: `bun install` → `bun run build` → `bun run lint` → `bun run typecheck` → `bun test`.
- Add binary compilation step to release workflow (per-platform matrix).
- Verify `semantic-release` works under Bun (it should — it's a Node package that Bun runs fine).
- Remove `bun audit` (previously package-manager-specific) or find Bun equivalent.

### 7) Cleanup

- Remove `package-lock.json`.
- Remove esbuild config and dependency.
- Remove Vitest config and dependency.
- Remove tsx dependency.
- Remove Node version gate in `dist/bin.cjs` and `scripts/node-version-gate.mjs`.
- Update root `engines` field to specify Bun version.
- Update package READMEs where they reference the previous runtime/tooling stack.

## Risks

| Risk | Status | Mitigation |
|------|--------|------------|
| ~~Workspace resolution~~ | ✅ Validated | 5 key packages tested, `bun install --dry-run` passes |
| ~~`bun:test` API gaps~~ | ✅ Validated | `mock()`, `mock.module()`, `spyOn()`, all matchers confirmed |
| ~~`memfs` compatibility~~ | ✅ Validated | Works unchanged under Bun |
| ~~`node:crypto` ciphers~~ | ✅ Validated | Full encryption roundtrip passes |
| ~~IPC serialization~~ | ✅ Validated | Both default and JSON serialization work |
| ~~`bun build --compile`~~ | ✅ Validated | Produces working standalone binary |
| `semantic-release` under Bun | Untested | Test in a dry-run on CI before cutting over |
| `exports` condition resolution | Untested | Verify third-party deps with `"node"` condition load correctly |
| Binary size | Accepted | Trade-off for zero-dependency install |

## Regression Checklist

Every item below must pass under Bun before the migration ships.

### CLI commands — basic execution

- [ ] `poe-code --version` prints version
- [ ] `poe-code --help` renders help text with all commands
- [ ] `poe-code configure --help` shows agent options
- [ ] `poe-code utils config show` reads and merges global + project config
- [ ] `poe-code utils config init` creates `.poe-code/config.json`
- [ ] `poe-code utils config edit --global` opens `$EDITOR`

### Authentication

- [ ] `poe-code login --api-key <key>` stores key in `~/.poe-code/config.json`
- [ ] `poe-code auth status` reads stored credentials and displays balance
- [ ] `poe-code auth api_key` prints stored key
- [ ] `poe-code logout` removes all credentials
- [ ] `POE_API_KEY=<key> poe-code auth status` resolves from env
- [ ] OAuth flow: browser opens, readline accepts redirect URL, key stored

### Configure / Unconfigure (all agents)

- [ ] `poe-code configure --yes` applies defaults for all agents
- [ ] `poe-code configure claude-code --yes` writes `~/.claude/settings.json`
- [ ] `poe-code configure codex --yes` writes codex config
- [ ] `poe-code configure kimi --yes` writes kimi config
- [ ] `poe-code configure opencode --yes` writes opencode config
- [ ] `poe-code unconfigure claude-code` removes applied config
- [ ] Interactive prompts render correctly (agent select, model select)
- [ ] `--dry-run` shows what would be written without writing

### Spawn

- [ ] `poe-code spawn claude-code "hello" --yes` executes and returns output
- [ ] `poe-code spawn codex "hello" --yes` executes
- [ ] `poe-code spawn kimi "hello" --yes` executes
- [ ] `poe-code spawn opencode "hello" --yes` executes
- [ ] Streaming: events arrive incrementally (not buffered until end)
- [ ] `spawn --interactive` launches TUI with inherited stdio
- [ ] `spawn --mode read` passes mode flag to agent
- [ ] `spawn --mode edit` passes mode flag to agent
- [ ] `spawn --mcp-config '{"server":{"command":"cmd"}}'` forwards MCP config
- [ ] Exit code propagation: agent failure → non-zero exit from poe-code
- [ ] `echo "prompt" | poe-code spawn claude-code -` reads stdin
- [ ] `OUTPUT_FORMAT=json poe-code spawn claude-code "hello" --yes` emits JSONL

### Generate

- [ ] `poe-code generate "hello"` returns text
- [ ] `poe-code generate text "hello"` returns text
- [ ] `poe-code generate image "a cat"` returns URL
- [ ] `poe-code generate video "a cat"` returns URL
- [ ] `poe-code generate audio "hello"` returns URL
- [ ] Model override: `poe-code generate "hello" --model <model>`

### Research

- [ ] `poe-code research "explain this codebase" --yes` runs in read mode
- [ ] `poe-code research --github <repo> "explain"` clones and researches
- [ ] `poe-code research --path <dir> "explain"` researches local dir
- [ ] `--keep` flag preserves cloned repo

### Test

- [ ] `poe-code test claude-code` runs health check
- [ ] `poe-code test --yes` tests all configured agents

### Install

- [ ] `poe-code install claude-code` installs agent tooling

### Usage

- [ ] `poe-code usage` shows balance
- [ ] `poe-code usage balance` shows balance
- [ ] `poe-code usage list` shows history
- [ ] `poe-code usage list --filter <model> --pages 2` filters and paginates

### MCP

- [ ] `poe-code mcp serve` starts MCP server on stdio (responds to JSON-RPC)
- [ ] `poe-code mcp configure claude-code --yes` writes MCP config to agent
- [ ] `poe-code mcp unconfigure claude-code` removes MCP config
- [ ] `--output-format url,base64` multiple formats accepted

### Skills

- [ ] `poe-code skill configure claude-code --yes` installs skill dirs
- [ ] `poe-code skill unconfigure claude-code` removes skill dirs

### Pipeline

- [ ] `poe-code pipeline install claude-code --yes` creates plan template
- [ ] `poe-code pipeline run` discovers and executes plan
- [ ] `poe-code pipeline run --max-runs 1` limits iterations
- [ ] `--dry-run` shows plan without executing

### Ralph

- [ ] `poe-code ralph run 1 <doc>` runs one iteration
- [ ] Progress reporting and usage tracking work

### SDK (programmatic usage)

- [ ] `spawn()` returns `{ events, result }` — events iterable, result resolves
- [ ] `spawn.pretty()` renders output
- [ ] `generate("hello")` returns text result
- [ ] `generateImage("a cat")` returns media result
- [ ] `getPoeApiKey()` returns stored key
- [ ] `runPipeline()` executes pipeline
- [ ] `runRalph()` executes ralph
- [ ] AbortSignal cancels in-flight spawn

### Interactive CLI / design system

- [ ] `select()` prompt renders with arrow key navigation
- [ ] `text()` prompt accepts input
- [ ] `confirm()` prompt shows Y/n
- [ ] `password()` prompt hides input
- [ ] Spinner shows elapsed time and stops correctly
- [ ] Colors render in TTY, stripped in non-TTY
- [ ] Tables render with correct alignment
- [ ] `--yes` skips all interactive prompts

### Binary wrappers

- [ ] `poe-claude` launches Claude Code with Poe config
- [ ] `poe-codex` launches Codex with Poe config
- [ ] `poe-opencode` launches OpenCode with Poe config
- [ ] `poe-agent` launches Poe Agent

### Config file handling

- [ ] JSON config: read, write, deep merge
- [ ] YAML parsing (`yaml` package): pipeline plans
- [ ] TOML parsing (`smol-toml`): agent configs
- [ ] JSONC parsing (`jsonc-parser`): settings with comments
- [ ] Backup on parse error: `config.json.invalid-<timestamp>.json`
- [ ] Env var overrides: `POE_API_KEY`, `POE_BASE_URL`, `POE_RALPH_PLAN_DIRECTORY`, `POE_PIPELINE_PLAN_DIRECTORY`

### Build + compile

- [ ] `bun install` resolves all 24 workspace packages
- [ ] `bun run build` produces `dist/index.js`
- [ ] `bun build --compile src/cli/index.ts` produces working standalone binary
- [ ] Standalone binary: `./poe-code --help` works without Bun/Node installed
- [ ] `tsc --noEmit` passes (type checking only)
- [ ] Turbo orchestrates package builds correctly under Bun

### CI parity

- [ ] `bun run lint` passes
- [ ] `bun run lint:workflows` passes
- [ ] `bun run typecheck` passes
- [ ] `bun test` runs all unit tests
- [ ] E2e tests pass: `bun run e2e:verbose`
- [ ] Screenshot tests render correctly: `bun run screenshot-poe-code -- --help`
- [ ] `semantic-release` dry-run succeeds under Bun
- [ ] Husky hooks fire on `bun install`

### Error handling

- [ ] Invalid API key → clear auth error, not crash
- [ ] Missing agent binary → helpful error message
- [ ] Network failure → timeout/error, not hang
- [ ] Ctrl+C during spawn → clean process termination
- [ ] Invalid config file → backup created, error reported

### Cross-platform (CI matrix)

- [ ] Linux x64: build, test, compile
- [ ] Linux arm64: build, test, compile
- [ ] macOS x64: build, test, compile
- [ ] macOS arm64: build, test, compile
- [ ] Windows x64: build, test, compile

## Open Questions

- None.
