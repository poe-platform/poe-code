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
the configured package cache, authorization and transport before guest execution. Canonical wheels use retained file handles and 64 KiB authentication/replay reads when the caller filesystem supports retained reads; they are not duplicated into the artifact cache. Content changes are rejected. Direct environment users should await `environment.finish(start)` so retained handles close before proceeding. Canonical and cached sources with streaming reads can instead be staged in the configured cache directory, falling back to the caller’s invocation directory when only that destination supports retained staging and reads. The staged snapshot retains the source stream’s consistency guarantees, without claiming retained identity for the original backend. Sources or destinations without these capabilities retain the buffered fallback. By default, network artifacts are cached in `.python-packages/cache/<runtime-key>` beneath the invocation directory; `cacheDirectory` selects a different location. The implicit environment manifest is streamed to a private directory on the first caller filesystem at first publication. It survives invocation finish and is conditionally removed by environment disposal; host preparation validates and indexes records in caller-backed storage, while direct inline preparation still materializes parsed records. Host snapshot indexing also requires retained read/write handles and conditional file removal. This requires retained reads, guarded atomic staging and conditional directory removal. Explicit manifest stores and cache directories retain their selected storage lifetime. Configured cache directories use the same streamed manifest storage, preserving the existing environment filename; stale publications require a fresh preparation. Network downloads stream into caller-owned staging with writes of at most 64 KiB, publish only after integrity checks, and replay offline through retained file handles. `noCache` also uses caller staging when available. Cancellation interrupts stalled response bodies and retires staging. The caller filesystem needs retained staging/read capabilities and atomic staging publication for the disk cache. Native dependency ordering retains source descriptors; each native fetch and extraction finishes before the next starts, and cleanup awaits admitted installations. Native and micropip wheel extraction read a seekable host source in at most 64 KiB chunks, preserving the pinned installer’s metadata, data-file and native-library handling. Micropip retains session-owned source receipts through dependency resolution; publication retires them before user execution. Explicit buffered cache adapters and sources without streaming reads or an available retained staging destination still buffer full wheels during acquisition. Network downloads can also stage in the invocation directory and stream authenticated bytes to a configured cache that supports streaming writes. Cache metadata is published only after that upload succeeds; backends without an available staging destination or streaming writes retain buffered compatibility. The native ZIP directory parser reads through a bounded window instead of copying the complete directory into BytesIO; interpreter adapter reads are capped at the native 65,558-byte end-record probe size, and host transfers remain at most 64 KiB. Native entry indexes use caller storage. Extracted packages also use caller storage in an invocation-owned `.python-install-*` directory. A capable configured cache parent is preferred; otherwise extraction and ZIP indexing use the invocation directory with their required capabilities. This requires conditional directory creation and atomic tree removal. The directory remains available through user execution and is removed when the interpreter retires; cleanup refuses substituted directories. Dynamic-library discovery preserves the pinned selection and order while loading one path at a time. Dependency resolution and post-install inventory visit distribution objects one at a time and retain version entries only for managed packages or requested uninstall targets. Wheel metadata-directory discovery retains only one matching top-level name for ordinary wheels, preserving native validation. Ambiguous multi-directory wheels keep native set ordering and its memory cost. Preloaded package protection uses an immutable caller-backed name snapshot, so packages installed later do not become protected. Its bounded index shares the existing scratch-storage requirements and retires before package publication. Saved records stay in the host session and cross the runtime boundary on demand in bounded messages, using a caller-backed ordinal index for native lookup. Startup carries a record count instead of the metadata array. Host encoding retains a bounded JSON window; backward record reads replay serialization. The native bridge forwards one window per request without assembling another complete JSON record, preserving supplementary Unicode across window boundaries. Custom executors that require the previous startup shape can select `packageRecordTransport: "inline"`; direct `environment.prepare()` calls retain inline records unless `recordTransport: "host"` is requested. Python startup indexes only each saved record’s leading name, leaving metadata and removal lists in caller storage until needed. It does not retain a second full record collection. Custom stores can implement `openSnapshot` to return a validated record lease; the environment closes it after use or failed preparation. Stores without it retain buffered compatibility. The native executor publishes saved record chunks and deduplicated pins through a private caller-owned file when the store supports `compareAndSetSource`; the host validates the complete file through caller-backed JSON before atomic publication. The default and streaming store adapters provide this method. Byte-only custom stores retain their compatibility path. New removal-path compaction uses caller-backed sets and stable external sorting; native publication writes those paths individually. Removal scans keep directory names and pending traversal on caller storage with one scan cursor, preserving unreadable-directory and symlink behavior. Installed requirement lists, individual metadata strings and micropip file discovery remain materialized. Global package discovery, snapshot path names and native executable loading retain separate memory costs.
Local wheels on filesystems with confined retained atomic staging are copied into durable installation storage, so later invocations can import them after the original wheel is removed. Installed bytes live in `installed` beneath the configured, runtime-scoped cache directory, or `.python-packages/installed` beneath the invocation directory when no cache directory is configured. When the configured cache lacks retained atomic staging, capable invocation storage holds the durable installation instead. These installed bytes survive `noCache`; that option controls the download cache. Original direct-URL provenance is retained separately. Legacy filesystem adapters without these staging capabilities retain their source-dependent behavior. Buffered cache adapters and filesystems without the required directory ownership capabilities remain outside the bounded installation profile.

