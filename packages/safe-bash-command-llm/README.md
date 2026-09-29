# llm commands

Query injected language and media models through the shared LLM service. Register `llmCommands({ providers, defaultModel })` with your shell. Providers own credentials and HTTP transport. Use `limits.maxInputBytes` and `limits.maxOutputBytes` to bound per-command byte accounting.

Persist aliases, default models and default options in the caller’s filesystem using `llm aliases`, `llm models default`, and `llm models options`. Set `LLM_USER_PATH` to choose the virtual configuration directory. `createLlmConfiguration(context)` exposes these controls to structured frontends. Configuration controls require atomic publication and have a 1 MiB quota. Remaining reference CLI workflows and bounded prompt/attachment preparation are still incomplete.

Use `llm aliases` for the plain alias list or `llm aliases set short -q part -q name` to select the first model matching every query. `llm models options clear MODEL` clears all defaults atomically; the SDK equivalent is `configuration.clearModelOption(model)`. Pass a key to either interface to clear one option.

Models can declare an `options` map with scalar types and numeric bounds. Declared options are validated before persistence or provider execution, and service requests receive typed values. Providers without declarations retain their own option validation.
