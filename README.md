# poe-code

> Configure coding agents to use the Poe API.

## Try it in 1 minute

```bash
# Install Poe wrapper binaries.
npm install -g poe-code

# Run your existing agent CLI through Poe (you’ll be prompted for api key on first run).
poe-claude --help
```

Also available: `poe-codex`, `poe-opencode`.

## Make it default

This updates the provider’s config files so you can use the provider CLI directly.

```bash
# Claude Code
npx poe-code@latest configure claude-code

# Codex
npx poe-code@latest configure codex

# OpenCode
npx poe-code@latest configure opencode

# Kimi
npx poe-code@latest configure kimi
```

### Unconfigure (remove overrides)

```bash
npx poe-code@latest unconfigure claude-code
```

## Utilities

Utilities are especially useful for scripting and CI/CD.

### Spawn a one-off prompt

```bash
npx poe-code@latest spawn codex "Say hello"
```

### Spawn a prompt via stdin

```bash
echo "Say hello" | npx poe-code@latest spawn codex
```

### Test a configured service

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

# Kimi
npx poe-code@latest install kimi
```

### Optional flags

- `--dry-run` – show every mutation without touching disk.
- `--yes` – accept defaults for prompts.
