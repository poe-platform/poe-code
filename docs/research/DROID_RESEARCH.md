# Factory Droid Research

Historical note: this is a dated vendor research snapshot, not current product
documentation. Re-verify commands, metrics, and install paths before using it for
implementation work.

## Overview

Factory Droid is an AI coding agent that operates in the terminal and handles
end-to-end development workflows.

Captured benchmark claims:

- Droid with Opus (58.8%) beats Claude Code with Opus (43.2%)
- Droid with GPT-5 (52.5%) beats Codex CLI (42.8%)
- Model-agnostic design enables cheaper models to outperform expensive ones on competitors

---

## 1. Installation Methods

### NPM Installation (Global)

```bash
npm install -g @factory/cli
```

### Shell Script Installation

**macOS/Linux:**

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

**Homebrew (macOS):**

```bash
brew install --cask droid
```

**Windows (PowerShell):**

```powershell
irm https://app.factory.ai/cli/windows | iex
```

**Linux Prerequisites:**

```bash
sudo apt-get install xdg-utils
```

### Verification

```bash
droid --version
```

---

## 2. Interactive vs Non-Interactive Modes

### Interactive Mode (Default)

Simply run `droid` to start an interactive REPL session:

```bash
cd /path/to/your/project
droid
```

Launch with an initial prompt:

```bash
droid "analyze this codebase and explain the overall architecture"
```

**Keyboard Controls:**

| Key                | Action                  |
| ------------------ | ----------------------- |
| `Enter`            | Submit task/question    |
| `Shift+Enter`      | Multi-line input        |
| `Shift+Tab`        | Switch modes            |
| `?`                | Show keyboard shortcuts |
| `!`                | Toggle bash mode        |
| `Esc`              | Return to normal mode   |
| `Ctrl+C` or `exit` | Terminate session       |

### Non-Interactive/Headless Mode (droid exec)

For automation, CI/CD pipelines, cron jobs, and batch operations:

```bash
# Basic usage
droid exec "analyze code quality"

# From file
droid exec -f prompt.md

# From stdin
echo "task" | droid exec
cat file | droid exec

# Resume session
droid exec -s <session-id> "next steps"
```

**Key Flags for Headless Mode:**

| Flag                             | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `-o, --output-format <format>`   | Output: `text`, `json`, `stream-json`, `stream-jsonrpc` |
| `--auto <level>`                 | Autonomy: `low`, `medium`, `high`                       |
| `-f, --file <path>`              | Read prompt from file                                   |
| `-m, --model <id>`               | Select AI model                                         |
| `-r, --reasoning-effort <level>` | `off`, `none`, `low`, `medium`, `high`                  |
| `--cwd <path>`                   | Set working directory                                   |
| `--list-tools`                   | Show available tools                                    |
| `--enabled-tools <ids>`          | Force-enable specific tools                             |
| `--disabled-tools <ids>`         | Disable specific tools                                  |
| `--use-spec`                     | Start in specification/planning mode                    |
| `--skip-permissions-unsafe`      | Bypass all permission checks (sandbox only!)            |

**Autonomy Levels:**

- **Default (Read-only):** File viewing, git status, information gathering—no modifications
- **`--auto low`:** File creation/editing in project directories, formatting
- **`--auto medium`:** Package installation, git operations (except push), building, network requests
- **`--auto high`:** Git push, deployment operations, executing untrusted code
- **`--skip-permissions-unsafe`:** NO restrictions (use in isolated Docker only)

**Output Formats:**

- `text` - Human-readable for logging
- `json` - Structured with success/failure, duration, session ID
- `stream-json` - Real-time JSONL event stream
- `stream-jsonrpc` - Multi-turn JSON-RPC protocol for SDK integration

---

## 3. Custom Server Configuration (BYOK)

Factory supports **Bring Your Own Key (BYOK)** for custom model providers.

### Configuration Location

```
~/.factory/settings.json
```

### Configuration Format

```json
{
  "customModels": [
    {
      "model": "your-model-id",
      "displayName": "My Custom Model",
      "baseUrl": "https://api.provider.com/v1",
      "apiKey": "YOUR_API_KEY",
      "provider": "generic-chat-completion-api",
      "maxOutputTokens": 16384,
      "supportsImages": true,
      "extraArgs": {
        "temperature": 0.7
      }
    }
  ]
}
```

