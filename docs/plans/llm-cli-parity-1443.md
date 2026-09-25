# LLM 0.27.1 compatibility inventory and implementation plan

Issue: #1443. Status: incomplete. Target: Simon Willison’s PyPI distribution `llm==0.27.1` (https://github.com/simonw/llm). This pin defines compatibility, rather than the existing single-request Safe Bash subset. Upgrades require regenerating and comparing the command/parameter inventory and rerunning differential fixtures.

Reference `llm/cli.py` SHA-256: `17f32b654bff9d725948a396b78bec6b1850182c1f27b9f5b2291fe57d839fcf`. The installed reference exposes 61 command/group entries, including the built-in OpenAI plugin. The adjacent inventory records every declared parameter, type, multiplicity, arity, default, help output and help exit status. Oracle dependencies are recorded because the reference has unbounded dependencies; these are characterization inputs, not product dependencies. Automatic help options are present in each captured help output.

## Command and option coverage

The rows below are reference requirements, not implemented claims. No group default, implicit prompt alias, or built-in plugin command is excluded. Plugin-added commands beyond the pinned built-ins require a qualified injected plugin host.

| Reference command | Declared parameters (automatic help in snapshot) | Implementation evidence |
| --- | --- | --- |
| `llm` | `--version` | Incomplete |
| `llm aliases` | — | Incomplete |
| `llm aliases list` | `--json` | Incomplete |
| `llm aliases path` | — | Incomplete |
| `llm aliases remove` | `alias` | Incomplete |
| `llm aliases set` | `alias, model_id, -q/--query` | Incomplete |
| `llm chat` | `-s/--system, -m/--model, -c/--continue, --cid/--conversation, -f/--fragment, --sf/--system-fragment, -t/--template, -p/--param KEY VALUE, -o/--option KEY VALUE, -d/--database, --no-stream, --key, -T/--tool, --functions, --td/--tools-debug, --ta/--tools-approve, --cl/--chain-limit` | Incomplete |
| `llm collections` | — | Incomplete |
| `llm collections delete` | `collection, -d/--database` | Incomplete |
| `llm collections list` | `-d/--database, --json` | Incomplete |
| `llm collections path` | — | Incomplete |
| `llm embed` | `collection, id, -i/--input, -m/--model, --store, -d/--database, -c/--content, --binary, --metadata, -f/--format` | Incomplete |
| `llm embed-models` | — | Incomplete |
| `llm embed-models default` | `model, --remove-default` | Incomplete |
| `llm embed-models list` | `-q/--query` | Incomplete |
| `llm embed-multi` | `collection, input_path, --format, --files KEY VALUE, --encoding, --binary, --sql, --attach KEY VALUE, --batch-size, --prefix, -m/--model, --prepend, --store, -d/--database` | Incomplete |
| `llm fragments` | — | Incomplete |
| `llm fragments list` | `-q/--query, --aliases, --json` | Incomplete |
| `llm fragments loaders` | — | Incomplete |
| `llm fragments remove` | `alias` | Incomplete |
| `llm fragments set` | `alias, fragment` | Incomplete |
| `llm fragments show` | `alias_or_hash` | Incomplete |
| `llm install` | `packages, -U/--upgrade, -e/--editable, --force-reinstall, --no-cache-dir, --pre` | Incomplete |
| `llm keys` | — | Incomplete |
| `llm keys get` | `name` | Incomplete |
| `llm keys list` | — | Incomplete |
| `llm keys path` | — | Incomplete |
| `llm keys set` | `name, --value` | Incomplete |
| `llm logs` | — | Incomplete |
| `llm logs backup` | `path` | Incomplete |
| `llm logs list` | `-n/--count, -p/--path, -d/--database, -m/--model, -q/--query, --fragment/-f, -T/--tool, --tools, --schema, --schema-multi, -l/--latest, --data, --data-array, --data-key, --data-ids, -t/--truncate, -s/--short, -u/--usage, -r/--response, -x/--extract, --xl/--extract-last, -c/--current, --cid/--conversation, --id-gt, --id-gte, --json, --expand/-e` | Incomplete |
| `llm logs off` | — | Incomplete |
| `llm logs on` | — | Incomplete |
| `llm logs path` | — | Incomplete |
| `llm logs status` | — | Incomplete |
| `llm models` | — | Partial listing and help; reference default/filters not qualified |
| `llm models default` | `model` | Incomplete |
| `llm models list` | `--options, --async, --schemas, --tools, -q/--query, -m/--model` | Incomplete |
| `llm models options` | — | Incomplete |
| `llm models options clear` | `model, key` | Incomplete |
| `llm models options list` | — | Incomplete |
| `llm models options set` | `model, key, value` | Incomplete |
| `llm models options show` | `model` | Incomplete |
| `llm openai` | — | Incomplete |
| `llm openai models` | `--json, --key` | Incomplete |
| `llm plugins` | `--all, --hook` | Incomplete |
| `llm prompt` | `prompt, -s/--system, -m/--model, -d/--database, -q/--query, -a/--attachment, --at/--attachment-type KEY VALUE, -T/--tool, --functions, --td/--tools-debug, --ta/--tools-approve, --cl/--chain-limit, -o/--option KEY VALUE, --schema, --schema-multi, -f/--fragment, --sf/--system-fragment, -t/--template, -p/--param KEY VALUE, --no-stream, -n/--no-log, --log, -c/--continue, --cid/--conversation, --key, --save, --async, -u/--usage, -x/--extract, --xl/--extract-last` | Partial single-request path; full flags/output not qualified |
| `llm schemas` | — | Incomplete |
| `llm schemas dsl` | `input, --multi` | Incomplete |
| `llm schemas list` | `-p/--path, -d/--database, -q/--query, --full, --json, --nl` | Incomplete |
| `llm schemas show` | `schema_id, -p/--path, -d/--database` | Incomplete |
| `llm similar` | `collection, id, -i/--input, -c/--content, --binary, -n/--number, -p/--plain, -d/--database, --prefix` | Incomplete |
| `llm templates` | — | Incomplete |
| `llm templates edit` | `name` | Incomplete |
| `llm templates list` | — | Incomplete |
| `llm templates loaders` | — | Incomplete |
| `llm templates path` | — | Incomplete |
| `llm templates show` | `name` | Incomplete |
| `llm tools` | — | Incomplete |
| `llm tools list` | `tool_defs, --json, --functions` | Incomplete |
| `llm uninstall` | `packages, -y/--yes` | Incomplete |

