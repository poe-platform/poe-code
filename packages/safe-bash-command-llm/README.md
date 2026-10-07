# llm commands

Use `llm --help` for the command overview and `llm prompt --help` for prompt options; history controls remain host-owned.

Manage an embedding collection catalog using the optional
`@poe-platform/safe-bash/commands/llm/collections` subpath:

```ts
const receipt = await withLlmCollections({
  fs, path: "/embeddings.db", signal,
  maxFileBytes: 16 * 1024 * 1024, maxIndexBytes: 1024 * 1024,
  maxOpenFiles: 8, now: () => new Date(),
}, async catalog => {
  await catalog.collection("documents", { model: "canonical-embedding-model" });
  await catalog.embed("documents", "document-1", {
    service, input, directory: "/staging", maxInputBytes: 8 * 1024 * 1024,
    store: true, metadata: { title: "Document" },
  });
  await catalog.list(row => console.log(row.name, row.count));
});
```

Import `withLlmCollections` from that subpath; supply a retained-storage capable
caller filesystem. Operations must be awaited and serialized within the callback.
The receipt separates committed changes from cleanup errors. Reopening a collection
preserves its model; `catalog.delete(name)` atomically deletes it and its embeddings.
New databases use the pinned embedding schema. Reference embedding schemas from
each earlier migration upgrade atomically, preserving content, vectors, metadata,
existing timestamps, indexes and triggers. Content hashes use incremental MD5;
reference-schema rows migrate through caller-backed snapshots and streamed record
rewrites instead of native whole-record copies. Extra caller indexes remain native
SQLite operations. `catalog.embed` consumes and disposes a UTF-8 input lease (or
binary bytes with `binary: true`), deduplicates content within the collection before
calling the shared service, and replaces an existing ID when content changes.
Content is retained only with `store: true`; metadata is optional. Input and encoded
metadata share `maxInputBytes`. Retained staging and database writes use bounded
chunks. Writes currently reject caller-added embedding indexes and triggers to
avoid stale indexes or incorrect trigger observations. Search with
`catalog.similarByVector(name, vector, { number: 10, prefix }, visit)` or
`catalog.similarById(name, id, { number: 10 }, visit)`; ID searches exclude that ID.
`catalog.similar(name, { service, input, maxInputBytes, number: 10 }, visit)` embeds
a query through the same service and disposes its input lease. Prefixes use SQL
`LIKE` semantics, including `%` and `_` wildcards. Negative numbers return all
matches. Scores use cosine similarity; zero-magnitude vectors fail explicitly.
Each result provides `id`, `score`, and nullable `content`/`metadata` UTF-8 fields
with `{ size, bytes }`. Consume these streams inside the visitor; they expire when
it returns. Ranking uses caller-backed SQLite temporary storage and bounded vector
blocks. `catalog.exists(name)` checks a collection without creating it. Pass
`create: false` to `withLlmCollections` to require an existing embedding schema.
Use `catalog.embedMany(name, { service, entries, directory, maxInputBytes,
batchSize: 100, store: true })` for an async iterable of `{ id, input, metadata? }`
entries. Each yielded input lease is consumed and disposed; the iterator is
retired on failure. The model's optional `embeddingBatchSize` further limits each
provider call. `maxInputBytes` bounds aggregate input and metadata per batch.
Batch deduplication follows the reference: skip existing IDs whose stored hash
matches any input in that batch, while allowing the same content under new IDs.
All batches participate in the surrounding catalog transaction; an error rolls
it back. Native placeholders share one streamed record rewrite per batch.
Import CSV/TSV, JSON or JSONL using `llm embed-multi documents data.csv --format csv
-m MODEL --store` (`-` reads stdin). The first dictionary value is the ID;
remaining values form the text. Duplicate headers and object keys retain their first position
and last value. `--prefix`, `--prepend`, and `--batch-size` customize imports.
Each provider-sized batch commits independently, so earlier batches survive a
later failure. File imports validate once before importing. JSON string payloads use separate caller backing and do not count against the index `maxFileBytes` limit. JSON documents stage completely before
embedding; JSONL accepts a UTF-8 BOM on each physical line and skips blank byte-whitespace lines, preserving earlier committed
batches when a later line fails.
SDK callers can use `withCsvEmbeddingEntries(options, bytes, async entries =>
...)` with `catalog.embedMany`, or use `withJsonEmbeddingEntries` and
`withJsonLinesEmbeddingEntries` for JSON and JSONL. Options include caller `fs`, `directory`,
`signal`, SQLite `maxFileBytes`/`maxOpenFiles`, optional `tabs`, `autoDetect`, `prefix`, and
`prepend`. Entries are callback-scoped and must be consumed serially. Payloads
use retained filesystem spools; header and ID controls retain SQLite's scalar
byte limits. Without `--format`, the CLI detects CSV dialects from a bounded
4096-byte sample using the pinned Python rules. A leading array or object selects JSON. Exact invalid-JSON diagnostics remain incomplete. Raw surrogate code points retain
Python string and object-key identity, including nested ID representations and
encoding failures before embedding content or after embedding invalid IDs.
Explicit JSON imports accept UTF-8, UTF-16LE/BE and UTF-32LE/BE with or without a BOM.
For text files, use `--files DIRECTORY GLOB --encoding utf32`. Generic UTF-32
requires an initial BOM; `utf-32-le` and `utf-32-be` preserve a BOM as text.
Query embedding inputs with `llm embed-multi documents --sql 'SELECT id, title, body FROM source.posts' --attach source /posts.db -m MODEL`.
SQL uses the embeddings database as `main`; repeated `--attach ALIAS FILE` options add source databases.
Attachments are validated in order before collection setup, including for non-SQL input. Missing files are created empty. SDK callers can use `prepareSqliteAttachments({ fs, path, directory, signal, attachments, maxFileBytes, maxIndexBytes, maxOpenFiles })` before opening a collection for the same lifecycle. Existing attachment contents remain unchanged.

