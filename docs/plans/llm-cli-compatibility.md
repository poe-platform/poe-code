# LLM CLI compatibility

Reference: Simon Willison `llm==0.27.1`, inspected through its Click command tree on 2026-09-28. Provider plugins are versioned independently. The target includes tools, fragments and schemas as well as the original issue feature families. A row marked incomplete remains required within the user-defined boundary below. Command rows track complete end-to-end parity; partial upstream delivery is recorded in the acceptance matrix below.

The LLM library must not own history or persistence, including through an optional history adapter. This requirement supersedes earlier full-parity plans for logs.db, history migrations, stored-schema lookup and persisted conversation continuation. Caller-supplied messages and schemas remain request data. Configuration/templates and stateless provider, model, Python and embedding behavior remain in scope.

## Command and flag inventory

| Command | Arguments and flags | Status |
| --- | --- | --- |
| `llm` | --version | incomplete |
| `llm aliases` |  | incomplete |
| `llm aliases list` | --json | incomplete |
| `llm aliases path` |  | incomplete |
| `llm aliases remove` | alias | incomplete |
| `llm aliases set` | alias; model_id; -q/--query (repeatable) | incomplete |
| `llm chat` | -s/--system; -m/--model; -c/--continue; --cid/--conversation; -f/--fragment (repeatable); --sf/--system-fragment (repeatable); -t/--template; -p/--param ×2 (repeatable); -o/--option ×2 (repeatable); -d/--database; --no-stream; --key; -T/--tool (repeatable); --functions (repeatable); --td/--tools-debug; --ta/--tools-approve; --cl/--chain-limit | partial: invocation-local context, multiline/custom delimiters, virtual editor, fragments/templates and shared Python tools implemented. 31 native subprocess captures cover startup and inline fragment timing, including multiline and stdin fragments. Caller-backed snapshots are taken once before input; materialization charges only the independent buffer allowance. The 1161 package and 180 shell tests include invalid initial UTF8 before banner/input, one-time source loading, independent materialization admission and empty-plugin stream bounds. Actual workerd verifies transient native Python tools and virtual-editor dispatch from source and independently installed public packages. The installed Python/LLM bundle is 2,110,963 bytes with no assets; existing budgets are unchanged. No saved conversations, IDs or database/history flags. Nine pinned native OpenAI conversation captures now cover empty replies, repeated/changing systems, tools and live attachment replay in buffered/source paths. System comparison uses bounded independent readers with short-read and cancellation coverage. Twenty-seven pinned parser captures (LLM 0.27.1 with Click 8.1.8) cover eager help, syntax-before-conversion errors, repeated scalar options and environment boolean validation. Sixty-six further native captures qualify long-option suggestions under the explicit no-history command profile, including Unicode, ties and multiple matches. Matching rejects oversized option names after a bounded prefix. Fourteen native captures now cover unknown-model diagnostics, defaults, aliases, template selection and validation ordering; unrelated host catalog failures retain their own errors. Fourteen further captures cover option validation before tool loading, native aggregate diagnostics, duplicate and numeric-key ordering, explicit options replacing configured defaults and one-time configuration snapshots across chat turns, on both buffered and source providers. Configured values are validated when a prompt is sent, allowing an immediate exit without consuming them. Ten native template captures now verify prompt-time parameter validation, EOF and earlier option/tool/fragment failures, with repeated missing-variable names retained. Both provider paths and actual Worker execution cover this ordering. Exhaustive help/errors and final hosted qualification remain incomplete. |
| `llm collections` |  | incomplete |
| `llm collections delete` | collection; -d/--database | incomplete |
| `llm collections list` | -d/--database; --json | incomplete |
| `llm collections path` |  | incomplete |
| `llm embed` | collection; id; -i/--input; -m/--model; --store; -d/--database; -c/--content; --binary; --metadata; -f/--format | stateless text/binary input and all four formats implemented with pinned fixtures; collections/store/database operations incomplete |
| `llm embed-models` |  | implemented; pinned catalog/help fixtures |
| `llm embed-models default` | model; --remove-default | implemented; canonical caller configuration, separate embedding default |
| `llm embed-models list` | -q/--query (repeatable) | implemented; case-insensitive AND queries, declared/configured aliases |
| `llm embed-multi` | collection; input_path; --format; --files ×2 (repeatable); --encoding (repeatable); --binary; --sql; --attach ×2 (repeatable); --batch-size; --prefix; -m/--model; --prepend; --store; -d/--database | incomplete |
| `llm fragments` |  | incomplete |
| `llm fragments list` | -q/--query (repeatable); --aliases; --json | incomplete |
| `llm fragments loaders` |  | incomplete |
| `llm fragments remove` | alias | incomplete |
| `llm fragments set` | alias; fragment | incomplete |
| `llm fragments show` | alias_or_hash | incomplete |
| `llm install` | packages; -U/--upgrade; -e/--editable; --force-reinstall; --no-cache-dir; --pre | compatible-wheel installation, prerelease selection and artifact-cache bypass implemented through shared Python CLI/SDK provisioning; pinned native selection, authorization/integrity, saved-state preservation and actual Worker coverage; upgrade and force-reinstall preserve native selection policies, unrelated versions and failure recovery through CLI/SDK; direct-wheel and ordinary pinned replacements are supported; caller-configured source environments build local PEP 517 and legacy setup.py projects into durable wheels; the optional extractPythonSourceZip capability extracts local ZIP sources with retained reads, caller-backed metadata and bounded writes, then uses the same build path; pinned pip fixtures and installed workerd cover source deletion and failed replacement; the optional extractPythonSourceArchive capability also supports plain/gzip/bzip2/xz tar sources with streamed writes, permissions, timestamps and archive-backed link copies; extended/global tar metadata remains memory-backed; named local file references retain names, normalized extras and native marker decisions through wheel publication; direct/named HTTP(S) archives reuse package authorization, caller-backed acquisition, SHA-256 verification and offline/no-cache controls; filename header parsing, MIME preference and redirect fallback match pinned pip captures, with independently installed workerd metadata, ZIP metadata and redirect/cache-replay cases passing on the current artifact; literal subdirectory fragments select nested local/remote source projects within the prepared tree; legacy setup_requires discovery uses genuine setuptools and the private dependency environment; installed .pth paths/hooks initialize after canonical storage mounting, preserving deduplication, startup arguments, main-module effects and live source updates; local editable setup projects use genuine setuptools compatibility-mode wheels linked to the original caller storage through CLI -e/--editable and SDK editable inputs; pinned pip and actual workerd qualify live edits, metadata, failed replacement and source-preserving uninstall; editable extras retain pinned pip parsing and reach dependency resolution through named durable wheel requirements; editable requirement-file entries preserve native option quoting and invocation-relative paths through the same source build path; nested local requirement/constraint files preserve caller environment expansion, relative paths, native role changes, shared byte bounds and cycle rejection; constraints limit selected packages without installing unused roots; CLI/SDK no-deps controls preserve existing dependencies and do not suppress isolated build dependencies; explicit primary/extra index controls and requirement-file index/prerelease directives compare candidates across indexes, while no-index suppresses lookup without blocking direct wheels; custom develop hooks, editable VCS and remaining requirements-file controls (including find-links and hash checking), broader archive formats/paths and final hosted qualification remain incomplete |
| `llm keys` |  | incomplete |
| `llm keys get` | name | incomplete |
| `llm keys list` |  | incomplete |
| `llm keys path` |  | incomplete |
| `llm keys set` | name; --value | incomplete |
| `llm logs` |  | Excluded: history belongs to the host |
| `llm logs backup` | path | Excluded: history belongs to the host |
| `llm logs list` | -n/--count; -p/--path; -d/--database; -m/--model; -q/--query; --fragment/-f (repeatable); -T/--tool (repeatable); --tools; --schema; --schema-multi; -l/--latest; --data; --data-array; --data-key; --data-ids; -t/--truncate; -s/--short; -u/--usage; -r/--response; -x/--extract; --xl/--extract-last; -c/--current; --cid/--conversation; --id-gt; --id-gte; --json; --expand/-e | Excluded: history belongs to the host |
| `llm logs off` |  | Excluded: history belongs to the host |
| `llm logs on` |  | Excluded: history belongs to the host |
| `llm logs path` |  | Excluded: history belongs to the host |
| `llm logs status` |  | Excluded: history belongs to the host |
| `llm models` |  | incomplete |
| `llm models default` | model | incomplete |
| `llm models list` | --options; --async; --schemas; --tools; -q/--query (repeatable); -m/--model (repeatable) | partial: tools/schema filtering, tool feature output and query/alias combinations have pinned fixtures; paired async catalog, sync-side filtering and async option/capability rendering now have nine pinned fixtures; broader metadata remains incomplete |
| `llm models options` |  | incomplete |
| `llm models options clear` | model; key (optional) | incomplete |
| `llm models options list` |  | incomplete |
| `llm models options set` | model; key; value | incomplete |
| `llm models options show` | model | incomplete |
| `llm openai` |  | incomplete |
| `llm openai models` | --json; --key | incomplete |
| `llm plugins` | --all; --hook (repeatable) | native Python metadata discovery implemented; 15 pinned CLI output/help/error cases, bounded protocol/cleanup tests and source/installed workerd checks pass; final hosted qualification remains incomplete |
| `llm prompt` | prompt; -s/--system; -m/--model; -d/--database; -q/--query (repeatable); -a/--attachment (repeatable); --at/--attachment-type ×2 (repeatable); -T/--tool (repeatable); --functions (repeatable); --td/--tools-debug; --ta/--tools-approve; --cl/--chain-limit; -o/--option ×2 (repeatable); --schema; --schema-multi; -f/--fragment (repeatable); --sf/--system-fragment (repeatable); -t/--template; -p/--param ×2 (repeatable); --no-stream; -n/--no-log; --log; -c/--continue; --cid/--conversation; --key; --save; --async; -u/--usage; -x/--extract; --xl/--extract-last | incomplete |
| `llm schemas` |  | Excluded: history belongs to the host |
| `llm schemas dsl` | input; --multi | incomplete |
| `llm schemas list` | -p/--path; -d/--database; -q/--query (repeatable); --full; --json; --nl | Excluded: history belongs to the host |
| `llm schemas show` | schema_id; -p/--path; -d/--database | Excluded: history belongs to the host |
| `llm similar` | collection; id; -i/--input; -c/--content; --binary; -n/--number; -p/--plain; -d/--database; --prefix | incomplete |
| `llm templates` |  | incomplete |
| `llm templates edit` | name | incomplete |
| `llm templates list` |  | incomplete |
| `llm templates loaders` |  | incomplete |
| `llm templates path` |  | incomplete |
| `llm templates show` | name | incomplete |
| `llm tools` |  | incomplete |
| `llm tools list` | tool_defs; --json; --functions (repeatable) | partial: injected registry, selection, text/JSON discovery, collision handling and bounded output have pinned fixtures; invocation-owned Python functions, default tools, registered tooling plugins and toolbox discovery use the genuine pinned package; plugin installation workflows remain incomplete |
| `llm uninstall` | packages; -y/--yes | confirmed and noninteractive compatible-wheel removal implemented through the shared Python environment; legacy requirements resolve dependencies and extras once before removal, then publish an exact snapshot without treating saved roots as current host requirements; pinned pip 21.2.4 prompt/warning/success captures, dependency retention, host protection, EOF recovery and manifest-conflict coverage; pinned pip directory grouping and complete confirmation output are compared after normalizing the installation prefix; versioned distribution metadata supports removal without restoring wheel artifacts, including host dependency protection; older snapshots need one restore to migrate; remaining lifecycle flags and final hosted qualification remain incomplete |

