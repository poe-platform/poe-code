# Opt-in command registration contract

This is evidence and the QA procedure for `registration-contract` in
`safe-bash-command-package-pattern.md`. It does not replace any of the 16
command plans, the shared PDF parser plan, or package/platform gates.

## Inspected integration boundaries

- `packages/safe-bash/scripts/build.mjs` and `scripts/integration-inputs.mjs`
  admit exact private profiles and guarded source roots. Ordinary sibling-source
  tsc is not a substitute. `integration-boundaries.json` remains authoritative.
- `packages/safe-bash/package.json` explicitly exports `./commands/exiftool`
  and `./commands/wkhtmltopdf`; their static source facades re-export private
  implementations. Imports perform no registration. These command exports
  currently advertise types/import, not qualified browser/workerd execution.
- `packages/package-lint/src/rules/safe-bash-command-private.ts` enforces
  workspace privacy. The current working-tree convention and bundling changes
  were preserved, rather than replaced or claimed as this task's work.
- `scripts/bundle-safe-bash.mjs` and `scripts/package-safe.mjs` resolve admitted
  private command graphs and rewrite runtime/declaration module specifiers into
  canonical relative artifacts. Packed declarations must not require private
  command/contract packages to be installed.
- `scripts/fixtures/safe-packages-private-command.mjs` exercises actual byte
  argv, canonical brands, carrier/context identity and constructor identity.
  `safe-packages-smoke.mjs`, `safe-packages-types.mts`, and release-safe's
  installed-consumer routes remain the broader maintained publication gates.

## Registration and options

`safe-bash-contracts/src/command.ts` owns `CommandDefinition`, runtime identity
and `CommandRegistry`; `src/plugin.ts` owns `VirtualShellPlugin` and `PluginHost`.
Keep real handlers in private command workspaces. Do not introduce a second
registry, runtime-brand implementation, or command-specific branch in composition.

| Command | SDK factory/plugin options | Registration scope |
| --- | --- | --- |
| exiftool | Optional partial `limits`; optional `replace`, default false | Exactly `exiftool`; bounded PNG profile remains unchanged |
| wkhtmltopdf | Required `limits` when supplying an options object; optional explicit trusted `renderer`; optional `replace`, default false. Omitted options retain existing bounded defaults | Exactly `wkhtmltopdf`; renderer remains opt-in |
| Future commands | Command-local typed limits/capabilities defined by each command plan; optional plugin replacement policy when implemented | Own name only; explicit safe-bash subpath and registration |

`replace` is host SDK composition policy, not a virtual CLI flag. Command
arguments continue through the same actual handler; this change adds no CLI
surface requiring a second implementation. Raw definitions can instead be
registered with `shell.register(definition, { replace: true })`.

Omitted/false replacement rejects `Command already registered: <name>` before
mutating the registry. For these single-command plugins, registry validation and
collision checking already occur before its one map update: no additional
preflight abstraction is needed. True replacement changes only the named
definition, retains unrelated definition identities and does not duplicate names.
Factories run before setup, preserving their current eager configuration checks.

Any future multi-definition plugin must preflight every host collision before
registering its first definition, and reject internal duplicate definitions
before installing them. This is collision preflight, not a transaction around
arbitrary host callbacks, filesystem effects or asynchronous plugin setup.
Shell queues plugin setup; dispatch awaits setup. Test collision policy directly
on `PluginHost` rather than expecting `shell.use()` to synchronously throw.

No new command is authorized for default aggregates. Existing fmt/fold remain
where they are and keep their existing inventory entries. A future migration or
default change needs explicit authorization. Keep the independent literal
110-name inventories in `tests/plugins/agent-commands.test.ts`,
`default-executor-refactor.test.ts`, and the packed mixed-entry fixture; inspect
other maintained profiles before a default change and update each explicitly.
Never calculate expected names from `createAgentCommands()` or the tested registry.