### Supported API Shapes (Providers)

| Provider                      | API Format              | Best For                                                |
| ----------------------------- | ----------------------- | ------------------------------------------------------- |
| `anthropic`                   | Anthropic Messages API  | Official Anthropic models (Claude)                      |
| `openai`                      | OpenAI Responses API    | GPT-5 and newest OpenAI models                          |
| `generic-chat-completion-api` | OpenAI Chat Completions | OpenRouter, Fireworks, Ollama, vLLM, open-source models |

### Required Fields

- `model` - Identifier sent to API (e.g., `claude-sonnet`, `gpt-5`, `qwen3:4b`)
- `baseUrl` - API endpoint URL
- `apiKey` - Authentication credentials (cannot be empty)
- `provider` - One of the three types above

### Optional Fields

- `displayName` - User-friendly label in model selector
- `maxOutputTokens` - Response length limits
- `supportsImages` - Image input capability flag
- `extraArgs` - Provider-specific parameters (temperature, top_p, etc.)
- `extraHeaders` - Custom HTTP headers

### Model Selection

Switch models via `/model` command or CLI flag:

```bash
droid exec -m gpt-5.1 "task"
```

### Built-in Models

- `opus` - Claude Opus 4.5 (default)
- `sonnet` - Claude Sonnet 4.5
- `haiku` - Claude Haiku 4.5
- `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max`
- `gpt-5.2`
- `gemini-3-pro`
- `droid-core` - GLM-4.6 open-source model

**Important:** Models below 30 billion parameters show significantly lower performance on agentic coding tasks.

### Cost & Caching

- API keys remain local (not uploaded to Factory servers)
- Automatic prompt caching for official providers (Anthropic, OpenAI)
- Track costs via `/cost` command

---

## 4. IDE Integrations

Factory Droid works with any IDE or terminal:

### VS Code

