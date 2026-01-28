# Skill Command Plan

## Overview

Add skill installation and configuration commands for agent skill directories. Skills are markdown files containing instructions that agents can use to extend their capabilities.

## Design Principle

Skills follow the same architectural pattern as MCP:
- Declarative provider configuration
- Configure/unconfigure mutations
- SDK parity with CLI
- No branching logic based on provider

## Command Usage

### `poe-code skill`

```bash
poe-code skill
```

Outputs the skill installation directory for manual setup (similar to `poe-code mcp`).

### `poe-code skill configure`

```bash
poe-code skill configure              # Prompts for provider selection
poe-code skill configure <provider>   # Configures specific provider
```

Creates the global skill directory structure for the specified provider.

### `poe-code skill unconfigure`

```bash
poe-code skill unconfigure <provider>
```

Removes skill directory configuration.

### `poe-code skill --help`

Displays help for skill commands.

## Skill Directory Structure

Each provider has a global skill directory in the user's home:

| Provider | Global Skills Dir |
|----------|-------------------|
| claude-code | `~/.claude/skills` |
| codex | `~/.codex/skills` |
| opencode | `~/.config/opencode/skills` |
| cursor | `~/.cursor/skills` |
| windsurf | `~/.codeium/windsurf/skills` |
| github-copilot | `~/.copilot/skills` |
| goose | `~/.config/goose/skills` |
| cline | `~/.cline/skills` |
| continue | `~/.continue/skills` |
| roo | `~/.roo/skills` |
| amp | `~/.config/agents/skills` |
| gemini-cli | `~/.gemini/skills` |

## Provider Skill Configuration

### Provider Configuration Pattern

Add `skill` object to provider configs:

```typescript
// src/providers/claude-code.ts
export const claudeCodeService = createProvider<...>({
  // ... existing config ...
  skill: {
    dir: "~/.claude/skills"
  }
});
```

The system generates `ensureDirectory` mutations from the `skill` property.

## Implementation Architecture

### Skill Provider Interface

```typescript
interface SkillConfig {
  dir: string;  // Home-relative path (expands ~)
}
```

### Configure Mutations

Configure creates the skill directory:

```typescript
// Generated from skill config
[
  ensureDirectory({ path: resolvedSkillDir })
]
```

### Unconfigure Mutations

Unconfigure removes empty skill directories (does not delete skill files):

```typescript
// Only removes if directory is empty
[
  removeEmptyDirectory({ path: resolvedSkillDir })
]
```

## Relationship with MCP

Skills and MCP are complementary features:

| Feature | Purpose | Config Type |
|---------|---------|-------------|
| MCP | Add MCP servers to agent | JSON/TOML merge |
| Skill | Create skill directories | Directory creation |

Both use the same provider pattern and can coexist on the same provider config.

## Expanding Query for MCP Feature Set

The `query` command can be expanded to provide MCP-like functionality without requiring an MCP client:

### Current Query

```bash
poe-code query "What is 2+2?"
poe-code query --bot Claude-3.5-Sonnet "Hello"
```

### Proposed Query Extensions

```bash
# Image generation (MCP generate_image equivalent)
poe-code query --image "A sunset over mountains"
poe-code query --image --bot DALL-E-3 "A cat"

# Audio generation (MCP generate_audio equivalent)
poe-code query --audio "Hello world"

# Video generation (MCP generate_video equivalent)
poe-code query --video "A rocket launching"

# Any bot query (MCP get_bot_response equivalent)
poe-code query --bot <bot-name> "prompt"
```

### SDK vs CLI Behavior

**SDK returns URLs:**

```typescript
import { query, generateImage, generateAudio, generateVideo } from "poe-code";

// Text query
await query("What is 2+2?");
// => { text: "4" }

await query("Hello", { bot: "Claude-3.5-Sonnet" });
// => { text: "Hello! How can I help?" }

// Media generation returns URLs
await generateImage("A sunset");
// => { url: "https://..." }

await generateAudio("Hello world");
// => { url: "https://..." }

await generateVideo("A rocket launching");
// => { url: "https://..." }
```

**CLI downloads to cwd:**

```bash
# Downloads image to ./image-1737984000.png
poe-code query --image "A sunset over mountains"

# Downloads audio to ./audio-1737984000.mp3
poe-code query --audio "Hello world"

# Downloads video to ./video-1737984000.mp4
poe-code query --video "A rocket launching"

# Optional: specify output path
poe-code query --image -o sunset.png "A sunset"
```

This provides the same capabilities as the MCP server but with appropriate behavior for each interface.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/cli/commands/skill.ts` | Skill command implementation |
| `src/cli/program.ts` | Register `registerSkillCommand()` |
| `src/providers/create-provider.ts` | Handle `skill` property |
| `src/providers/claude-code.ts` | Add `skill` property |
| `src/providers/codex.ts` | Add `skill` property |
| `src/providers/opencode.ts` | Add `skill` property |
| `src/sdk/skill.ts` | SDK skill functions |
| `tests/skill-command.test.ts` | Unit tests |

## Command Structure

```typescript
// src/cli/commands/skill.ts
export function registerSkillCommand(
  program: Command,
  container: CliContainer
): void {
  const skill = program
    .command("skill")
    .description("Skill configuration commands")
    .action(async function () {
      // Output skill directory info
    });

  skill
    .command("configure [provider]")
    .description("Configure skill directory for provider")
    .action(async (provider) => {
      // 1. If no provider, prompt for selection
      // 2. Resolve skill provider
      // 3. Run configure mutations (create directory)
    });

  skill
    .command("unconfigure <provider>")
    .description("Remove skill directory for provider")
    .action(async (provider) => {
      // 1. Resolve skill provider
      // 2. Run unconfigure mutations (remove empty dir)
    });
}
```

## SDK Integration

```typescript
// src/sdk/skill.ts
export interface SkillConfigureOptions {
  provider: string;
}

export async function configureSkill(
  options: SkillConfigureOptions
): Promise<void> {
  // Uses same core as CLI
}

export async function unconfigureSkill(
  provider: string
): Promise<boolean> {
  // Uses same core as CLI
}
```

## Skill File Format

Skills are markdown files with optional frontmatter:

```markdown
---
name: my-skill
description: A helpful skill
---

# My Skill Instructions

When the user asks about X, you should...
```

## Implementation Steps

1. Add `SkillConfig` type to provider types
2. Add `skill` property handling in `createProvider`
3. Create `skill.ts` command with configure/unconfigure
4. Add `skill` config to claude-code, codex, opencode providers
5. Create SDK functions for skill management
6. Add additional skill-only providers (cursor, windsurf, etc.)
7. Expand query command with `--image`, `--audio`, `--video` flags

## Skill-Only Providers

Some providers only support skills (not agent spawning):

```typescript
// src/providers/cursor.ts
export const cursorSkillProvider = createSkillProvider({
  id: "cursor",
  name: "Cursor",
  skill: {
    dir: "~/.cursor/skills"
  }
});
```

These use a simplified `createSkillProvider` factory that only handles skill configuration.

## Testing Strategy

- Use memfs for directory creation tests
- Test configure creates directory
- Test unconfigure removes empty directory
- Test unconfigure preserves directory with files
- Test SDK parity with CLI

## Priority Order

1. Core skill infrastructure (types, createProvider changes)
2. Skill command implementation
3. Claude-code, codex, opencode skill support
4. SDK skill functions
5. Additional skill-only providers
6. Query command media extensions
