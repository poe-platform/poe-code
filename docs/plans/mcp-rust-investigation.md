# MCP Rust implementation investigation

Date: 2026-09-19. Repository inspected: `1a9316310` on local `main`.
Status: implementation active. The reusable `mcp-protocol-rust` JSON foundation
is implemented, including a tested napi-rs JSON binding; MCP package rewrites
and the complete poe-agent dependency rewrite are in progress.
An additive native server checkpoint now covers sessions, tool callbacks, direct
value conversion, request admission, cancellation, modern result metadata, and
stdio framing/backpressure. Content now includes binary and resource blocks,
annotation validation, structured primitives on modern explicit results, and
ordinary tool failures versus explicit `ToolError` responses.
A first callback-heavy benchmark is recorded below. Consumer integration and
publication have not been performed; transports and complete server conformance
remain in progress. The format foundation cross-checks canonical base64 padding
bits and resource URI syntax/authorities against the TypeScript implementation.
Complete Unicode IDNA mapping, contextual joining, combining marks, and bidi host
rules remain an explicit conformance gap; the current host checks are not a full
replacement for WHATWG URL processing. Content helper classes and output-schema
normalization/validation also remain pending.

`toolcraft-schema-rust` now has a private native checkpoint with independent
compilation/evaluation of boolean and type schemas, scalar limits, value equality,
object/array applicators, composition, conditionals, unevaluated members, URI-based
resources/registries, pointers/anchors, dynamic/recursive refs and vocabularies.
Native validation and issue formatting are checked
against TypeScript, including its signed-zero equality behavior. Its graph owns
child schemas once rather than retaining cloned subtrees at every ancestor.
The schema and server bindings share one descriptor-safe ingress source.

This checkpoint runs all 2,226 cases in the locally vendored official draft-7 and
2020-12 suites (640 groups), plus 23 Rust tests and 14 native safety/diagnostic
comparison tests. This does not include optional upstream suites or establish
complete ECMAScript regex compatibility. Schema URI normalization is checked against
Node and TypeScript for special URL references, credentials, IPv4/IPv6 and controls;
full WHATWG and Unicode host compatibility remain pending. The own bounded Unicode
pattern engine supports scalar matching, ranges/classes, repetition, alternation,
lookahead, word boundaries and bundled Unicode 17 general categories. Tests compare
it against TypeScript and exercise bounded failures for pathological patterns.
Backreferences, lookbehind, named groups, Unicode scripts and most binary properties
fail explicitly and remain pending, together with fluent DSL and
non-JSON host values remain pending. Known unfinished constraints fail explicitly
at compilation, and no MCP consumer has been switched to the new schema package.

Custom formats now use an injected per-evaluation Rust validator interface, with
an environment-local synchronous napi callback. The host snapshots own enumerable
format functions without evaluating getters. Conformance tests cover strict true
results, references/property names, inherited registrations, callback exceptions,
reentrant validation, and isolated worker environments. Diagnostics preserve full
UTF-16 pattern/format names in expected/message/keyword fields.

The active goal began on 2026-09-20 at 02:45 UTC (September 19 at 21:45 Chicago).
The user's minimum effort requirement is 24 hours, with a deadline of Monday,
September 21 at 12:00 America/Chicago (17:00 UTC). Neither the duration nor the
full objective has been achieved yet. Continue implementation and independent
compatibility, memory, stability, and performance review through that requirement;
report actual elapsed work and remaining gaps rather than treating elapsed time
alone as completion.

## Objective and boundary

Create independent Rust implementations of the MCP libraries with TypeScript
bindings through `napi-rs`. Use the existing package name plus `-rust`; retain
the scope for scoped packages. Existing TypeScript packages, imports, binaries,
and production consumers continue to use their current implementations.

This round is additive. Add Rust counterparts and the supporting Rust rewrites
they need, including `toolcraft-design-rust` when a concrete native consumer needs
design-system behavior. Do not delete, rename, replace, or retire existing
implementations; change production import paths; switch default backends; or
publish replacements. Build/test registration may add the entries needed to
exercise the new packages while retaining all existing routes and behaviors.