The genuine Python host adapter now registers only declared async pairs, exposes their independent options/capabilities/streaming metadata, and preserves async mode through buffered and source requests. Pinned native resolver regressions and the maintained workerd/native workflow comparison cover selection and dispatch. Function and toolbox qualification is recorded below; plugin installation and the wider Python acceptance scope remain incomplete.

Python `--functions` now loads repeated inline/file definitions through the explicit
`createPythonLlmToolLoader` SDK capability. The genuine pinned package supplies
schemas, signatures and implementations; an invocation-owned interpreter retains
globals across sync/async calls. Local template code is trusted, remote/plugin
embedded code is not. Discovery collision order matches explicit selection.
Caller-backed result/attachment spools, shared worker capacity, protocol failure
retirement and registered cleanup have regression coverage. All 907 LLM and 243
Python tests, 203 focused public shell cases, actual workerd discovery/stateful
serial/concurrent/cancellation execution, lint/types and CLI screenshot inspection
pass. Python task cancellation remains cooperative; noncooperative code requires
runtime interruption. Independently packed/installed workerd execution also passes,
including 4,096-emoji output. All maintained profile budgets and portable Worker
smokes pass; the final Python/LLM profile is 2,095,000 bytes with no assets. This checkpoint predates the registered-tool and toolbox qualification below.


