# llm commands

Query injected language and media models through the shared LLM service. Register `llmCommands({ providers, defaultModel })` with your shell. Providers own credentials and HTTP transport. Use `limits.maxInputBytes` and `limits.maxOutputBytes` to bound per-command byte accounting.

Persist aliases, default models and default options in the caller’s filesystem using `llm aliases`, `llm models default`, and `llm models options`. Set `LLM_USER_PATH` to choose the virtual configuration directory. `createLlmConfiguration(context)` exposes these controls to structured frontends. Configuration controls require atomic publication and have a 1 MiB quota. Remaining reference CLI workflows and bounded prompt/attachment preparation are still incomplete.