- Install [Factory Droid Extension](https://marketplace.visualstudio.com/items?itemName=Factory.factory-vscode-extension)
- Or run `droid` in VS Code integrated terminal

### JetBrains IDEs

- Install [Factory Droid Plugin](https://plugins.jetbrains.com/plugin/28649-factory-droid)
- Supports: IntelliJ IDEA, PyCharm, Android Studio, WebStorm, PhpStorm, GoLand
- Or run `droid` in integrated terminal

### Vim and Other Editors

- No plugin required
- Run `droid` from your IDE's integrated terminal
- Maintains native keyboard shortcuts and debugging tools

### IDE Auto-Connect Setting

```json
{
  "ideAutoConnect": true // Connect to IDE from any terminal
}
```

---

## 5. MCP (Model Context Protocol) Server Configuration

### Server Types

1. **HTTP servers** - Remote endpoints for cloud services/APIs (recommended)
2. **Stdio servers** - Local processes with direct system access

### Adding MCP Servers

**HTTP Servers:**

```bash
droid mcp add <name> <url> --type http [--header "KEY: VALUE"...]

# Example
droid mcp add twelvelabs-mcp https://mcp.twelvelabs.io --type http \
  --header "x-api-key: YOUR_API_KEY"
```

**Stdio Servers:**

```bash
droid mcp add <name> "<command>" [--env KEY=VALUE...]
```

### Configuration Files

| Level   | Location              | Priority                            |
| ------- | --------------------- | ----------------------------------- |
| User    | `~/.factory/mcp.json` | Higher (overrides project)          |
| Project | `.factory/mcp.json`   | Shared with team, committed to repo |

**Configuration Schema:**

```json
{
  "linear": {
    "type": "http",
    "url": "https://mcp.linear.app/mcp",
    "disabled": false
  },
  "local-tool": {
    "type": "stdio",
    "command": "/path/to/tool",
    "args": ["--flag"],
    "env": {
      "API_KEY": "value"
    }
  }
}
```

### Authentication

- OAuth tokens stored globally in system keyring (not per-project)
- Authenticate once, available everywhere that server is configured

### Interactive Management

Use `/mcp` command within droid to:

- Browse 40+ pre-configured servers from registry
- View connection status and available tools
- Enable/disable servers
- Authenticate via OAuth
- Add/remove servers

### Remove Servers

```bash
droid mcp remove <name>
```

---

## 6. Skills Configuration

Skills are reusable capabilities that agents invoke **automatically** based on task context.

### Directory Structure

```
# Workspace skills (shared with team)
<repo>/.factory/skills/<skill-name>/SKILL.md

# Personal skills
~/.factory/skills/<skill-name>/SKILL.md
```

### Skill File Format

```markdown
---
name: prompt-refiner
description: Refine prompts for optimal AI model performance
---

# Instructions

Your skill instructions go here...
```

### Required Frontmatter Fields

- `name` - Identifier for the skill
- `description` - When to invoke it (helps AI decide automatically)

### Skill Components

Skills can include:

- `SKILL.md` - Main skill definition
- Supporting scripts and schemas
- `references.md` - Links to existing APIs/modules
- `schemas/` - JSON/YAML schema definitions
- `checklists.md` - Validation and rollout procedures

### Built-in Skill Families

1. Frontend UI implementation
2. Service integration
3. Data querying
4. Internal tools
5. Rapid vibe coding
6. AI data analysis
7. Product management
8. Browser automation

### Skills vs Slash Commands

- **Skills:** Model-invoked, automatic based on task
- **Slash Commands:** User-invoked macros (explicit trigger)

---

## 7. Custom Droids (Subagents)

Custom droids are reusable subagents with their own system prompt, model preference, and tooling policy.

### Directory Structure

```
# Project scope (shared with teammates)
<repo>/.factory/droids/<name>.md

# Personal scope (follows you across workspaces)
~/.factory/droids/<name>.md
```

### Droid File Format

```markdown
---
name: code-reviewer
description: Reviews code changes for quality and security
model: inherit
tools: read-only
reasoningEffort: medium
---

You are a code reviewer. Focus on:

- Security vulnerabilities
- Performance issues
- Code style violations
  ...
```

### Configuration Fields

| Field             | Purpose                                              |
| ----------------- | ---------------------------------------------------- |
| `name`            | Identifier (lowercase, digits, hyphens, underscores) |
| `description`     | UI label (≤500 characters)                           |
| `model`           | `inherit` or specific model ID                       |
| `reasoningEffort` | `low`, `medium`, `high`                              |
| `tools`           | Category string or array                             |

### Tool Categories

- `read-only`: `Read`, `LS`, `Grep`, `Glob`
- `edit`: `Create`, `Edit`, `ApplyPatch`
- `execute`: `Execute`
- `web`: `WebSearch`, `FetchUrl`
- `mcp`: Dynamically populated

### Management

Use `/droids` command to:

- Create new droids through guided wizard
- View, edit, delete existing droids
- Import agents from Claude Code (`~/.claude/agents/`)
- Reload configurations

### Invocation

```
"Use the subagent code-reviewer on this diff."
```

Or let Droid invoke them autonomously based on task.

---

## 8. Custom Slash Commands

User-invoked macros for repeatable prompts or setup steps.

### Directory Structure

```
# Project commands
<repo>/.factory/commands/<name>.md

# Personal commands
~/.factory/commands/<name>.md
```

### Usage

```
/review-pr
/my-custom-command
```

### Built-in Slash Commands

- `/review` - Code review
- `/settings` - Adjust preferences
- `/model` - Switch AI models
- `/mcp` - MCP server management
- `/droids` - Custom droids management
- `/hooks` - Hooks management
- `/account` - Factory account portal
- `/billing` - Billing information
- `/cost` - Track API costs

---

## 9. Hooks Configuration

Hooks are user-defined shell commands that execute at various points in Droid's lifecycle.

### Configuration Location

```
~/.factory/settings.json
```

### Hook Events

| Event              | When it Fires                  |
| ------------------ | ------------------------------ |
| `PreToolUse`       | Before tool calls (can block)  |
| `PostToolUse`      | After tool calls complete      |
| `UserPromptSubmit` | When user submits prompts      |
| `Notification`     | When Droid sends notifications |
| `Stop`             | When Droid finishes responding |
| `SubagentStop`     | When sub-droid tasks complete  |
| `PreCompact`       | Before compacting operations   |
| `SessionStart`     | When sessions begin/resume     |
| `SessionEnd`       | When sessions end              |

### Configuration Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "type": "command",
        "command": "prettier --write $FACTORY_FILE"
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "type": "command",
        "command": "/usr/local/bin/logger.sh $FACTORY_TOOL"
      }
    ]
  }
}
```

### Use Cases

- Automatic code formatting (prettier, gofmt)
- Compliance logging and command tracking
- Custom notifications during input waiting periods
- Codebase convention enforcement
- Sensitive file protection

### Security Warning

Hooks run automatically with your current environment's credentials. Always use absolute paths.

### Global Toggle

```json
{
  "hooksDisabled": true // Disable all hooks
}
```

---

## 10. AGENTS.md - Project Context File

AGENTS.md is a Markdown file that provides project context to AI agents.

### Location Discovery Hierarchy

1. `./AGENTS.md` in current working directory
2. Nearest parent directory up to repo root
3. Any `AGENTS.md` in sub-folders
4. Personal override: `~/.factory/AGENTS.md`

### Recommended Sections

```markdown
# Build & Test