Registered Python tools and toolboxes now use the pinned package for discovery,
constructor parsing, method schemas and sync/async preparation. CLI selection
preserves mixed host/Python order; SDK loaders expose the same selection and
metadata. The default time/version tools and explicitly registered tooling hooks
are enabled while model providers and ambient plugin installation remain
host-controlled. Preparation also runs on a final response with no calls, matching
the pinned chain. Startup failures retire the interpreter without interrupting a
pending host reply. The rebased workspace passes 916 LLM tests; the Python changes
pass 248 tests, and 203 focused public shell cases pass. Source workerd fixtures
cover native preparation values, discovery, default tools, malformed definitions,
provider policy and cancellation. Native text comparison and screenshot inspection
pass. Independently packed and installed workerd fixtures and all maintained
profile budgets/portable smokes also pass; Python/LLM is 2,096,874 bytes with no
assets. Plugin installation workflows, stateless chat, SQL import streaming,
remaining stateful codecs, exact help/errors, large JSON controls and complete
hosted acceptance remain incomplete.


Plugin discovery now exposes native names, versions and hooks through `llm plugins`
and the same invocation-owned SDK loader. Built-in inclusion and repeated hook
filters follow the pinned package. Fifteen native CLI captures cover output, help,
filtering and diagnostics. Metadata admission, invalid protocol data, bounded
output and cleanup have regressions; 933 LLM and 251 Python tests plus lint/types
pass. Source and independently installed workerd checks verify platform metadata,
default tooling and missing-hook selection. Screenshot inspection passes. The
installed Python/LLM profile is 2,098,496 bytes with no assets, within the unchanged
budget. Plugin installation and the remaining acceptance checklist above remain
incomplete.


## Acceptance matrix

All rows require deterministic differential fixtures against the pinned distribution; help alone is insufficient.

