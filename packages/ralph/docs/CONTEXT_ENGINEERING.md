# Context Engineering Reference

This document explains the malloc/free metaphor for LLM context management that underlies the [Ralph Wiggum technique](https://ghuntley.com/ralph/), originally developed by Geoffrey Huntley.

## The malloc() Metaphor

In traditional programming, memory management follows a clear pattern: `malloc()` allocates memory, and `free()` releases it. In LLM context windows, **there is no equivalent to `free()`**. Every operation that adds information to context—reading files, executing tools, generating responses—allocates context space permanently until the conversation ends.

The only way to "free" context is to start a new conversation.

## Why This Matters

### Context Pollution

Context pollution occurs when the LLM's context window accumulates information that interferes with current work. This includes failed attempts, unrelated code snippets, error traces, and mixed concerns from multiple tasks.

```
Task 1: Build authentication → context contains auth code, JWT docs, security patterns
Task 2: Build UI components → context now ALSO contains auth stuff

Result: LLM might suggest auth-related patterns when building UI
        or mix concerns inappropriately
```

### Autoregressive Failure

When context contains pollution, each generated token is influenced by that pollution, creating a feedback loop where the model's outputs become increasingly off-base. This is [autoregressive failure](https://ghuntley.com/gutter/): the model predicts the next token based on a context window that contains increasingly irrelevant or misleading information.

### The Gutter

> "If the bowling ball is in the gutter, there's no saving it. It's in the gutter."
> — [Geoffrey Huntley](https://ghuntley.com/gutter/)

The "gutter" is the state where context pollution has reached a point of no return. Like a bowling ball in the gutter, once the agent is stuck in polluted context, there is no recovering without starting fresh.

## Context Health Indicators

### 🟢 Healthy Context
- Single focused task
- Relevant files only
- Clear progress
- Under 40% capacity

### 🟡 Warning Signs
- Multiple unrelated topics discussed
- Several failed attempts in history
- Approaching 40% capacity
- Repeated similar errors

### 🔴 Critical / Gutter
- Mixed concerns throughout
- Circular failure patterns
- Over 40% capacity
- Model suggesting irrelevant solutions

## Best Practices

### 1. One Task Per Context

Huntley's #1 recommendation: use a context window for one task, and one task only. Don't ask "fix the auth bug AND add the new feature". Do them in separate conversations.

### 2. Fresh Start on Topic Change

Finished auth? Start a new conversation for the next feature.

### 3. Don't Redline

The "dumb zone" hits around 40% context utilization. Past that, reasoning degrades. The [Ralph Playbook](https://claytonfarr.github.io/ralph-playbook/) recommends rotating context at 40% of total capacity (e.g., 80k/200k tokens), not at 90%+. This is "deterministically bad in an undeterministic world"—it wastes some work on rotation, but guarantees the agent never reaches the gutter.

### 4. Recognize the Gutter

If you're seeing:
- Same error 3+ times
- Solutions that don't match the problem
- Circular suggestions

Start fresh. Your progress is in the files.

### 5. State in Files, Not Context

Real state lives in files and Git, not in the LLM's context window. Context is treated as ephemeral scratch space that will be discarded at rotation. The next conversation can read your files. Context is ephemeral; files are permanent.

## Ralph's Approach

The [original Ralph technique](https://ghuntley.com/ralph/) (`while :; do cat PROMPT.md | agent ; done`) naturally implements these principles:

1. **Each iteration is a fresh process** — Context is freed
2. **State persists in files** — Progress survives context resets
3. **Same prompt each time** — Focused, single-task context
4. **Backpressure beats direction** — Instead of telling the agent what to do, engineer an environment where wrong outputs get rejected automatically

This implementation aims to bring these benefits while working within Cursor's session model.

## Measuring Context

Rough estimates:
- 1 token ≈ 4 characters
- Average code file: 500-2000 tokens
- Large file: 5000+ tokens
- Conversation history: 100-500 tokens per exchange

Track allocations in `.poe-code-ralph/context-log.md` to stay aware.

## Theory vs Implementation

The capacity percentages above (40%, etc.) are **theoretical guidelines** from the original Ralph methodology. In practice, agents like Claude Code and Cursor don't expose context usage programmatically.

### What's Available

| Agent | Context Visibility |
|-------|-------------------|
| Claude Code | `/context` command (interactive only) |
| Cursor | No real-time access; Admin API for team analytics |
| Codex | No programmatic access |

There are [open feature requests](https://github.com/anthropics/claude-code/issues/10593) to expose this data, but as of now it's not available for automated rotation.

### What We Use Instead

Since we can't measure context usage directly, this implementation uses proxy signals:

1. **Iteration count** (`maxIterations`) — Rotate after N iterations regardless of context. Conservative default ensures we never hit the gutter.

2. **Overbaking detection** (`maxFailures`) — Track consecutive failures per story. If a story fails N times in a row, it's likely we're in the gutter or the story needs to be split.

3. **Stale timeout** (`staleSeconds`) — Auto-reopen stories stuck in `in_progress` state, handling crashes or abandoned runs.

The percentages in this document are useful for **humans** making manual decisions about when to start a new conversation. For automated loops, fresh context per iteration sidesteps the problem entirely.

## When to Start Fresh

**Definitely start fresh when:**
- Switching to unrelated task
- Context over 40% full
- Same error 3+ times
- Model suggestions are off-topic

**Consider starting fresh when:**
- Significant topic shift within task
- Feeling "stuck"
- Multiple failed approaches in history

---

## Further Reading

- [Ralph Wiggum as a Software Engineer](https://ghuntley.com/ralph/) — Original technique by Geoffrey Huntley
- [Autoregressive Queens of Failure](https://ghuntley.com/gutter/) — The gutter metaphor explained
- [The Ralph Playbook](https://claytonfarr.github.io/ralph-playbook/) — Comprehensive guide by Clayton Farr
- [how-to-ralph-wiggum](https://github.com/ghuntley/how-to-ralph-wiggum) — Official methodology guide
- [ralph](https://github.com/snarktank/ralph) — Reference implementation of the Ralph autonomous agent loop
- [From ReAct to Ralph Loop](https://www.alibabacloud.com/blog/from-react-to-ralph-loop-a-continuous-iteration-paradigm-for-ai-agents_602799) — Comparison with other agent paradigms