- Build: `npm run build`
- Test: `npm run test`

# Architecture Overview

Brief description of major modules and data flow.

# Security

API keys, auth flows, sensitive data handling.

# Git Workflows

Branching strategy, commit conventions, PR requirements.

# Conventions & Patterns

Folder structure, naming patterns, code style.
```

### Cross-Agent Compatibility

AGENTS.md works with multiple AI tools:

- Factory Droid
- Cursor
- Aider
- Gemini CLI
- Jules
- Codex
- Zed

---

## 11. Settings Reference

### Settings Location

```
~/.factory/settings.json
```

### Key Settings

| Setting                    | Options                                    | Default              | Description                         |
| -------------------------- | ------------------------------------------ | -------------------- | ----------------------------------- |
| `model`                    | `opus`, `sonnet`, `haiku`, `gpt-5.1`, etc. | `opus`               | Default AI model                    |
| `reasoningEffort`          | `off`, `none`, `low`, `medium`, `high`     | Model-dependent      | Thinking depth                      |
| `autonomyLevel`            | `normal`, `spec`, `auto-low/medium/high`   | `normal`             | Default autonomy                    |
| `cloudSessionSync`         | `true`, `false`                            | `true`               | Mirror sessions to web              |
| `diffMode`                 | `github`, `unified`                        | `github`             | Code diff display                   |
| `completionSound`          | `off`, `bell`, `fx-ok01`, custom path      | `fx-ok01`            | Audio on response complete          |
| `awaitingInputSound`       | Same as above                              | `fx-ack01`           | Audio when waiting                  |
| `commandAllowlist`         | Array of commands                          | Safe defaults        | Auto-allowed commands               |
| `commandDenylist`          | Array of commands                          | Restrictive defaults | Always-blocked commands             |
| `includeCoAuthoredByDroid` | `true`, `false`                            | `true`               | Add co-author to commits            |
| `enableDroidShield`        | `true`, `false`                            | `true`               | Secret scanning, git guardrails     |
| `hooksDisabled`            | `true`, `false`                            | `false`              | Globally disable hooks              |
| `ideAutoConnect`           | `true`, `false`                            | `false`              | Auto-connect from external terminal |
| `todoDisplayMode`          | `inline`, `pinned`                         | `pinned`             | Todo list display                   |
| `enableCustomDroids`       | `true`, `false`                            | `true`               | Toggle custom droids                |
| `showThinkingInMainView`   | `true`, `false`                            | `false`              | Display AI reasoning                |
| `customModels`             | Array                                      | `[]`                 | BYOK model configs                  |

### Example Configuration

```json
{
  "model": "opus",
  "reasoningEffort": "medium",
  "autonomyLevel": "auto-low",
  "diffMode": "github",
  "cloudSessionSync": true,
  "completionSound": "fx-ok01",
  "commandAllowlist": ["ls", "pwd", "git status"],
  "commandDenylist": ["rm -rf /", "shutdown"],
  "customModels": []
}
```

---

## 12. CLI Reference Summary

### Core Commands

```bash
droid                              # Interactive REPL
droid "query"                      # REPL with initial prompt
droid exec "query"                 # Non-interactive execution
droid exec -f prompt.md            # Execute from file
cat file | droid exec              # Execute from stdin
droid exec -s <id> "query"         # Resume session
droid exec --list-tools            # List available tools
droid mcp add <name> <url>         # Add MCP server
droid mcp remove <name>            # Remove MCP server
```

### Essential Flags

```bash
-f, --file <path>                  # Read prompt from file
-m, --model <id>                   # Select model
-s, --session-id <id>              # Continue session
--auto <level>                     # Set autonomy (low/medium/high)
-o, --output-format <format>       # Output format
-r, --reasoning-effort <level>     # Reasoning level
--cwd <path>                       # Working directory
--enabled-tools <ids>              # Enable specific tools
--disabled-tools <ids>             # Disable specific tools
--use-spec                         # Specification/planning mode
--skip-permissions-unsafe          # Skip all permissions (dangerous!)
-v, --version                      # Show version
-h, --help                         # Show help
```

---

## 13. GitHub Repository

**Main Repository:** <https://github.com/Factory-AI/factory>

The repository contains:

- Documentation (`docs/`)
- Examples (`examples/`)
- Community builds listing
- Issue tracker for bugs/features

**Note:** The CLI itself is closed-source; the repository is primarily for documentation and community contributions.

### Related Repositories

- [droid-factory](https://github.com/iannuttall/droid-factory) - Custom subagents installer
- [droid-factory-template](https://github.com/julianromli/droid-factory-template) - 112+ specialist droids template

---

## 14. Comparison with Claude Code

| Feature              | Factory Droid           | Claude Code       |
| -------------------- | ----------------------- | ----------------- |
| Terminal-Bench Score | 58.75% (with Opus)      | 43.2% (with Opus) |
| Model Support        | Multi-model (BYOK)      | Anthropic only    |
| MCP Support          | Yes (40+ registry)      | Yes               |
| Custom Agents        | Yes (Custom Droids)     | Yes (Agents)      |
| Skills               | Yes (auto-invoked)      | Yes               |
| IDE Integrations     | VS Code, JetBrains, Vim | VS Code           |
| Hooks                | Yes (9 event types)     | Yes               |
| Headless Mode        | Yes (`droid exec`)      | Yes               |
| Open Source          | Docs only               | No                |
| Cloud Sync           | Yes                     | No                |

---

## 15. Integration Considerations for poe-code

### Potential Integration Points

1. **As a Provider Option**
   - Add `factory-droid` as a supported agent alongside Claude Code
   - Configure via `@factory/cli` npm package

2. **Shared Configuration Format**
   - AGENTS.md is cross-compatible (works with both)
   - MCP server configs have similar structure

3. **API Compatibility**
   - Both support `droid exec` / headless mode for automation
   - JSON output format for scripted usage

4. **BYOK Model Support**
   - Droid's generic-chat-completion-api provider enables wide model support
   - Could allow poe-code users to use same models across agents

### Installation for Testing

```bash
# Install globally
npm install -g @factory/cli