SDK callers use `withSqlEmbeddingEntries({ fs, path, directory, signal, sql, attachments, maxFileBytes, maxIndexBytes, maxOpenFiles, prefix?, prepend?, admit? }, callback)` from the collections entry point.
Query results live in private caller storage; text and blob fields replay in bounded chunks, and cancellation retires native work and temporary files before returning.
Original column names preserve duplicate-key ordering, and UTF-16 database text is converted incrementally to UTF-8.
The result file counts against the existing file budget and consumes no SQL attachment slot. SQLite expression evaluation still uses native memory; this does not establish bounded native allocation for arbitrary expressions.
Full SQL introspection/diagnostic parity remains unqualified.
This optional catalog does not store conversation or response history.

To enable collection commands, import `createLlmCollectionCommands` from the same
subpath and register `llmCommands({ service, collections:
createLlmCollectionCommands({ maxFileBytes: 16 * 1024 * 1024, maxIndexBytes:
1024 * 1024, maxOpenFiles: 8 }) })`. Then use `llm embed documents intro -m MODEL
-c 'Hello' --store`, `llm collections`, `llm collections --json`,
`llm collections path`, or `llm collections delete documents`. `-d PATH` or
`LLM_EMBEDDINGS_DB` selects the caller filesystem database; otherwise it is
`embeddings.db` in `LLM_USER_PATH`'s configuration directory. Existing collections
retain their model even if another `-m` is supplied. Stored embedding commands
are silent by default; pinned `--format json` behavior prints `null`.
Use `llm similar documents intro` to find neighbors of a stored ID, or
`llm similar documents -c 'A query'` to embed a query. `-i PATH` accepts a file
(`-` reads stdin), and `--binary` selects binary input. Results stream as JSON
lines; `--plain` prints stored content and metadata. Control results with
`--number`, `--prefix`, and the same database selection options.

Query injected language and media models through the shared LLM service. Register `llmCommands({ providers, defaultModel })` with your shell. Providers own credentials and HTTP transport. `llm --version` reports the pinned CLI reference target, also available to SDK callers as `llmReferenceVersion`. Use `limits.maxInputBytes` and `limits.maxOutputBytes` to bound per-command byte accounting.

SDK requests can supply declarative `tools: [{ name, description, inputSchema }]`
to models declaring the `tools` capability. Find these models with
`llm models --tools`; combine `--schemas`, `-q` or `-m` to narrow the list.
`llm models --options` includes tool support in each model's features.
OpenAI chat providers send these
definitions in buffered and source requests; completed JSON/SSE responses expose
`toolCalls: [{ id, name, arguments }]` in response metadata and the shared service's
final `response` event. Calls preserve provider order, including interleaved
streaming deltas. Set provider `limits.maxToolCallBytes` to bound aggregate
retained call controls; it defaults to `Infinity`, like the other provider quotas.
Tool controls also count toward the service's `maxOutputBytes`. Tool definitions
and parsed arguments are JSON control values held in memory. This transport does
not execute tools or retain responses. Supply prior calls in assistant messages
using `toolCalls`, and results as `{ role: "tool", toolCallId, content }` messages.
Both require the model's `messages` and `tools` capabilities. An empty current
prompt is omitted when tool results are supplied, so a continuation can consist
entirely of caller-provided messages. `streamSources()` accepts input leases for
tool-result content and releases them with the other request inputs. Nested call
arguments and result content are encoded in bounded chunks on this path.
Executable tools may share a `prepare(context, { async })` hook. The executor runs
each distinct hook once per batch, across effective tool names, before approvals;
the hook owns instance initialization and cancellation. Preparation failure stops
the batch. Runtime-loaded toolbox methods share their interpreter's hook.