| Behavior | Current evidence / work remaining |
| --- | --- |
| Prompts, stdin and attachments | URL image references are supported through CLI and buffered/source SDK requests, including caller-supplied messages. Untyped URLs use caller-injected HEAD metadata without downloading payloads; typed URLs do not fetch. OpenAI preserves URL spelling and emits native image_url parts. Five pinned provider fixtures, HEAD failure/cancellation and mixed-source regressions pass locally. An actual workerd CLI smoke passes typed/untyped image URLs with an injected HEAD capability and synthetic provider transport. Local WAV/MP3 attachments now encode native input_audio parts in buffered/source SDK and CLI requests. Ten pinned provider captures, mixed prior/current attachment ordering, source cancellation and wire-limit retirement are covered. CLI audio URLs now acquire bytes through the shared createLlmUrlSource SDK helper and caller fetch capability. Six pinned audio URL parts, total/materialized/parent admission, late fetch cancellation, read cancellation, error cleanup and byte ownership are covered. Actual workerd CLI/SDK execution passes all six captures with typed/untyped CLI inputs. Direct provider URL fields remain image-only; SDK audio uses source acquisition. PDF native file parts are now implemented for buffered content, retained sources and CLI local/URL inputs. Sources hash content while emitting base64, then emit the filename; no second read or full-payload buffer is required. URL origins use pinned Python JSON/SHA256 identity, and optional explicit attachment IDs are preserved. Ten PDF-part fixtures and seven URL-ID fixtures cover content/path/URL, empty inputs, explicit IDs, Unicode and escaping. Actual workerd CLI/SDK checks pass all ten PDF cases. Python origin-ID forwarding and independent installed-package/consumer qualification remain incomplete. The shared service and OpenAI transport accept retained safe-fs-backed prompt/attachment sources with bounded reads and request serialization. Buffered injected-provider compatibility remains explicit. Historical attachments now pass through the shared service, buffered/streamed OpenAI serializers and Python bridge. Local regressions cover history-only and mixed groups, MIME admission, shared byte accounting, cancellation and disposal. The legacy Python shim retains completed-response attachments in sync/async conversations, with pinned 0.27.1 fixtures. The genuine Python provider adapter now maps prior prompt attachments through the same bounded staging and cleanup path as current attachments. Pinned-distribution sync/async regressions cover retained content and cleanup after a later attachment fails; The maintained actual-workerd differential workflow also passes with sync/async history attachments against the pinned CPython oracle; The same workflow passes against independently packed and installed scoped packages. These changes are verified on remote main at e5986ff5c0; release publication and hosted consumer acceptance remain separate. Installed genuine Python Worker calling checks pass for their tested subset; final consumer source transport and hosted qualification remain required. |
| Models, aliases and defaults | Persisted aliases, defaults and string options have 16 initial and 13 additional pinned differential cases. Additional local changes cover plain alias listing, repeated queries, clear-all and declared model option validation. Prompt queries now have six pinned reference cases covering shortest-ID selection, catalog-order ties, repeated queries, aliases and explicit-model precedence; the shared SDK selector also covers Unicode IDs and cancellation. Complete help/errors, host catalog declarations and remaining reference semantics are incomplete. Control-file acquisition uses explicit caller input admission rather than a default 1 MiB cap; complete reference qualification remains unresolved. |
| Options | Strings accepted by shell; scalar typed options and richer shared service delivered. The pinned reference accepts dictionary or JSON-string `logit_bias`, coerces its values to integers and rejects invalid token keys or values outside [-100, 100]. The shared service now admits finite structured options, and object/array descriptors convert CLI JSON without flattening SDK values. Dictionary token bias retains provider-specific coercion and validation. Completion, source, embedding and CLI regressions pass locally. The legacy Python shim normalizes nested JSON options, including integer dictionary keys, rejects cyclic/nonfinite data before dispatch, and maps object/array descriptors to validated dictionary/list fields. The genuine Python provider adapter now also maps object/array descriptors to Pydantic dictionary/list fields. Pinned-distribution tests verify sync/async transport and rejection of wrong types and unknown options before dispatch; the maintained actual-workerd differential workflow passes with these options against pinned CPython. This does not establish full genuine-adapter parity. Declared object options preserve JSON dictionary key order through the CLI and shared service; collision cases, duplicate keys and escaped keys match the pinned raw-string normalizer in focused tests. Installed-consumer qualification of this correction remains required. Upstream structured options, history attachments and usage are verified on remote main at e5986ff5c0. Packed Node/Bun CLI/SDK usage and installed-package workerd Python differential checks pass. Release publication, consumer dependency adoption and hosted acceptance remain required. |
| Help, diagnostics, status | Root help now matches seven pinned native captures, with history commands excluded and stateless fragment/schema descriptions. Template subcommand help and plugin loader descriptions retain their exact output through shared formatting. Remaining configuration/subcommand errors and broader control qualification stay open. Leading `--version` and its value-rejection diagnostic now have pinned differential fixtures and an SDK reference-version export. Prompt `-u`/`--usage` now emits canonical token counts and details to stderr after successful completion, with bounded SDK/CLI serialization and pinned-reference fixtures. OpenAI JSON/SSE responses retain native fields and add canonical usage; streamed requests request usage explicitly. Prompt argument arity, extra operands, boolean value rejection and clustered short flags now have 23 pinned differential fixtures, including valid provider requests and rejection before stdin acquisition. Nine pinned root-routing fixtures now cover root versus explicit/default prompt separators; raw-byte argument regressions preserve canonical carriers through routing. Command-tree inventory above; root eager help/version ordering now matches 17 pinned captures plus five oracle-verified help precedence cases, including malformed boolean values, unknown root options and short clusters. All 612 leaf tests, lint/types, selected build and 17 actual-workerd cases pass; visual output was inspected. Prompt help now matches pinned 0.27.1 text with history controls, stored schema IDs and stored fragment hashes excluded. Fixed help text shares a lazily decoded gzip catalog generated from readable JSON; lint detects stale generated data, and no runtime dependency is added. Explicit/default prompt help, short clusters and eager validation precedence have ten native differential captures; help bypasses stdin and invalid environment option conversion. Root help text, unknown-option suggestions, remaining differential formatting and exit status are incomplete. |
| Streaming/binary/cancellation | Existing suites; partial errors and cleanup must remain covered. Shared structured events delivered. |
| Templates/fragments | Named templates, parameters, saved attachment paths/types, loader callbacks and template schema propagation are delivered in canonical virtual storage. File prompt/system fragments and saved/template fragment paths now use the shared SDK composer and caller-backed retained storage. Pinned Prompt properties and a genuine 0.27.1 CLI capture verify ordering, separators, Python whitespace and universal newlines. Source/buffered regressions cover admission, large trimmed inputs, cancellation, invalid UTF-8 and cleanup. URL fragments now use injected fetch with three validated redirects, preserved HTTP newlines, incremental UTF-8 and shared single-byte replacement decoding. Pinned HTTPX captures cover BOMs, malformed bytes, Latin-1, ASCII, Windows, EBCDIC, Mac and ISO variants. Redirect/cancellation and raw-versus-decoded admission regressions pass; an actual workerd run passes 18 built-workspace CLI/SDK checks. Injected plugin fragment loaders now expose prefix discovery and shared SDK acquisition. Mixed text/attachment ordering, preserved newlines, system attachment rejection, buffered/source admission, late-source disposal and stalled-return cancellation have regression coverage. Explicitly authorized installed Python fragment loaders now have an executor bridge: native ordered Fragment/Attachment results, caller-backed text and local bytes, lazy injected URL fetch, raw content admission and invocation cleanup. Explicit native template loaders now transfer validated Template fields through bounded messages under the caller materialization allowance, preserving interpolation, untrusted function policy and budgeted stdout/stderr. Explicit host discovery now returns native ordered fragment/template maps and raw docstrings, including native collision suffixes, through the same bounded metadata transport as templates. The optional native loader provider now discovers the requested family at CLI listing time and resolves execution prefixes lazily after environment changes, without an extra registration-hook pass. Explicit maps override dynamic names; metadata and hook output retain caller budgets. Pinned unknown-prefix diagnostics, installed public APIs, actual workerd and unchanged bundle profiles are verified. Registration-hook and plugin-import failures now retain native lookup-stage messages without loader-execution wrapping. Pinned programs distinguish initialization/registration from execution, including restoration of explicit plugin settings after import failure; installed workerd covers both families with genuine installed plugins. Python exception-type/traceback fidelity, broader HTTP charset/header conformance, large-control parity and final hosted qualification remain incomplete. |
| Conversations/chat | Caller-supplied messages are supported request data. Persistent continuation and conversation storage are host-owned and excluded from the library. Interactive chat remains incomplete. |
| Schemas/tools | Per-model provider schemas, CLI schema DSL, prompt --schema/--schema-multi, template schema references and the shared SDK resolver are delivered. Stored-history schema ID lookup/list/show and migrations are removed by explicit user direction. Hosts supply schema objects, files or templates. The shared SDK now admits declarative tools for explicitly capable models and preserves completed tool calls in response metadata. OpenAI buffered/source requests and JSON/SSE responses match four pinned captures across eight input/protocol combinations, including parallel interleaved calls, Unicode arguments, text-free completions and first-choice selection. Aggregate tool-control quotas, output accounting, malformed arguments, byte splits and cancellation/cleanup have regression coverage; all eight captures also pass in actual workerd. Caller-provided assistant tool calls and tool-result messages now roundtrip through buffered and source requests. Four additional pinned captures verify ordering, ASCII/space argument serialization, text-free assistant calls and omitted empty continuation prompts; all eight path combinations pass in actual workerd. A 1 MiB result and large nested arguments stream with bounded writes and backpressure. Pending/empty-source cancellation, wire limits, invalid UTF-8 and role/capability validation have cleanup coverage. These messages remain single-request caller data, with no library retention. The SDK now exposes a stateless serial per-response executor with explicit host implementations, finite JSON or leased output, source/URL attachments, callback-scoped single-use leases, aggregate byte admission and cancellation/late-result cleanup. Seven pinned synchronous execution modes cover callbacks, missing tools, cancellation, errors, duplicate names and attachments. The SDK now also streams serial chain rounds with pinned limit timing (default 10, CLI default 5), aggregate response/tool quotas, bounded chunks and cancellation cleanup. The host supplies each request and consumes result leases; the library retains no conversation or response list. Six pinned limit fixtures and focused lifecycle/source regressions cover this helper. Shared SDK async execution and chain rounds now support explicitly declared coroutine tools, concurrent borrowed-source visitors carrying original call indices, aggregate admission, sibling cancellation and late-source disposal. Hosts stage completion payloads and restore call order without library-owned result retention. Six pinned AsyncResponse fixtures qualify result values, skipped missing/unimplemented definitions and per-call hook lifecycles; JavaScript scheduling turns do not claim identical global Python callback timing. The shared service now admits explicit paired async model definitions with independent option/capability snapshots, shared IDs/aliases and mode forwarding to the existing host provider. Buffered/source SDK requests use async metadata before dispatch and retire rejected sources. CLI --async now resolves the paired model for initial admission and every tool round, including typed options, no-stream/extraction, approvals and debug output. Results/attachments stage concurrently in caller safe-fs and replay in original call order. Approval and diagnostic writes serialize; decline does not implicitly decline the next call. Twenty-four pinned CLI captures run on buffered/source providers, including streaming and nonstreaming model metadata. OpenAI chat declares paired support through its existing transport. canStream false forces nonstreaming CLI/SDK behavior. Exact async callback/EOF scheduling and the reference AsyncChainResponse --usage AttributeError are explicit differences: this CLI reports per-response usage instead of crashing. Python toolbox methods now retain invocation-owned instances and native sync/async preparation. The genuine pinned Python provider now forwards tool definitions, response calls and caller-supplied result messages through the shared service, advertises host tool capability and preserves native sync/async execution callbacks. Large result text uses existing caller-backed input spools; metadata/control quotas and cleanup remain enforced. This adapter work does not qualify plugin installation, all toolbox/chain behavior, legacy shims or final hosted/installed paths. CLI prompt tool selection and serial execution loops are now delivered through the shared executor. Repeatable -T/--tool, --cl/--chain-limit, template tool names, streaming/no-stream/extraction and per-response usage are supported. Command-local request context uses caller-backed staging and is cleaned on exit; no saved history API is added. Twelve pinned CLI fixtures cover buffered/source paths, and a three-round OpenAI wire capture covers live attachment behavior and separate assistant text/call messages. Large tool output, aggregate admission and cancellation cleanup have regressions. CLI --ta/--tools-approve now uses invocation stdin for each tool call, with pinned accept/decline/retry/EOF semantics, Python argument display, terminal prompt preservation, single-use input ownership and cancellable bounded reads. SDK callers use the existing beforeCall hook and LlmCancelToolCall. CLI --td/--tools-debug and LLM_TOOLS_DEBUG now emit Python-style arguments, formatted JSON/raw results, exceptions and attachment representations. Formatting uses the existing caller-backed JSON document engine and independent bounded readers, with output admission and cleanup. Nine pinned captures cover both provider paths, including duplicate keys, Python numeric formatting, whitespace, empty output and attachments. JSON control tokens above the existing 64 KiB parser ceiling remain a debug parity gap. Large chain-limit integers now remain exact in CLI and SDK. Plugin installation workflows, exact async callback/EOF/error parity, wider Python bridging and installed/hosted qualification remain incomplete; injected tool discovery is delivered. |
| Input admission | CLI and Python now distinguish aggregate materialized-input admission (`maxBufferedInputBytes`) from total input (`maxInputBytes` plus the parent budget). Retained attachment and staged-stdin bytes bypass only the materialization allowance. Buffered fallbacks, schema/config/template acquisition and template expansion are admitted before retention. Caller-owned loaders still own pre-return acquisition; full streamed template/save preparation and final hosted qualification remain incomplete. |
| Logs/history | Explicitly excluded by the user. LLM-owned history persistence, SQLite migrations, response/fragment/tool/attachment history storage and history-backed schema APIs are removed. The host owns persistence; the library accepts caller-supplied messages without retaining them for subsequent requests. |
| Embeddings/collections/similarity | The shared service supports leased text and mixed text/binary batches with explicit model capabilities. Canonical caller-backed SQLite collections now cover legacy migrations, stored content, deduplication, batched embeddings and similarity queries. CSV/TSV/JSON/JSONL imports use retained payloads and caller-backed global state. CLI file imports support repeated --files/--encoding, --binary, prefix/prepend and provider batches spanning file groups. Python 3.9 pathlib traversal uses lazy directory reads and caller-backed SQLite traversal/deduplication state; the default shell device/scoped views preserve enumeration and cancellation/accounting. These file workflows are verified on remote main through 17fa2bb0a9 with pinned captures, isolated installed Node/workerd/browser shell and SDK checks, public types and unchanged bundle budgets. UTF8 signature edge cases are verified on remote main at e6b80dfa29. Codec name resolution now reuses the CSVkit alias registry; all 34 aliases for the supported codecs match pinned Python 3.9, with additional punctuation and invalid-name regressions. File decoding now covers all 70 fixed 256-character Python codec tables plus ASCII: 71 codecs, 18,176 byte results and 219 aliases captured from pinned Python 3.9, including undefined-byte errors. Supplemental file-only maps reuse the existing strict decoder without expanding CSVkit codec admission. Whole-file captures cover universal newlines, undefined-byte skipping and staging cleanup. Shared incremental UTF-16/LE/BE now matches 228 pinned split-byte cases, including missing-BOM versus malformed-input error categories; file imports cover split surrogate pairs and cleanup. Shared incremental UTF-32/LE/BE now matches 417 pinned split-byte cases, preserves decoder state after errors and distinguishes missing-BOM from malformed-input errors. File imports preserve universal newlines and caller-storage cleanup. Fourteen multibyte codecs now have pinned Python transition captures and complete EUC-KR Hangul composition coverage; file-boundary, newline and cleanup checks cover caller-backed imports. GB18030 now uses pinned Python four-byte ranges and two-byte native-table overrides, with every high-lead two-byte input and all four-byte pointer combinations qualified in Node and actual workerd. Mapping boundaries, error recovery and file-boundary/newline cleanup are covered. HZ now reuses the GB2312 maps with one pending byte and persistent shift mode. Pinned Python captures cover all 262,144 two-byte transitions in both modes, split and whole, followed by EOF and error recovery. File imports cover aliases, read boundaries, universal newlines and cleanup. All 99 codec and 1162 LLM package tests, 180 public shell tests, source/installed workerd and independently installed collection SDK/CLI checks pass. Lint, types, visual inspection and unchanged profile budgets pass. All seven ISO-2022 variants now reuse existing mappings with bounded pending bytes and designation/shift state. Native captures cover 1608 escape/secondary-set cases, 44 complete character-map comparisons and 35000 persistent-stream steps, including generic pending-buffer overflow and old-buffer restoration after incomplete final input. File imports cover all seven variants, read boundaries, supplementary characters, universal newlines and cleanup. A malformed escape split at the read boundary remains a skippable whole-file error, while the incremental API preserves its native generic carry error. All 157 codec and 1164 LLM package tests, 180 public shell tests, final source/installed workerd, installed collection SDK/CLI checks, lint/types, screenshot review and unchanged profile budgets pass. UTF-7 now stages completed units with constant decoder state instead of retaining the native incremental codec's unbounded shift buffer. Pinned native decode/UTF8 captures cover every UTF16 unit at every split, padding, terminated/unterminated shifts, surrogate pairs and decode-before-materialization error precedence. File import delays valid surrogate errors until the final successful encoding is selected; later valid encodings replace them. Long shifts, late errors, universal newlines and caller-storage cleanup have regressions. All 1219 codec and 1166 LLM package tests, 180 public shell tests, source/installed workerd, installed collection SDK/CLI checks, lint/types, screenshot review and unchanged profile budgets pass. Escaped lone-surrogate IDs are retained until collection insertion, matching pinned provider-call timing; invalid content still fails before embedding. File/stdin timing, lossy-dedup avoidance and unchanged-database rollback are covered. The JSON/JSONL file prepass now counts validated raw rows without converting embedding IDs or content, preserving progress/error timing; JSONL counting and consumption share bounded physical-line storage. Raw JSON surrogatepass now preserves individual Python code points through UTF-8/16/32 decoding, retained staging, object-key identity and nested ID representations. Forty pinned Python byte cases, duplicate-key captures, provider timing, dedup avoidance and cleanup cover these distinctions. Exact diagnostics remain incomplete. SQL imports now accept --sql and repeated --attach through the shared withSqlEmbeddingEntries SDK path. Native SELECT results are staged as SQLite records in a separate caller-backed file and decoded as field streams; duplicate column names retain Python dictionary ordering, and native UTF-16 text converts to UTF-8 before bounded transfers. Result staging is absent from the query attachment namespace, preserving all ten native attachment slots. Scoped pinned captures cover IDs, null/false values, type errors, duplicate names, batches and provider timing. Cancellation drains native query work and removes private snapshots. JavaScript field transfers and stored results are bounded; native expression/conversion allocation and complete SQL diagnostics remain unqualified. Database-list introspection now reports the retained canonical caller paths through a confined VFS name mapping; repeated attachments share the same private source snapshot and recovery sidecars stay private. Read snapshots and attachment validation follow final source symlinks only with synchronous followed-resolution guards; retargeting aborts acquisition and sidecars resolve beside the canonical target. Attachment preparation now creates missing files and validates ordered aliases/content before migrations/model resolution, including non-SQL inputs; pinned lifecycle captures and bounded-copy/cancellation checks cover this behavior. Remaining requirements include SQL/attach imports, wider codecs/aliases, exact invalid-input timing/diagnostics, custom collection schema semantics, complete help/errors and external-backend/hosted consumer qualification. Mount traversal now forwards lazy backend iteration, including synthetic children and shadowing, with per-pull namespace admission and early-exit/cancellation cleanup. It retains only configured mount children and does not hold namespace locks while consumers are paused. Mounted SQLite publication forwards the complete database/sidecar source set to one backend atomic commit, with version, ancestry and cross-mount checks; this enables collection writes during mounted CLI imports. Overlay enumeration now streams visible upper/lower entries with per-entry shadow checks, whiteout/opaque-directory handling, cancellation and cleanup, without a complete deduplication set. Overlay source imports use caller-provided writable storage in a separate mount for SQLite scratch and collections; this does not add overlay descriptor or atomic source-set write support. S3 lazy enumeration retains one service page and constant continuation-cycle state, checks cancellation and revalidates each child against the live namespace. Buffered S3 listings preserve their exact repeated-token rejection. LLM glob enumeration uses caller-owned scratch storage; S3 retained file reads and WebDAV directory streaming remain incomplete, so external file-content import qualification is still required. |
| Keys/plugins/install/configuration | Virtual key storage and --key alias resolution are delivered. Keys, aliases, model defaults/options, embedding-model controls and templates now share native configuration parsing. 254 pinned cases compare help, usage errors, separators, option values, stdout/stderr and configuration files. Key prompting reads one nonempty line without echoing secrets, preserves positioned shell input, and handles EOF/cancellation without publishing. The shared parser also derives option aliases/value arity from the trusted native help catalog for embed, plugins, tools and fragment loaders; 38 additional native captures cover their short flags, suggestions and error precedence. Remaining configuration action and large-control parity still require qualification. Plugin/tool installation and final qualified host implementations remain incomplete. No ambient host access permitted. |
| Packed consumer/workerd/Miniflare/hosted Poe | Required final acceptance, not established by unit tests. |


