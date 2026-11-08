# Python LLM

The calling profile runs the original `llm==0.27.1` distribution. Python code
uses its regular API, backed by the host's configured model catalog,
authorization and billing:

```python
import llm

model = llm.get_model()
response = model.prompt("Explain gravity", temperature=0.2)
print(response.text())

for chunk in model.prompt("Give me an example"):
    print(chunk, end="", flush=True)
```

The package owns `Model`, `Response`, `AsyncResponse`, `Conversation`,
`Attachment` and `Options`, including lazy execution, cached iteration,
completion callbacks and validation. Callers need no custom client, context
manager or Pyodide calls.

```python
import asyncio
import llm

async def main():
    model = llm.get_async_model("your-model")
    response = model.prompt("Explain gravity")
    async for chunk in response:
        print(chunk, end="", flush=True)
    print(await response.text())

asyncio.run(main())
```

Use `llm.get_models()` and `llm.get_async_models()` to discover the host's
enabled text models. `get_models_with_aliases()` and
`get_embedding_models_with_aliases()` return alias records whose `matches(query)`
method searches model names and aliases without case sensitivity.
The runtime selects its internal provider before guest
code runs; guest `LLM_LOAD_PLUGINS` settings do not replace it. Bundled external
providers and tool plugins are disabled. Model calls stay within the host's
catalog and existing authorization; caller-supplied provider keys are rejected.
This integration does not enable provider or plugin installation.

```python
chat = model.conversation()
chat.prompt("I am learning Python", system="Be concise").text()
print(chat.prompt("What should I learn next?").text())

attachment = llm.Attachment(path="/work/report.txt", type="text/plain")
print(model.prompt("Summarize this", attachments=[attachment]).text())

embedding_model = llm.get_embedding_model("your-embedding-model")
vector = embedding_model.embed("orbital mechanics")
vectors = list(embedding_model.embed_multi(["gravity", "orbits"]))
```

Embedding calls retain the same host authorization and limits as prompts.
Embedding host requests reject completion-only fields, including attachments
and templates, before acquiring file leases or invoking a provider.

Conversations remain in memory. Schemas accept dictionaries or Pydantic model
classes. The original `llm.schema_dsl()` helper builds schemas from compact
field descriptions. Model options use genuine Pydantic validation. Path and byte-content
attachments use the canonical filesystem and bounded host input transport.
Use `llm.Attachment(url="https://example.com/report.txt")` when the host enables
URL attachments; both sync and async model calls keep the regular syntax.
The native reference and actual Worker conformance program compare the same
calling code, including a prompt larger than 16 MiB and its reuse in conversation
history with exact UTF-8 byte hashes.

The profile adds no call logging, saved history, collections or persistent
database integration. CLI administration and plugin management are outside
this calling profile.

## Runtime provisioning

Provision dependencies at build time with `downloadPythonLlmPackages()` and
`readPythonLlmAssets()` from
`@poe-platform/safe-bash/commands/python/node`. The manifest pins distribution
versions, sizes and SHA-256 hashes. Wheels and native binaries are generated
assets, not vendored source. The interpreter does not download dependencies.

Register the returned native Wasm modules with the existing static JSPI asset
loader. Call `installPythonLlmPackages(runtime, assets.packages)` before handing
the runtime to the executor. Enable `createPythonLlmCapability()` over the
same invocation-owned authorized service used by the shell command. An optional
`attachmentTransport` supplies the host-authorized GET/HEAD transport for URL
attachments. There is no ambient Python networking fallback. The host transport
must enforce its download policy and return redirects without following them;
like the original library, this adapter rejects redirect responses. Embedded URL
credentials are rejected. MIME checks, response headers, retained input bytes
and cleanup stay bounded.

Set finite interpreter, filesystem, parent input and host bridge budgets. The
package profile requires the pinned Pyodide runtime. Hosts that omit its assets
retain the legacy compatibility module; that fallback is not the genuine
package qualification described here.

### Optional dependencies for the legacy compatibility module

The following dependency-only path applies to hosts that retain the legacy
module. The calling profile above already includes these dependencies.

The legacy module retains shared templates and saved configuration. Its
`get_default_model`, `set_default_model`, `get_default_embedding_model` and
`set_default_embedding_model` helpers use canonical configuration files. The text
getter accepts `filename` and `default`, trims stored whitespace and retains the
reference `DEFAULT_MODEL` fallback; embedding defaults fall back to `None`.
Setting an existing default to `None` removes it atomically. Named defaults must
be `.txt` basenames inside the configuration directory. Lookup without a model
name uses the host service's effective default.

Legacy custom Python models can subclass `llm.Model` or `llm.AsyncModel` and
implement `execute(prompt, stream, response, conversation)` as a sync or async
generator. Responses remain lazy, replay completed text and close custom
generators on cancellation or explicit early closure. Embedding subclasses
implement `embed_batch(items)` and declare `supports_text` and `supports_binary`;
the inherited helpers enforce those capabilities and batch sizes. Calls to
discovered models continue through the authorized JavaScript provider service.
The calling profile above keeps provider registration disabled.