Python `os.scandir` consumes caller directory entries lazily when `fs.iterateDirectory` is available. Cursors share the invocation's open-handle limit and close on exhaustion, early exit, or interpreter retirement. Namespace changes retain the backend's validation behavior. Package environments store discovered metadata groups in caller-backed installation scratch, preserving native search order and cache invalidation. Suspended searches retain their snapshot until released; cleanup replays streamed creation records without enumerating a changing directory. `os.listdir`, fixed runtime assets, ZIP metadata discovery, and backends without lazy enumeration retain buffered boundaries.

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
method schemas, plugin names and sync/async preparation are preserved. Discovery and preparation preserve native `EOFError` and Click `Abort` exit status and diagnostics. Exceptions inside tool implementations or fragment/template loader calls retain their native ordinary-error behavior. Tool-only,
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

Hosts with atomic streaming storage can wrap their manifest backend with
`createPythonPackageStreamingManifestStore({ get, compareAndSet })` and pass it as
`manifestStore` with an explicit `scope`. Its backend `compareAndSet` receives an
async byte source, avoiding a complete encoded manifest buffer during publication.
The backend must consume into private storage before atomically checking the
revision and publishing; source failures must preserve the previous snapshot.
The adapter enforces `maxManifestBytes` while serializing and closes failed sources.
Existing byte-based stores remain supported. Stores may implement `getSnapshot`
to decode incrementally; it must enforce `maxBytes` on the original input and
close retained reads before returning. Installed requirement arrays and individual
metadata records still have separate buffering costs.
`createPythonPackageFileManifestStore({ fs, directory })` supplies a persistent
caller-filesystem backend for this adapter. It requires retained reads, retained
staging writers and cleanup, and guarded atomic staging publication. Writes use
at most 64 KiB chunks; failed serialization or a stale revision leaves the prior
manifest intact. Restores use incremental JSON decoding without retaining the
complete encoded file or decoded JSON text. Native metadata restoration reads
individual saved fields without decoding unrelated removal lists. Saved uninstall
confirmation lists stream one path at a time. Native file publication writes JSON
strings in bounded fragments and emits selected metadata headers without joining
them into a complete output string. Standard installed-distribution
file discovery stages metadata lines and parsed paths on caller storage while
using the native metadata parser. Custom distribution providers retain native
compatibility behavior and may buffer their file lists. Custom
`openSnapshot` stores can provide `readField(ordinal, field, offset)` for the same
bounded JSON transport; stores without it retain whole-record compatibility.
The compatibility `get` method still
returns bytes. The directory remains caller-owned after environment disposal.
An optional `filename` selects a single existing manifest file instead of the
default scope-keyed filename.

Hosts provisioning build tools can use `createPythonBuildEnvironment(options)`
with `pythonCommands({ createExecutor, environment })`. Each build environment
has a private installed snapshot, ignoring the target's manifest, scope, default
requirements, requirement files and document profile. Explicit cache, transport,
authorization and budget settings remain in effect; supply build requirements
through install commands or `environment.prepare(...)`. Dispose the environment
after the build; caller-owned caches remain usable.

Use `createPythonBuildBackend({ createExecutor, environment })` to invoke
`get_requires_for_build_wheel` or `build_wheel` in that environment. Pass the
hook name, prepared `source` directory, `backend` module/object name, optional
relative `backendPath` entries and `configSettings`; wheel builds also take
`wheelDirectory` and optional `metadataDirectory`. Its second argument supplies
the caller's filesystem, working directory, environment, signal, output sinks
and `maxBytes` metadata budget. Requirements return as strings and wheel builds
return a filename; wheel bytes stay in caller storage. Backends read the
prepared source tree directly, so hosts own source snapshots, build-dependency
installation, durable wheel publication and cleanup. Use the source-building
environment below to coordinate local source installs; editable installation
is not yet supported.