Use `executeLlmToolCalls({ tools, calls, context, maxOutputBytes }, visit)` to
execute one response's calls serially. Tools add an `implementation(args, context)`
to their definition and return `{ output }` (text or finite JSON) or `{ source }`,
with optional source/URL attachments. The injected context supplies the caller's
filesystem, working directory, capabilities, cancellation signal and remaining
output budget. Implementations own resource acquisition until they return.
The visitor borrows single-use output and attachment leases; consume or stage
them in caller storage before returning. All consumed output/attachment bytes
share the budget across calls, and acquired sources are disposed on completion,
failure or cancellation, including sources returned after cancellation.
`beforeCall` may throw `LlmCancelToolCall` to decline a call and continue. Missing
tools and implementation failures become result errors; a declared tool without
an implementation stops execution. The helper retains no conversation history.
Pass `async: true` to the executor or chain and declare coroutine tools with
`async: true` on their definitions to execute them concurrently. Unmarked tools,
including functions returning promises, remain serial. In async mode the pinned
reference omits missing tools and definitions without implementations. Visitors
can overlap and receive `(result, callIndex)` in completion order; stage payloads
in caller storage and use that index to assemble the next request in call order.
The next chain response waits for every visitor. A visitor failure cancels sibling
work and retires all returned source leases. Implementations must honor the
supplied signal during acquisition. JavaScript and Python scheduling turns differ;
per-call hooks retain their lifecycle order, not a shared global callback order.
Use `llm --async` to select the paired async definition and execute declared coroutine tools concurrently. Python function tools use the explicit loader described below.

Use `streamLlmToolChain` to repeat requests and serial tool execution without
giving the library ownership of conversation state:

```ts
for await (const event of streamLlmToolChain({
  tools,
  context: { fs, cwd, signal },
  openResponse: (index, signal) => service.streamSources(
    host.prepareRequest(index, signal)
  ),
  visit: result => host.consumeToolResult(result),
  chainLimit: 5,
  maxOutputBytes: 1_000_000,
  maxToolOutputBytes: 1_000_000,
})) {
  await host.consumeResponseEvent(event);
}
```

The host supplies each request and consumes/stages each borrowed tool result
before the next request opens. Use `service.stream` for buffered requests or
`service.streamSources` for leased inputs. The chain retains no response list,
messages or persisted history. Output and tool byte limits apply across all
rounds. Consumer exit aborts the active response and does not run pending tools.
The SDK default chain limit is 10; zero/null disables it. Use `bigint` for chain
limits beyond JavaScript's safe integer range; CLI integer values remain exact.
Matching the pinned
reference, the limit is checked after yielding each response, before executing
tools, including a final response with no calls.

Register host tools with `createLlmToolRegistry(definitions)` and pass the returned
map as `llmCommands({ tools, providers })`. Inspect registrations with
`llm tools list` or `llm tools --json`; add registered names to show a selection.
Definitions can include a display `signature` and `plugin` name. Duplicate names
receive registry-key suffixes while preserving the underlying callable name.
SDK callers resolve names with `selectLlmTools(registry, names)` and pass the
result to `executeLlmToolCalls`. Discovery never executes implementations or
loads ambient plugins. JSON schemas stream under the command output limit.
Load inline Python or caller-filesystem definitions with repeated `--functions CODE_OR_PATH`,
including `llm tools list --functions tools.py`. Configure `loadTools` with
`createPythonLlmToolLoader(pythonOptions)` from
`@poe-platform/safe-bash/commands/python/executor`; the configured interpreter must
provide the pinned `llm==0.27.1` package and its host bridge. Definitions execute
once per invocation, preserving Python globals across calls. Function schemas and
signatures come from the genuine package. Local templates retain function code;
remote/plugin templates cannot execute their embedded functions. Explicit CLI
functions remain enabled. Definition code and metadata obey input limits; result
text and attachments stream through caller storage under output limits. SDK callers
can invoke the loader directly and must close its returned session after consuming
borrowed results. Cancellation cooperatively cancels Python tasks; arbitrary
noncooperative Python requires runtime-enforced interruption. The same loader discovers the pinned default tools and tool-only plugins already
registered in its interpreter. Use `-T 'Counter(3)'` to instantiate a registered
Python toolbox; method state lasts for the invocation. `llm tools list --json`
includes toolbox schemas, while text output shows their method signatures.
Sync/async preparation runs before approvals and method execution. Additional
model-provider registration and ambient entrypoint loading stay disabled; runtime
packages remain explicitly provisioned by the host.

