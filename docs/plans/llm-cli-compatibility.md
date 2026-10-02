# LLM CLI compatibility

Reference: Simon Willison `llm==0.27.1`, inspected through its Click command tree on 2026-09-28. Provider plugins are versioned independently. The target includes tools, fragments and schemas as well as the original issue feature families. A row marked incomplete remains required. Command rows track complete end-to-end parity; partial upstream delivery is recorded in the acceptance matrix below.

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
| `llm embed` | collection; id; -i/--input; -m/--model; --store; -d/--database; -c/--content; --binary; --metadata; -f/--format | incomplete |
| `llm embed-models` |  | incomplete |
| `llm embed-models default` | model; --remove-default | incomplete |
| `llm embed-models list` | -q/--query (repeatable) | incomplete |
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
| `llm logs` |  | incomplete |
| `llm logs backup` | path | incomplete |
| `llm logs list` | -n/--count; -p/--path; -d/--database; -m/--model; -q/--query; --fragment/-f (repeatable); -T/--tool (repeatable); --tools; --schema; --schema-multi; -l/--latest; --data; --data-array; --data-key; --data-ids; -t/--truncate; -s/--short; -u/--usage; -r/--response; -x/--extract; --xl/--extract-last; -c/--current; --cid/--conversation; --id-gt; --id-gte; --json; --expand/-e | incomplete |
| `llm logs off` |  | incomplete |
| `llm logs on` |  | incomplete |
| `llm logs path` |  | incomplete |
| `llm logs status` |  | incomplete |
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
| `llm schemas` |  | incomplete |
| `llm schemas dsl` | input; --multi | incomplete |
| `llm schemas list` | -p/--path; -d/--database; -q/--query (repeatable); --full; --json; --nl | incomplete |
| `llm schemas show` | schema_id; -p/--path; -d/--database | incomplete |
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
| Prompts, stdin and attachments | The shared service and OpenAI transport accept retained safe-fs-backed prompt/attachment sources with bounded reads and request serialization. Buffered injected-provider compatibility remains explicit. Historical attachments now pass through the shared service, buffered/streamed OpenAI serializers and Python bridge. Local regressions cover history-only and mixed groups, MIME admission, shared byte accounting, cancellation and disposal. The legacy Python shim retains completed-response attachments in sync/async conversations, with pinned 0.27.1 fixtures. The genuine Python provider adapter now maps prior prompt attachments through the same bounded staging and cleanup path as current attachments. Pinned-distribution sync/async regressions cover retained content and cleanup after a later attachment fails; The maintained actual-workerd differential workflow also passes with sync/async history attachments against the pinned CPython oracle; The same workflow passes against independently packed and installed scoped packages. These changes are verified on remote main at e5986ff5c0; release publication and hosted consumer acceptance remain separate. Installed genuine Python Worker calling checks pass for their tested subset; final consumer source transport and hosted qualification remain required. |
| Models, aliases and defaults | Persisted aliases, defaults and string options have 16 initial and 13 additional pinned differential cases. Additional local changes cover plain alias listing, repeated queries, clear-all and declared model option validation. Prompt queries now have six pinned reference cases covering shortest-ID selection, catalog-order ties, repeated queries, aliases and explicit-model precedence; the shared SDK selector also covers Unicode IDs and cancellation. Complete help/errors, host catalog declarations and remaining reference semantics are incomplete. Control-file acquisition uses explicit caller input admission rather than a default 1 MiB cap; complete reference qualification remains unresolved. |
| Options | Strings accepted by shell; scalar typed options and richer shared service delivered. The pinned reference accepts dictionary or JSON-string `logit_bias`, coerces its values to integers and rejects invalid token keys or values outside [-100, 100]. The shared service now admits finite structured options, and object/array descriptors convert CLI JSON without flattening SDK values. Dictionary token bias retains provider-specific coercion and validation. Completion, source, embedding and CLI regressions pass locally. The legacy Python shim normalizes nested JSON options, including integer dictionary keys, rejects cyclic/nonfinite data before dispatch, and maps object/array descriptors to validated dictionary/list fields. The genuine Python provider adapter now also maps object/array descriptors to Pydantic dictionary/list fields. Pinned-distribution tests verify sync/async transport and rejection of wrong types and unknown options before dispatch; the maintained actual-workerd differential workflow passes with these options against pinned CPython. This does not establish full genuine-adapter parity. Declared object options preserve JSON dictionary key order through the CLI and shared service; collision cases, duplicate keys and escaped keys match the pinned raw-string normalizer in focused tests. Installed-consumer qualification of this correction remains required. Upstream structured options, history attachments and usage are verified on remote main at e5986ff5c0. Packed Node/Bun CLI/SDK usage and installed-package workerd Python differential checks pass. Release publication, consumer dependency adoption and hosted acceptance remain required. |
| Help, diagnostics, status | Leading `--version` and its value-rejection diagnostic now have pinned differential fixtures and an SDK reference-version export. Prompt `-u`/`--usage` now emits canonical token counts and details to stderr after successful completion, with bounded SDK/CLI serialization and pinned-reference fixtures. OpenAI JSON/SSE responses retain native fields and add canonical usage; streamed requests request usage explicitly. Command-tree inventory above; remaining differential formatting and exit status are incomplete. |
| Streaming/binary/cancellation | Existing suites; partial errors and cleanup must remain covered. Shared structured events delivered. |
| Templates/fragments | Named templates, parameters, saved attachment paths/types, loader callbacks and template schema propagation are delivered in canonical virtual storage. Fragments and final host qualification remain incomplete. |
| Conversations/chat | Message contract delivered; persisted continuation and interactive chat incomplete. |
| Schemas/tools | Per-model provider schemas, CLI schema DSL, prompt --schema/--schema-multi, template schema references and the shared SDK resolver are delivered. Stored schema IDs now resolve through bounded retained reads of checkpointed native logs.db in CLI and SDK, with selected-content admission and UTF-8/UTF-16 coverage. Schema writing/list/show, active-journal integration, remaining history, tools and chains remain incomplete. |
| Input admission | CLI and Python now distinguish aggregate materialized-input admission (`maxBufferedInputBytes`) from total input (`maxInputBytes` plus the parent budget). Retained attachment and staged-stdin bytes bypass only the materialization allowance. Buffered fallbacks, schema/config/template acquisition and template expansion are admitted before retention. Caller-owned loaders still own pre-return acquisition; full streamed template/save preparation and final hosted qualification remain incomplete. |
| Logs/history | Database capability and actual host implementation incomplete. A bounded SQLite record serializer now preserves native TEXT/BLOB serial types and signed integer widths (26 native fixtures). An isolated native SQLite probe read two streamed 16 MiB TEXT fields with 16 KiB serializer chunks and a fixed 17,432,576-byte WASM heap. Bounded retained-snapshot table/overflow reads now cover 47 native rows including signed rowid extremes, short reads, page-one schema records and corrupt chains; a 32 MiB native TEXT record reads through safe-fs with 4 KiB maximum reads. Atomic fixed-size snapshot patch publication and lazy native field decoding are delivered; schema-ID reads now use bounded table iteration. A source-set publication path now streams snapshot patches into caller-owned retained staging and validates the database plus WAL, rollback journal and shared-memory sidecars in one MemoryFileSystem commit. Stale sidecars preserve the entire destination set, and original retained readers survive retirement. Device and scoped views now forward this operation with source-route guards, operation/path admission, composed cancellation and preserved commit receipts. Quota and mount forwarding remain unqualified. Coherent retained source acquisition now uses authoritative synchronous binding guards, revalidates all four paths around bounded reads, and owns cleanup after partial acquisition. Its composition with the WAL reader matches native committed-row fixtures. External-backend qualification, transactional command wiring, indexing, the remaining shared persistence APIs and Worker qualification remain required; this is not a delivered logging feature. |
| Embeddings/collections/similarity | Shared embedding contract delivered; collection storage, import and similarity incomplete. |
| Keys/plugins/install/configuration | Virtual key storage and --key alias resolution are delivered. Plugin/tool installation and final qualified host implementations remain incomplete. No ambient host access permitted. |
| Packed consumer/workerd/Miniflare/hosted Poe | Required final acceptance, not established by unit tests. |