The same backend runner accepts `{ hook: 'read_build_system', source, name?,
usePep517? }` before invoking build hooks. It reads `pyproject.toml` through the
native TOML parser and returns `{ requires, backend, backendPath, check }`, or
`null` when the project selects the legacy `setup.py` path. `requires` contains
declared build dependencies; `check` lists implicit backend requirements to
verify after installing them. The context's `maxBytes` bounds both the TOML input
and the returned metadata. Inspection does not import the backend or install
dependencies. For legacy projects, pass `{ hook: 'build_legacy_wheel', source,
wheelDirectory }` to execute `setup.py bdist_wheel` with genuine runtime
setuptools in the isolated build interpreter. It returns the wheel filename.
Build invocations bootstrap the existing installer through the configured
package cache/transport even in an empty environment; bootstrap tooling is not
added to the environment's installed application inventory.

Pass the returned build system to
`createPythonBuildDependencies({ createExecutor, environment })` with
`{ source, buildSystem, name?, configSettings? }` and the same hook context.
Use a dedicated `createPythonBuildEnvironment(...)`: preparation installs declared
requirements, checks implicit backend requirements, invokes the requirements hook,
then installs only missing dynamic dependencies. Conflicting installed versions
stop the build; missing implicit fallback requirements produce diagnostics before
the backend runs. Checks use the environment's installed metadata manifest, so
unrecorded runtime bootstrap packages cannot satisfy build dependencies. The host
owns environment disposal, wheel building and publication; preparation does not
modify the target environment or implement automatic source/editable installation.

Use `createPythonSourceSnapshot(source, directory, commandContext)` to copy a
source tree into an existing caller-owned directory before running hooks. Pass
the returned `path` as the hook source and await `dispose()` after the build.
Files stream through retained readers; the filesystem must support lazy directory
iteration, confined writes, conditional directory creation and atomic tree removal.
The copy excludes top-level `.tox` and `.nox` and its own destination, preserving
file/directory modes and timestamps where supported and symlink targets without
following them. Symlink timestamps and special files are not supported. This is
a copied build tree, not an atomic snapshot of concurrent source edits. Keep
output wheels outside the snapshot; disposal removes only the owned tree and
refuses substituted identities.

Pass `--pre` to include prerelease and development candidates. Use
`--no-cache-dir` to bypass artifact-cache reads and writes while retaining the
caller-owned environment manifest. Authorization and integrity checks still
apply; cache bypass does not force reinstall an already satisfied requirement.
Use `--upgrade` (`-U`) to update requested packages while retaining satisfying
dependencies, or `--force-reinstall` to reinstall their dependency graph. Explicit
version pins can replace installed versions without either flag. Unrelated
packages remain installed; failed resolution leaves the saved environment intact.
Use `--no-deps` (or `--no-dependencies`) to install only the requested packages.
This leaves existing dependencies untouched and does not suppress isolated build dependencies.
Select a package index with `-i`/`--index-url`, add candidates with repeated
`--extra-index-url`, or disable index lookup with `--no-index`. Direct wheels
remain available when indexes are disabled. Requirement and constraint files can
also set indexes and enable prereleases with `--pre`; their effective controls
apply to the whole installation and to source builds. SDK callers use `indexUrl`,
`extraIndexUrls` and `noIndex`; every fetch still uses caller authorization.
SDK callers use `noDeps`, `upgrade`, `forceReinstall`, `pre` and `noCache` on `PythonPackageOptions` or per-invocation
`PythonPackagePrepareContext`; explicit invocation values override defaults.

Hosts can call `publishPythonBuildWheel(source, directory, maxBytes, context)`
to retain a built wheel before deleting its build directory. The destination must
already exist in caller-owned storage. Publication streams through retained,
atomic staging and returns `{ url, digest, size }`; pass the file URL to the
installer. Digest directories keep distinct builds of the same filename separate.
The caller owns these durable files and their retention policy. Failed staging
is removed; empty digest directories can remain. Publication requires confined
writes and retained read/staging capabilities, with no whole-file fallback.

For local PEP 517 or legacy `setup.py` projects and ZIP or tar source archives, configure
a source-building environment:

