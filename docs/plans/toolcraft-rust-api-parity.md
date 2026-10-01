# Toolcraft Rust replacement

## Contract and release boundary

Add `packages/toolcraft-rust` alongside `toolcraft`. Keep JavaScript consumers on
the existing package until every gate below passes. The final replacement must
preserve every public import path, export, overload, inferred type, property
descriptor, callback order, stream lifecycle, error class/message and observable
CLI/HTTP/MCP behavior. An additive checkpoint is not replacement readiness.

Rust owns policy, transformations and state machines. Node adapters retain host
objects (functions, promises, errors, streams, AbortSignals, filesystem/fetch
capabilities), and implement Node/ECMAScript operations whose identity or runtime
semantics are part of the contract. No adapter may import the JavaScript
implementation at runtime. Reference imports are allowed only in tests.

## Implementation sequence

1. Port runtime support: typo matching, requirement validation, errors, diagnostic
   filtering, redaction, metadata, source snippets and MCP result shaping. Use
   UTF-16 at native boundaries; Rust Unicode scalar strings alone lose lone
   surrogates and change JavaScript edit distances.
2. Port command/group/stream definitions, metadata inheritance, cloning, scope,
   defaults, secret resolution and human-in-loop configuration. Keep opaque
   schemas and callbacks in the Node heap. Verify cross-bundle symbol behavior.
3. Complete `toolcraft-schema-rust`: fluent DSL, Standard Schema, JSON conversion,
   custom callbacks, arbitrary host values and existing compiler compatibility.
   Close its documented regex, URI and non-JSON gaps before claiming parity.
4. Port invocation/runtime, SDK casing and inference, validation, services,
   approval tracking, managed streams and cancellation. Run the existing SDK
   and compile-check suites against native exports.
5. Port CLI parsing, prompting, help, validation presentation and renderers.
   Complete the required `toolcraft-design-rust` and task/human-in-loop dependency
   surfaces; compare terminal screenshots at fixed dimensions and themes.
6. Port MCP, proxy discovery, HTTP, hosted OAuth and testing helpers using the
   corresponding Rust transport, protocol, OAuth and configuration dependencies.
   Verify errors, wire data, injected transports, cancellation and shutdown.
7. Qualify all subpath reexports, composition inventory, standalone packaging,
   platform-native distribution and the opt-in alias swap. Only then change
   the default implementation in a separately reviewed change.

## Complete export and dependency inventory

The authoritative inventory is `packages/toolcraft/package.json` plus its
`src/index.ts` and each exported module. Expand wildcard exports to all matching
modules; do not treat a matching export name as behavior parity.

| Public surface                                                                   | Rust destination/dependencies                                            | Gate                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `.`                                                                              | toolcraft-rust core, schema, design, user errors                         | All definition, clone, inheritance, error and compile-check suites          |
| `./cli`                                                                          | core, design, task list, human-in-loop                                   | CLI suites, help/interactive screenshots, no-prompt args                    |
| `./sdk`                                                                          | core, schema, runtime, approvals                                         | SDK suites and published inferred types                                     |
| `./schema`                                                                       | toolcraft-schema-rust                                                    | Complete DSL/compiler/reference suite                                       |
| `./mcp`, `./mcp-proxy`                                                           | mcp-protocol-rust, tiny-stdio-mcp-server-rust, tiny-mcp-client-rust      | Native transport and in-memory reference suites                             |
| `./http`, `./http/hosted-oauth`                                                  | tiny-http-mcp-server-rust, mcp-oauth-server-rust, mcp-oauth-rust         | HTTP/OAuth integration and injection suites                                 |
| `./human-in-loop`                                                                | agent-human-in-loop (Rust implementation still required), task-list-rust | Sync/async approval, cancellation, replay                                   |
| `./design`, `./design/*`, `./design/render-markdown-plaintext`, `./file-changes` | toolcraft-design-rust                                                    | Every concrete subpath, reference suites and screenshots                    |
| `./agent-defs`                                                                   | agent-defs-rust                                                          | Export/type and behavior parity                                             |
| `./agent-mcp-config`                                                             | agent-mcp-config-rust, config-mutations-rust                             | Config formats, deep merges, injected filesystem                            |
| `./auth-store`                                                                   | auth-store-rust                                                          | Storage/provider and type parity                                            |
| `./config-mutations`                                                             | config-mutations-rust                                                    | Parsers, file edits and error parity                                        |
| `./frontmatter`                                                                  | frontmatter-rust                                                         | Parser/serializer parity                                                    |
| `./process-runner`                                                               | process-runner-rust                                                      | Spawn, injection, streams, cancellation                                     |
| `./tiny-mcp-client`                                                              | tiny-mcp-client-rust                                                     | Transport/auth/lifecycle parity                                             |
| `./safe-bash`                                                                    | existing injected safe-bash capability                                   | Same command/schema capabilities; assess any runtime dependency before swap |
| `./source-snippet`                                                               | toolcraft-rust, toolcraft-design-rust                                     | Locations, text and diagnostics                                             |
| `./testing`                                                                      | toolcraft-rust test hosts, Rust transport test servers                   | Existing testing API and lifecycle suites                                   |
| `./composition`                                                                  | deterministic native package inventory                                   | Exact shipped dependency/license inventory                                  |