Canonical wheel transport now authenticates and replays through caller-filesystem retained handles, with bounded reads, version/identity revalidation, cancellation checkpoints and awaited retirement. Canonical files no longer populate a redundant full-byte artifact cache. Cache-directory network acquisition now writes caller staging in at most 64 KiB chunks and publishes only after integrity and sealed-identity checks; cache replay uses retained reads. No-cache acquisition uses the same staging path. Stalled response cancellation, source/integrity/limit/progress failures, corrupted/missing cache artifacts and staging races have regressions. Default network acquisition now uses caller-backed .python-packages/cache storage as well, while implicit manifest ownership and durable local-wheel paths stay unchanged. Explicit buffered cache adapters, weak filesystem fallback and interpreter extraction remain transport gaps. Cleanup failures are reported after confirmed interpreter capacity is released.


## Remaining interpreter extraction boundary

Revalidated against main `69d186fa45` and the pinned Pyodide 314.0.6 / micropip
0.11.1 artifacts. At that baseline, `installPythonPackages` allocated
`opened.size` before handing native packages to the loader. Micropip additionally wraps whole
wheel bytes in `BytesIO`; Pyodide's `unpack_buffer` then copies them into a private
`NamedTemporaryFile`. Both worker executors install before mounting the caller
filesystem. Streaming network acquisition therefore does not qualify extraction.