Use llm.Template for reusable Python prompt templates. Its typed fields match
the reference library, evaluate(input, params) interpolates prompt and system
strings with defaults, and vars() reports named variables. Missing named values
raise Template.MissingVariables; templates reject unknown fields. Inline functions
remain untrusted data and are never executed by template evaluation.

```python
template = llm.Template(
    name="review",
    prompt="Review $topic: $input",
    defaults={"topic": "code"},
)
prompt, system = template.evaluate("print('hello')")
response = llm.get_model("your-model").prompt(prompt, system=system)
```

llm.Fragment("content", source="notes.md") preserves a source label and exposes
a SHA-256 id while remaining a normal string for prompt and system fragments.
Implemented public values are also importable from llm.models, llm.templates,
llm.utils and llm.errors. These modules share the same class identities as the
top-level llm exports and are bundled without runtime file installation.

Custom models can use the standard llm.Tool, ToolCall, ToolResult, ToolOutput and
Toolbox interfaces. Tool.function(callable) derives a JSON argument schema from
Python type annotations and defaults. Toolboxes expose bound methods and extra
registered functions, with prepare or prepare_async hooks. A model that declares
supports_tools=True can call response.add_tool_call(...); response.tool_calls()
completes the lazy response and returns its calls. Execute them with
response.execute_tool_calls(before_call=..., after_call=...) (await both methods
on asynchronous responses). CancelToolCall from the before hook produces a
cancelled result. Tool exceptions become results with the original exception;
cancelling an async execution also cancels and joins its outstanding tool tasks.

Use model.chain(..., tools=[...]) or conversation.chain(...) for successive
tool-driven turns. The chain exposes text and streaming iteration (async for
asynchronous models), and responses() exposes each individual response. Set
chain_limit on the conversation or its chain call to bound successive turns.
ToolOutput can carry canonical-file attachments into the following prompt.

```python
def add_one(value: int):
    return value + 1

class Workflow(llm.Model):
    model_id = "workflow"
    supports_tools = True

    def execute(self, prompt, stream, response, conversation):
        if prompt.tool_results:
            yield prompt.tool_results[0].output
        else:
            response.add_tool_call(llm.ToolCall("add_one", {"value": 4}))
            yield "Result: "

print(Workflow().chain("go", tools=[add_one]).text())
```

These tool workflows are qualified for Python custom models. Provider tool
transport through discovered JavaScript models remains unfinished; unsupported
host prompts fail explicitly instead of dropping their tools or results.

For real Pydantic schema classes, the public Python SDK exports
pythonLlmDependencies and installPythonLlmDependencies. The manifest pins the
Pyodide version, wheel filenames, sizes and SHA-256 digests, plus native module
paths and digests. Fetch and authenticate these inputs at build time. Register
the extracted native modules with createPythonJspiAssets, and bundle the wheels
as static data. Inside loadRuntime, call
await installPythonLlmDependencies(runtime, archives), where each archive is
{fileName, bytes}, before returning the interpreter.

The loader checks the complete bundle before extraction into the private
interpreter runtime. It performs no network requests or pip installation, and
requires no runtime Wasm compilation. Pydantic availability alone does not yet
qualify the complete reference Options interface. With these dependencies loaded,
llm.Options is a genuine Pydantic BaseModel with extra fields forbidden. Custom
models can define a nested Options subclass; model.prompt validates it immediately
and execute receives the typed instance through prompt.options. Discovered models
with declared shared-service options receive generated Pydantic classes using
those same types, bounds, nullability and descriptions. Transport serializes typed
options before canonical JavaScript validation. Models without declarations retain
their existing permissive option behavior; full base-model Options parity remains
unfinished.

For the actual Worker conformance test, provision packages explicitly and set
`SAFE_BASH_LLM_PACKAGE_DIR` to that directory. Also set
`SAFE_BASH_LLM_REFERENCE_PYTHON` to a native CPython environment with the pinned
original package. Tests do not download or install dependencies implicitly.

## Input ownership and remaining calling limits

Large prompt, system and history text and inline attachment content are written
in chunks of at most 16 KiB to retained canonical staging. Private handles cross
the control bridge. The selected provider must implement `completeSources`;
there is no whole-file buffering fallback. Path attachments use retained reads.
Parent input limits account for admitted sizes and consumed bytes. Temporary
input count and live bytes are bounded; bridge retirement awaits cleanup even
when the interpreter is cancelled during acquisition.

The control budget separately bounds schemas, options and metadata. Output
chunks preserve order and Unicode scalar boundaries. The original package may
retain response chunks or materialize data inside Python, including explicit
attachment content reads; the interpreter's finite heap remains its memory
boundary.

Conversation history preserves attachments from completed responses, including
restored responses. Historical and current attachments share retained input
transport, cleanup and the total input budget. Declared object and array options
are validated by generated Pydantic classes and retain their structured values
through JavaScript validation.

Binary embedding inputs are not supported by the current transport. Worker
conformance does not establish consumer deployment acceptance.

`createPythonLlmCapability` accepts `maxInputBytes` for total input admission and
`maxBufferedInputBytes` for aggregate materialized request controls. Retained
input bytes consume the total allowance; configuration, templates, schemas and
serialized controls also consume the buffering allowance. Parent invocation
limits and provider encoded-body limits still apply.