Set `plugins: ["my-tool-plugin"]` on `createPythonLlmToolLoader` to load
host-authorized installed distributions from its shared Python environment.
The native LLM loader supplies entrypoint names, versions and hooks. Tool,
template-loader and fragment-loader hooks are allowed; provider registration
remains platform-owned.

Set `loaderProvider: createPythonLlmLoaderProvider({ ...pythonOptions, plugins: ["my-plugin"] })`
on `llmCommands` for native fragment and template loaders that follow installed
environment changes. Import the factory from `@poe-platform/safe-bash/commands/python`.
Listing discovers the selected family after argument validation; execution resolves
the requested prefix without a separate discovery pass. Metadata shares the command
input budget and plugin diagnostics share its output budget. Explicit `fragmentLoaders`
and `templateLoaders` entries take precedence. CLI loader failures retain their complete
message, including long Unicode diagnostics, through bounded stderr writes. Native loader
and tool `SystemExit` preserve their process status and diagnostics; SDK callers receive
`LlmPluginExit` with `exitCode`. Click failures during plugin setup and loader discovery
retain their native formatted diagnostics and custom exit codes. SDK hosts can supply `LlmLoaderProvider`
to the template store or pass it as the fifth argument to `loadLlmPluginFragments`.

Use `llm plugins` to list the configured interpreter's installed plugin names,
versions and hooks. `--all` includes built-in plugins; repeated `--hook NAME`
filters match any requested hook. SDK callers pass
`pluginQuery: { all: true, hooks: ["register_tools"] }` to the same loader and read
`session.plugins`, then close the session. Metadata obeys the loader input limit;
CLI JSON output streams under the output limit. Package installation and provider
provisioning remain host-controlled. Supply `managePackages` for package commands;
`createPythonLlmPackageManager` from the Python executor entrypoint uses native
LLM argument parsing and a shared caller-owned package environment. Compatible
wheel installs work through that environment. Uninstall, editable installs and
pip lifecycle flags remain incomplete in the supplied installer.

Run selected tools with `llm -T lookup "Find an answer"`. Repeat `-T`/`--tool`
for multiple registrations. The CLI executes calls serially by default; `--async` runs declared coroutine tools concurrently and sends results
back to the model through the shared service. `--cl`/`--chain-limit` defaults to
five responses; zero disables the limit. `--no-stream`, extraction and per-response
`--usage` output work across the chain. Templates can save and supply tool names.
All transient request context is staged on the caller's filesystem and removed
when the command exits. Large results use bounded reads on source-capable
providers; buffered providers remain subject to materialized-input limits.
Matching the pinned live-chain behavior, prior assistant text and tool calls are
separate messages, and attachments are sent in their current round. SDK callers
can still explicitly supply prior attachments in their own request messages.
Use `--ta`/`--tools-approve` to approve each call through invocation stdin.
Declined calls return a cancellation result to the model. Terminal input stays
available for approval when a prompt is supplied; redirected stdin is consumed
as prompt input first. SDK callers use `beforeCall` and `LlmCancelToolCall`.
Use `--td`/`--tools-debug` or `LLM_TOOLS_DEBUG=true` to print tool arguments,
formatted results, exceptions and attachment details to stderr. Large diagnostics
use temporary caller storage and bounded writes, with aggregate output admission.
JSON result formatting keeps a fixed page cache and spills large inputs to the caller’s filesystem.
JSON keys and numeric tokens currently use the parser’s 64 KiB control-token
limit; larger controls and plugin installation workflows remain compatibility gaps. Async results and attachments are staged in caller storage and assembled in original call order; approval prompts and debug records are serialized. A debug sink failure cancels sibling execution and cleans staged inputs. The pinned reference crashes on async tool chains with `--usage`; this implementation reports per-response usage instead. Exact async callback/EOF scheduling remains a compatibility gap.

