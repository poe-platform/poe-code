# Cursor Agent Configuration Options - Research Document

## Overview

**CLI Version**: 2026.01.28-fd13201
**Command**: `cursor agent`

This document provides a comprehensive overview of all configuration options, modes, and features available in the Cursor Agent CLI.

---

## Interactive vs Non-Interactive Modes

### Interactive Mode (Default)
```bash
cursor agent
cursor agent "Initial prompt"
```
- Opens an interactive TUI (Text User Interface)
- Requires raw mode support on stdin
- Cannot be used in scripts or pipelines without a TTY

### Non-Interactive Mode (`--print`)
```bash
echo "What is 2+2?" | cursor agent --print
cursor agent --print "What is 2+2?"
```
- **Flag**: `--print` or `-p`
- Prints responses to console
- Designed for scripts and programmatic use
- Has access to all tools (including write and bash)
- Can accept prompts via:
  - Command line arguments: `cursor agent --print "prompt"`
  - Standard input (stdin): `echo "prompt" | cursor agent --print`
  - File input: `cursor agent --print "$(cat prompt.txt)"`

---

## Output Formats (Non-Interactive Only)

### Text Format (Default)
```bash
cursor agent --print --output-format text "What is 2+2?"
# Output: 2+2 = 4
```
- Simple text output
- Best for basic CLI usage

### JSON Format
```bash
cursor agent --print --output-format json "What is 10 + 5?"
```
**Output Structure**:
```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 4364,
  "duration_api_ms": 4364,
  "result": "10 + 5 = 15",
  "session_id": "92d8a550-82f3-409d-bf7e-ab2acc7d4d06",
  "request_id": "021b26c0-0371-4464-8556-d8c04c959418"
}
```
- Single JSON object at the end
- Contains full result with metadata

### Stream JSON Format (ACP-style)
```bash
cursor agent --print --output-format stream-json "List three colors"
```
**Event Types**:
- `system` - initialization events
- `user` - user message events
- `thinking` - model thinking process (with thinking models)
- `tool_call` - tool invocations (started/completed)
- `assistant` - assistant responses
- `result` - final result

**Example Events**:
```json
{"type":"system","subtype":"init","apiKeySource":"login","cwd":"/path","session_id":"...","model":"Claude 4.6 Opus (Thinking)","permissionMode":"default"}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"List three colors"}]},"session_id":"..."}
{"type":"thinking","subtype":"delta","text":"The user is","session_id":"...","timestamp_ms":...}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"1. Blue\n2. Red\n3. Green"}]},"session_id":"..."}
{"type":"result","subtype":"success","duration_ms":4278,"duration_api_ms":4278,"is_error":false,"result":"...","session_id":"...","request_id":"..."}
```

### Stream JSON with Partial Output
```bash
cursor agent --print --output-format stream-json --stream-partial-output "Count from 1 to 10"
```
**Features**:
- Streams individual text deltas as separate events
- Real-time output as the model generates text
- Each thinking/assistant text chunk is a separate JSON event
- Useful for progressive UI updates

**Example Partial Events**:
```json
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"1"}]},"session_id":"...","timestamp_ms":...}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":","}]},"session_id":"...","timestamp_ms":...}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":" 2, 3, 4"}]},"session_id":"...","timestamp_ms":...}
```

### Tool Events in Stream JSON
When tools are used, you'll see tool_call events:
```json
{"type":"tool_call","subtype":"started","call_id":"toolu_bdrk_...","tool_call":{"editToolCall":{"args":{"path":"...","streamContent":"test"}}},"model_call_id":"...","session_id":"...","timestamp_ms":...}
{"type":"tool_call","subtype":"completed","call_id":"toolu_bdrk_...","tool_call":{"editToolCall":{"args":{"path":"...","streamContent":"test"},"result":{"success":{"path":"...","linesAdded":1,"linesRemoved":1,"diffString":"...","afterFullFileContent":"test","message":"..."}}}},"model_call_id":"...","session_id":"...","timestamp_ms":...}
```

