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
| `llm chat` | -s/--system; -m/--model; -c/--continue; --cid/--conversation; -f/--fragment (repeatable); --sf/--system-fragment (repeatable); -t/--template; -p/--param ×2 (repeatable); -o/--option ×2 (repeatable); -d/--database; --no-stream; --key; -T/--tool (repeatable); --functions (repeatable); --td/--tools-debug; --ta/--tools-approve; --cl/--chain-limit | incomplete |
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
| `llm install` | packages; -U/--upgrade; -e/--editable; --force-reinstall; --no-cache-dir; --pre | incomplete |
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
| `llm models list` | --options; --async; --schemas; --tools; -q/--query (repeatable); -m/--model (repeatable) | incomplete |
| `llm models options` |  | incomplete |
| `llm models options clear` | model; key (optional) | incomplete |
| `llm models options list` |  | incomplete |
| `llm models options set` | model; key; value | incomplete |
| `llm models options show` | model | incomplete |
| `llm openai` |  | incomplete |
| `llm openai models` | --json; --key | incomplete |
| `llm plugins` | --all; --hook (repeatable) | incomplete |
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
| `llm tools list` | tool_defs; --json; --functions (repeatable) | incomplete |
| `llm uninstall` | packages; -y/--yes | incomplete |

## Acceptance matrix

All rows require deterministic differential fixtures against the pinned distribution; help alone is insufficient.

