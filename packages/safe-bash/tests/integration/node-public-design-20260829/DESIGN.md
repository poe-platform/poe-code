# Explicit opt-in public Node — design only

2026-08-29. Proposed integration, not implementation, module acceptance or public
acceptance. Poincare's independent review of Node a2f3983 remains active. No product,
engine, Worker, compiler, build, package install, native oracle or private source
was executed/read for this design. All future cases in MATRIX.md are UNRUN.

## 1. Authority and exact composition

- Accepted public80: c83f352f057c64917f219eb938f54aa42cdab829.
- Accepted Unit1: 1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e.
- Accepted resolved Unit2: 928be5585f05c15867fbbb5f4b5debe153b0734e.
- Selected base is derived26215b99cb379a9f825f803454f758fab5a3c8e9, full950
  SHA2561fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4.
- PROVISIONAL Node: a2f3983da537b95bed65b8bc727ab93bc7e98ca3. Its author-v5
  handoff is committed at af66b7748af06319751b6cf87acacbe43acc48fd; body SHA256
  584fdf40225ddc44da79fb89e0b14a15434191be3db906b10a72fdbd5adfcbcc.

SOURCES.json binds24 selected source blobs (16 Node files plus8 accepted-base
pattern files). This is selected SOURCE inspection, not a new complete pack/tree
reconstruction. The existing accepted SOURCE.json supplies the derived-base blob
identities. A computed tree need not exist in Git's object database. Do not overlay
Node's entire source commit or its author public79 package onto this base: that
author package predates accepted public80/Unit1/Unit2. No live HEAD or Unit3 inputs.

After ROOT accepts the Node module, an integrator must reconstruct the accepted
292-input base plus the exact accepted16-file Node module (or explicitly revised
accepted inventory), then only the approved integration additions. Preserve every
other base path/mode/blob. Declare new source, emitted and package inventories and
hashes; do not reuse full950 as the hash/count of the enlarged package. Authenticate
complete derived tree bytes using the established canonical rules, without requiring
a stored derived object or materializing AGENTS. Independent source/installed/moved
review and ROOT public acceptance follow; this design supplies neither GO.

## 2. Smallest proposed API

Retain all existing Node module APIs unchanged. Add only these declarations to
src/commands/node/index.ts (proposed, not present in a2):

```ts
export interface NodeCommandsOptions extends NodeCommandOptions {
  readonly replace?: boolean;
}
export function createNodeCommands(options: NodeCommandsOptions): readonly CommandDefinition[];
export function nodeCommands(options: NodeCommandsOptions): VirtualShellPlugin;
```

No default options, no optional provider, no implicit provider factory or engine
lookup. createNodeCommands returns the one real createNodeCommand definition.
nodeCommands returns plugin name node-commands and registers only node. Both use
one descriptor-validated configuration snapshot; only provider/grants/replace keys
are supported and an explicitly supplied replace must be boolean. Use the existing
module-local record/grants validation; do not spread accessors or introduce new
shared validators. Strip replace before createNodeCommand, whose exact option
record accepts only provider and optional grants. Omission of grants preserves the
existing all-false defaults; do not silently accept malformed explicit values.

The wrapper validates synchronously before returning a plugin; it must neither
call provider.prepare nor acquire a Worker. Setup preflights an existing node and,
unless replace:true, throws Error("Command already registered: node") before any
registry mutation; otherwise use host.commands.register(definition,{replace}).
This follows network/safejs family replacement authority. Standalone plugin use
does not require agentCommands. Public Shell.use queues setup: assert collision at
its actual awaited exec/setup boundary, not a fabricated synchronous use throw.
Do not introduce Shell.ready or a new public input/budget API.

### Exact public exports

Add export * from ./commands/node/index.js to src/index.ts. Add only this exact
package export (existing root export remains unchanged):

```json
"./commands/node": {
  "types": "./dist/commands/node/index.d.ts",
  "import": "./dist/commands/node/index.js"
}
```

Root and subpath expose the same9 runtime exports: createNodeCommand,
createNodeCommands, nodeCommands, createNodeWorkerProvider, NODE_PROFILE,
NODE_ENGINE_ABI, nodeLimits, NodeProfileError, NodeUsageError. Existing20 types
remain: NodeCommandOptions, NodeCompletion, NodeGrants, NodeGuestError,
NodeHostRequest, NodeHostResponse, NodeHostServices, NodeObservation, NodeReason,
NodeRetirement, NodeRuntimeProvider, NodeSelector, NodeSession, NodeSourceRequest,
NodeBridge, NodeEngineAdapter, NodeEngineInput, NodeEngineResult, NodeWorkerEvent,
NodeWorkerProviderOptions; add NodeCommandsOptions. These provider/adapter protocol
types are necessary for explicit trusted implementations, not private lifecycle owners.

