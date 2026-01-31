# Binary Detection in poe-code

This document explains how poe-code detects installed CLI binaries (like `claude`, `codex`, `opencode`) and the changes made to support Docker/container environments.

## Problem Statement

When running `poe-code install <agent>`, the tool needs to verify that the agent's CLI binary was successfully installed. This verification must work across:

- Native macOS/Linux environments
- Docker containers (via `@poe-code/e2e-docker-test-runner`)
- Different installation methods (npm global, curl scripts, etc.)

### Before: Limited Detection

The original implementation only checked:

```typescript
const detectors = [
  { command: "which", args: [binaryName] },           // PATH lookup
  { command: "where", args: [binaryName] },           // Windows PATH lookup
  { command: "test", args: ["-f", `/usr/local/bin/${binaryName}`] },
  { command: "ls", args: [`/usr/local/bin/${binaryName}`] }
];
```

**Issues:**

1. **Hardcoded system path** - Only checked `/usr/local/bin/`, but many tools install to user directories
2. **Claude installs to `~/.local/bin/`** - The Claude CLI install script (`curl -fsSL https://claude.ai/install.sh | bash`) installs to `$HOME/.local/bin/claude`
3. **PATH not updated mid-session** - In Docker, when Claude's installer updates the shell profile, the current session doesn't see the PATH change

### After: Comprehensive Detection

The updated implementation checks multiple common installation paths:

```typescript
const commonPaths = [
  `/usr/local/bin/${binaryName}`,
  `/usr/bin/${binaryName}`,
  `$HOME/.local/bin/${binaryName}`,
  `$HOME/.claude/local/bin/${binaryName}`
];

const detectors = [
  { command: "which", args: [binaryName] },
  { command: "where", args: [binaryName] },
  {
    command: "sh",
    args: ["-c", commonPaths.map((p) => `test -f "${p}"`).join(" || ")],
  }
];
```

**Improvements:**

1. **User-local paths** - Checks `$HOME/.local/bin/` where many modern CLI tools install
2. **Claude-specific path** - Checks `$HOME/.claude/local/bin/` for Claude Code
3. **Shell expansion** - Uses `sh -c` to properly expand `$HOME` at runtime
4. **OR-chained tests** - Single shell command tests all paths efficiently

## Docker/Container Fix

In addition to detection, the container runner (`@poe-code/e2e-docker-test-runner`) ensures binaries are findable after installation by extending PATH at container startup:

```typescript
// In buildContainerScript()
'export PATH="$HOME/.local/bin:$HOME/.claude/local/bin:$PATH"',
```

This ensures that binaries installed to user directories (like `~/.local/bin`) are immediately available to subsequent commands in the same container session.

## How It Works

1. **Installation Phase**: `poe-code install claude-code` runs `curl -fsSL https://claude.ai/install.sh | bash`
2. **Binary placed**: Claude CLI binary installed to `~/.local/bin/claude`
3. **Verification**: `createBinaryExistsCheck("claude", ...)` runs:
   - First tries `which claude` - may fail if PATH not updated
   - Falls back to checking common paths via `sh -c 'test -f "$HOME/.local/bin/claude" || ...'`
4. **Subsequent commands**: Because PATH includes `~/.local/bin`, commands like `poe-code configure` and `poe-code test` can invoke `claude` directly

## File Locations

- **Binary detection**: `src/utils/command-checks.ts` - `createBinaryExistsCheck()`
- **Container runner**: `packages/e2e-docker-test-runner/src/container.ts` - `buildContainerScript()`
- **Provider install definitions**: `src/providers/*.ts` - Each provider's `install` property

## Adding New Installation Paths

If a new CLI tool installs to a non-standard location, add the path to `commonPaths` in `createBinaryExistsCheck()`:

```typescript
const commonPaths = [
  `/usr/local/bin/${binaryName}`,
  `/usr/bin/${binaryName}`,
  `$HOME/.local/bin/${binaryName}`,
  `$HOME/.claude/local/bin/${binaryName}`,
  `$HOME/.new-tool/bin/${binaryName}`  // Add new path here
];
```

And if needed for Docker testing, update the PATH export in `buildContainerScript()` in `packages/e2e-docker-test-runner/src/container.ts`:

```typescript
'export PATH="$HOME/.local/bin:$HOME/.claude/local/bin:$HOME/.new-tool/bin:$PATH"',
```
