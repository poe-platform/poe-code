# Python for Safe Bash

Run Python commands against your shell's virtual filesystem, with explicit runtime,
package, and host-service configuration through Safe Bash's public exports.

```ts
import { Shell } from "@poe-platform/safe-bash";
import { pythonExecutorCommands } from "@poe-platform/safe-bash/commands/python/executor";

const shell = new Shell({ fs });
shell.use(pythonExecutorCommands({ createExecutor }));
const result = await shell.exec('python3 -c "print(42)"');
```

Provide `fs` and a trusted `createExecutor` for your application. Executor, JSPI,
worker, and Docker profiles retain their own runtime prerequisites. Runtime assets
and package provisioning remain explicitly configured; JavaScript interoperability
does not isolate untrusted Python from its host.

- `python` and `python3`: inline code, stdin, modules, and VFS scripts.
- Executor pooling, cancellation, cleanup, and bounded filesystem replies.
- Package provisioning with cache and manifest support.
- Optional shell and LLM host capabilities.

Use `PythonCommandsOptions` to configure limits, runtime providers, and packages.
Existing default command behavior and registration collision rules are unchanged.
This package is internal and bundled into Safe Bash; consumers use the public
Safe Bash paths above, including `/commands/python/node`, `/worker`, and `/docker`.

Python LLM buffered calls and streams preserve the same host error classifications:
unsupported model capabilities and other service failures raise `poe_llm.LlmError`
with code `service` and a sanitized message. Host limits raise `LimitError` with
code `limit`; timeouts raise `asyncio.TimeoutError`. `CapabilityError` remains
available for explicit capability errors, such as an unavailable Python LLM bridge.

The genuine `llm==0.27.1` provider registers async models only when the host
defines `asyncModel`. `llm.get_async_model()` uses that paired definition for
options, attachments and capabilities, and forwards async mode to the shared
service. `canStream: false` is exposed as Python `can_stream = False`; the shared
service enforces nonstreaming provider requests.

The genuine `llm==0.27.1` provider exposes tools when the host model declares
the `tools` capability. Pass native `llm.Tool` values to sync or async prompts;
returned calls support the reference's `execute_tool_calls()` callbacks and
results. The adapter forwards caller-supplied prior calls and tool results to
the same shared service. Large result text uses bounded writes to the caller's
filesystem and releases temporary inputs after each request. Tool schemas,
arguments and response metadata remain subject to host byte limits. Tool
implementations execute in the configured Python runtime; credentials and
provider transport remain host-owned.

Use `createPythonLlmToolLoader(pythonOptions)` from the public executor entrypoint
as `llmCommands({ service, loadTools })`'s `loadTools` option to enable
`llm --functions tools.py`, inline definitions, and `-T 'Counter(3)'` selections
from registered Python toolboxes. `llm tools list` discovers built-in tools and
registered tool-only plugins and shows toolbox methods. The configured executor must
provide genuine `llm==0.27.1` and the standard host bridge. Each invocation owns
one interpreter, shares the loader's configured worker capacity, and preserves
function globals and toolbox instances across calls. Native constructor parsing,
method schemas, plugin names and sync/async preparation are preserved. Tool-only,
template-loader and fragment-loader hooks can register with the native plugin
manager; additional model hooks and ambient entrypoint discovery remain blocked,
so model transport and credentials stay platform-owned. Result text and attachments use caller-backed
storage; close direct SDK sessions after consuming their borrowed results.
Cancellation is cooperative for Python tasks; CPU-bound or cancellation-suppressing
code still requires runtime-enforced interruption. No conversation history is stored.

Use `llm plugins` to list the configured interpreter's installed plugin names,
versions and hooks. `--all` includes built-in plugins; repeated `--hook NAME`
filters match any requested hook. SDK callers pass
`pluginQuery: { all: true, hooks: ["register_tools"] }` to the same loader and read
`session.plugins`, then close the session. Metadata obeys the loader input limit;
CLI JSON output streams under the output limit. Package installation and provider
provisioning remain host-controlled.