The `native package handoff retains the wheel source instead of materializing
it` regression reproduced that eager handoff. Native dependency ordering now
retains source descriptors, and fetch/install lifetimes serialize through the
pinned installer. Early bootstrap failures drain admitted installs, and both
callbacks become unavailable before guest execution. Regression tests cover
the handoff, single-payload admission and delayed retirement. All 302 Python
workspace tests and lint/types pass. Source workerd cache controls and the
independently packed workerd install/reuse/uninstall/recovery/plugin flows pass,
as do the unchanged bundle profile checks. Individual wheel
materialization and extraction remain unqualified. The pinned package manager
separates `downloadPackage` from `installPackage`, and its installer separates archive extraction from
`loadDynlibsFromPackage`. Preserve dependency ordering, wheel data-file handling,
metadata, native-library loading and manifest publication when replacing the
byte handoff. Acquisition errors, cancellation and abandoned downloads must retire
retained sources before an interpreter is released.

Native package extraction now uses a seekable host-backed Python file instead of
allocating the complete JavaScript wheel and a second `NamedTemporaryFile` copy.
A shared artifact lifetime serializes native extraction with micropip transfers;
short reads, cancellation identity, closure and bootstrap failure draining retain
coverage. Extraction still delegates to pinned `shutil`/`zipfile`, wheel metadata,
data-file relocation and dynamic-library helpers. The optional native integration
oracle compares installed files and failure categories with the unchanged Pyodide
installer for four noncontiguous layouts, stored/deflated 2 MiB payloads, CRC
failures and truncated archives. A genuine workerd case installs Pydantic Core
without preloaded LLM packages and executes its compiled extension. This does not
move ZIP metadata or extracted files out of interpreter memory. At that stage,
micropip still retained separate whole-wheel buffers.