---

## Execution Modes

### Default Mode
```bash
cursor agent
```
- Full access to all tools (read, write, bash, etc.)
- Interactive or non-interactive

### Plan Mode
```bash
cursor agent --plan
cursor agent --mode plan
```
- **Purpose**: Read-only/planning mode
- Agent analyzes, proposes plans, but makes no edits
- Useful for understanding codebases or getting implementation proposals
- Still has read access to files and can use analysis tools

### Ask Mode
```bash
cursor agent --mode ask
```
- **Purpose**: Q&A style for explanations and questions
- Read-only mode
- Optimized for answering questions about code
- No write operations

---

## Sandbox Modes

### Default Sandbox Behavior
- Controlled by user configuration
- Prompts for permission before executing potentially dangerous operations

### Explicitly Enable Sandbox
```bash
cursor agent --sandbox enabled
```
- Enforces sandbox mode regardless of configuration
- Still executes operations but with safety guardrails

### Disable Sandbox (YOLO Mode)
```bash
cursor agent --sandbox disabled
```
- Explicitly disables sandbox mode
- Bypasses configuration settings
- Use with caution

### Force Flag
```bash
cursor agent --force
cursor agent -f
```
- Force allows commands unless explicitly denied
- Reduces permission prompts
- Can be combined with sandbox modes
- Example: `cursor agent --print --sandbox disabled --force`

---

## Authentication & API Configuration

### API Key
**Via Environment Variable**:
```bash
export CURSOR_API_KEY="your-key"
cursor agent
```

**Via Command Line**:
```bash
cursor agent --api-key "your-key"
```

### Authentication Commands
```bash
# Login (opens browser for auth)
cursor agent login

# Check auth status
cursor agent status
cursor agent whoami

# Logout
cursor agent logout
```

**Skip Browser Opening**:
```bash
NO_OPEN_BROWSER=1 cursor agent login
```

---

## Custom Headers

```bash
cursor agent --print -H "X-Custom-Header: value1" -H "X-Another: value2" "prompt"
```
- **Flag**: `-H` or `--header`
- Format: `'Name: Value'`
- Can be used multiple times for multiple headers
- Useful for custom authentication or tracking

---

## Model Selection

### List Available Models
```bash
cursor agent --list-models
cursor agent models
```

**Available Models** (as of 2026.01.28):
- auto - Auto
- composer-1 - Composer 1
- gpt-5.2-codex (+ variants: high, low, xhigh, fast versions)
- gpt-5.1-codex-max (+ high variant)
- gpt-5.2 (+ high variant)
- opus-4.6-thinking - Claude 4.6 Opus (Thinking) [Default]
- opus-4.6 - Claude 4.6 Opus
- sonnet-4.5 - Claude 4.5 Sonnet
- sonnet-4.5-thinking - Claude 4.5 Sonnet (Thinking)
- gemini-3-pro / gemini-3-flash
- grok

### Select a Model
```bash
cursor agent --model sonnet-4.5 "Your prompt"
```
- Can also switch in interactive mode: `/model <id>`

---

## Workspace Configuration

### Specify Workspace Directory
```bash
cursor agent --workspace /path/to/directory "prompt"
```
- Changes the working directory for the agent
- Defaults to current working directory
- Affects file operations and context

---

## Session Management

### Create New Chat
```bash
cursor agent create-chat
# Returns: chat-id (e.g., 499e02de-0a11-490d-b811-d3cefb4b034d)
```

### Resume a Specific Chat
```bash
cursor agent --resume <chat-id> "Follow-up prompt"
```
- Continues previous conversation with full context

### Resume Last Chat
```bash
cursor agent --continue
cursor agent resume
```
- Automatically resumes the most recent chat session

### List Chats
```bash
cursor agent ls
```
- **Note**: Requires interactive terminal (TTY)
- Lists all available chat sessions