Do NOT export NodeOwner, NodeHost, WorkerSession, channels, lowering/admission
helpers, worker-main, NodeOperation or NodeCommandFactory merely because their
source files contain exports. No ./commands/node/* wildcard or worker-entry subpath.
Type declarations may refer to internal declarations without granting package
subpath access. Check emitted root/subpath collision freedom later, not by assertion.

### Default membership and minimal edit list

agentCommands/createAgentCommands and AgentCommandsOptions stay byte-identical:
80 defaults, no node/npm/npx, no Node placeholder/refusal stub. Optional curl/SafeJS
remain separate, with no new network grant. Explicitly installing nodeCommands
adds node to that host's registry only; it is not default81 acceptance.

Future integrator's production edits: src/commands/node/index.ts (two wrappers,
options interface, necessary type import), src/index.ts (one export), package.json
(one exact subpath). Module code ships from its accepted inventory, not rewritten
for integration. No dependency or package-lock change is expected. README.md and
src/commands/node/README.md need narrow proposed-public usage/profile wording;
maintained status docs change only at the appropriate ROOT adjudication. New
public integration tests/type fixtures are separate from immutable module evidence.
No src/plugins/index.ts, contracts, ShellLimits, Budget, AST or Unit3 edit is proposed.

## 3. Trusted provider and static engine adapter

Existing createNodeCommand({provider,grants?}) requires a data-record provider with
exact profile NP1-CJS-WRQ-L-SYNC-1, nonempty bounded identity and prepare function.
prepare(request,services) returns a synchronous NodeSession with start/cancel/retire;
it is NOT a Promise-returning factory and must be inert. The command registers
cleanup before acquisition, attaches the session and then starts it. Parent service
operations before active start are refused. Trusted JS that secretly acquires
resources during prepare violates the provider contract; record validation cannot
sandbox it or magically reclaim undisclosed resources. No public promise of that.

createNodeWorkerProvider({entry,identity,observe?}) is the existing reference owner.
entry must be a canonical serialized file: URL string without query/fragment;
identity is nonempty and bounded; observe, if present, is a function. Malformed
record/URL/grants/configuration fails at construction with the existing TypeError
or bounded-profile error as applicable, not a registered command returning a
configuration-refusal stub. Missing file, import failure, bad default-export shape,
ABI or identity is detected later at actual Worker startup; do not promise eager
filesystem/hash checks which the source does not perform.

The package-owned Worker launch is ./worker-main.js relative to its provider
module. That Worker later imports exactly the trusted entry supplied by the host.
The adapter module has default as its sole value export; that default is the
exact data record {abi,identity,execute}, abi NP1-ENGINE-PUBLIC-SYNC-1 and identity
matching the provider. Type-only exports erase, but extra emitted named exports
are not accepted by current worker-main. execute consumes NodeEngineInput and
returns Promise<NodeEngineResult> under its declared engine contract. Do not
provide a fake execute returning {ok:true} or call host eval/Function/vm/native
Node/subprocess as a fallback. Actual restricted guest entry, output and VFS effects
need independent qualification of this concrete adapter and engine closure.

Host authorization is external and explicit: authenticate the chosen static
adapter URL, engine/dependency bytes and allowed load/Worker routes before use.
The identity string and URL normalization are NOT byte authentication, permission
fencing or private-source authorization. Adapter code executes as trusted host
code in a Worker, not sandboxed malicious-host code. The guest receives no native
Worker, SAB/ports, host FS or process authority through the declared facade.

Reference Worker options pin env:{}, argv:[], captured native stdout/stderr and
resourceLimits; source does NOT explicitly set execArgv. Future qualified loader
and deployment review must bind the real inherited startup flags/load closure,
not infer a blank execArgv or blanket Worker allowance. No new option/permission
to bypass this is proposed. Importing the public barrel may load the provider's
node:worker_threads binding but must not construct a Worker, import the adapter
or acquire an engine until command start. Keep internal-loader observations and
application Node Worker exit/retirement observations separate.

## 4. Profile and error/lifetime boundaries

NP1-CJS-WRQ-L-SYNC-1 supports -e/--eval, primitive -p/--print, .cjs entry and
noninteractive stdin source; bounded argv/env and synchronous text FS, JSON and
POSIX-path facades. Refusals include .js entry, ESM/TLA, package search, local JS
require, full CommonJS, Buffer, async FS, process.exit, Promise constructor, npm/npx
and native eval/Function/subprocess. Promise.race([]) is a qualified pending-job
idiom, NOT all-jobs-settled semantics. No full Node.js compatibility claim.

All7 grants default false: sourceRead/dataRead/dataWrite/jsonModules/stdinRead/
stdoutWrite/stderrWrite. File entry needs sourceRead; stdin source also stdinRead;
JSON modules need dataRead+jsonModules with fresh per-require canonical-path
authorization and per-invocation cache. Inline source is supplied input. VFS
authority must be configured separately; paths are not atomic backing-identity
guarantees. Checked w/wx does not create rollback or universal atomicity.
UTF-8 replacement decoding strips one leading BOM only at source/JSON boundaries,
not ordinary text data; writes are UTF-8. Preserve the two v5 decoder repairs.

All24 limits remain fixed: source262144, context65536, path1024, metadata8192,
error1024 bytes; operations128, frames4096, wakes8192; operation1048576,
read4194304, write4194304, output1048576, JSON1048576 bytes; JSON entries32;
logical memory16777216 including diagnostic reserve1048576; SAB197056 bytes;
admission5000ms; steps100000; callDepth128; V8 old32/young8/code8/stack4MiB.
No public overrides, shared-budget reset or new ShellLimit fields. Source limit
bounds the generated facade+program, not every raw256KiB source. Multiple maxima
need not be simultaneously reachable. Logical ledger/V8 settings are not RSS,
all guest/native allocations or arbitrary provider preallocation control.

Worker-L means cutoff at the actual entry-return marker after required output,
retirement of the owned Worker and draining admitted parent work; it may abandon
guest continuations. Admission5s is not a complete invocation/cleanup deadline.
Status0/1/2 denotes clean entry return/guest failure/private profile failure only
after confirmed retirement+owned cleanup. Caller reason wins, then escaping
execution/control/sink, cleanup failure, then numeric profile selection. Provider
prepare/start rejection is raw execution failure, not inferred from error class.
Public Shell's existing mapping still applies; do not copy direct-handler rejection
expectations to public Shell without inspecting the actual boundary. Bounded
diagnostics may be unavailable and must not replace the primary failure.

Author-v5 reports27 cases/layout, not independent public passes. Its old loop
callback absence, diagnosticFault detail and inherited observations remain qualified
unknowns. Module acceptance must specify exactly what is accepted before public
integration; do not convert source/type/author-only evidence into engine guarantees.

## 5. Proposed consumer example — not yet compiled/run

This belongs in public README only after implementation and three-layout review.
The application supplies its already authorized adapter; no engine package is
automatically imported or installed, and no provider-free example is offered.

```ts
import {
  Shell, agentCommands, createNodeWorkerProvider, nodeCommands,
  type FileSystem,
} from "virtual-bash";

export async function printWithRestrictedNode(
  fs: FileSystem,
  authorizedAdapter: { readonly entry: string; readonly identity: string },
) {
  const provider = createNodeWorkerProvider(authorizedAdapter);
  const shell = new Shell({ fs, cwd: "/" });
  try {
    shell.use(agentCommands());
    shell.use(nodeCommands({
      provider,
      grants: { stdoutWrite: true, stderrWrite: true },
    }));
    return await shell.exec("node -p '1 + 2'");
  } finally {
    await shell.dispose();
  }
}
```

Expected supported-profile stdout is3 plus newline after actual qualified execution;
it is a proposed expectation, not a measured result. For VFS .cjs/stdin/JSON workflows
enable only the additional required grants. Replacing the root import with the
exact commands/node subpath for Node symbols is a separate planned type/load case.
The host must pin and authorize the adapter/default ABI described above; this
function does not establish that authorization merely by accepting two strings.

## 6. ROOT ratification needed before implementation

1. Approve the opt-in wrapper names/options and root+exact commands/node subpath,
   retaining default80 and no AgentCommandsOptions.node field.
2. Approve reuse of the existing provider/Worker ABI exports and fixed24 caps, with
   host-authorized adapter/engine required and no bundled/default engine. Publication
   must call this restricted NP1/Worker-L execution, not complete Node/CommonJS.
3. Identify the accepted Node source/qualification receipt after Poincare closes
   review, then authorize the minimal integration and a separate concrete public
   execution preseal. No implementation or actual review GO follows from this design.

No additional speculative shell feature or policy redesign is requested.
