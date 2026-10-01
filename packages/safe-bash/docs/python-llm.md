# Python LLM workflows

The bundled Python module is named `poe_llm`, distinct from the reference `llm`
package. It contains Python request construction and workflow code. Providers,
model resolution, authorization, billing and file access belong to the injected
JavaScript service.

The module ships with the authenticated runtime, without pip installation.
The JSPI launcher installs an invocation-owned bridge. Enable `llm` in
`pythonCommands({ createCapabilities })`: its `call({ operation, payload },
{ signal })` handles `models`, `complete` and `embed`; its `stream(payload,
{ signal })` produces incremental events. The application adapter must reuse
`createPythonLlmCapability(context, service)` over its authorized JavaScript
service. Python receives data, never credentials or
service objects. A default `Client()` raises `CapabilityError` when the parent
has not enabled the capability. The blocking Node filesystem launcher does not
support host capabilities.

```javascript
import { createLlmService, llmCommands } from '@poe-platform/safe-bash/commands/llm';
import { pythonCommands, createPythonLlmCapability } from '@poe-platform/safe-bash/commands/python';

const service = createLlmService({ providers: [authorizedProvider], defaultModel: 'your-model' });
shell.use(llmCommands({ service })).use(pythonCommands({
  createExecutor,
  createCapabilities: context => ({ llm: createPythonLlmCapability(context, service) }),
}));
```

The deterministic Python suites verify customization and the API contract.
Installed runtime and hosted integration require separate qualification.

```python
from poe_llm import Client, Attachment

async def summarize():
    async with Client(model="your-model", options={"temperature": 0.2}) as client:
        models = await client.models()
        response = await client.complete(
            "Summarize the attachment", system="Be concise",
            attachments=[Attachment("/work/report.txt", "text/plain")],
        )
        print(response.model, response.text, response.usage)
```