Persist aliases, default models and default options in the caller’s filesystem using `llm aliases`, `llm models default`, and `llm models options`. Use `llm embed-models` (or `list`) with repeated `-q` queries to discover embedding models, and `llm embed-models default [MODEL]` or `--remove-default` to manage their separate default. SDK callers use `service.models` and `configuration.defaultModel("default_embedding_model.txt")` / `setDefaultModel(modelOrNull, "default_embedding_model.txt")`. Use `llm keys set NAME --value VALUE` for noninteractive key storage, or omit `--value` to read one nonempty line at the hidden key prompt. Configuration commands support native `-h`/`--help`, `--` separators and usage errors (exit 2). Set `LLM_USER_PATH` to choose the virtual configuration directory. `createLlmConfiguration(context)` exposes these controls to structured frontends. Configuration controls require atomic publication. Configuration and remote templates default to unlimited bytes and accept explicit `Infinity`; set `limits.maxConfigurationBytes` (or the second argument to `createLlmConfiguration`) and `maxRemoteTemplateBytes` to impose finite quotas. Remote templates inherit `limits.maxInputBytes` when no separate quota is supplied. Remaining reference CLI workflows and bounded prompt/attachment preparation are still incomplete.

Use `llm aliases` for the plain alias list or `llm aliases set short -q part -q name` to select the first model matching every query. `llm models options clear MODEL` clears all defaults atomically; the SDK equivalent is `configuration.clearModelOption(model)`. Pass a key to either interface to clear one option.

Prompt `-q/--query` searches model descriptions and aliases, selecting the shortest matching model ID; repeat it to require all queries. An explicit `-m` takes precedence. SDK callers can use `selectLlmModelByQuery(service.models, queries, configuredAliases, signal)` with the same selection rules.

Models can declare an `options` map with scalar types, numeric bounds, and `object` or `array` types. Structured declarations accept JSON strings from CLI options and native objects or arrays from SDK callers. Nested values must be finite JSON data. Declared options are validated before persistence or provider execution, and service requests receive typed values. Boolean declarations accept the reference’s case-insensitive `true/false`, `1/0`, `yes/no`, `on/off`, `y/n` and `t/f` values. Providers without declarations retain their own option validation. Numeric declarations and OpenAI options follow the pinned reference’s decimal syntax, rejecting radix prefixes and exponent strings for integer fields. OpenAI chat translates `-o json_object true` to JSON mode and parses `-o logit_bias '{"1712":-100}'` into a token-bias dictionary. False JSON-mode values are omitted; invalid values fail before transport. Token IDs retain exact decimal integers beyond JavaScript's numeric precision.

Use `llm chat` for an interactive conversation, with `!multi`/`!end`,
`!fragment` and `!edit` prompts. Templates, model options and Python tools use the
same injected service and caller filesystem as ordinary prompts. The editor runs
through the caller's virtual shell using `VISUAL`, `EDITOR`, or `vi`. Tool approval
and editing share chat stdin. Context and Python tool instances last only for this
invocation; exit destroys staging and a new invocation starts fresh. SDK callers
continue to supply `messages` to the stateless service themselves. Saved
conversations and history options are excluded. Initial fragments resolve before
the banner; inline fragments resolve when entered, including in multiline input. A `-` fragment consumes the remaining chat stdin.
Live chat omits empty assistant replies and prior attachment payloads from later
turns. Repeated system prompts appear once; changed systems follow earlier turns.
`--help` takes precedence over invalid option values after syntax checks; repeated
`--cl` options use the final value. Unknown long options suggest up to three close
matches from supported chat options. Explicit `-o` values replace configured model
options and are validated before tool loading. Chat retains its initial model
options for all turns. Complete native help/error parity remains incomplete.

Use `llm prompt hello` or `llm hello` for the same prompt; add `-u` or `--usage` to print token usage to stderr after a successful response. SDK callers can stream formatted canonical `usage.input`, `usage.output` and `usage.details` with `serializeLlmTokenUsage(usage, signal)`. Formatting emits bounded chunks and preserves backpressure. OpenAI chat requests streaming usage and exposes these canonical fields alongside its native usage fields; zero-valued detail entries are omitted from canonical details. `llm prompt -- "prompt hello"` sends the literal words. The root group consumes its own `--` before dispatch; use `llm prompt -- -x` to send an option-looking prompt literally. Pass the prompt as one argument, quoting multiple words. Extra arguments, missing option values and values attached to boolean flags exit with status 2 before reading stdin. Short flags can be clustered, such as `-nmMODEL` or `-nxo KEY VALUE`; value-taking flags consume the remaining cluster text first. List models with `llm models`; declared output MIME types appear as `Output type` independently of attachment input support, while models without a declared output type retain the default text listing. Narrow matches with repeated `-q` queries or repeated `-m` selections, and inspect declared options and attachment types with `--options`. `--schemas` selects schema-capable models. Model-list usage errors exit with status 2. Use `asyncModel: {}` in a model definition to register paired async support; override options, capabilities or `displayName` there when the async definition differs. IDs and aliases stay shared. `llm models --async` displays paired definitions; its query/schema/tool filters use the sync registration, matching the reference. `--options` reports the async feature for either listing. SDK callers select the paired definition with `service.resolve(model, { async: true })` or `async: true` on completion/stream requests. The service validates against that definition and forwards the mode to the same host provider, which owns async dispatch. Undeclared async models fail before invocation, and rejected source requests release their leases. Use prompt `--async` for the same paired selection. OpenAI chat models register paired async support automatically through the existing injected transport. Set `canStream: false` when a model cannot stream: CLI output is staged until completion and SDK requests forward `stream: false` even if the caller requests streaming. `canStream: true` adds the streaming feature to catalog output. Broader catalog metadata remains incomplete.