Keep the Rust libraries usable from other projects without depending on the
poe-code CLI or a running Node process. Separate Node bindings from the Rust core
so Python bindings can later use PyO3 and maturin against the same implementation.
Python bindings are an architectural consideration, not additional implementation
scope for the first MCP work.

### Expanded poe-agent scope

The user subsequently required the rewrite to include everything needed for
`poe-agent`, and authorized committing each completed package and pushing directly
to `main` without waiting for CI. Production consumers remain unchanged and Rust
packages remain private. Package commits, verified remote delivery, and any release
status are reported separately; publishing or enabling the Rust replacements is
still outside this round.

The declared runtime dependency closure of `@poe-code/poe-agent` contains nineteen
workspace packages, including the agent itself. Each requires a suffixed Rust
counterpart for the behavior actually needed by the independent agent:

| Existing package                | Rust counterpart                     |
| ------------------------------- | ------------------------------------ |
| `@poe-code/poe-agent`           | `@poe-code/poe-agent-rust`           |
| `@poe-code/agent-spawn`         | `@poe-code/agent-spawn-rust`         |
| `@poe-code/poe-acp-client`      | `@poe-code/poe-acp-client-rust`      |
| `@poe-code/user-error`          | `@poe-code/user-error-rust`          |
| `auth-store`                    | `auth-store-rust`                    |
| `tiny-mcp-client`               | `tiny-mcp-client-rust`               |
| `@poe-code/agent-defs`          | `@poe-code/agent-defs-rust`          |
| `@poe-code/agent-harness-tools` | `@poe-code/agent-harness-tools-rust` |
| `@poe-code/agent-hook-config`   | `@poe-code/agent-hook-config-rust`   |
| `@poe-code/agent-skill-config`  | `@poe-code/agent-skill-config-rust`  |
| `@poe-code/poe-code-config`     | `@poe-code/poe-code-config-rust`     |
| `@poe-code/process-runner`      | `@poe-code/process-runner-rust`      |
| `toolcraft-design`              | `toolcraft-design-rust`              |
| `@poe-code/config-extends`      | `@poe-code/config-extends-rust`      |
| `@poe-code/config-mutations`    | `@poe-code/config-mutations-rust`    |
| `@poe-code/frontmatter`         | `@poe-code/frontmatter-rust`         |
| `@poe-code/providers`           | `@poe-code/providers-rust`           |
| `@poe-code/task-list`           | `@poe-code/task-list-rust`           |
| `toolcraft-schema`              | `toolcraft-schema-rust`              |

This closure adds about 82,700 non-test TypeScript source lines by a first manifest
inventory; source imports and optional paths still require review. Counts do not
prove behavioral coverage. External packages currently supply OpenAI API/SSE
handling, glob/ignore/shell parsing, HTML-to-Markdown conversion, YAML/TOML/JSONC,
TypeScript config evaluation, and terminal width/wrapping. The native rewrite must
provide those required behaviors without retaining the external runtime packages.
Standard host HTTP, crypto, filesystem, and process adapters remain allowed.

Acceptance includes the fluent agent builder, plugin registry and hooks, providers,
streaming model protocols, MCP tools, files/shell/web/memory/skills/policy/compaction,
child spawning, ACP, session branching and persistence, cancellation, background
process cleanup, and transcript events. Exercise all of these with deterministic
model/host adapters; no test calls a live model. Port the dependency graph in order
and use the existing public APIs and tests as development-time references. A
small native orchestration shell delegating agent logic back to TypeScript is not
an independent Rust rewrite.

## Dependency policy

The shipped packages are self-contained, with zero external runtime package
dependencies. Development dependencies may provide tooling and cross-checking;
official MCP SDKs are test oracles, not the implementation. In particular, do not
use `rmcp` as the Rust engine, bundle it to disguise a runtime dependency, or
delegate protocol operations to an official SDK.

