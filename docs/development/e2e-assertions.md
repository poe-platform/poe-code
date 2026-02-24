# E2E Assertion Catalog (US-006 Investigation)

Investigation of what to assert in each e2e step, based on source code analysis
of the CLI commands, provider definitions, and templates.

## How `stdoutMatchesExpected` works

The health check passes if the expected string appears as an exact match on any
trimmed non-empty line of stdout (`command-checks.ts:stdoutMatchesExpected`).
This is important: we don't need to match the entire stdout, just one line.

---

## Login

**Command:** `poe-code login --api-key '<key>'`

### Assertions

| What | How to check | Expected |
|------|-------------|----------|
| Exit code | `result.exitCode` | `0` |
| Success message | `result.stdout` | Contains `Poe API key stored at` |
| Credentials file exists | `container.fileExists('~/.poe-code/credentials.json')` | `true` |
| Credentials file content | `container.readFile('~/.poe-code/credentials.json')` | Valid JSON with `apiKey` field |

### Notes
- The exact success message is: `Poe API key stored at /root/.poe-code/credentials.json.`
- The credentials file has the structure: `{ "apiKey": "<key>" }`
- After login, if services were previously configured, they are reconfigured with the new key
- The `~/.poe-code/` directory is created automatically if it doesn't exist

---

## Install

**Commands per agent:**
- `poe-code install claude-code`
- `poe-code install codex`
- `poe-code install opencode`
- `poe-code install kimi`

### Common Assertions (all agents)

| What | How to check | Expected |
|------|-------------|----------|
| Exit code | `result.exitCode` | `0` |
| Success message | `result.stdout` | Contains `Installed <label>.` |

### Per-Agent Assertions

#### claude-code
| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Installed Claude Code.` or `Installed Claude CLI.` |
| Binary exists | `container.exec('which claude')` | Exit code `0` |
| Binary path (common) | `container.fileExists('/root/.claude/local/bin/claude')` | `true` (may vary by install method) |

**Install method:** `curl -fsSL https://claude.ai/install.sh | bash` (unix)

#### codex
| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Installed Codex.` or `Installed Codex CLI via npm.` |
| Binary exists | `container.exec('which codex')` | Exit code `0` |

**Install method:** `npm install -g @openai/codex`

#### opencode
| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Installed OpenCode CLI.` or `Installed OpenCode CLI via npm.` |
| Binary exists | `container.exec('which opencode')` | Exit code `0` |

**Install method:** `npm install -g opencode-ai`

#### kimi
| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Installed Kimi.` or `Installed Kimi CLI via uv.` |
| Binary exists | `container.exec('which kimi')` | Exit code `0` |

**Install method:** `uv tool install --python 3.13 kimi-cli`

### Notes
- Install is idempotent; if the binary already exists, it may skip with a
  different message (e.g., "already installed")
- The install check uses `which <binary>` first, then `where <binary>`, then
  common path tests (`/usr/local/bin/<binary>`, `/usr/bin/<binary>`,
  `$HOME/.local/bin/<binary>`, `$HOME/.claude/local/bin/<binary>`)
- Success messages use `adapter.label` (e.g., "Claude Code", "Codex", "OpenCode CLI", "Kimi")
  with the pattern: `Installed <label>.`

---

## Configure

**Commands per agent:**
- `poe-code configure claude-code --yes`
- `poe-code configure codex --yes`
- `poe-code configure opencode --yes`
- `poe-code configure kimi --yes`

### Common Assertions (all agents)

| What | How to check | Expected |
|------|-------------|----------|
| Exit code | `result.exitCode` | `0` |
| Success message | `result.stdout` | Contains `Configured <label>.` |
| Credentials updated | `container.readFile('~/.poe-code/credentials.json')` | Has `configured_services.<agent>` |

### Per-Agent Assertions

#### claude-code

**Config path:** `~/.claude/settings.json`

| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Configured Claude Code.` |
| Config file exists | `container.fileExists('/root/.claude/settings.json')` | `true` |
| Config structure | `container.readFile('/root/.claude/settings.json')` | Valid JSON |
| Config: apiKeyHelper | parsed config | `apiKeyHelper` field starts with `echo ` |
| Config: env.ANTHROPIC_BASE_URL | parsed config | Non-empty URL string |
| Config: model | parsed config | One of: `claude-haiku-4.5`, `claude-sonnet-4.5`, `claude-opus-4.6` |
| Post-configure message | `result.stdout` | Contains `vscode://settings/claudeCode.disableLoginPrompt` |