### Chat Storage
- Chats stored in: `~/.cursor/chats/<hash>/`
- Organized by workspace hash

---

## MCP (Model Context Protocol) Configuration

### Configuration Files
**Global Configuration**:
```
~/.cursor/mcp.json
```

**Local/Workspace Configuration**:
```
.cursor/mcp.json
```

**Example mcp.json**:
```json
{
  "mcpServers": {
    "playwright": {
      "url": "http://localhost:8931/sse"
    },
    "discord": {
      "url": "http://localhost:3004/mcp",
      "disabled": false
    }
  }
}
```

### MCP Commands

#### List Configured MCPs
```bash
cursor agent mcp list
# Shows status of each configured MCP server
```

#### Enable/Disable MCPs
```bash
# Enable an MCP
cursor agent mcp enable <identifier>

# Disable an MCP
cursor agent mcp disable <identifier>
```

#### List MCP Tools
```bash
cursor agent mcp list-tools <identifier>
```
- Shows available tools and their argument names for a specific MCP

#### MCP Authentication
```bash
cursor agent mcp login <identifier>
```
- Authenticate with an MCP server

### Auto-Approve MCPs (Non-Interactive)
```bash
cursor agent --approve-mcps --print "prompt"
```
- **Flag**: `--approve-mcps`
- Automatically approves all MCP servers
- Only works with `--print` (headless/non-interactive mode)
- Useful for CI/CD or automated workflows

---

## Configuration Files

### Global Configuration Directory
```
~/.cursor/
├── agent-cli-state.json         # CLI state
├── cli-config.json              # Main CLI configuration (large file with permissions, sandbox settings)
├── mcp.json                     # MCP server configurations
├── chats/                       # Chat history
├── projects/                    # Per-project settings
│   └── <workspace-hash>/
│       ├── mcp-approvals.json   # MCP approval state
│       └── repo.json            # Repository metadata
├── skills-cursor/               # Skills directory
└── prompt_history.json          # Prompt history
```

### Local/Workspace Configuration
```
.cursor/
├── commands/                    # Custom commands (*.md files)
└── skills/                      # Custom skills
```

**Example Custom Commands**:
- opsx-apply.md
- opsx-archive.md
- opsx-explore.md
- etc.

---

## Shell Integration

### Install Shell Integration
```bash
cursor agent install-shell-integration
```
- Installs integration to `~/.zshrc`
- Enables shell completions and hooks

### Uninstall Shell Integration
```bash
cursor agent uninstall-shell-integration
```
- Removes integration from `~/.zshrc`

---

## Other Features

### Generate Rules
```bash
cursor agent generate-rule
cursor agent rule
```
- Interactive prompt to create new Cursor rules
- Generates custom behavior rules for the agent

### Cloud Mode
```bash
cursor agent --cloud
cursor agent -c
```
- Starts in cloud mode
- Opens composer picker on launch

### Version and Info
```bash
# Show version
cursor agent --version
cursor agent -v

# Show detailed info
cursor agent about
```

### Update
```bash
cursor agent update
cursor agent upgrade
```
- Updates Cursor Agent to the latest version

---

## Environment Variables

### CURSOR_API_KEY
```bash
export CURSOR_API_KEY="your-api-key"
```
- Alternative to `--api-key` flag

### NO_OPEN_BROWSER
```bash
NO_OPEN_BROWSER=1 cursor agent login
```
- Prevents browser from opening during login

---

## Complete Usage Examples

### Example 1: Non-Interactive with JSON Streaming
```bash
echo "Write a hello world function in Python" | \
  cursor agent --print \
  --output-format stream-json \
  --stream-partial-output \
  --model sonnet-4.5 \
  --workspace /path/to/project
```

### Example 2: Automated with Force and Sandbox Disabled
```bash
cursor agent --print \
  --force \
  --sandbox disabled \
  --output-format json \
  "Create a README.md file"
```

