# Using Claude Sonnet 4.6 with Coding Agents

Model ID: `anthropic/claude-sonnet-4.6`

## Claude Code

### Configure as default

```bash
poe-code configure --agent claude-code --model "anthropic/claude-sonnet-4.6"
```

### Spawn a one-off task

```bash
poe-code spawn claude-code "Refactor the auth module" --model "anthropic/claude-sonnet-4.6"
```

## OpenCode

### Configure as default

```bash
poe-code configure --agent opencode --model "anthropic/claude-sonnet-4.6"
```

### Spawn a one-off task

```bash
poe-code spawn opencode "Add input validation" --model "anthropic/claude-sonnet-4.6"
```
