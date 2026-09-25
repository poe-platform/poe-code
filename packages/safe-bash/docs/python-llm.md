# Python LLM workflows

The bundled Python module is named `poe_llm`, distinct from the reference `llm`
package. It contains Python request construction and workflow code. Providers,
model resolution, authorization, billing and file access belong to the injected
JavaScript service.

The API is implemented and tested with a deterministic Python bridge. Both
existing launchers install the module without pip or a network download.
**JavaScript capability installation and real-runtime LLM qualification are
pending #1444 and the shared service in #1443.** Importing the module is available;
constructing a default `Client()` without that capability raises `CapabilityError`.
The examples below require that capability and are not yet production-qualified.

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
        response = stream.response  # The optional complete-response event.
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

| Feature | Python API | JavaScript/host qualification |
| --- | --- | --- |
| Model discovery and selection | `models()`, `model=`; identities and aliases preserved | Pending #1443/#1444 |
| Prompt, system, messages | `Request`, `Message`, `complete()` | Pending #1443/#1444 |
| Provider options | String, safe integer (±9,007,199,254,740,991), finite float, boolean, null; types preserved | Provider validation remains in JavaScript; pending #1443 |
| File attachments | `Attachment(path, mime_type)` | Canonical host filesystem access pending #1444 |
| Complete text/binary/usage/metadata | `Response` | Pending shared-service adapter |
| Incremental text/binary and final response | `Stream`, `Event` | Pending bridge/runtime qualification |
| Templates and structured output | `template`, `parameters`, `schema`; `Response.json()` | Pending #1443 parity |
| Conversation continuation | `Conversation`, messages and conversation identity | Host continuation semantics pending #1443 |
| Embeddings | `embed()` returns `Embeddings` | Pending #1443 |
| Logs, collections, plugins and configuration | Not yet exposed | Await applicable #1443 service operations; incomplete parity |
| Cleanup, cancellation, per-call limits | Deterministic fake-bridge tests | Real Pyodide and hosted acceptance pending |

The client defaults to an 8 MiB response payload limit and no timeout. Set
`max_response_bytes` and `timeout` (seconds) on the client or individual completion
and stream calls. Completion timeouts include request and response transforms;
client cleanup cancels and awaits that work too. Text is measured as UTF-8, binary as bytes; embeddings use eight
bytes per numeric element. Stream limits count emitted payload bytes and separately
check a final complete response. These are guest payload checks, not bounds on
interpreter memory, host transport buffers or provider billing. Host admission,
request/chunk limits and cancellation must be enforced by the invocation bridge.

Exceptions include `LlmError(code, message)`, `CapabilityError`, `LimitError`,
native `asyncio.CancelledError` and `asyncio.TimeoutError`. Invalid Python option
types and invalid limits fail before transport. Host errors must be sanitized by
the bridge; credentials, private files and service objects must not enter Python.

For deterministic testing, `Client(bridge=...)` accepts an object with async
`call(operation, payload)` and `stream(payload)` returning an async iterator with
`aclose()`. This is the Python-side protocol, not a claim that an equivalent
JavaScript bridge has shipped. `models` returns model records; `complete` returns
a response record; `embed` returns model, vectors and usage. Stream events use
`type: text|bytes|response`. Binary data can be bytes or byte-value sequences.

Package publication and poe2 adoption are separate from implementation and are
not verified by the Python unit tests. The requirement audit is maintained in
[the issue plan](../../../docs/plans/python-llm-1445.md).