### Example 3: Plan Mode with Custom Headers
```bash
cursor agent --print \
  --mode plan \
  --output-format text \
  -H "X-Session-ID: abc123" \
  "How should I implement user authentication?"
```

### Example 4: Resume Chat with MCP Auto-Approval
```bash
cursor agent --print \
  --resume <chat-id> \
  --approve-mcps \
  "Continue the previous task"
```

### Example 5: File-Based Prompt Input
```bash
# Store prompt in file
cat > prompt.txt << 'EOF'
Analyze the codebase and suggest improvements:
1. Code organization
2. Performance optimizations
3. Security concerns
EOF

# Execute with file input
cursor agent --print --mode plan "$(cat prompt.txt)"
```

---

## ACP Protocol Details

The stream-json format follows an event-streaming protocol similar to ACP (Agent Communication Protocol):

### Event Stream Structure
1. **System Initialization**: Session details, model, permissions
2. **User Input**: Echo of user's message
3. **Thinking Events**: Model's internal reasoning (for thinking models)
4. **Tool Events**: Tool invocations and results
5. **Assistant Output**: Model's response (streamed or complete)
6. **Result Summary**: Final status and metrics

### Integration Tips
- Parse newline-delimited JSON (NDJSON)
- Handle events sequentially
- `timestamp_ms` can be used for latency tracking
- `session_id` persists across related events
- `call_id` links tool_call started/completed events

---

## Stdin, File Input, and Prompt Sources

### Standard Input (Pipe)
```bash
echo "prompt" | cursor agent --print
cat prompt.txt | cursor agent --print
```

### Command Line Argument
```bash
cursor agent --print "prompt text"
```

### File Content via Command Substitution
```bash
cursor agent --print "$(cat prompt.txt)"
```

### Heredoc (Multi-line Prompts)
```bash
cursor agent --print << 'EOF'
Multi-line prompt
with multiple lines
EOF
```

---

## Summary Table

| Feature | Flag/Option | Notes |
|---------|-------------|-------|
| **Non-interactive** | `--print`, `-p` | Required for scripts |
| **Output Format** | `--output-format <format>` | text, json, stream-json |
| **Partial Streaming** | `--stream-partial-output` | Only with stream-json |
| **Execution Mode** | `--mode <mode>`, `--plan` | plan, ask |
| **Sandbox** | `--sandbox <mode>` | enabled, disabled |
| **Force** | `--force`, `-f` | Allow unless denied |
| **API Key** | `--api-key <key>` | Or CURSOR_API_KEY env |
| **Custom Headers** | `-H <header>` | Multiple allowed |
| **Model** | `--model <model>` | See --list-models |
| **Workspace** | `--workspace <path>` | Working directory |
| **Resume Chat** | `--resume [chatId]` | Continue session |
| **Auto-continue** | `--continue` | Resume last chat |
| **Cloud Mode** | `--cloud`, `-c` | Composer picker |
| **MCP Auto-approve** | `--approve-mcps` | Only with --print |

---

## Configuration File Locations

| Purpose | Location |
|---------|----------|
| Global MCP config | `~/.cursor/mcp.json` |
| Local MCP config | `.cursor/mcp.json` |
| CLI settings | `~/.cursor/cli-config.json` |
| Chat history | `~/.cursor/chats/` |
| Project settings | `~/.cursor/projects/<hash>/` |
| Custom commands | `.cursor/commands/` |
| Custom skills | `.cursor/skills/` |

---

## Research Notes

- The CLI is built using Ink (React for CLI)
- Uses Cursor API for model access
- Supports both local workspace context and cloud collaboration
- MCP servers enable extensibility via external tools
- Stream-json format is ideal for building UIs or real-time dashboards
- The agent has access to various tools: file operations, bash, search, etc.
- Permission system can be configured via cli-config.json (permissions, sandbox settings)
- Chat sessions are persistent and can be resumed across invocations