Implement the MCP protocol, client/server lifecycle, and state in our own Rust
libraries. Keep the core standard-library-only as the starting constraint; this
investigation does not authorize additional implementation crates. The previously
selected `napi-rs` binding necessarily uses Rust crates and their compiled support
code. Those are explicit binding/build dependencies, not proof of a literally
dependency-free native binary. Python bindings would have the analogous PyO3
exception when implemented.

For npm artifacts, runtime `dependencies`, `optionalDependencies`, required peers,
and bundled external implementation packages are empty. Ship the supported native
binaries and generated loader in the package itself, rather than using platform
packages as optional dependencies or downloading binaries during installation.
Installed consumers need their normal host runtime, not Rust, Cargo, a compiler,
the napi CLI, or a running service. Future Python wheels likewise ship their
extension and need no external Python runtime packages.

Use host-standard networking and cryptographic capabilities behind explicit
adapters where needed. Do not write new cryptographic primitives to satisfy the
dependency goal. General JSON Schema validation and JSON/TOML/YAML parsing are
substantial implementation work under this constraint; existing parser/validator
packages cannot simply become runtime dependencies. Python's standard library
also does not provide a general JWT signing/verification implementation. Native
and Python feature parity must account for these gaps explicitly, rather than
silently adding a library or omitting a feature.

## Repository inventory

There are ten MCP-named package directories. Their `src` trees contain roughly
22,200 TypeScript lines, including exported testing support, and 136 test or
compile-check files. These figures describe scope, not an effort estimate.