Micropip now keeps authenticated session-owned wheel receipts instead of Python
wheel bytes. Metadata and extraction use bounded reads from the same retained
source, without refetching after dependency resolution. The decision to read
archive metadata remains after acquisition, preserving concurrent PEP 658 sidecar
completion. Existing micropip source/hash/requirements metadata and loaded-package
registration remain intact. Successful publication, finish,
cancellation and disposal retire retained sources; publication closes them before
user Python can execute. Close failures still drain every handle and remain
observable. ZIP directory/package metadata and extracted package files still use
interpreter memory. Explicit buffered cache adapters still materialize artifacts, so this is
not full caller-backed storage qualification.

The native directory parser retains CPython parsing and validation while replacing its whole-directory BytesIO copy with a bounded source window. Raw interpreter reads are capped at the fixed 65,558-byte ZIP end-record probe; native payload extraction accepts short reads. Extraction, metadata installation and dynamic-library discovery share one index within each retained-wheel call. The production installer now stores native entry records, filename lookups and header boundaries in guarded caller scratch, using existing archive spools and bounded sorted runs. Entry objects are reconstructed on demand; reversed stable header ordering and last-name-wins behavior remain native-compatible. The native parser adaptation fails closed if its expected AST changes. Cancellation, finish and disposal retire the index. Unrelated archives retain their own parser/index, and failures restore the original parser. Global package metadata and extracted files still occupy interpreter memory, so complete caller-backed installation remains open.