SDK callers can prepare an iterable of `{ path, id }` files with `withFileEmbeddingEntries(options, files, operation)` from the collections entrypoint. It uses retained caller filesystem storage, supports UTF-8, UTF-8-sig, UTF-16/32 and 71 Python single-byte codecs (including EBCDIC, ISO-8859, Windows/DOS, KOI8 and Mac variants), and keeps the last successful decoding (default: UTF-8 then Latin-1). Entries are borrowed until disposal or advancing the iterator. `binary`, `prefix` and `prepend` preserve the reference file-content rules, including empty binary files becoming text. Use `withEmbeddingFileGlob(options, { directory, pattern }, operation)` to enumerate Python 3.9 pathlib globs (or an iterable of directory/pattern groups) into `{ path, id }` entries, then pass that iterable to file preparation. Traversal requires `iterateDirectory`; its stack, directory entries and deduplication state live in caller-backed SQLite. Recursive `**` does not follow directory symlinks; explicit symlink path components do. The CLI accepts repeated `--files DIRECTORY GLOB` and `--encoding NAME`, or `--binary` for binary files. Groups share provider batches; `--prefix`, `--prepend` and `--store` also apply. Files cannot be combined with an input path or `--format`. Fourteen multibyte codecs also cover Big5/HKSCS, CP932/949, EUC-JP/KR and JIS variants, GB2312/GBK, Johab and Shift-JIS variants. GB18030 and HZ are also supported, including split input and HZ shift transitions. The seven Python ISO-2022 Japanese/Korean variants preserve designations and shift state across reads. UTF-7 streams completed text into caller storage without retaining a whole shifted segment. Decoding must finish before entries are exposed; malformed data is skipped, while lone surrogate content is rejected only if it belongs to the final selected encoding.

SDK callers can use `service.embedSources(request)` for UTF-8 embedding inputs as `{ bytes, dispose }` leases. The service validates models/options and vectors, and releases every distinct lease on success, failure or cancellation. OpenAI embedding requests stream escaped JSON through the injected transport under `maxRequestBytes`; `service.embed(request)` continues to accept materialized strings. Use `llm embed -m MODEL -c "text"` or `llm embed -i PATH` (stdin by default) to return a vector. `-f json|blob|base64|hex` selects reference-compatible output; binary formats use little-endian float32. `LLM_EMBEDDING_MODEL` overrides the separate embedding default; `-m` overrides both. File/stdin paths use the source API with retained caller storage and bounded reads; they require a source-capable provider. Text input uses UTF-8 and universal newlines; `--binary` preserves bytes and requires an explicit `embed-binary` model capability. SDK callers pass `binary: true` to `service.embedSources` for the same operation. For a mixed batch, pass `inputTypes: ["text", "binary", ...]` in input order instead of `binary`; the model must declare `embed-mixed` and, when any input is binary, `embed-binary`. Collection batch entries can override the batch default with their own `binary` flag; mixed entries retain one provider call and their individual SQLite content types. OpenAI embedding models support text only. Collections, batch imports and similarity remain incomplete. SDK callers can use `service.streamSources(request)` when the service exposes it. Supply UTF-8 prompt/message sources and binary attachment sources as `{ bytes, dispose }` leases. Each history message can carry its own `attachments` using the same shape as current attachments. The service validates their MIME types and disposes their leases, including on cancellation; OpenAI chat preserves them in message content. Disposal must release ownership independently of a pending iterator read. The shared service admits model options and capabilities before reading, and owns disposal on success, failure, cancellation and early return. Custom OpenAI-compatible transports can import `serializeOpenAiChatRequest` and `OpenAiChatSourceRequest` from `@poe-platform/safe-bash/commands/llm/providers`. Pass admitted typed controls and a wire-byte limit (or explicit `Infinity`); the serializer does not translate model options, authorize requests or dispose source leases. Keep those responsibilities in the shared service/provider host. For native provider request formats, the same entrypoint exports `serializeLlmJsonString(utf8Bytes, signal)`, `serializeLlmJsonValue(controls, signal)` and `encodeLlmBase64(binaryBytes, signal)`. JSON helpers emit byte chunks; base64 emits unquoted ASCII string chunks. These helpers preserve backpressure and pending-read cancellation, do not collect streamed payloads, and do not dispose source leases. The host retains native endpoint/attachment semantics and enforces its complete wire-body cap after JSON escaping and base64 encoding. The OpenAI chat provider streams JSON escaping and attachment base64 through its injected HTTP transport; other provider endpoints explicitly reject this source contract. Options and schema are borrowed JSON data: keep them stable until the input leases are disposed. Their JSON encoding streams in bounded chunks, while the caller still owns the control values in memory. `maxRequestBytes` accounts for the complete wire body while it streams, including encoded attachments. The leased service API is qualified through independently installed public packages in Node and workerd. A model can declare `inputSources: false` when its provider exposes source input only for other models. OpenAI derives this flag from each model’s endpoint, so image and video generation retain their existing routes. For source-capable models, CLI file attachments use retained reads of at most 16 KiB and reject file changes before emitting changed bytes. This requires retained-read support from the caller filesystem. Plain prompts for source-capable models stage stdin on the caller filesystem, preserve UTF-8 and prompt separators, and replay retained reads of at most 16 KiB. This path also requires retained staging writers and cleanup; empty stdin does not allocate staging. Template/save prompt acquisition, argument/control acquisition, a qualified external backend and the consumer proxy path remain incomplete.