# Or via curl
curl -fsSL https://app.factory.ai/cli | sh

# Verify
droid --version

# Run interactive
droid

# Run headless
droid exec "analyze this repository" --auto low -o json
```

---

## Sources

- [Factory.ai Website](https://factory.ai)
- [Factory Documentation](https://docs.factory.ai)
- [Factory CLI Quickstart](https://docs.factory.ai/cli/getting-started/quickstart)
- [Factory BYOK Docs](https://docs.factory.ai/cli/byok/overview)
- [Factory MCP Docs](https://docs.factory.ai/cli/configuration/mcp)
- [Factory Custom Droids](https://docs.factory.ai/cli/configuration/custom-droids)
- [Factory Skills](https://docs.factory.ai/cli/configuration/skills)
- [Factory Hooks Guide](https://docs.factory.ai/cli/configuration/hooks-guide)
- [Factory CLI Reference](https://docs.factory.ai/reference/cli-reference)
- [Factory Droid Exec](https://docs.factory.ai/cli/droid-exec/overview)
- [Factory GitHub](https://github.com/Factory-AI/factory)
- [NPM Package](https://www.npmjs.com/package/@factory/cli)
- [VS Code Extension](https://marketplace.visualstudio.com/items?itemName=Factory.factory-vscode-extension)
- [JetBrains Plugin](https://plugins.jetbrains.com/plugin/28649-factory-droid)
- [Droid on Terminal-Bench](https://factory.ai/news/terminal-bench)
- [Tembo CLI Tools Comparison](https://www.tembo.io/blog/coding-cli-tools-comparison)