## Semantics and host implementation work

- Prompt/stdio: reference root defaults to `prompt`; prompt accepts one optional operand, combines nonempty stdin with it using one space, consumes `-a -`/`--at - TYPE` as binary attachment input, and treats missing interactive input separately. Current Safe Bash uses two newlines and joins multiple operands. Preserve raw attachment bytes and newline behavior. Differential fixtures must cover explicit/implicit prompt, empty/default/piped stdin, invalid UTF-8, attachments from VFS/stdin/URL, MIME detection and URL authorization.
- Models/configuration: qualify aliases (including embedding aliases), substring query selection with shortest matching model ID, persisted defaults, provider-declared features, model-option defaults and explicit override precedence. Canonical virtual storage must persist across shell instances; host credentials/configuration are explicit capabilities. `LLM_MODEL` and other documented variables must come from the invocation environment, never ambient host state.
- Options/provider boundary: keep CLI option values as strings; provider validation and conversion run before transport admission. Supported numeric/boolean options must reach the consumer proxy with their typed values. Unknown, invalid or model-inapplicable options must produce useful errors and zero transport calls. Existing reference providers have conversions; consumer rejection cannot be proven or fixed without its source.
- Streaming/output: text streams end with the reference newline; binary outputs preserve bytes. Qualify `--no-stream`, asynchronous models, usage diagnostics, fenced-code extraction, partial-stream failure, response type mismatch, cancellation identity and iterator cleanup. Bound arguments, attachments, responses, retained logs and collection work; maintain backpressure without buffering streamed output unnecessarily.
- Templates/fragments: implement YAML parsing/deep merge, parameter substitution/defaults, saved prompts and extraction settings, load/edit/list/show/path operations, fragment hashing/aliases and explicit URL/file/plugin loaders. Template editing needs a working injected editor capability; help-only or an unsupported result is incomplete.
- Conversations/chat: persistent conversation identity and continuation, system prompts and fragments, template/default option handling, interactive multiline/exit commands, tools inherited from conversation history. A terminal capability must have a qualified working host and deterministic scripted fixture implementation.
- Structured outputs/tools: implement schema JSON/file/ID/DSL and multi-result wrapping, persisted schema discovery, reference logs data extraction, provider feature validation, injected tool/function execution, approval/debug hooks and chain limits. Python-defined functions depend on the authorized Python host bridge; never execute arbitrary host code implicitly.
- Logs/history: canonical virtual database capability supports reference schema/migrations, log on/off/status/path/list/backup, SQL/search filters, conversation selection, JSON/short/response/usage modes and structured-data extraction. JSON files that omit database/search/backup semantics do not establish parity.
- Embeddings/collections: injected embedding providers, binary/text embedding inputs, stored content/metadata, array/JSON/base64/hex output, batch formats/files/SQL/attached databases, encoding/prefix/prepend, similarity ranking and collection/default-model management. Qualify resource bounds and cancellation for batched work.
- Providers/plugins/keys: qualify built-in OpenAI model discovery and explicit keys; injected package installation/uninstallation, plugin inventory/hooks and configuration ownership must have working host implementations. No implicit pip/process/network access or credential reads in product commands. Do not claim native package management parity from a registry-only stub.
- Help/errors/status: compare every captured help, default-group dispatch, required/extra operands, typed options and option tuple arity; distinguish Click usage exit 2 from runtime exit 1. Match stdout/stderr and output bytes, not just command acceptance.

