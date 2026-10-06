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
does not isolate untrusted Python from its host. JSPI package installation uses
the configured package cache, authorization and transport before guest execution. Canonical wheels use retained file handles and 64 KiB authentication/replay reads when the caller filesystem supports retained reads; they are not duplicated into the artifact cache. Content changes are rejected. Direct environment users should await `environment.finish(start)` so retained handles close before proceeding. Filesystems without retained reads retain the buffered fallback. With `cacheDirectory`, network downloads stream into caller-owned staging with writes of at most 64 KiB, publish only after integrity checks, and replay offline through retained file handles. `noCache` also uses caller staging when available. Cancellation interrupts stalled response bodies and retires staging. The caller filesystem needs retained staging/read capabilities and atomic staging publication for the disk cache. Native dependency ordering retains source descriptors; each native fetch and extraction finishes before the next starts, and cleanup awaits admitted installations. Native and micropip wheel extraction read a seekable host source in at most 64 KiB chunks, preserving the pinned installer’s metadata, data-file and native-library handling. Micropip retains session-owned source receipts through dependency resolution; publication retires them before user execution. Legacy or memory caches and unsupported filesystems still buffer full wheels during acquisition. ZIP directory/package metadata and extracted files still occupy interpreter memory.
Native extensions still require matching, statically supplied runtime modules;
installation does not enable arbitrary Worker WebAssembly compilation.

- `python` and `python3`: inline code, stdin, modules, and VFS scripts.
- Executor pooling, cancellation, cleanup, and bounded filesystem replies.
- Package provisioning with cache and manifest support, including pure-Python
  wheels through explicitly configured JSPI host transport.
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

Set `plugins: ["my-tool-plugin"]` on `createPythonLlmToolLoader` to load
host-authorized installed distributions from its shared Python environment.
The native LLM loader supplies entrypoint names, versions and hooks. Tool,
template-loader and fragment-loader hooks are allowed; provider registration
remains platform-owned.

Pass `createPythonLlmFragmentLoader({ ...pythonOptions, plugins: ["my-plugin"] }, "prefix")`
as the `"prefix"` entry in `llmCommands({ fragmentLoaders: new Map(...) })` to
execute that installed plugin's native fragment loader with `llm -f prefix:value`.
Native `llm.Fragment` and `llm.Attachment` results retain order and IDs. Text and
local attachment bytes stage in caller storage with bounded transfers; URL
attachments use only the injected fetch capability and download when consumed.
Each invocation owns an interpreter and borrows one result at a time. Direct SDK
callers must consume a source before advancing the iterator, and close the iterator
on early exit. Plugin stdout and stderr use the caller streams when supplied; the
CLI includes both in its output budget without treating them as fragment content.
The content byte limit excludes attachment metadata; cancellation
and iterator closure retire staged files and the interpreter.

For automatic CLI lookup after installing or changing authorized plugins, pass
`loaderProvider: createPythonLlmLoaderProvider({ ...pythonOptions, plugins: ["my-plugin"] })`
to `llmCommands`. Listings discover only the requested loader family; execution
resolves a prefix without an extra registration pass. Help and usage errors do
not start discovery. Explicit loader map entries override dynamic registrations.

To discover prefixes directly from authorized installed plugins, call
`createPythonLlmLoaderDiscovery({ ...pythonOptions, plugins: ["my-plugin"] })(context)`.
Supply `fs`, `cwd`, `signal` and a finite metadata `maxBytes` in `context`; optional
output streams and `registerCleanup` retain caller-owned diagnostics and retirement.
Set `kind: "fragments"` or `"templates"` to run only that family's hooks, and
`admitBytes` to charge retained metadata to a shared caller budget.
Spread the returned `{ fragmentLoaders, templateLoaders }` into `llmCommands` or
use the maps directly through the SDK. Native ordering, collision suffixes and
docstrings are preserved. Discovery does not execute the loaders. Discover again
after changing the installed environment; it does not load ambient distributions.

Use `createPythonLlmTemplateLoader({ ...pythonOptions, plugins: ["my-plugin"] }, "prefix")`
as the corresponding `templateLoaders` map entry to execute native `llm.Template`
loaders with `llm -t prefix:value`. Native fields, parameters and loader diagnostics
flow through the shared template store. Template JSON uses bounded host messages
and the caller's remaining materialized-input allowance. Loaded functions keep the
existing untrusted-template policy. Direct SDK calls supply the loader's third
argument, `LlmTemplateLoaderContext`, including caller filesystem, environment,
byte limit and optional output streams. Each call retires its interpreter before
returning the template.

Use `llm plugins` to list the configured interpreter's installed plugin names,
versions and hooks. `--all` includes built-in plugins; repeated `--hook NAME`
filters match any requested hook. SDK callers pass
`pluginQuery: { all: true, hooks: ["register_tools"] }` to the same loader and read
`session.plugins`, then close the session. Metadata obeys the loader input limit;
CLI JSON output streams under the output limit. Package installation and provider
provisioning remain host-controlled.

To enable `llm install` and `llm uninstall` for compatible wheels, pass
`managePackages: createPythonLlmPackageManager({ createExecutor, environment })`
to `llmCommands`. Share the caller-owned `createPythonPackageEnvironment(...)`
with Python commands and tool loaders, and dispose it when the host closes.
The pinned native LLM CLI handles package-command help and argument errors
without restoring caller packages or reading their requirement files;
installation uses the environment’s authorization, cache and manifest. Installed
state is restored exactly without resolving its dependencies again; new install
requests resolve their dependency closure. Legacy requirement manifests resolve their dependencies once and migrate
on the next successful operation, including uninstall. Migration keeps saved packages separate from current host requirements.
Use `llm uninstall PACKAGE` (or `python -m pip uninstall PACKAGE`) to remove
a distribution with confirmation; `-y` skips the prompt. Dependencies remain
installed. Host-required distributions cannot be removed. Removal publishes an
exact environment snapshot only after success. New snapshots retain native distribution
metadata and removal listings, so uninstall works after the original wheels are
deleted or unavailable. Older snapshots need one successful restore to acquire
that metadata. Ordinary Python execution still restores the installed code. Editable installs and other pip lifecycle flags
still require additional installer support.

Hosts provisioning build tools can use `createPythonBuildEnvironment(options)`
with `pythonCommands({ createExecutor, environment })`. Each build environment
has a private installed snapshot, ignoring the target's manifest, scope, default
requirements, requirement files and document profile. Explicit cache, transport,
authorization and budget settings remain in effect; supply build requirements
through install commands or `environment.prepare(...)`. Dispose the environment
after the build; caller-owned caches remain usable. This provisions isolated
build dependencies only; source-build hooks and editable installation are not
yet supported.

Pass `--pre` to include prerelease and development candidates. Use
`--no-cache-dir` to bypass artifact-cache reads and writes while retaining the
caller-owned environment manifest. Authorization and integrity checks still
apply; cache bypass does not force reinstall an already satisfied requirement.
Use `--upgrade` (`-U`) to update requested packages while retaining satisfying
dependencies, or `--force-reinstall` to reinstall their dependency graph. Explicit
version pins can replace installed versions without either flag. Unrelated
packages remain installed; failed resolution leaves the saved environment intact.
SDK callers use `upgrade`, `forceReinstall`, `pre` and `noCache` on `PythonPackageOptions` or per-invocation
`PythonPackagePrepareContext`; explicit invocation values override defaults.