**Expected config structure:**
```json
{
  "apiKeyHelper": "echo <api-key>",
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.poe.com/v1"
  },
  "model": "claude-opus-4.6"
}
```

**Default model:** `anthropic/claude-opus-4.6` (stripped to `claude-opus-4.6`)

#### codex

**Config path:** `~/.codex/config.toml`

| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Configured Codex.` |
| Config dir exists | `container.exec('test -d /root/.codex')` | Exit code `0` |
| Config file exists | `container.fileExists('/root/.codex/config.toml')` | `true` |
| Config: model_provider | parsed TOML | `"poe"` |
| Config: model | parsed TOML | Default: `gpt-5.2-codex` |
| Config: model_reasoning_effort | parsed TOML | Default: `medium` |
| Config: model_providers.poe.base_url | parsed TOML | Non-empty URL |
| Config: model_providers.poe.experimental_bearer_token | parsed TOML | Non-empty string (API key) |

**Expected config structure (TOML):**
```toml
model_provider = "poe"
model = "gpt-5.2-codex"
model_reasoning_effort = "medium"

[model_providers.poe]
name = "poe"
base_url = "https://api.poe.com"
wire_api = "responses"
experimental_bearer_token = "<api-key>"
```

**Default model:** `openai/gpt-5.2-codex` (stripped to `gpt-5.2-codex`)

#### opencode

**Config paths:** `~/.config/opencode/config.json` and `~/.opencode-data/auth.json`

| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Configured OpenCode CLI.` |
| Config file exists | `container.fileExists('/root/.config/opencode/config.json')` | `true` |
| Auth file exists | `container.fileExists('/root/.opencode-data/auth.json')` | `true` |
| Config: model | parsed JSON | `"poe/claude-sonnet-4.5"` (default) |
| Config: enabled_providers | parsed JSON | Contains `"poe"` |
| Auth: poe.type | parsed JSON | `"api"` |
| Auth: poe.key | parsed JSON | Non-empty string (API key) |

**Expected config structure:**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "poe/claude-sonnet-4.5",
  "enabled_providers": ["poe"]
}
```

**Expected auth structure:**
```json
{
  "poe": {
    "type": "api",
    "key": "<api-key>"
  }
}
```

**Default model:** `anthropic/claude-sonnet-4.5` (provider-prefixed as `poe/claude-sonnet-4.5`)

#### kimi

**Config path:** `~/.kimi/config.toml`

| What | How to check | Expected |
|------|-------------|----------|
| Success message | `result.stdout` | Contains `Configured Kimi.` |
| Config dir exists | `container.exec('test -d /root/.kimi')` | Exit code `0` |
| Config file exists | `container.fileExists('/root/.kimi/config.toml')` | `true` |
| Config: default_model | parsed TOML | `"poe/kimi-k2.5"` (default) |
| Config: default_thinking | parsed TOML | `true` |
| Config: providers.poe.type | parsed TOML | `"openai_legacy"` |
| Config: providers.poe.base_url | parsed TOML | Non-empty URL |
| Config: providers.poe.api_key | parsed TOML | Non-empty string (API key) |
| Config: models | parsed TOML | Contains entries for all KIMI_MODELS |

**Expected config structure (TOML):**
```toml
default_model = "poe/kimi-k2.5"
default_thinking = true

[models."poe/kimi-k2.5"]
provider = "poe"
model = "kimi-k2.5"
max_context_size = 256000

[models."poe/kimi-k2-thinking"]
provider = "poe"
model = "kimi-k2-thinking"
max_context_size = 256000