| Existing package directory        | Rust counterpart                       | Responsibility and dependencies                                                                                                                                               |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tiny-stdio-mcp-server`           | `tiny-stdio-mcp-server-rust`           | Shared server engine, stdio, schemas, content helpers, resources, prompts, custom methods, subscriptions, cancellation, and testing helpers. Uses `toolcraft-schema`.         |
| `tiny-http-mcp-server`            | `tiny-http-mcp-server-rust`            | HTTP transport around the shared server engine; SSE, replay, sessions, authorization, limits, observability, Node HTTP and Express adapters.                                  |
| `tiny-mcp-client`                 | `tiny-mcp-client-rust`                 | Client lifecycle, JSON-RPC, stdio and HTTP transports, subscriptions, sampling, elicitation, roots, OAuth discovery, and test pairs.                                          |
| `mcp-oauth`                       | `mcp-oauth-rust`                       | Client authorization, PKCE, loopback flow, token refresh, metadata handling, resource indicators, session storage, and JWKS verification.                                     |
| `mcp-oauth-server`                | `mcp-oauth-server-rust`                | Authorization server, signing, grants, one-use codes, refresh-token rotation, revocation, interaction security, and storage contracts.                                        |
| `agent-mcp-config`                | `agent-mcp-config-rust`                | Agent configuration shapes and parsed JSON/TOML/YAML mutations; depends on agent definitions and config-mutation infrastructure. This is configuration, not a wire transport. |
| `tiny-stdio-mcp-test-server`      | `tiny-stdio-mcp-test-server-rust`      | Deterministic stdio fixture and tool-call recording.                                                                                                                          |
| `tiny-http-mcp-oauth-test-server` | `tiny-http-mcp-oauth-test-server-rust` | Combined MCP/OAuth fixture; also depends on `tiny-oauth-test-server`, which is not itself MCP-named.                                                                          |
| `terminal-png-mcp`                | `terminal-png-mcp-rust`                | Application server for terminal PNG rendering; implementation currently delegates to `terminal-png`.                                                                          |
| `terminal-pilot-mcp`              | `terminal-pilot-mcp-rust`              | Application server built from Toolcraft commands and `terminal-pilot`; actual work includes PTYs, terminal state, processes, and rendering.                                   |

MCP also appears inside other packages. `toolcraft` has server and proxy adapters;
`memory` and `superintendent` expose application servers; `poe-agent` and `safe-js`
consume the client. Other adapters, including `agent-code-review`, require separate
application-level assessment. They are recorded as integration surfaces and remain
unchanged during the independent library work. An inventory of MCP-named packages
is not a claim that every MCP-related application in the repository has been ported.

The two terminal application servers are small wrappers, not small self-contained
Rust rewrites. A binding that delegates their work to the existing TypeScript
implementation does not constitute a native Rust version. Track the rendering and
terminal-runtime prerequisites explicitly before claiming those ports complete.

## Supporting design-system rewrite

The core stdio and HTTP MCP packages inspected here do not import the design
system directly. `terminal-pilot-mcp` builds commands through `toolcraft` and runs
them through `toolcraft/mcp`; Toolcraft's CLI and MCP proxy use `toolcraft-design`.
That creates an application/presentation dependency, not a reason to couple the
Rust wire-protocol engine to terminal UI.

`toolcraft-design` includes tokens/themes, ANSI styling, Unicode-aware layout,
help and tables, Markdown, prompts, dashboards, explorers, and terminal screen
handling. Its current runtime dependencies include `fast-string-width`,
`fast-wrap-ansi`, `sisteransi`, and the frontmatter package. A zero-dependency Rust
counterpart needs its own behavior for the features it exports; importing the
existing TypeScript design package or its dependencies at runtime is not a port.

Add `packages/toolcraft-design-rust` if needed, with the same separation between
the Rust library and its Node binding as the MCP packages. Port the required
capabilities in dependency order:

1. Tokens, themes, terminal-text escaping, ANSI styling and control sequences.
2. Display width, ANSI-aware wrapping, columns, help, static tables/cards, and
   deterministic renderers required by native consumers.
3. Markdown and template rendering when used by those consumers.
4. Prompts, spinners, screen state, dashboards, and explorers when a native
   interactive application actually needs them.

Preserve current appearance and public behavior. Use existing TypeScript output
as a development-time reference. Test narrow widths, ANSI resets, terminal-text
escaping, combining marks, wide characters, emoji, color-disabled output,
non-interactive output, input cancellation, and restoration after shutdown.
Keep theme/output settings scoped to each binding environment; the reusable
Rust core must not acquire process-global JS state.

Expose implemented features precisely. A partial static-rendering port is not
full dashboard/prompt parity. Add ad hoc screenshots of native demo output for
visual changes; do not add screenshot tests or switch the production CLI to
exercise the new design package. Generate design documentation when an actual
visual-language change warrants it, preserving existing generation routes.

Own supporting Rust libraries such as schema, configuration, terminal rendering,
frontmatter, or PTY counterparts are in scope when needed by a port. Give them
the `-rust` suffix and the same additive and dependency rules. Design-system
work does not by itself replace `terminal-png`'s SVG/PNG/font backend or
`terminal-pilot`'s terminal/PTY runtime; assess those implementations separately.

## Architecture

For each substantive library, put the reusable Rust core and its Node binding
in separate Cargo packages. A possible npm workspace layout is:

```text
packages/tiny-mcp-client-rust/
  package.json
  README.md
  Cargo.toml                 # reusable Rust library
  src/                       # Rust implementation
  bindings/node/
    Cargo.toml               # cdylib, napi + napi-derive
    build.rs
    src/
  node/                      # TypeScript host adapters and public API
  dist/                      # generated loader, declarations, native artifact