```ts
import { extractPythonSourceArchive } from "@poe-platform/safe-bash/commands/python/source-archive";

const environment = createPythonSourcePackageEnvironment(packageOptions, {
  directory: "/package-builds", // existing caller-owned durable storage
  extractArchive: extractPythonSourceArchive, // optional source archive capability
  python: { createExecutor }
});
const commands = pythonCommands({ createExecutor, environment });
```

`python -m pip install ./project` then copies the source, installs its isolated
build dependencies (or bootstraps runtime setuptools for legacy projects), runs
the native backend and installs the published wheel. Legacy tooling uses the
configured runtime package transport and stays out of the target inventory.
Legacy `setup_requires` dependencies are discovered by genuine setuptools and
installed in that private build environment before building the wheel.
Installed `.pth` paths and import hooks initialize against caller storage before
user code runs, so linked source modules retain live file updates.
The same environment works with SDK requirements and the LLM package manager.
Named local references such as `project[feature] @ file:///sources/project`
retain the requested package name, extras and environment marker after building.
Inactive markers skip the build.
Direct wheel installations retain their original URL and supplied hash in
`direct_url.json`, including direct URL dependencies. Index-selected wheels do
not acquire direct-install provenance.
PEP 517 installations retain the original source URL, optional archive hash and
subdirectory in `direct_url.json`, including after source cleanup and offline
restoration through the source environment. Authentication is redacted following
pinned pip rules. Legacy and editable installs keep the pinned legacy behavior.
Direct and named HTTP(S) ZIP/tar archives use the same authorized package
transport and caller-backed cache. URL hashes (SHA-1, SHA-224, SHA-256, SHA-384,
SHA-512 and MD5) follow pinned pip selection rules and are verified before cache
publication and extraction. Cached archives are checked again before extraction;
offline replay and cache bypass use the normal installation controls.
Local source file URLs enforce the same hashes using an owned archive snapshot;
changing the original file cannot change the verified extraction input.
Hashed local archives and remote archives require retained caller storage and streaming writes. ZIP and tar
contents are also detected when the download URL has no archive extension.
Response filenames follow pinned pip header, MIME and redirect rules; filenames
and content types guide extraction without becoming filesystem staging paths.
Local file URLs and remote archives can select a nested project with
`#subdirectory=path/to/project`. Selection preserves pip’s literal fragment
spelling and must remain inside the prepared source tree.
Select the optional `extractArchive` capability above to enable ZIP and tar sources;
source-directory hosts can omit its import. ZIP sources use retained reads, storage-backed directory metadata and streamed
extraction inside the build directory. A shared top-level directory is removed
according to pip’s source layout rules. Relative project paths in requirements
files use the invocation working directory.
Installed snapshots retain durable wheel URLs, so later runs do not need the
source directory. Direct `environment.prepare()` calls that build sources must
supply `env`, `stdout` and `stderr`; Python commands supply these automatically.
Tar sources support plain, gzip, bzip2 and xz archives with streamed file writes,
executable permissions, timestamps and links confined to the build directory.
Hard links copy retained archive contents. Tar extended headers and global PAX
metadata still use the archive engine’s memory limits.
Local setup projects also support `python -m pip install -e ./project` (repeat
`-e` for several projects), or `editable: ["./project"]` in the package SDK.
Use `-e './project[feature]'` (or the same SDK string) to install optional
dependencies while keeping imports linked to the original source. Requirements
files support backslash continuations, whitespace-delimited comments and
`${NAME}` expansion from the caller environment. Missing or empty variables remain
unchanged. Local `-r`/`--requirement` includes resolve relative to the containing
file, preserve entry order and share `maxRequirementBytes`; recursive includes
are rejected. Use `-c`/`--constraint` files to limit selected versions without
installing unused packages, or supply `constraints` and `constraintFiles` in the
package SDK. These limits apply to application dependencies; isolated build
dependencies keep their own requirements. They also accept `-e`/`--editable` entries, including quoted paths and extras;
relative paths use the invocation directory.
The genuine setuptools compatibility-mode wheel keeps imports linked to the
original caller-owned source directory; keep that directory available after
installation. Build dependencies remain isolated and failed builds leave the
installed environment intact. Custom `develop` commands, VCS
sources and other requirements-file controls still need qualification.

Source URL content-disposition selection
is not supported yet. ZIP members must
use canonical relative paths; broader archive path compatibility remains incomplete.
