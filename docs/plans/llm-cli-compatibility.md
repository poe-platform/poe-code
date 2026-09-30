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
| Prompts, stdin and attachments | The shared service and OpenAI transport accept retained safe-fs-backed prompt/attachment sources with bounded reads and request serialization. Buffered injected-provider compatibility remains explicit. Final consumer source transport and hosted qualification remain required. |
| Models, aliases and defaults | Persisted aliases, defaults and string options have 16 initial and 13 additional pinned differential cases. Additional local changes cover plain alias listing, repeated queries, clear-all and declared model option validation. Prompt queries now have six pinned reference cases covering shortest-ID selection, catalog-order ties, repeated queries, aliases and explicit-model precedence; the shared SDK selector also covers Unicode IDs and cancellation. Complete help/errors, host catalog declarations and remaining reference semantics are incomplete. Control files currently have an explicit 1 MiB quota; unlimited-reference qualification remains unresolved. |
| Options | Strings accepted by shell; typed options and richer shared service delivered; complete CLI option behavior remains incomplete. Consumer blanket rejection requires separate regression and delivery. |
| Help, diagnostics, status | Command-tree inventory above; differential formatting and exit status incomplete. |
| Streaming/binary/cancellation | Existing suites; partial errors and cleanup must remain covered. Shared structured events delivered. |
| Templates/fragments | Named templates, parameters, saved attachment paths/types, loader callbacks and template schema propagation are delivered in canonical virtual storage. Fragments and final host qualification remain incomplete. |
| Conversations/chat | Message contract delivered; persisted continuation and interactive chat incomplete. |
| Schemas/tools | Per-model provider schemas, CLI schema DSL, prompt --schema/--schema-multi, template schema references and the shared SDK resolver are delivered. Stored schema IDs/history, tools and chains remain incomplete. |
| Logs/history | Database capability and actual host implementation incomplete. |
| Embeddings/collections/similarity | Shared embedding contract delivered; collection storage, import and similarity incomplete. |
| Keys/plugins/install/configuration | Virtual key storage and --key alias resolution are delivered. Plugin/tool installation and final qualified host implementations remain incomplete. No ambient host access permitted. |
| Packed consumer/workerd/Miniflare/hosted Poe | Required final acceptance, not established by unit tests. |