Use `llmCommands({ service })` to share an authorized `createLlmService()` instance with another language frontend. Configure providers and the default model on that service; command limits remain per invocation. Set `limits: { maxInputBytes: 50 * 1024 * 1024, maxBufferedInputBytes: 8 * 1024 * 1024 }` to admit larger streamed files while retaining a smaller materialization allowance. Both budgets are aggregate raw/UTF-8 input-byte admission, including decoded arguments and acquired configuration/schema/template controls; template expansion also consumes admission before concatenation. The shell's own `maxInputBytes` separately counts stdin and attachment bytes, excluding command arguments and inserted separators. Source attachments and staged stdin consume only the total allowance. Buffered provider fallback, template stdin and saved prompts consume both. These are input-byte budgets, not JavaScript heap measurements or encoded HTTP-body limits; the provider still enforces its wire cap. SDK hosts can share `createLlmInputBudget(limits, parentInputBudget)` across acquisition paths. After admitting streamed bytes, use `budget.materialize(size)` when decoding them to charge only the independent buffer allowance; fresh buffered inputs still use `budget.admit(size, true)`. Injected template loaders must bound acquisition before returning their control objects.

Add caller-filesystem or HTTP(S) context with repeated `-f PATH_OR_URL` / `--fragment PATH_OR_URL` and `--sf PATH_OR_URL` / `--system-fragment PATH_OR_URL`. Prompt fragments preserve empty entries and join with newlines; system fragments trim Python whitespace and join nonempty entries with blank lines. Templates prepend their `fragments` and `system_fragments`; `--save` retains paths for later acquisition. Files use UTF-8 with universal newlines. Source providers compose through retained caller storage without materializing complete fragments; buffered providers obey the materialization budget. SDK callers use `createLlmFragmentSource({ fs, directory, signal, fragments, tail?, system?, normalizeNewlines?, admitBytes?, admitSeparator? })`, then pass the returned source as `prompt` or `system` to `service.streamSources`. Fragment sources are acquired sequentially and disposed during composition; dispose the returned source after use. The optional tail is already-admitted text. URL fragments use the caller’s injected `fetch`, follow at most three validated HTTP(S) redirects, preserve HTTP text newlines and decode UTF-8 or the shared Python single-byte charsets with replacement for malformed bytes. Unknown charset names fall back to UTF-8; other recognized codecs currently fail explicitly. SDK callers use `createLlmUrlFragmentSource({ url, fetch, signal, maxBytes?, admitBytes? })` and pass it to the composer. Its admission callback counts downloaded bytes; the composer’s callback counts decoded UTF-8 bytes. The CLI charges raw bytes to the parent shell budget and decoded text to the LLM materialization/total budgets. Attachment URL sources still reject redirects by default; `createLlmUrlSource` accepts an explicit `maxRedirects` allowance. Plugin fragment loaders are injected through `fragmentLoaders`: use `createLlmFragmentLoaders(entries)` to preserve registration order and duplicate-prefix suffixes. A loader receives the text after `prefix:` and `{ fs, cwd, signal, maxBytes, capabilities }`, and lazily yields text or attachment sources. `llm fragments loaders` lists descriptions without invoking a provider. Prompt fragments accept attachments; system fragments reject them. Loader text preserves newlines. The SDK `loadLlmPluginFragments(reference, loaders, context, allowAttachments?)` borrows each yielded source until its next pull or return and disposes it exactly once. Hosts must bound acquisition before yielding against the dynamic remaining `maxBytes` and honor cancellation; CLI admission also checks consumed bytes. Streamed attachment staging uses caller storage, while buffered providers retain their materialization limit. Python plugin installation/bridging, broader HTTP charset/header conformance and installed/hosted qualification remain incomplete; history-backed aliases/hashes remain host-owned.

