# LLM CLI compatibility — issue 1443

Reference: Simon Willison `llm==0.27.1`, inspected through its Click command tree on 2026-09-28. Provider plugins are versioned independently. The target includes tools, fragments and schemas as well as the original issue feature families. A row marked incomplete remains required.

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
| `llm models options clear` | model; key | incomplete |
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
| Prompts, stdin and attachments | Existing command suite; request preparation buffers input and attachments. Streaming safe-fs-backed inputs and provider serialization remain required. |
| Models, aliases and defaults | Injected registry exists; persisted configuration, query/list options and default workflows incomplete. |
| Options | Strings accepted by shell; richer shared service under implementation. Consumer blanket rejection requires separate regression and delivery. |
| Help, diagnostics, status | Command-tree inventory above; differential formatting and exit status incomplete. |
| Streaming/binary/cancellation | Existing suites; partial errors and cleanup must remain covered. Shared structured events under implementation. |
| Templates/fragments | Canonical virtual storage and template semantics incomplete. |
| Conversations/chat | Message contract under implementation; persisted continuation and interactive chat incomplete. |
| Schemas/tools | Provider schema contract under implementation; CLI schema DSL, tools and chains incomplete. |
| Logs/history | Database capability and actual host implementation incomplete. |
| Embeddings/collections/similarity | Shared embedding contract under implementation; collection storage, import and similarity incomplete. |
| Keys/plugins/install/configuration | Explicit host capabilities and qualified implementation incomplete. No ambient host access permitted. |
| Packed consumer/workerd/Miniflare/hosted Poe | Required final acceptance, not established by unit tests. |

## Delivery receipts

Starting upstream source: `0a539330d5`. Dedicated worktree and branch: `poe-code-deliver-full-ll-1443`. No full-parity claim or issue closure until every incomplete item is implemented or explicitly descoped by the user. Upstream commit, remote-main receipt, publication and consumer rollout must be recorded separately.