Named templates use the same canonical configuration directory as Bash `llm`
(`LLM_USER_PATH`, or the current guest environment's configuration directory). Template
parameters are strings; explicit model, system and options override template
values. Saved model options apply first, followed by template options and explicit
request options; their existing types are preserved. Attachments declared by templates use the same retained canonical reads.
Use `await client.configuration()` to inspect the saved default model, aliases
and per-model options as a typed `Configuration` snapshot. Changes to that snapshot
do not modify host state. Use `await client.configure(action, **fields)` to persist
changes in the same canonical store used by Bash. Actions are `set_default_model`
(`model`), `set_alias` (`name`, `model`), `remove_alias` (`name`),
`set_model_option` (`model`, `name`, `value`) and `clear_model_option` (`model`,
optional `name`; omit it to clear all options for that model). Models resolve to
canonical IDs before storage. Saved option values are strings, matching the shared
configuration contract; per-call options retain their native types. For example:

```python
await client.configure("set_alias", name="reviewer", model="your-model")
await client.configure("set_model_option", model="reviewer", name="temperature", value="0.2")
```

Each call performs one shared atomic publication and uses the client timeout and
current guest configuration directory. Completions, streams and embeddings resolve saved aliases
and defaults through the shared JavaScript configuration service. Changes to
Python cwd and `HOME`, `XDG_CONFIG_HOME` or `LLM_USER_PATH` take effect on the next
operation, including relative template attachments. Other environment fields are
not forwarded by the direct LLM API; provider authorization remains on the parent
JavaScript service.

For a stored `review` template with prompt `Review $topic: $input`:

```python
response = await client.complete(
    "this change", template="review", parameters={"topic": "code"},
)
```

Use `model = await client.select_model("provider", "small")` to select a model
with the shared Bash query rules, then pass that ID as `model=model`. Queries
match case-insensitively against provider/model names and catalog or saved aliases.
All queries must match; the shortest matching model ID wins, with catalog order
breaking ties. No match raises an error. Selection inherits the client timeout,
current configuration directory and host response budget without calling a provider.

Use `schema = await client.load_schema("saved-schema-id")` to read a stored schema
from the shared canonical `logs.db`, then pass it to `complete(..., schema=schema)`.
A missing ID returns `None`. Supply `database="/work/history.db"` to read another
canonical database; relative database paths resolve from the current guest cwd.
Lookup otherwise uses the current guest configuration directory,
client timeout, and host input/response budgets. The database must be a checkpointed
SQLite snapshot: active WAL or rollback journals are explicitly rejected. The
selected schema is returned as an owned dictionary; this operation does not write
schemas or create a missing database.

Paths refer to the caller's canonical agent filesystem. Python sends attachment
paths, rather than copying attachment contents into the request. JavaScript owns
reading, authorization and provider transport. Binary results are `response.data`;
write them with ordinary `open(path, "wb")` to the same agent filesystem.

Use the async context manager for early stream exits:

```python
async with Client(model="your-model") as client:
    async with client.stream("Explain gravity") as stream:
        async for event in stream:
            if event.type == "text":
                print(event.text, end="", flush=True)
            elif event.type == "bytes":
                process_bytes(event.data)
        response = stream.response  # Final model/usage/metadata; prior output is not retained.
```

`break` alone does not close Python async iterators. Exiting `async with` closes
the host iterator, including after exceptions. Closing the client cancels its
pending calls and stream reads and awaits iterator cleanup. Cancellation and
timeouts propagate; they do not undo completed provider effects. The bridge must
enforce invocation cancellation and host budgets independently.

Ordinary Safe Bash script files cannot use top-level await. The current JSPI
launcher supports `pyodide.ffi.run_sync(main())` as a suspension boundary. See
[single-call example](examples/llm-single.py) and
[streaming example](examples/llm-stream.py), intended for
`python /work/llm-single.py` and `python /work/llm-stream.py` after the host has
installed the invocation capability. There is no synchronous LLM API and no
nested `asyncio.run()` requirement.

## Customization

```python
from dataclasses import replace
from poe_llm import Client, Message

def add_instructions(request):
    return replace(request, system="Answer with evidence")

async with Client(model="your-model", request_transform=add_instructions) as client:
    explain = client.prompt(lambda topic: f"Explain {topic}", options={"temperature": 0.1})
    response = await explain("orbital mechanics")
    specialist = client.with_defaults(options={"temperature": 0.3})
    async with specialist:
        response = await specialist.complete("Compare two approaches")
    chat = client.conversation(messages=[Message("user", "I am learning Python")])
    await chat.complete("What should I learn first?")
    await chat.complete("Show an example")
```

Request and response transforms may be synchronous or async Python callables.
Request transforms return a typed `Request`; response transforms can return a
custom value. Conversation orchestration requires transforms to retain `Response`
because it records the assistant text and conversation identity. Turns are
serialized and failed calls do not append history. Reusable prompt functions can
compose ordinary Python functions; callers never build shell command strings or
parse CLI stdout. `with_defaults()` merges option defaults into a separate client
with its own cleanup scope and the same borrowed bridge.

## Feature matrix and limits

| Feature | Python API | Host responsibility |
| --- | --- | --- |
| Discovery and selection | `models()`, `select_model(*queries)`, `model=` | Resolve identities through the shared catalog and list its aliases alongside canonical saved aliases |
| Prompt, system and messages | `Request`, `Message`, `complete()` | Validate and dispatch the same request as the CLI |
| Options | String, safe integer (±9,007,199,254,740,991), finite float, boolean, null | Preserve types and validate provider settings |
| Attachments | `Attachment(path, mime_type)` | Lease canonical files, resolve relative paths from current Python cwd and stream bounded input chunks; infer MIME from a bounded prefix |
| Text and binary responses | `Response`, incremental `Stream` events | Return text/bytes and final response records |
| Usage and metadata | `Response` and `Embeddings` fields | Supply available provider metadata |
| Structured output | `schema`, `load_schema(schema_id)`, `Response.json()` | Validate and send schema through the shared service |
| Templates | `template`, `parameters`, Python prompt functions | Load named templates from canonical shared configuration; reuse Bash interpolation, defaults, options and attachments |
| Conversations | `Conversation`, prior messages | Python orchestrates message history; persisted conversation IDs are explicitly rejected until shared-service support is delivered |
| Embeddings | `embed()`, `Embeddings` | Use the shared embedding operation; reject unsupported providers |
| Configuration | `configuration()`, saved model defaults, aliases and options | Read and mutate canonical shared configuration; explicit request values override stored defaults |
| Logs and collections | No persistence methods currently | Shared persistence integration remains unavailable |
| Cancellation and cleanup | Async context managers, timeout, response limit | Cancel invocation-owned operations and release streams |

The client defaults to no response-byte limit and no timeout. Set
`max_response_bytes` and `timeout` (seconds) on the client or individual completion
stream and embedding calls. Explicit `None` or `float("inf")` disables a byte limit.
Completion timeouts include request and response transforms, and client cleanup
cancels and awaits that work. Text is measured as UTF-8, binary as bytes;
embeddings use eight bytes per numeric element. Host buffering ceilings also apply
to model listings, configuration snapshots and embedding results. Embedding
host and per-call limits count the serialized vector/result envelope, including usage and metadata;
`embed(..., max_response_bytes=...)` can lower the host ceiling and inherits the
client limit by default. The host metadata ceiling also applies to embedding
metadata independently of the vectors. Stream limits count incremental
payloads and separately check a final response. These guest checks do not bound
interpreter memory, provider buffers or billing. Configure host admission,
serialized-message and stream limits through `capabilityLimits`. The host may
set stricter application limits; it must report refusal rather than truncate.

Set `maxBufferedInputBytes` on the host adapter to bound serialized request
controls independently of the parent `inputBudget.maxBytes` for canonical
attachments. For example, an 8 MiB buffered-input ceiling can coexist with a
larger streamed-file admission limit. Prompts, messages, options, schemas and
expanded template controls must fit the buffered ceiling before provider admission; attachment file bytes
remain streamed and do not count toward that ceiling. Stored schema loading also
uses this ceiling before decoding its selected control object. The bridge's
message limit still bounds transfer into the host; configure both limits. Provider
wire limits must separately account for JSON escaping and base64 expansion.
The buffered-input ceiling defaults to `Infinity`; callers cannot raise host policy.
Remote template fetches also use this ceiling. Local template/configuration loaders
and custom loader callbacks retain their own allocation policies; the request check
does not retroactively bound allocations made inside those loaders.

`createPythonLlmCapability(context, service, options)` accepts host-owned
`maxBufferedResponseBytes`, `maxBufferedEvents` and `maxMetadataBytes` ceilings.
Configure finite limits before exposing the capability: guest requests can lower
but cannot raise or omit host policy. Buffered admission counts the serialized
result, including escaped text, numeric byte arrays and response metadata; empty
events count toward the event ceiling without accumulating text fragments.
Event and metadata ceilings default to the buffered ceiling, and all three are
disabled (`Infinity`) when no host policy is configured.

`maxStreamChunkBytes` splits both text and binary provider events without retaining
the stream; the default chunk is 16 KiB. Text fragments preserve Unicode scalars;
choose at least four bytes to accommodate every valid scalar. For a finite
`capabilityLimits.maxMessageBytes`, choose chunks below one quarter of that budget,
allowing additional room for the JSON event envelope and byte-array expansion.
Byte and text order are preserved, early close releases the provider iterator,
and terminal model/usage/metadata is emitted once after payload chunks.
`maxMetadataBytes` measures terminal response data; reserve envelope headroom.
Buffered ceilings are separate from cumulative streaming limits, so large results
can stream incrementally into canonical files. Embeddings must independently fit
the bridge message budget; oversized results fail explicitly.

Canonical attachments use the shared service's `streamSources` contract, preserving
model identity, typed options, messages and schema. The adapter retains a file
handle and reads at most 16 KiB per input chunk; it samples at most 4 KiB for MIME
inference. It does not read or copy the entire file before provider admission.
The parent input budget checks both retained file sizes and actual streamed bytes.
Finite input limits reject excess data; streaming never silently truncates files.
Cancellation, preparation errors and early output-stream exit release the leases.

The filesystem must authorize retained reads, and the selected provider must
support the shared streamed-input contract. Unsupported capabilities fail
explicitly. There is no automatic whole-file buffering fallback or Python HTTP
implementation. Calls without attachments retain the shared buffered request API.

Exceptions include `LlmError(code, message)`, `CapabilityError`, `LimitError`,
native `asyncio.CancelledError` and `asyncio.TimeoutError`. Invalid Python option
types and invalid limits fail before transport. Host errors must be sanitized by
the bridge; credentials, private files and service objects must not enter Python.

For deterministic testing, `Client(bridge=...)` accepts an object with async
`call(operation, payload)` and `stream(payload)` returning an async iterator with
`aclose()`. The bundled native adapter maps this Python contract to the named data-only host capability. `models` returns model records; `complete` returns
a response record; `embed` returns model, vectors, usage and metadata. Stream events use
`type: text|bytes|response`. Binary data can be bytes or byte-value sequences.

Package publication and consumer adoption require verification beyond Python
unit tests.

The executable [customization example](examples/llm-customize.py) composes defaults,
request/response transforms, a reusable prompt function and local conversation
history through the same invocation service.