Store a prompt with `llm 'Hello $input' -s 'Speak $style' -m MODEL -p style softly --save greet`, then run `llm world -t greet -p style loudly`. Add `-a PATH` or `--at PATH MIME` (`--attachment-type` also works) when saving to retain attachment paths and types; each invocation reads those paths from the caller filesystem. Templates with named `$input` consume stdin; fixed, escaped and braced forms append the explicit prompt on a new line. `llm templates` lists stored templates; `templates show NAME` and `templates path` inspect them. These workflows use the caller filesystem and the optional `yaml@2.9.0` parser. SDK callers use `createLlmTemplateStore()`, `validateLlmTemplateParameters()` and `evaluateLlmTemplate()`. Template parameter validation and model admission precede stdin consumption. Use `-a https://example.com/image.png` for a URL image attachment or `--at URL image/png` to supply its MIME type. Untyped URLs require the caller’s injected `fetch` capability for a HEAD request; typed URLs require no local fetch. OpenAI chat forwards image URLs directly, preserving their spelling and attachment order. SDK callers supply `{ mimeType, url }` in current or caller-supplied message attachments, through either buffered or source requests. Custom models must declare `attachmentUrls: true`; HTTP(S) URLs without embedded credentials are accepted. Image/video editing endpoints still require local bytes. For models advertising `audio/wav` or `audio/mpeg`, local audio attachments use native OpenAI `input_audio` parts (WAV or MP3). CLI retained files and SDK sources stream base64 under the provider wire limit; buffered SDK bytes use the same format. Audio URLs download through the caller’s injected `fetch`, with aggregate input admission and cancellation. SDK callers use `createLlmUrlSource({ url, fetch, signal, maxBytes, admitBytes })` as an attachment source, and `resolveLlmUrlAttachment(context, url, mimeType?)` for optional HEAD MIME inference. Sources are single-use, emit owned chunks up to 16 KiB, and must be disposed; passing them to `service.streamSources` transfers cleanup to the service. Image references still pass through unchanged. Direct `{ mimeType, url }` provider requests support images; use the source helper for audio and PDFs. Models advertising `application/pdf` receive native OpenAI file parts. Local PDF sources are hashed while their base64 is streamed, without a second read or retained full payload. For a PDF URL source, pass `id: await getLlmAttachmentUrlId(url, signal)` on the attachment to preserve the reference URL identity; the CLI does this automatically. An explicit attachment `id` preserves caller-provided identity. Sources default to content SHA-256; buffered empty content follows the reference’s absent-origin identity, while empty local files use the empty-content digest. Remaining template fields and final installed/consumer qualification are incomplete. `--no-stream` withholds terminal output in retained staging on the caller filesystem and replays it in bounded chunks after completion. It requires retained staging writers, cleanup and reads; it does not yet select a different provider HTTP protocol.

Convert concise field definitions with `llm schemas dsl 'name, age int, bio: their bio'`; `--multi` wraps the schema in an `items` array. SDK callers use `parseLlmSchemaDsl(input, multi)`. Send structured prompts with `--schema` or `--schema-multi`, accepting inline JSON, concise field definitions, a schema JSON path, or `t:NAME` for a template schema. Template schemas also apply when prompting with `-t NAME`; `--save` retains an explicit schema. Both buffered and streamed providers receive the same schema control object. `resolveLlmSchemaInput(context, input, options)` exposes resolution to SDK callers. Schema files use retained reads of at most 16 KiB and the command input budget; the parsed schema remains an in-memory provider control value. Conversation history and persistence belong to the host. The library forwards caller-supplied messages for one request without retaining them for the next call. It does not log responses, open or migrate history databases, or resolve/list stored schema IDs.
