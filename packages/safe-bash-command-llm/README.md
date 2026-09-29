# llm commands

Query injected language and media models through the shared LLM service. Register `llmCommands({ providers, defaultModel })` with your shell. Providers own credentials and HTTP transport. Use `limits.maxInputBytes` and `limits.maxOutputBytes` to bound per-command byte accounting.