The pinned installer's complete filename iteration is now lazy. ZIP Path metadata
membership uses the retained entry index and native implied-parent iteration instead
of constructing a full name set. Ordinary archives keep native behavior, and all
temporary methods restore after success or failure. Ordinary wheel metadata-directory
discovery now retains at most one matching top-level name. The pinned micropip and
Pyodide helpers retain their validation and differing ambiguous-directory behavior;
multiple matching directories still use native sets and remain outside this bound.
Dynamic-library results are consumed one at a time, and extracted files use caller
storage. Global metadata, malformed-wheel directory sets and native executable
loading still need full memory qualification. Preloaded package protection now
snapshots normalized names one distribution at a time into the same bounded
caller-backed index machinery. The snapshot is immutable during restore/install/
uninstall, independent of wheel indexes, and retires on publication or failure.
Saved-record restoration now uses a separate caller-backed ordinal index and lazy
native mapping; records cross the runtime boundary individually in both directions.
Legacy normalization, duplicate/name validation, provenance and metadata-only
uninstall are preserved. Host manifest snapshots and individual records remain
buffered, and dependency names still retain native global state. Restored metadata
snapshot paths now derive from one resolved package root and the existing saved-record
index instead of retaining a second path table; preloaded packages remain excluded.
Python scandir now forwards lazy caller-directory enumeration through both interpreter
transports, sharing file-handle admission and cleanup. Listdir, fixed bootstrap
directories and non-lazy backend fallbacks remain buffered. Package environments
adapt the pinned Importlib.metadata Lookup constructor to caller-backed group rows
and ordered manifests. Native normalization and group ordering remain unchanged;
FastPath retains its mtime/cache policy. Searches own their snapshot through iterator
retirement, and scratch cleanup replays streamed creation records without mutating an
active directory cursor. Fixed bootstrap and ZIP
metadata lookup still use the native implementation. Plain runtimes without a package
environment do not install this adapter. Dependency expansion now consumes parsed
requirements lazily and revisits the stable graph for pending installs, preserving
extras propagation, constraints and native last-distribution version precedence.
It no longer retains every dependency edge as a parsed requirement. Managed and
restored package-name membership now uses installation-root key files and a streamed
ordinal journal. Discard/re-add does not duplicate enumeration, and publication
retires both stores; failed installation remains covered by installation-root
retirement. Resolver requested-name snapshots, extras and per-pass version maps
also use caller storage. Version overwrites preserve last-distribution precedence;
each superseded version pass retires before the next, and resolution retires its
requested/extras state before returning managed names. Individual graph records
remain materialized. Constraint sources are indexed in caller storage after eager
validation, with matching constraints parsed on demand; original constraints still
reach native installation unchanged. Resolution retires the constraint index on
normal and no-deps returns. Per-package constraint lists remain materialized.
Parsed source roots and filtered resolver roots now use ordered caller-backed
records; duplicate-root extras are explicitly persisted before native installation.
Restoration, normal resolution and no-deps resolution retire their root records.
Native installation still materializes its input list.
This does not bound host manifests, native requirement/constraint inputs,
pending requirements and convergence signatures, final inventory collections,
native executable allocation, or the remaining ZIP fallback.
JSPI package transfers and native metadata filesystem operations share one dispatch
lane before reaching the host's single-request transport. This preserves dependency
installation after a prior `--no-deps` install; cancellation and descriptor retirement
still use the existing executor lifecycle.

The next implementation must cover three separate retention points: authenticated
wheel bytes, ZIP directory/global metadata, and extracted package storage. Use
caller-owned backing storage for each. A lazy descriptor followed by `BytesIO`,
Python's in-memory ZIP entry dictionary, or extraction into bootstrap MEMFS is
not completion. Pinned Python 3.9.6 captures now prove acceptance of leading,
middle and trailing gaps, discarded local members and empty archives with unused data.
The ZIP engine offers an explicit `allowUnreferencedData` mode for buffered and
caller-indexed reads, and authenticated Python wheel tooling selects it.
Referenced spans still cannot overlap; strict contiguous validation remains the
default for other consumers. These layout captures are a prerequisite for
streamed wheel extraction, not full `ZipFile` compatibility. All 71 ZIP and
302 Python tests, lint/types, ten installed Node/workerd layout cases, integrity
checks for 26 pinned wheels and two native modules, and unchanged bundle limits
pass. Other accepted wheel variants and exact error timing still require differential qualification; do not
silently reduce wheel compatibility to avoid this work. Qualify the final
implementation with
pinned wheel installs, dependency/data/native-library behavior, failed extraction,
cancellation, external caller storage, packed public artifacts, actual workerd
and the unchanged bundle limits.

Collection command parsing now uses the same native-qualified default-group and
leaf parser as configuration commands. The collection help catalog remains in
its optional storage module. Pinned LLM 0.27.1 / Click 8.1.8 captures cover 104
cases across implicit list, explicit list, delete and path: eager group help,
short clusters, terminators, option suggestions, missing values, extra operands
and help/error ordering. This closes the demonstrated collection parser gaps;
SQL imports, arbitrary query-result streaming and wider collection semantics
remain separate incomplete requirements.

## Private command ownership

Revalidated extraction against remote main `c8f7ac43fb` on 2026-10-02.
Commit `f99b28f57c` already moved the implementation into the private
`safe-bash-command-llm` workspace. Safe Bash retains compatibility facades,
public root/command/provider exports, explicit registration and canonical
`safe-bash-contracts` identities. The workspace is bundled into the parent;
consumers never install its private name. The existing optional YAML peer remains
unchanged. This ownership work does not change the compatibility inventory above.

Standalone service, ElevenLabs, provider and provider-acceptance suites now live
beside the implementation, with unchanged assertions and leaf-contract imports.
Shell-specific OpenAI, command, lifecycle and public-export tests remain in Safe
Bash to avoid a dependency back from the command package. Moving the service
suite first reproduced its invalid old source imports before they were repaired.

Verification uses the maintained selected-workspace build closure, LLM unit and
lint/typecheck scripts, Safe Bash LLM integration suites, memfs package-safe
adapter coverage and scoped package-lint rules. The installed public tarball
fixture covers root/subpath identity, registration replacement, text and binary
pipes, VFS scripts, canonical byte argv, error identity and cancellation cleanup;
its declarations are checked with strict NodeNext. Browser and workerd conditions
use the same packed fixture. All provider and transport calls are synthetic.

Final verification after rebasing through `f9d76811f8`: 335 LLM workspace tests,
180 Safe Bash LLM integration tests, 234 packaging tests, selected-workspace
builds, and LLM lint/source/test typechecks passed. Nine package-lint privacy,
resolution, bundling and asset rules reported no violations for LLM, Safe Bash or
contracts; five findings outside that scope remain outside this verification.
The independently installed public tarball passed Node execution and strict
NodeNext declarations without private workspace resolution. Browser and workerd
export-condition bundles passed in realms without filesystem, process or network
capabilities. The realm shares Error identity with its injected Web APIs.
No command output/help or registration defaults changed; no visual CLI changes
required screenshot validation. All four migrated suites were compared against
their original sources and differ only in import paths.