| Behavior | Current evidence / work remaining |
| --- | --- |
| Prompts, stdin and attachments | URL image references are supported through CLI and buffered/source SDK requests, including caller-supplied messages. Untyped URLs use caller-injected HEAD metadata without downloading payloads; typed URLs do not fetch. OpenAI preserves URL spelling and emits native image_url parts. Five pinned provider fixtures, HEAD failure/cancellation and mixed-source regressions pass locally. An actual workerd CLI smoke passes typed/untyped image URLs with an injected HEAD capability and synthetic provider transport. Local WAV/MP3 attachments now encode native input_audio parts in buffered/source SDK and CLI requests. Ten pinned provider captures, mixed prior/current attachment ordering, source cancellation and wire-limit retirement are covered. CLI audio URLs now acquire bytes through the shared createLlmUrlSource SDK helper and caller fetch capability. Six pinned audio URL parts, total/materialized/parent admission, late fetch cancellation, read cancellation, error cleanup and byte ownership are covered. Actual workerd CLI/SDK execution passes all six captures with typed/untyped CLI inputs. Direct provider URL fields remain image-only; SDK audio uses source acquisition. PDF native file parts are now implemented for buffered content, retained sources and CLI local/URL inputs. Sources hash content while emitting base64, then emit the filename; no second read or full-payload buffer is required. URL origins use pinned Python JSON/SHA256 identity, and optional explicit attachment IDs are preserved. Ten PDF-part fixtures and seven URL-ID fixtures cover content/path/URL, empty inputs, explicit IDs, Unicode and escaping. Actual workerd CLI/SDK checks pass all ten PDF cases. Python origin-ID forwarding and independent installed-package/consumer qualification remain incomplete. The shared service and OpenAI transport accept retained safe-fs-backed prompt/attachment sources with bounded reads and request serialization. Buffered injected-provider compatibility remains explicit. Historical attachments now pass through the shared service, buffered/streamed OpenAI serializers and Python bridge. Local regressions cover history-only and mixed groups, MIME admission, shared byte accounting, cancellation and disposal. The legacy Python shim retains completed-response attachments in sync/async conversations, with pinned 0.27.1 fixtures. The genuine Python provider adapter now maps prior prompt attachments through the same bounded staging and cleanup path as current attachments. Pinned-distribution sync/async regressions cover retained content and cleanup after a later attachment fails; The maintained actual-workerd differential workflow also passes with sync/async history attachments against the pinned CPython oracle; The same workflow passes against independently packed and installed scoped packages. These changes are verified on remote main at e5986ff5c0; release publication and hosted consumer acceptance remain separate. Installed genuine Python Worker calling checks pass for their tested subset; final consumer source transport and hosted qualification remain required. |
| Models, aliases and defaults | Persisted aliases, defaults and string options have 16 initial and 13 additional pinned differential cases. Additional local changes cover plain alias listing, repeated queries, clear-all and declared model option validation. Prompt queries now have six pinned reference cases covering shortest-ID selection, catalog-order ties, repeated queries, aliases and explicit-model precedence; the shared SDK selector also covers Unicode IDs and cancellation. Complete help/errors, host catalog declarations and remaining reference semantics are incomplete. Control-file acquisition uses explicit caller input admission rather than a default 1 MiB cap; complete reference qualification remains unresolved. |
| Options | Strings accepted by shell; scalar typed options and richer shared service delivered. The pinned reference accepts dictionary or JSON-string `logit_bias`, coerces its values to integers and rejects invalid token keys or values outside [-100, 100]. The shared service now admits finite structured options, and object/array descriptors convert CLI JSON without flattening SDK values. Dictionary token bias retains provider-specific coercion and validation. Completion, source, embedding and CLI regressions pass locally. The legacy Python shim normalizes nested JSON options, including integer dictionary keys, rejects cyclic/nonfinite data before dispatch, and maps object/array descriptors to validated dictionary/list fields. The genuine Python provider adapter now also maps object/array descriptors to Pydantic dictionary/list fields. Pinned-distribution tests verify sync/async transport and rejection of wrong types and unknown options before dispatch; the maintained actual-workerd differential workflow passes with these options against pinned CPython. This does not establish full genuine-adapter parity. Declared object options preserve JSON dictionary key order through the CLI and shared service; collision cases, duplicate keys and escaped keys match the pinned raw-string normalizer in focused tests. Installed-consumer qualification of this correction remains required. Upstream structured options, history attachments and usage are verified on remote main at e5986ff5c0. Packed Node/Bun CLI/SDK usage and installed-package workerd Python differential checks pass. Release publication, consumer dependency adoption and hosted acceptance remain required. |
| Help, diagnostics, status | Leading `--version` and its value-rejection diagnostic now have pinned differential fixtures and an SDK reference-version export. Prompt `-u`/`--usage` now emits canonical token counts and details to stderr after successful completion, with bounded SDK/CLI serialization and pinned-reference fixtures. OpenAI JSON/SSE responses retain native fields and add canonical usage; streamed requests request usage explicitly. Prompt argument arity, extra operands, boolean value rejection and clustered short flags now have 23 pinned differential fixtures, including valid provider requests and rejection before stdin acquisition. Command-tree inventory above; root default-command separator behavior, unknown-option suggestions, remaining differential formatting and exit status are incomplete. |
| Streaming/binary/cancellation | Existing suites; partial errors and cleanup must remain covered. Shared structured events delivered. |
| Templates/fragments | Named templates, parameters, saved attachment paths/types, loader callbacks and template schema propagation are delivered in canonical virtual storage. File prompt/system fragments and saved/template fragment paths now use the shared SDK composer and caller-backed retained storage. Pinned Prompt properties and a genuine 0.27.1 CLI capture verify ordering, separators, Python whitespace and universal newlines. Source/buffered regressions cover admission, large trimmed inputs, cancellation, invalid UTF-8 and cleanup. URL fragments now use injected fetch with three validated redirects, preserved HTTP newlines, incremental UTF-8 and shared single-byte replacement decoding. Pinned HTTPX captures cover BOMs, malformed bytes, Latin-1, ASCII, Windows, EBCDIC, Mac and ISO variants. Redirect/cancellation and raw-versus-decoded admission regressions pass; an actual workerd run passes 18 built-workspace CLI/SDK checks. Injected plugin fragment loaders now expose prefix discovery and shared SDK acquisition. Mixed text/attachment ordering, preserved newlines, system attachment rejection, buffered/source admission, late-source disposal and stalled-return cancellation have regression coverage. Python plugin installation/bridging, broader HTTP charset/header conformance and independent installed/hosted qualification remain incomplete. |
| Conversations/chat | Caller-supplied messages are supported request data. Persistent continuation and conversation storage are host-owned and excluded from the library. Interactive chat remains incomplete. |
| Schemas/tools | Per-model provider schemas, CLI schema DSL, prompt --schema/--schema-multi, template schema references and the shared SDK resolver are delivered. Stored-history schema ID lookup/list/show and migrations are removed by explicit user direction. Hosts supply schema objects, files or templates. Remaining tools, chains and hosted qualification remain incomplete. |
| Input admission | CLI and Python now distinguish aggregate materialized-input admission (`maxBufferedInputBytes`) from total input (`maxInputBytes` plus the parent budget). Retained attachment and staged-stdin bytes bypass only the materialization allowance. Buffered fallbacks, schema/config/template acquisition and template expansion are admitted before retention. Caller-owned loaders still own pre-return acquisition; full streamed template/save preparation and final hosted qualification remain incomplete. |
| Logs/history | Explicitly excluded by the user. LLM-owned history persistence, SQLite migrations, response/fragment/tool/attachment history storage and history-backed schema APIs are removed. The host owns persistence; the library accepts caller-supplied messages without retaining them for subsequent requests. |
| Embeddings/collections/similarity | The shared service supports leased text and mixed text/binary batches with explicit model capabilities. Canonical caller-backed SQLite collections now cover legacy migrations, stored content, deduplication, batched embeddings and similarity queries. CSV/TSV/JSON/JSONL imports use retained payloads and caller-backed global state. CLI file imports support repeated --files/--encoding, --binary, prefix/prepend and provider batches spanning file groups. Python 3.9 pathlib traversal uses lazy directory reads and caller-backed SQLite traversal/deduplication state; the default shell device/scoped views preserve enumeration and cancellation/accounting. These file workflows are verified on remote main through 17fa2bb0a9 with pinned captures, isolated installed Node/workerd/browser shell and SDK checks, public types and unchanged bundle budgets. UTF8 signature edge cases are verified on remote main at e6b80dfa29. Codec name resolution now reuses the CSVkit alias registry; all 34 aliases for the supported codecs match pinned Python 3.9, with additional punctuation and invalid-name regressions. File decoding now covers all 70 fixed 256-character Python codec tables plus ASCII: 71 codecs, 18,176 byte results and 219 aliases captured from pinned Python 3.9, including undefined-byte errors. Supplemental file-only maps reuse the existing strict decoder without expanding CSVkit codec admission. Whole-file captures cover universal newlines, undefined-byte skipping and staging cleanup. Shared incremental UTF-16/LE/BE now matches 228 pinned split-byte cases, including missing-BOM versus malformed-input error categories; file imports cover split surrogate pairs and cleanup. Shared incremental UTF-32/LE/BE now matches 417 pinned split-byte cases, preserves decoder state after errors and distinguishes missing-BOM from malformed-input errors. File imports preserve universal newlines and caller-storage cleanup. Fourteen multibyte codecs now have pinned Python transition captures and complete EUC-KR Hangul composition coverage; file-boundary, newline and cleanup checks cover caller-backed imports. GB18030 now uses pinned Python four-byte ranges and two-byte native-table overrides, with every high-lead two-byte input and all four-byte pointer combinations qualified in Node and actual workerd. Mapping boundaries, error recovery and file-boundary/newline cleanup are covered. Stateful codecs remain incomplete. Escaped lone-surrogate IDs are retained until collection insertion, matching pinned provider-call timing; invalid content still fails before embedding. File/stdin timing, lossy-dedup avoidance and unchanged-database rollback are covered. The JSON/JSONL file prepass now counts validated raw rows without converting embedding IDs or content, preserving progress/error timing; JSONL counting and consumption share bounded physical-line storage. Raw JSON surrogatepass now preserves individual Python code points through UTF-8/16/32 decoding, retained staging, object-key identity and nested ID representations. Forty pinned Python byte cases, duplicate-key captures, provider timing, dedup avoidance and cleanup cover these distinctions. Exact diagnostics remain incomplete. SQL import groundwork now includes shared immutable SQLite read sessions with attached caller-backed snapshots, bounded copy/WAL acquisition and canonical identity preservation. This scalar API does not yet implement arbitrary large query-result streaming or CLI imports. Remaining requirements include SQL/attach imports, wider codecs/aliases, exact invalid-input timing/diagnostics, custom collection schema semantics, complete help/errors and external-backend/hosted consumer qualification. Mount traversal now forwards lazy backend iteration, including synthetic children and shadowing, with per-pull namespace admission and early-exit/cancellation cleanup. It retains only configured mount children and does not hold namespace locks while consumers are paused. Mounted SQLite publication forwards the complete database/sidecar source set to one backend atomic commit, with version, ancestry and cross-mount checks; this enables collection writes during mounted CLI imports. Overlay enumeration now streams visible upper/lower entries with per-entry shadow checks, whiteout/opaque-directory handling, cancellation and cleanup, without a complete deduplication set. Overlay source imports use caller-provided writable storage in a separate mount for SQLite scratch and collections; this does not add overlay descriptor or atomic source-set write support. S3 lazy enumeration retains one service page and constant continuation-cycle state, checks cancellation and revalidates each child against the live namespace. Buffered S3 listings preserve their exact repeated-token rejection. LLM glob enumeration uses caller-owned scratch storage; S3 retained file reads and WebDAV directory streaming remain incomplete, so external file-content import qualification is still required. |
| Keys/plugins/install/configuration | Virtual key storage and --key alias resolution are delivered. Plugin/tool installation and final qualified host implementations remain incomplete. No ambient host access permitted. |
| Packed consumer/workerd/Miniflare/hosted Poe | Required final acceptance, not established by unit tests. |


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