[providers.poe]
type = "openai_legacy"
base_url = "https://api.poe.com"
api_key = "<api-key>"
```

**Default model:** `novitaai/kimi-k2.5` (provider-prefixed as `poe/kimi-k2.5`)

**All Kimi models configured:**
- `novitaai/kimi-k2.5` -> `poe/kimi-k2.5`
- `novitaai/kimi-k2-thinking` -> `poe/kimi-k2-thinking`

---

## Test

**Commands per agent:**
- `poe-code test claude-code`
- `poe-code test codex`
- `poe-code test opencode`
- `poe-code test kimi`

### Common Assertions (all agents)

| What | How to check | Expected |
|------|-------------|----------|
| Exit code | `result.exitCode` | `0` |
| Success message | `result.stdout` | Contains `Tested <label>.` |

### Per-Agent Health Check Details

#### claude-code
| What | How to check | Expected |
|------|-------------|----------|
| Health check output | `result.stdout` | Contains `CLAUDE_CODE_OK` on a line |
| Success message | `result.stdout` | Contains `Tested Claude Code.` |

**Health check command:** `claude -p "Output exactly: CLAUDE_CODE_OK" --model claude-opus-4.6 --allowedTools Bash,Read --permission-mode acceptEdits --output-format text`

#### codex
| What | How to check | Expected |
|------|-------------|----------|
| Health check output | `result.stdout` | Contains `CODEX_OK` on a line |
| Success message | `result.stdout` | Contains `Tested Codex.` |

**Health check command:** `codex --model gpt-5.2-codex exec "Output exactly: CODEX_OK" --full-auto --skip-git-repo-check`

#### opencode
| What | How to check | Expected |
|------|-------------|----------|
| Health check output | `result.stdout` | Contains `OPEN_CODE_OK` on a line |
| Success message | `result.stdout` | Contains `Tested OpenCode CLI.` |

**Health check command:** `opencode --model poe/claude-sonnet-4.5 run "Output exactly: OPEN_CODE_OK"`

#### kimi
| What | How to check | Expected |
|------|-------------|----------|
| Health check output | `result.stdout` | Contains `KIMI_OK` on a line |
| Success message | `result.stdout` | Contains `Tested Kimi.` |

**Health check command:** `kimi --quiet -p "Output exactly: KIMI_OK"`

### Isolated Test Mode

**Commands per agent:**
- `poe-code test claude-code --isolated`
- `poe-code test codex --isolated`
- `poe-code test opencode --isolated`
- `poe-code test kimi --isolated`

Same assertions as above, but the test runs in an isolated environment using
`poe-code wrap <agent> -- <args>` under the hood.

---

## Recommended Assertion Patterns for US-007

Based on the investigation above, here are the recommended assertion patterns for
the refactored e2e tests using the Container API:

### Pattern: Login + Verify Credentials
```typescript
it('login', async () => {
  await container.login();
  expect(await container.fileExists('/root/.poe-code/credentials.json')).toBe(true);
  const creds = JSON.parse(await container.readFile('/root/.poe-code/credentials.json'));
  expect(creds).toHaveProperty('apiKey');
});
```

### Pattern: Install + Verify Binary
```typescript
it('install', async () => {
  const result = await container.exec('poe-code install <agent>');
  expect(result.exitCode).toBe(0);
  // Verify binary is on PATH
  const which = await container.exec('which <binary>');
  expect(which.exitCode).toBe(0);
});
```

### Pattern: Configure + Verify Config Files
```typescript
it('configure', async () => {
  const result = await container.exec('poe-code configure <agent> --yes');
  expect(result.exitCode).toBe(0);
  // Verify config file exists and has expected structure
  expect(await container.fileExists('<config-path>')).toBe(true);
  const config = await container.readFile('<config-path>');
  // Parse and validate structure (JSON.parse or TOML parse)
});
```

### Pattern: Test + Verify Health Check
```typescript
it('test', async () => {
  const result = await container.exec('poe-code test <agent>');
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('<EXPECTED_TOKEN>');
});
```

---

## Key File Paths Summary

| Agent | Binary Name | Config Path(s) | Install Method |
|-------|------------|----------------|----------------|
| claude-code | `claude` | `~/.claude/settings.json` | curl installer |
| codex | `codex` | `~/.codex/config.toml` | npm -g |
| opencode | `opencode` | `~/.config/opencode/config.json`, `~/.opencode-data/auth.json` | npm -g |
| kimi | `kimi` | `~/.kimi/config.toml` | uv tool install |

**Shared:** `~/.poe-code/credentials.json` (login, tracks configured services)

## Health Check Tokens

| Agent | Expected Token | Matching Rule |
|-------|---------------|---------------|
| claude-code | `CLAUDE_CODE_OK` | Any trimmed non-empty line equals token |
| codex | `CODEX_OK` | Any trimmed non-empty line equals token |
| opencode | `OPEN_CODE_OK` | Any trimmed non-empty line equals token |
| kimi | `KIMI_OK` | Any trimmed non-empty line equals token |

## Default Models (with `--yes`)

| Agent | Raw Default | Stripped (in config) |
|-------|------------|---------------------|
| claude-code | `anthropic/claude-opus-4.6` | `claude-opus-4.6` |
| codex | `openai/gpt-5.2-codex` | `gpt-5.2-codex` |
| opencode | `anthropic/claude-sonnet-4.5` | `poe/claude-sonnet-4.5` (provider-prefixed) |
| kimi | `novitaai/kimi-k2.5` | `poe/kimi-k2.5` (provider-prefixed) |
