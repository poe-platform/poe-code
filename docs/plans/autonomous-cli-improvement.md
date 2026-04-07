---
agent: 
    - claude-code
    - codex
    - opencode:anthropic/claude-opus-4.6
    - opencode:anthropic/gemini-3.1-pro
iterations: 20
status:
  state: open
  iteration: 0
---

Run autonomously, improve the design of cli commands, start with spawn and expand. And then also double-check other commands.

## Todo

Maintain todo lists in {{ current_file }}

- [ ] improve spawn `npm run dev -- spawn claude "what files are here?"` - check kimi, opencode, claude, codex
  - [ ] weird extra bullet after Claude Code spawn completed.
  - [ ] no space before tokens, looks too crammed
- [ ] check wrap
- [ ] check github workflow commands

## Constraints

- For spawn. You must not diverge from the ACP spec, no custom fields, no hacks
- If you find bugs, fix them
- If you find failing tests, fix them