Existing Rust packages are candidates, not evidence of completed dependency
parity. Audit their README limitations, public declarations and runtime imports.
Replace remaining npm algorithms (including parser, schema, layout and transport
dependencies) with Rust equivalents while keeping host compatibility adapters.

## Verification and swap gates

- TDD: establish a failing native or reference test before each behavior port.
  Differential tests must compare reference and native outputs, descriptors,
  identity-sensitive callbacks, errors and side effects, including adversarial
  Unicode, special member names, null/undefined, cycles and sparse arrays.
- Run original tests against native module resolution without copying assertions
  or silently falling back to the reference implementation. Track unported
  suites explicitly until the entire maintained suite runs.
- Type-check identical consumers against both packages, including all current
  compile-check fixtures. Published declarations must be standalone.
- Verify installed tarballs outside the monorepo and without JS implementation
  packages. Exercise every export, required native platform, and callback/worker
  lifetime. CI must run native tests and package checks.
- Confirm default behavior stays on JS during additive work. Qualify a package
  alias replacement with the original application and transport suites before
  authorizing a default swap.
- Report local commits, remote-main verification and published releases
  separately. Record confirmed safe-bash bugs in the project issue tracker.

## Current state

The JavaScript implementation remains authoritative. Existing Rust dependencies
include schema, design, transports, protocol, config and process packages, but
their availability does not establish complete parity. The first Toolcraft
checkpoint implements suggestions, diagnostics, HTTP/user errors, command
requirements and secret resolution. Rust unit tests, native differential tests,
the original suggestion/logging suites and declaration checks cover these
surfaces. Command/group/stream definitions, cloning, default selection, source
locations and metadata inheritance now have a native policy layer with Node
identity adapters. Original Toolcraft and clone suites exercise native definitions
through the existing SDK/MCP consumers; those consumers remain JavaScript.
Requirement/secret signatures now use the complete command contracts.
Redaction has native name/header policies and object traversal, with Node host
operations for JSON parsing, array mapping and serializer calls. Differential
coverage includes cycles, repeated references, sparse arrays, subclasses,
custom methods, getters, serializer keys/receivers and thrown-value identity.
Package metadata lookup now uses a native search algorithm with injected Node
filesystem/path capabilities. The original lookup suite and in-memory differential
tests cover symlinks, fallback directories, malformed packages and exception identity.
MCP result marking and recognition now use native validation with Node property,
spread and symbol operations. Original MCP-result tests run with native definitions
and markers through the JavaScript SDK/MCP consumers; differential tests cover
getters, inherited properties, cross-realm arrays, descriptors and arbitrary throws.
The SDK/MCP consumers themselves still require porting.
The `./source-snippet` subpath now has a Rust window/rendering core with native
design styling. The original renderer tests and differential coverage exercise
line endings, UTF-16, numeric edge cases, changing accessors, styling scopes and
exception identity. Its subpath declaration is included in build and type checks.

The schema dependency now has native `cloneDefaultValue` and `isJsonValue`
traversals with host identity, descriptor and enumeration operations. Differential
coverage checks cycles, aliasing, sparse slots, prototype/serialization guards,
budgets, getter/proxy order, deep graphs and arbitrary thrown values. The original
default-isolation and JSON-safety suites run against the native public entry point.
DSL validation now also has a Rust continuation engine for every descriptor kind,
default mode, union branch policy and diagnostic path. JSON constraint comparison
uses iterative native traversal, preserving caller-supplied array methods and
callback results. Original top-level schema suites run with the native validator,
builders, conversion and Standard Schema adapters. Runtime code never imports
the reference package.
Differential checks include getter order, missing/undefined, resource defaults,
native callback issues, reentrancy, iterator closing, cycles and deep/wide inputs.
The portable 16,384-depth recursion guard preserves RangeError classification but
does not reproduce engine-specific stack-exhaustion thresholds; qualify that
resource boundary before a swap.

Descriptor construction and JSON Schema conversion now have Rust policy engines.
The Node adapters retain spread/assignment behavior, symbol identity, getters,
custom array methods and Standard Schema closures. Differential checks cover
constructor diagnostics, required-key set collisions, sparse branch arrays,
custom map results, option enumeration, native documents, exception identity and
cyclic/deep conversion. Synchronous union-map conversion callbacks have a separate
128-entry reentrancy guard, also requiring resource-boundary qualification.
All 18 selected original top-level schema suites run through the native public
entry point. The compiler-internal suites and property projection remain pending.
Schema declarations are standalone, and all six original compile-check fixtures
resolve to the built native declarations with a guard against fallback imports.
Installed-tarball and complete compiler compatibility gates remain open.

The remaining sequence is still required. Definition declarations currently
import existing schema/design/config contract types. Standalone type packaging
must be finished before a swap. Direct higher-order assignment of the generic
stream factories also needs shared contract identity: independent recursive
declarations make TypeScript infer the stream context as services during that
assignment, although matching generic instantiations and inferred SDK consumers
pass. Do not treat those narrower checks as proof of full factory interchangeability.
