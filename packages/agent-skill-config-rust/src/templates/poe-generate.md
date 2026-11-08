---
name: poe-generate
description: "Poe Code agent prompting guidance"
---

# Poe Code Prompting

Use Poe Code's supported agent surfaces for prompts. The current CLI has no standalone generation command.

## One-shot Poe Agent Prompt

```bash
poe-code agent "Summarize the current repository."
```

Specify a model when the command supports it:

```bash
poe-code agent "Summarize this codebase change." --model "<model-id>"
```

## Coding Agent Prompt

Use `spawn` when the prompt should run through a configured coding agent CLI:

```bash
poe-code spawn codex "Review the auth module"
poe-code spawn claude-code "Fix the failing tests" --model "<model-id>"
```

Run against a GitHub locator when the work should happen outside the current checkout:

```bash
poe-code spawn codex "Review this package" --cwd github://owner/repo#main:packages/auth
```

## Tips

- Run `poe-code models` to find model IDs and endpoint support.
- Use `poe-code auth status` to verify credentials before running prompts.
- Use `poe-code spawn --help` and `poe-code agent --help` for current flags.