## Ownership and retained gates

Each new command owns `packages/safe-bash-command-<name>`, `private: true`, its
one command plan and actual handler. Shared parsing belongs in narrowly scoped
private engines. Zero external runtime dependencies applies to the entire
shipped graph/assets; bundled first-party source is allowed. Development tools
and pinned native research controls never ship.

Keep the paired branded carrier/context; equal recreated args fail admission.
Byte semantics consume carrier values/bytes with admitted copy accounting,
explicit decoding policy and invocation lifetime. Preserve rollback and falsey
failure identity. Re-export canonical contracts rather than duplicating brands.
Do not assume a private manifest makes the runtime closure portable: qualify
the current byte-length implementation and its complete filesystem/encoding
prerequisites in every advertised profile.
The inspected leaf currently uses a Buffer-free string byte-length implementation
in `safe-bash-contracts/src/value.ts`; older Buffer-based source descriptions
do not establish the current portable runtime closure.

PDF parser metadata qualification comes first, then pdfinfo metadata,
pdftotext text/layout and qpdf lossless transformations. GNU text semantics,
CSV Decimal/date/inference, HTML5/legacy htmlq contracts, PDF graph/font/crypto
engines, RTF output profiles, independent metadata writability and versioned
layout/render/OCR assets retain their original gates. No external parser or
shipping native fallback is adopted.

## QA procedure

1. Run command-local registration tests against `CommandRegistry` for omitted,
   false and true replacement. Check exact collision diagnostic, unchanged
   registry on rejection, unrelated identities and no duplicate names.
2. Run each command's maintained unit and lint/typecheck scripts after selected
   maintained workspace builds. No timeout or assertion changes are permitted.
3. Run `tests/plugins/agent-commands.test.ts`: assert the independent default
   inventory, command-not-found before opt-in, custom command collision,
   replacement, direct dispatch, middleware and exact output bytes through
   `sh /command.sh` and pipes. The file is explicitly registered in
   `scripts/integration-inputs.test.mjs`.
4. Package with `scripts/package-safe.mjs`, pack scoped artifacts and install
   them with scripts disabled into an isolated consumer with no private command
   workspace packages. Execute `safe-packages-registration.mjs` (including
   the existing byte/identity fixture) and compile
   `safe-packages-registration-types.mts` under strict NodeNext.
5. Keep broader smoke/types, host denial, resource/cleanup, realm and replay
   gates applicable to each command profile. Node evidence does not qualify
   Bun/browser/workerd. If virtual CLI presentation changes, inspect screenshots;
   this task changes only SDK registration policy.

## Local evidence

Before implementation, both explicit `replace: true` registration tests failed
with `Command already registered`; omitted/false controls passed. The repair
only forwards the existing replacement policy to the owning registry.

Selected maintained builds for both private command workspaces passed, including
their filesystem/contracts prerequisites. Command unit suites passed 120
ExifTool and 87 wkhtmltopdf cases. Aggregate/Shell tests passed all 39 cases,
including the two added opt-in workflows and the unchanged 110-name inventory.
Both command lint/source/test typechecks passed. Integration discovery tests
passed all 120 cases. Focused lint for the Shell/discovery tests and packed
fixtures passed. Fresh scoped artifacts were packed and installed with scripts
disabled and legacy peer resolution into a separate consumer. The Node
registration fixture and strict ES2022 NodeNext declarations passed, with no
installed private command/contracts workspace packages. The fixture also
executed the maintained Shell byte-argv/constructor identity controls. This is
registration qualification, not a dependency certification of every optional
export or proof of additional platforms.

No default, host binding, budget, realm or replay logic
was changed. No full repository unit result or additional platform qualification
is claimed by these focused checks. No commit, push or release is part of this
local evidence.
The edited pipeline document also passed its maintained `parsePlan` parser,
and `git diff --check` passed. Generated packing/consumer output was purged
after verification.