## Shared service and consumer delivery

The first milestone extracts `createLlmService` from shell model registration/dispatch. It owns model resolution and attachment capability validation and forwards structured requests to providers. CLI parsing, VFS/stdin reads and terminal output stay in the command. Providers retain transport/authentication and option translation. This initial API is single-request only; richer response metadata, conversations, tools, embeddings and persistence still need service contracts coordinated with #1444 and #1445. The Python library proposes `models`/`complete`/`embed`, typed scalar options and typed text/bytes/final-response events. Those requirements are not yet implemented by this initial service. The initial API and its limits are recorded on #1444 (comment 10413) and #1445 (comment 10414).

Consumer source is available at `github.com/poe-internal/poe2`, inspected at `d4b57114e51a24fec492bb7f5d4be27353370e01`. A sparse, read-only source copy was used for inspection; no consumer changes or rollout have been delivered. AST extraction and TypeScript transpilation of the actual `completeShellLlm`, its message helper and attachment constant reproduced the rejection with an injected text stream: an empty options bag produced `ok` and one transport call; adding `temperature: "0.5"` threw `llm model options are not supported`, with the transport call count still one. This is concrete rejection evidence, not the required maintained consumer regression suite or proof that a real Poe model supports temperature. The existing proxy accepts typed `modelParams` and performs provider translation; its documented skip semantics need explicit admission validation for this CLI boundary.

Required delivery order: upstream implementation and checks → remote main → upstream published version → consumer dependency update, focused rejection regression, proxy translation and normal consumer PR/release workflow → hosted Poe-flow verification. Record upstream commit, remote-main verification, publication and consumer rollout separately. The user waived waiting for the full upstream release, not consumer rollout or verification requirements.

## Acceptance ledger

| Requirement | Current evidence | Completion |
| --- | --- | --- |
| Versioned full command/flag inventory | 61 entries extracted from pinned distribution; all help snapshots captured | Inventory captured; behavioral differential audit incomplete |
| Full capability-backed CLI behavior and qualified hosts | Existing single-request path only | Incomplete |
| Consumer options rejection regression and fix | Current source fetched; blanket rejection reproduced from actual function with injected stream | Reproduced; maintained regression/fix incomplete |
| Correct provider option validation/translation | Existing conversions inspected; no consumer transport evidence | Incomplete |
| Shared structured JavaScript service | Extracted model registry, resolution, attachment validation and provider dispatch; focused regression tests | Initial single-request milestone only |
| Differential fixtures for full inventory | Reference snapshots; existing focused tests are not differential qualification | Incomplete |
| Binary/stdin/attachment/error/cancellation/bounds | Existing focused suites preserved; full reference/host matrix missing | Incomplete |
| Packed consumer and actual workerd/Miniflare | Must verify candidate public service exports; full parity matrix remains absent | Incomplete |
| Hosted Poe flows | Consumer source available; established hosted lane not yet run | Incomplete |
| Consumer PR/release and dependency rollout | Not performed | Incomplete |

Do not close #1443 from this ledger until every incomplete row has implementation and fresh qualification evidence or an explicit user descope. No exclusions in older README text or historical plans override these requirements.
