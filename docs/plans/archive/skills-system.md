# Skills System for poe-agent

## Context

poe-code has a basic skill infrastructure (`agent-skill-config`) that writes SKILL.md files to agent-specific directories. CLI agents (claude-code, codex, opencode) discover and read these natively. The `poe-agent` built-in agent has no skill awareness at all.

**Problem:** poe-agent can't discover or use skills. It has a static `SYSTEM_PROMPT.md` with no skill metadata injection.

**Goal:** Add OpenCode/Crush-style skill discovery and prompt injection **entirely within `packages/poe-agent`**:
1. Discover SKILL.md files from filesystem paths at session creation
2. Inject skill metadata (name, description, path) into the system prompt
3. The agent reads the full SKILL.md on demand via its `read_file` tool when a task matches

## Research

| Project | Approach |
|---------|----------|
| **Codex** | Progressive disclosure: metadata always in prompt, SKILL.md injected on trigger |
| **OpenCode/Crush** | Simplest: XML metadata in system prompt, agent reads SKILL.md via file tools |
| **Goose** | MCP-based: `load()`/`delegate()` tools, sub-agent delegation |

**Chosen approach: OpenCode/Crush** — simplest, lowest coupling, already aligned with our SKILL.md format.

### How OpenCode does it

System prompt gets two conditional blocks appended:

```xml
<available_skills>
  <skill>
    <name>git-release</name>
    <description>Create consistent releases and changelogs</description>
    <location>/path/to/git-release/SKILL.md</location>
  </skill>
</available_skills>

<skills_usage>
When a user task matches a skill's description, read the skill's SKILL.md
file to get full instructions.
Skills are activated by reading their location path. Follow the skill's
instructions to complete the task.
If a skill mentions scripts, references, or assets, they are placed in the
same folder as the skill itself.
</skills_usage>
```

The model uses its `read_file` tool to load SKILL.md when relevant. Full SKILL.md content never enters the system prompt — only name + description + path.

## Architecture

Everything lives in `packages/poe-agent/src/`. No changes to other packages.

```
packages/poe-agent/src/
  SYSTEM_PROMPT.md          (existing, unchanged)
  system-prompt.ts          (existing, extend)
  agent-session.ts          (existing, extend)
  chat.ts                   (existing, unchanged)
  tool-executor.ts          (existing, unchanged)
  skills/                   (new)
    discovery.ts            — scan dirs for SKILL.md, parse frontmatter
    discovery.test.ts
    prompt.ts               — render <available_skills> XML section
    prompt.test.ts
    types.ts                — SkillMetadata interface
```

### SKILL.md Format (unchanged)

```yaml
---
name: poe-generate
description: 'Poe code generation skill'
---

# Instructions
Markdown body with full agent instructions...
```

### Flow

```
createAgentSession({ skillsPaths: [...] })
  │
  ├─ loadSystemPrompt()         → base SYSTEM_PROMPT.md
  ├─ discoverSkills(paths)      → SkillMetadata[]
  ├─ renderSkillsPrompt(skills) → XML string (or "")
  │
  └─ PoeChatService({ systemPrompt: base + skillsXml })
       │
       └─ Agent receives prompt with skill metadata
          │
          └─ Task matches skill description?
               │
               └─ Agent calls read_file(skill.location)
                    │
                    └─ Follows SKILL.md instructions
```

## Steps

### Step 1: Types and frontmatter parser

**Create:**
- `packages/poe-agent/src/skills/types.ts`

```typescript
export interface SkillMetadata {
  name: string;
  description: string;
  location: string; // absolute path to SKILL.md
}
```

**Create (TDD):**
- `packages/poe-agent/src/skills/discovery.test.ts`
- `packages/poe-agent/src/skills/discovery.ts`

**Functions:**
- `parseFrontmatter(content: string): { name: string; description: string } | null` — extract YAML between `---` delimiters, validate `name` and `description` exist. Use `yaml` package for parsing.
- `discoverSkills(paths: string[]): Promise<SkillMetadata[]>` — scan each path for subdirectories containing `SKILL.md`, parse frontmatter, return metadata sorted by name. Skip invalid skills silently. Deduplicate by absolute path.

**Test cases (memfs):**
- Discovers skills from single directory
- Discovers skills from multiple directories
- Skips SKILL.md without valid frontmatter (missing name or description)
- Skips directories without SKILL.md
- Handles nested skill directories (`skills/my-skill/SKILL.md`)
- Deduplicates by path
- Returns empty array for empty/missing directories
- Sorts by name

### Step 2: Prompt renderer

**Create (TDD):**
- `packages/poe-agent/src/skills/prompt.test.ts`
- `packages/poe-agent/src/skills/prompt.ts`

**Function:**
```typescript
export function renderSkillsPromptSection(skills: SkillMetadata[]): string
```

Returns empty string if skills array is empty. Otherwise returns the `<available_skills>` XML block + `<skills_usage>` instructions.

XML-escape `<`, `>`, `&` in name/description values.

**Test cases:**
- Returns empty string for empty array
- Renders single skill correctly
- Renders multiple skills
- Escapes XML special characters
- Location paths preserved as-is

### Step 3: Integrate into agent session

**Edit:**
- `packages/poe-agent/src/agent-session.ts`

Add `skillsPaths?: string[]` to `CreateAgentSessionOptions`. In `createAgentSession`:

1. Load base system prompt via `loadSystemPrompt()`
2. If `skillsPaths` provided and non-empty, call `discoverSkills(skillsPaths)`
3. If skills found, call `renderSkillsPromptSection(skills)` and append to system prompt
4. Pass assembled prompt to `PoeChatService`

**Test:** Unit test verifying system prompt includes skills section when `skillsPaths` resolves skills.

### Step 4: Export from package

**Edit:**
- `packages/poe-agent/src/index.ts` — export `discoverSkills`, `renderSkillsPromptSection`, `SkillMetadata` for consumers that need to list skills

## What's NOT in scope

- Changes to `agent-skill-config`, `agent-spawn`, or CLI commands
- Skill authoring CLI (`poe-code skill create`)
- Remote skill registry/marketplace
- `$skill-name` trigger syntax
- MCP-based skill tools
- Skill composition/chaining

## Open Questions

1. Should we add a `yaml` dependency to poe-agent, or hand-roll a minimal `---` frontmatter parser? (Recommend `yaml` — CLAUDE.md says install parser libraries.)
2. What default `skillsPaths` should callers pass? Likely `[".agents/skills/", "~/.config/poe-code/skills/"]` — but that's the caller's responsibility, not poe-agent's.