```

Preserve the dependency direction: HTTP uses the server core; fixtures use the
real client/server/OAuth cores. Share protocol models and implementation utilities
where they have actual consumers; avoid a new generic framework or a binding crate
that also owns application logic.

Keep the core independent of `napi`, PyO3, JavaScript values, Python objects,
terminal presentation, and poe-code-specific configuration. Rust callers use Rust
types directly. Node callers use the generated native exports and a small adapter
that implements JavaScript-specific behavior. Public generic schema inference can
remain in TypeScript; generated declarations alone do not reproduce that API.

Each addon owns the Rust objects it exposes. Do not exchange opaque class instances
between independently built `.node` modules without a deliberately designed ownership
contract. Reuse Rust crates at compile time; share ordinary descriptors at a binding
boundary. HTTP can own its complete server dependency graph inside its addon.

Python would add a separate `bindings/python` crate using PyO3, built into wheels
with maturin. Both bindings call the same Rust core; the Python package does not
route through Node. Async Python support needs an explicit asyncio/Rust-runtime
adapter, and eligible Rust computation should release the GIL.

## Upstream and toolchain findings

The official Rust MCP SDK, `rmcp`, is a useful conformance reference, not an
implementation dependency under the zero-dependency requirement. Its upstream
README and model source explicitly include `2026-07-28` as well as earlier
versions. Its client supports initialize, discovery, and automatic fallback
lifecycles. Use it and the official TypeScript SDK for development-time
cross-checking while retaining our own implementation.

Registry metadata at investigation time reports `rmcp` 3.4.0, `napi` 3.12.6,
`napi-derive` 3.6.7, and `napi-build` 2.4.3, with Rust 1.88 as their minimum
reported Rust version. `@napi-rs/cli` reports version 3.10.4 and requires Node
`^20.17.0 || ^22.13.0 || >=23.5.0` to run its tooling. Compiler/tooling requirements
are distinct from the Node versions supported by the finished addon.

The inspected machine has Rust 1.98.1 and Node 22.23.2. No toolchain installation
is needed to begin a local prototype. Inspection of the published `rmcp` 3.4.0
crate archive confirms the same protocol-version constants and the required
transport feature declarations. Actual lifecycle and behavior parity still need
contract tests; exported constants and upstream documentation do not prove it.
These findings characterize a possible test oracle, not permission to link it
into the shipped implementation.

## Compatibility work

- Preserve both legacy lifecycle and the repository's `2026-07-28` discovery,
  request metadata, cache metadata, input-required responses, subscriptions,
  parameter headers, and output-schema behavior. Merely supporting tool calls
  is not package parity.
- Test JSON-RPC string and numeric IDs, notification semantics, error codes and
  data, malformed messages, and result metadata. Arbitrary extension metadata
  should survive conversion.
- Match schema compilation timing, nullability normalization, structured results,
  and validation issues. Current server code uses `toolcraft-schema`'s
  `compileJsonSchema` and `formatIssues`; its README's Ajv descriptions are not
  the authority for current error behavior. A Rust validator needs contract tests
  rather than an assumption of identical diagnostics.
- JS tool, resource, prompt, sampling, roots, elicitation, storage, and verifier
  callbacks may return promises. Invoke them on the owning JS thread through
  appropriate thread-safe binding mechanisms; propagate exceptions as operation
  errors. Never synchronously wait on the JS thread or hold a core lock while
  calling into application code.
- Translate `AbortSignal` into native cancellation with deterministic listener
  cleanup and request settlement. Async execution alone does not provide this.
- Custom `fetch`, `spawn`, streams, transports, `Request`/`Response`, `URL`,
  `KeyObject`, `Date`, and Node HTTP objects require host adapters. They are not
  automatically equivalent to a Rust struct with similar fields.
- Preserve the Node HTTP/Express path as an adapter over native protocol/session
  logic. A native TCP listener cannot manufacture a real Node `IncomingMessage`
  or `ServerResponse`; expose a native listener separately and document its context
  differences instead of pretending it is interchangeable with that adapter.
- Match SSE framing across chunk boundaries, UTF-8 rejection, byte limits, reconnect
  cursors, response-body ownership, session deletion, redirects, and auth headers.
- OAuth ports need storage atomicity, token replay behavior, issuer/audience/resource
  checks, algorithm restrictions, JWKS limits, and cancellation tests. Use existing
  tests as evidence of contracts rather than replacing security behavior with a
  generic token library's defaults.
- Configuration ports parse documents and deep merge them. Preserve unrelated keys,
  dry-run behavior, observers, and injectable filesystem support. Agent metadata
  stays declarative and derives from maintained definitions instead of becoming a
  second hand-maintained registry in Rust.

## Performance, memory, and stability

A stdio checkpoint on Node 22.23.2 used separate processes, release addons,
in-memory Node streams, one sequential legacy request at a time, 1,000 warmups,
and five batches of 20,000 requests. The same host loop serialized requests,
parsed responses, and checked successful echo text in both implementations.
The tool schema was only `{ type: "object" }`; this is not a schema-enforcement
benchmark or proof of full behavioral parity.

| Workload | TypeScript median | Rust median | TypeScript RSS after GC | Rust RSS after GC |
| --- | --- | --- | --- | --- |
| Ping | 6.09 µs | 6.06 µs | 89.50 MiB | 82.23 MiB |
| JavaScript echo, initial wire path | 8.30 µs | 15.75 µs | 87.50 MiB | 102.95 MiB |
| JavaScript echo, lazy primitive copying | 8.30 µs (same reference run) | 13.04 µs | 87.50 MiB | 103.56 MiB |

Primitive copying now avoids looking up object descriptors/prototypes for scalar
values, with a failing-then-passing native regression test. The rerun is consistent
with less conversion overhead, but does not establish a durable speedup by itself.
Rust remains slower for this callback workload. Echo retained heap after GC was
about 369 KiB for TypeScript and 301 KiB for the optimized Rust run. Endpoint RSS
is neither peak memory nor leak evidence, and it did not improve for Rust echo.
These results supersede any general inference of lower memory from the first
in-memory callback measurement below. Investigate meaningful batching and fewer
native crossings after completing protocol/schema parity.

Native bindings remove the extra process and JSON-over-stdio boundary between the
SDK and engine. MCP's own network or stdio transport remains, of course. Core state,
framing, validation, scheduling, and native transports stay in Rust. Transfer complete
operations or meaningful events, not every internal step; avoid repeated stringify/parse
and full-history conversion. JSON-like values still need conversion at language boundaries.

Rust can improve CPU time and allocation behavior, especially compared with Python
loops over many objects. It does not reduce model response times or make external
tools execute faster. TypeScript and Python execute the same native core; differences
come from adapters, conversions, callbacks, and their host runtimes. No speedup claim
is established by this investigation.

Lower memory is possible, not automatic. The Node or Python runtime remains loaded.
Keep one authoritative copy of state, bound queues and retained histories, and release
native resources explicitly. Use buffers where their ownership model actually avoids
copies. Native buffers and allocations may not be reflected accurately by host heap
metrics, so measure process RSS and native allocations as well as language heap use.

Safe Rust prevents many memory-safety and data-race errors. Binding libraries still
contain unsafe boundaries, and a fatal native failure can terminate the host process.
Exercise callback lifetimes, reentrancy, concurrent close/cancel, worker environments,
and shutdown. Never store environment-specific JS handles in process-global core
state. Deterministic close/dispose is the primary cleanup mechanism; finalization is
a fallback. Python adds reference/GIL and interpreter-lifetime considerations.

Benchmarks compare equal behavior using deterministic workloads: JSON-RPC parsing,
schema validation, in-memory dispatch, concurrent requests, notifications, large
content, sustained session churn, and cancellation/cleanup. Measure throughput,
latency distribution, event-loop responsiveness, peak and steady RSS, and retained
memory after close. Separate callback-heavy cases from native tool cases. Repeated
sessions should plateau in retained memory. Real model calls cannot isolate engine
performance and are not benchmark or unit-test dependencies.

The first callback-heavy checkpoint measurement used separate Node 22.23.2
processes, release addons, 1,000 warmup calls, five batches of 20,000 legacy echo
calls, and explicit GC before and after. Median time per call was 5.14 µs for
TypeScript and 15.09 µs for Rust. Final RSS was 83.31 MiB and 65.72 MiB,
respectively; retained JS heap changes were about 132 and 135 KiB. This synthetic
measurement establishes a regression to address, not a general speed or memory
guarantee. Prioritize parsing wire messages once in Rust, reducing boundary
crossings, and measuring equivalent schema-heavy and native-tool workloads before
choosing production defaults. Repeat memory measurements over sustained session
churn and cancellation; a single RSS endpoint does not establish leak freedom.

## Implementation sequence and acceptance

1. Establish the package/Cargo layout and independent build path. Pin binding/tooling
   dependencies and write failing contract tests using the existing implementation
   and official SDKs as development-only oracles. Implement our own protocol core.
   First deliverable: an actual native server addon with an async JavaScript
   echo tool, in-memory transport, cancellation, and deterministic disposal.
2. Complete `tiny-stdio-mcp-server-rust` and its stdio fixture. Cover legacy and modern
   protocol, schemas, content, resources, prompts, and subscriptions.
3. Implement `tiny-mcp-client-rust` lifecycle, in-memory/stdio/HTTP transports and
   server-to-client callbacks. Treat OAuth support as incomplete until the OAuth port
   is connected inside the Rust package family.
4. Implement `tiny-http-mcp-server-rust` using the shared native server core, including
   HTTP/SSE lifecycle, sessions, limits, and separate Node/Express adapters.
5. Implement both OAuth packages and the combined HTTP/OAuth fixture. Complete client
   OAuth parity and test both native and application-supplied storage paths.
6. Implement `@poe-code/agent-mcp-config-rust` against explicit mutation/filesystem and
   registry contracts; do not silently expand into a rewrite of all configuration
   and provider packages.
7. Add the supporting Rust counterparts needed by terminal applications, including
   the required `toolcraft-design-rust` capabilities, and implement the terminal
   application ports against their real native prerequisites. Record any remaining
   embedded MCP application ports separately.

Use TDD for code: first a failing behavior test, then the native implementation.
Pure Rust tests use in-memory state and injected I/O/clock dependencies. Node file
mutation tests use memfs; neither suite creates real files for unit fixtures. Verify
the actual addon, async callbacks, errors, cancellation, and worker lifetimes rather
than testing only a mock binding. Cross-test old client/new server and new client/old
server, plus the official SDK, without changing production imports.

Give each new npm package maintained `build` and `test:unit` scripts so the declared
workspace routes discover its Rust and binding checks. Focused builds use the existing
`build:workspaces -- --workspace=<exact-name>` route. Cargo dependency relationships
must also be reflected in maintained npm build closure where necessary. Future
workflow changes use `npm run lint:workflows`, not workflow unit tests.

Keep packages private during development. Build and test real native artifacts before
designing publication. Later distribution needs explicit OS/architecture/libc coverage,
native loading errors, tarball checks, generated declarations, and a supported Node
baseline. Existing MCP releases build on Ubuntu and do not establish a Rust addon
release matrix. Rust binaries stay external to JavaScript bundlers; existing SafeFS
native packaging is specialized and is not automatic support for arbitrary addons.
Check packed manifests and installed artifacts for the zero-dependency contract,
including installation with optional dependencies omitted and install scripts disabled.

No production integration or publication is part of the independent-port milestone.
Completion means behavior and native artifacts are verified, not that directories
with `-rust` names exist. Python wheels can be a later milestone using the proven core.

## Sources

- Repository: `packages/tiny-stdio-mcp-server/src/server.ts`, `src/protocol.ts`, and
  `src/index.ts`; `packages/tiny-mcp-client/src/internal.ts`, `src/index.ts`, and
  `scripts/build.mjs`; `packages/tiny-http-mcp-server/src/http-server.ts`,
  `src/http-transport.ts`, and `src/express-middleware.ts`.
- Repository: the ten package manifests and tests; `packages/mcp-oauth-server/src/index.ts`;
  `packages/agent-mcp-config/src/apply.ts`; terminal MCP entry points;
  `packages/toolcraft-design/package.json`, `src/index.ts`, and its rendering modules;
  `scripts/build-workspaces.mjs`; MCP release workflows;
  `docs/development/NPM_PUBLISHING.md`.
- [Official Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk), including
  its README, `crates/rmcp/src/model.rs`, and Cargo manifest.
- [napi-rs async functions](https://napi.rs/docs/concepts/async-fn),
  [thread-safe functions](https://napi.rs/docs/concepts/threadsafe-function), and
  [build tooling](https://napi.rs/docs/cli/build).
- Registry metadata from crates.io for `rmcp`, `napi`, `napi-derive`, and `napi-build`,
  and npm metadata for `@napi-rs/cli`. Version observations are date-specific.
