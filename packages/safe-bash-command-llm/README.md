# llm commands

Query injected language and media models through the shared LLM service. Register `llmCommands({ providers, defaultModel })` with your shell. Providers own credentials and HTTP transport. Use `limits.maxInputBytes` and `limits.maxOutputBytes` to bound per-command byte accounting.

Persist aliases, default models and default options in the caller’s filesystem using `llm aliases`, `llm models default`, and `llm models options`. Set `LLM_USER_PATH` to choose the virtual configuration directory. `createLlmConfiguration(context)` exposes these controls to structured frontends. Configuration controls require atomic publication and have a 1 MiB quota. Remaining reference CLI workflows and bounded prompt/attachment preparation are still incomplete.

Use `llm aliases` for the plain alias list or `llm aliases set short -q part -q name` to select the first model matching every query. `llm models options clear MODEL` clears all defaults atomically; the SDK equivalent is `configuration.clearModelOption(model)`. Pass a key to either interface to clear one option.

Models can declare an `options` map with scalar types and numeric bounds. Declared options are validated before persistence or provider execution, and service requests receive typed values. Providers without declarations retain their own option validation. Numeric declarations and OpenAI options follow the pinned reference’s decimal syntax, rejecting radix prefixes and exponent strings for integer fields.

Use `llm prompt hello` or `llm hello` for the same prompt; `llm -- prompt hello` sends the literal words. List models with `llm models`, narrow matches with repeated `-q` queries or repeated `-m` selections, and inspect declared options and attachment types with `--options`. `--schemas` selects schema-capable models. Model-list usage errors exit with status 2. Positive tool and async catalog metadata remain incomplete.

Use `llmCommands({ service })` to share an authorized `createLlmService()` instance with another language frontend. Configure providers and the default model on that service; command limits remain per invocation.

Store a prompt with `llm 'Hello $input' -s 'Speak $style' -m MODEL -p style softly --save greet`, then run `llm world -t greet -p style loudly`. `llm templates` lists stored templates; `templates show NAME` and `templates path` inspect them. These workflows use the caller filesystem and the optional `yaml@2.9.0` parser. SDK callers use `createLlmTemplateStore()`, `validateLlmTemplateParameters()` and `evaluateLlmTemplate()`. Template parameter validation and model admission precede stdin consumption. Attachment templates, external loaders, editor workflows and the remaining template fields are incomplete. `--no-stream` buffers terminal output; it does not yet select a different provider HTTP protocol.

Convert concise field definitions with `llm schemas dsl 'name, age int, bio: their bio'`; `--multi` wraps the schema in an `items` array. SDK callers use `parseLlmSchemaDsl(input, multi)`. Stored schema lookup and history workflows remain incomplete.
