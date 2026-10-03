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

Do not add external runtime or development dependencies. Comparison tools may
be installed temporarily, then uninstalled; do not retain new dependency
declarations or lockfile entries for them.
Own Rust workspace packages are allowed; benchmark them to guide performance
work and integration decisions.

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
| `./human-in-loop`                                                                | agent-human-in-loop-rust, task-list-rust | Sync/async approval, cancellation, replay                                   |
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
All original schema test files now run through native module resolution, including
the compiler's index, custom-format and nullability suites and the original
external JSON Schema fixture harness. The config discovers the original test
tree instead of maintaining an allow-list. Its package script uses the original
suite's repository-root working directory. The duplicate native fixture runner
has been removed; the same canonical cases run through the original assertions.
The current 23 files contain 2,634 passing tests. This proves the maintained-suite
gate, not parity beyond its assertions or the other replacement gates.
Schema declarations are standalone, and all six original compile-check fixtures
resolve to the built native declarations with a guard against fallback imports.
Installed-tarball and complete compiler compatibility gates remain open.

Property projection now walks the native reference graph to collect declarations,
derive unconditional required flags and reconstruct independent annotation copies.
Each candidate validator evaluates every declaration with fresh evaluation state,
retaining the original graph's reference context and callback order. All ten
original projection tests run through the native entry point. Differential tests
cover recursive references, draft-7 siblings, snapshot getters, annotation isolation,
special keys, callback reentrancy and diagnostics. The compiler bridge now preserves
arbitrary format-callback throws, including null, undefined and symbols. Every
current runtime schema export is present; that export inventory does not prove
complete compiler semantics. Projection resource budgets and the existing compiler
ingress/pattern/URI limitations still require replacement qualification.

Native compilation errors now retain a rejected pattern's UTF-16 source. The
Node adapter uses it to reproduce engine-specific SyntaxError class and wording
after native rejection, including lone-surrogate diagnostics. Successful matching
remains native, and valid unsupported features keep explicit capability errors.
This diagnostic adapter is an intentional host dependency; it is not a claim of
complete independent ECMAScript pattern grammar coverage.

Managed streams now expose the root `createManagedStream` export with a native
continuation engine for startup, pulls, validation, completion and cancellation.
The Node adapter retains promises and iterator handles; native schema validation
checks events while the original untransformed event value remains observable.
Both original stream suites run against the native implementation. Differential
coverage checks arbitrary throws, cleanup precedence, distinct validation errors,
getter order, callback receivers, microtask timing, reentrant cancellation,
concurrent completion and exceptional listener removal. Managed-stream declarations
pass bidirectional generic assignment and inferred event checks. SDK/MCP consumers
in the reference suites now use native streams, but those consumers remain JavaScript.

Scope projection now uses a Rust traversal for optional promotion, field pruning,
empty-branch policy and original-schema association. Node retains property access,
object spreads, WeakMap identity and custom `flatMap`/`includes` operations. The
original scope and exhausted-scope suites run through native projections, including
SDK/MCP commands and streams; the consumers themselves remain JavaScript. Native
differential tests cover getter order, changing shapes, sparse/custom branch arrays,
retained callbacks and arbitrary throws. Wrapper chains use an explicit work stack
bounded at 16,384 levels; synchronous map callback nesting is guarded at 128 native
entries. Both produce catchable RangeErrors rather than native stack aborts. These
thresholds do not claim equivalence to engine-dependent stack limits and remain
part of resource qualification. The current Toolcraft checkpoint passes 390
reference/parity tests, 40 native Node tests, Rust tests and declaration checks.

The root schema exports and `./schema` subpath now forward to the native schema
dependency. The public subpath export set matches Toolcraft exactly; native
definitions and streams compose with its builders, conversion and Standard Schema
adapters. The reference definition entry now uses native builders too. This
facade intentionally retains the existing schema declaration contract, like the
command declarations: separately branded recursive generic declarations are not
interchangeable when assigning the entire API. The facade passes bidirectional
generic namespace assignment; removing its type-only dependency remains part of
standalone Toolcraft packaging. This does not change the native schema package's
independent declarations or close its compiler/resource qualification gates.
With native builders enabled, the checkpoint passes 390 reference/parity tests
and 42 native Node tests, plus Rust, declarations, lint and the maintained build.

Schema member collision validation now runs in Rust, including discriminator
aliases, optional propagation and independent maps for each object/union branch.
The shared synchronous host bridge preserves opaque formatter keys, getter order,
iteration and abrupt-completion cleanup. The original collision suite exercises
native validation through SDK and MCP construction; those consumers remain
JavaScript. Differential tests cover custom iterators, arbitrary throws, formatter
reentrancy and changing discriminator access. The existing 16,384-wrapper and
128-native-entry resource guards also apply here and still require replacement
qualification. The checkpoint passes 549 reference/parity tests and 49 native
Node tests, plus Rust, declaration and lint checks.

Discriminator selection and exclusive-union validation now have native policy
engines. Host operations retain own-property checks, rest-property reads, JSON
formatting, branch callback receivers and iterator cleanup. The original SDK/MCP
discriminator and union suites use the native helpers. Differential coverage adds
changing getters, prototype-like branch names, custom entries/index coercion,
first-error reporting, raw return values, reentrancy and arbitrary callback throws.
Callback nesting uses the existing 128-entry native guard and remains a resource
qualification item. The checkpoint passes 957 reference/parity tests and 56 native
Node tests, plus Rust, declaration and lint checks.

Applied-default validation now uses native policy plus the native clone and
schema validator. It checks the original schema retained by scope projection,
keeps canonical default contents and disables unused nested default insertion.
The original SDK/MCP applied-default suite runs through this path. Differential
tests verify clone isolation, invalid-value return behavior, default getter reads,
scoped fields, diagnostic receivers and arbitrary throws. Reentrant host calls
retain the existing 128-entry guard, whose resource threshold still needs
qualification. The checkpoint passes 1,311 reference/parity tests and 60 native
Node tests, plus Rust, declaration and lint checks. SDK argument normalization,
runtime assembly and invocation themselves still require porting.

SDK argument validation and key normalization now run in Rust, including canonical
schema kinds, defaults, additional properties, alias conflicts, discriminators,
unions and native JSON-schema ingress. Rust chooses UTF-16 casing boundaries;
Node supplies the caller's Unicode lowercase/uppercase behavior. Descriptor-based
optional omission preserves accessors, prototypes, sparse arrays and the existing
64-depth/10,000-node preprocessing limits. Native-schema tests construct each
implementation's private symbol through its own builder, as required by those
package contracts. Cross-bundle native-schema marker interoperability is not proven.
The test harness parses the original SDK module and substitutes native casing and
object validation while leaving assembly/invocation in JavaScript. Reference SDK,
stream, scope, branch and default suites now exercise the native argument engine
and schema dependency. Differential tests cover every schema kind, UTF-16 names,
getter/diagnostic order, arbitrary exceptions, reentrancy and cyclic wrappers.
The checkpoint passes 1,338 reference/parity tests and 68 native Node tests, plus
Rust, declarations and lint. The existing 128-entry/16,384-wrapper guards remain
unqualified for engine-specific resource parity. Runtime I/O, assembly, invocation
and public SDK exports still require porting.

Runtime service admission and approval wiring now use native policies. The
reserved-name list originates in Rust; the exported mutable Set and original
diagnostic-list snapshot retain JavaScript behavior. Gated-command traversal,
strict approval flags and missing-runtime decisions run in Rust, with Node
preserving iterator closure, changing getters and callback receivers. Filesystem
promises and environment property access remain host capabilities; injected
objects retain exact identity. Memfs checks exercise filesystem reads, writes,
encoding, stat, rename, removal and rejection behavior without writing test files.
The original runtime-I/O and SDK suites use these adapters. The checkpoint passes
1,353 reference/parity tests and 74 native Node tests, Rust, declarations and lint.
Approval providers, persistence and invocation are not yet ported. Native callback
traversals retain the 128-entry guard pending resource-limit qualification.

HTTP error recognition, summaries and structured envelopes now use Rust policies
and native redaction. REST/GraphQL precedence, header selection, optional fields,
retry hints and nested field-error flattening retain the reference behavior.
Node preserves own-property checks, getters, array iteration/mapping and thrown
identity. The original API-summary suite and differential status/body/header
matrices pass. The checkpoint passes 1,356 reference/parity tests and 77 native
Node tests, plus Rust, declarations and lint. SDK error-report persistence and
project-root discovery still require porting; this increment does not provide
the public SDK assembly/invocation or complete the approval runtime.

Error-report rendering and persistence now use native policies for schema-marked
secrets, sensitive parameter collection, argv redaction, structured error fields,
cause chains, report admission, filename timestamps/slugs and directory confinement.
Nearest project discovery runs in Rust without parsing package metadata. Node
retains report string assembly, literal string replacement, dates/UUIDs, filesystem
promises and path semantics. Persistence preserves the original mkdir, lexical
containment, concurrent realpath checks, rendering and write order. Memfs parity
checks cover exact content/paths, symlink escapes, getter order, arbitrary throws,
Unicode slugs, environment overrides and filesystem effects. The original report
suite now exercises the native implementation through SDK/CLI consumers.
The approval error adapter preserves the original class behavior. Commander is a
direct dependency solely for its shared error constructor; its parser/runtime
still requires porting. Report version lookup uses the executing package's own
metadata, so differential content tests supply the same explicit version.
The checkpoint passes 1,372 reference/parity tests and 79 native Node tests, plus
Rust, declarations and lint. Recursive callbacks retain the 128-entry guard and
optional wrappers the 16,384 guard pending resource-limit qualification. Public SDK
assembly/invocation, proxy resolution and the full approval runtime remain open.

JSON-schema conversion now routes reference discovery/resolution, recursive
projection selection, metadata and default rules, nullability, discriminators,
composition and conditional object fields through Rust. The adapter retains
JavaScript collection operations, property descriptors, schema-builder calls and
error formatting. Native schema validation remains authoritative for upstream
constraints. The original converter suite and differential nested-schema cases
verify projections, wire documents, validation, getter ordering and arbitrary
exceptions; independent native Node tests verify default identity, frozen inputs,
pointer escaping, recursive validation, prototype-named fields and custom array
iterator closing. The checkpoint
passes 1,409 reference/parity tests and 83 native Node tests, plus Rust,
declarations and lint. The converter remains internal, ready for native MCP proxy
discovery. MCP connection/cache lifecycle, SDK assembly/invocation, complete
approval runtime and deep-graph resource qualification are still required.

MCP proxy discovery now uses native policies for group collection, refresh/cache
selection, cache shape validation, pagination limits, allowlists, renames,
transactional group replacement, typed results, hot connection reuse and disposal.
The Node adapter preserves filesystem/promise sequencing, abort listeners, symbol
identity, host path/hash operations and error formatting. Upstream connections
use `tiny-mcp-client-rust` as a direct runtime dependency. The 80 original proxy
tests run through the native implementation; differential tests verify exact
side effects, tree metadata, getter order, replacement, cancellation, disposal
failures and inherited-setter handling. A native HTTP-client smoke test covers
protocol discovery fallback, initialization, tools, calls and session termination
with a mocked fetch transport. The checkpoint passes 1,493 reference/parity tests
and 86 native Node tests, plus Rust, declarations and lint. Proxy support remains
internal until public SDK assembly/invocation is ported. The full approval runtime,
CLI/transports, standalone contracts and resource-limit qualification remain open.

The public `toolcraft-rust/sdk` entrypoint now uses Rust policies for startup,
member-tree assembly, cased names, scope filtering, invocation routing, parameter
validation, typed MCP failures and deferred discovery caching/retries. Node keeps
object spread, callbacks, promises and host I/O. Original SDK consumers now import
the native adapter directly; the temporary AST substitution of SDK argument
functions has been removed. Differential coverage includes getter order, immutable
descriptors, callback receivers, arbitrary thrown values, promise settlement order,
lazy streams/secret refresh, params changed by async requirements, error-report
persistence and failure precedence, shared discovery and retry, and deferred path
errors. The original approval SDK integration suite also exercises native SDK
invocation with the existing approval runtime. The checkpoint passes 1,500
reference/parity tests and 94 native Node tests, plus Rust, declarations and lint.
SDK declarations currently borrow the original generic contract; this does not
establish standalone packaging. The full approval runtime, CLI/transports,
remaining exports and replacement qualification remain required.

Approval-plan admission, canonical traversal, cycle rejection and hash comparison
now use Rust policies. Node retains array species/methods, getter execution,
finally cleanup, JSON serialization and SHA-256. Differential tests cover sorted
accessor order, shared references, sparse/subclass arrays, arbitrary exceptions,
finite-number requirements and exact diagnostics/messages. The original plan-hash
suite and approval SDK integration now use this adapter. The checkpoint passes
1,502 reference/parity tests and 97 native Node tests, plus Rust, declarations and
lint. Canonicalization currently preserves the reference's own `__proto__`
assignment behavior, including its omission from canonical JSON; correcting that
requires a coordinated reference/native behavior change. The synchronous 128-entry
guard still needs resource-parity qualification. This does not complete the
approval task store, gate, runner, commands or provider dependency.

Approval task storage and gate invocation now use native policies. The static,
deeply frozen state-machine definition comes from Rust; list cache selection,
state/event comparisons, payload admission, optional metadata, collision retries
and missing-record handling run through the native engine. The direct runtime
dependency is `@poe-code/task-list-rust`. Node retains its filesystem promises,
error constructors, weak caches, record construction and random IDs. Gate
continuations preserve the reference's exact await boundaries, callback receivers,
getter order, cancellation checks, plan re-verification, async enqueue results
and detached runner launch. Original task/gate/spawn/state-machine and SDK
integration suites now use these adapters. Memfs differential checks cover exact
stored contents, cache behavior, invalid machines and metadata getter order.
The checkpoint passes 1,534 reference/parity tests and 104 native Node tests,
plus Rust, declarations and lint. State-machine admission currently preserves
the reference's omission of `initial` from its equality check; correcting it
requires a coordinated reference/native fix. Constructor identity across independently
loaded task-list packages still needs replacement qualification. The approval
runner, built-in commands, runtime factory and provider dependency remain open.

The queued approval runner now uses Rust continuations for task admission,
claim contention, provider decisions, stored-plan/prompt verification, execution
plan re-validation, command lookup/CLI-visible suggestions and outcome recording.
Node retains callback objects, JSON round-trips, error metadata and promises.
Differential tests exercise getter/transition order, exact promise timing,
malformed metadata, skipped states, drifted plans, non-JSON results and storage
failures in each catch region (including retrying a failed failure-write).
The 12 original runner tests exercise native execution and native task storage,
including concurrent claim contention through memfs. The checkpoint passes
1,546 reference/parity tests and 108 native Node tests, plus Rust, declarations
and lint. The approval commands, factory, platform providers and public subpath
still require porting. The complete replacement gates remain unchanged.

Approval list/show/run built-ins and the runtime factory now use Rust policies
for reserved-group admission, state-filter selection, ordered ID deduplication,
missing-task translation, provider admission and render-record traversal. Node
retains method receivers, async iteration/await boundaries, presentation callbacks
and string/JSON semantics. Differential tests cover getter order, marker descriptors,
duplicate states/tasks, missing-file catch boundaries, arbitrary thrown values,
Markdown escaping, JSON fallbacks and microtask settlement. The 11 original
approval command tests now run through native commands/factory/SDK/storage while
CLI and MCP hosts remain the reference implementations. The checkpoint passes
1,557 reference/parity tests and 113 native Node tests, Rust, declarations and
package lint. Ad hoc screenshots verify list/detail/empty rendering with the
caller's existing table primitives; this does not qualify a native table renderer.
The platform-provider dependency, full public approval subpath, CLI/transports,
standalone types and complete swap qualification remain required.

The provider dependency now has an additive `@poe-code/agent-human-in-loop-rust`
package with all three runtime exports and standalone structural declarations.
Rust owns request/result admission, response parsing, script selection, mock-result
cloning and process-error policy. Node retains process execution, promises,
callback receivers, property reads and JavaScript string operations. Its 40
reference/parity and six native tests cover exact script snapshots, line endings,
lone surrogates, inherited fields, changing getters, arbitrary exceptions and
process rejection/settlement. Rust lint and bidirectional declaration checks pass.

The public `toolcraft-rust/human-in-loop` entrypoint now exports the runtime,
provider, gate, state machine and decline error. Native platform policy preserves
lazy construction, fallback diagnostics and per-module provider caching. Original
default-provider tests run against the native adapter; public-import tests compose
the native SDK, approval runtime and task store through memfs. The checkpoint
passes 1,562 reference/parity tests and 115 native Node tests plus declarations
and package lint. Its generic declarations still borrow the reference contract.
Both implementations currently fail to infer an unannotated parameter in a
human-in-loop message callback; explicit callback parameter types work. This
shared generic limitation needs a coordinated fix, not a native-only signature.
CLI, transports, complete design dependencies, standalone Toolcraft contracts,
cross-package error identity and platform/resource qualification remain open.

The design dependency now exposes native table policies at its root,
`./render-table` and `./components/table`. Rust owns column admission/alignment,
width budgeting, own-cell selection, ANSI scanning, display-width rules,
truncation, padding and word-wrapping decisions. Node retains ICU segmentation,
array/string semantics, output templates, JSON and theme callbacks. Public subpath
exports and standalone structural table declarations match the reference in both
assignment directions. All source declarations are emitted and checked with
`skipLibCheck: false`; previously omitted declarations no longer become implicit any.
The original 46-test components suite runs native tables, text, color and logger
adapters; command-error panels and symbols in that suite remain reference code.
The checkpoint passes 126 reference tests and 44 native Node tests plus Rust,
declaration and package lint checks. Differential coverage includes Unicode/ANSI,
detail layouts, fractional budgets, changing getters, array species/sparse slots,
reentrant themes and arbitrary thrown values. An ad hoc screenshot verifies
table borders, truncation, colors and long detail wrapping. The synchronous
128-entry callback guard and host rendering work still need resource and
complete replacement qualification. Full design, CLI and transport ports remain open.

Command-not-found diagnostics now have native composition and admission policies
at the design root and `./components/command-errors`. Node retains observable
string/array methods, styling callbacks and template coercion. Getter ordering,
method receivers, immediate coercion, sparse suggestion arrays, arbitrary thrown
values and nested formatter calls agree with the reference. The original six
command-panel tests now run against native diagnostics; all 126 selected reference
tests and 47 native Node tests pass, with strict bidirectional declarations and
package lint. Ad hoc screenshots cover terminal, Markdown and JSON-mode diagnostic
strings. The host callback reentrancy guard still needs resource qualification;
help layout and the remaining design/CLI/transport surface are not yet ported.

File-change rendering now uses native policies for status styles, rename and
diff paths, summary admission, shared-prefix/suffix discovery, three-line hunk
context and diff color selection. Node retains observable arrays, Maps, string
methods, iteration and color callbacks. Differential tests cover content/newline
boundaries, lone surrogates, all change kinds, conflicts, changing getters,
species, custom split arrays, nested calls and arbitrary throws. The design
root and `./components/file-changes` expose standalone structural types and the
same function. `toolcraft-rust/file-changes` now wires native rendering to stdout,
Markdown and unchanged JSON result identity, retaining lazy option access and
the original generic renderer contract. Its root exports the corresponding types.
The design checkpoint passes 52 native and 129 reference tests; Toolcraft passes
116 native and 1,564 reference/parity tests, plus package lint and declarations.
Screenshots verify the public factory's colored status/conflict/rename output
and added/modified/deleted diff headers and lines. This retains the existing
single-hunk algorithm, not a new diff policy. The callback depth guard and full
design/CLI/transport replacement qualification remain outstanding.

The native design root and both help-formatter component subpaths now expose
rich and plain help columns, command/option lists, usage lines and structured
tokens. Rust owns ANSI/OSC scanning, the help-specific Unicode width policy,
ASCII conversion, wrapping, hanging indents, layout validation and token/list
selection. Node retains ICU segmentation, observable array/string operations,
styling callbacks and template coercion. Standalone declarations agree in both
assignment directions. Differential tests cover fractional and narrow layouts,
combining/emoji/wide glyphs, lone surrogates, incomplete controls, sparse arrays,
changing getters, receivers, nested calls and arbitrary throws; a regression
preserves plain depth-prefix coercion before name evaluation. The package passes
57 native and 162 original reference tests, declarations and package lint.
Ad hoc screenshots verify help alignment, wrapping, styles and plain/Markdown
output; the screenshot font lacks CJK glyphs, whose strings and widths are checked
by parity tests. Host callback depth/resource qualification remains outstanding.
Interactive design controls, terminal Markdown, CLI and transport ports remain open.

Catalog and resource-browser rendering now have native policies at the design
root and both component subpaths. Rust controls format selection, optional
content, tone admission, empty groups, item spacing and group composition.
Node retains observable arrays, theme receivers, string templates, spreads and
JSON serialization. Native ANSI cleanup now has a host-observable scanning path
for changing/nonprimitive values as well as the existing primitive UTF-16 path;
this preserves a catalog metric getter that changes from string to number.
Differential coverage includes getter order, receivers, sparse/species arrays,
toJSON, arbitrary throws, nested callbacks and push-before-join evaluation.
The package passes 64 native and 168 original reference tests, standalone
declarations and package lint. Packed imports verify root/component identity,
Markdown, JSON and ANSI cleanup; screenshots verify grouped terminal styling,
metadata, previews, empty hints and Markdown output. Detail/inspector cards, their wrapping dependencies,
interactive controls and terminal Markdown remain open, as do resource and
cross-package qualification for a complete replacement.

Symbols and the token namespace now expose native policy through the root,
`components/symbols`, and all six existing `tokens/*` modules. Rust owns symbol
selection, terminal glyphs and numeric spacing/width defaults. Node retains live
format scopes, theme/color property access and shared mutable object identity.
Differential tests cover both theme modes, three brands, color capability,
asynchronous format nesting, property descriptors and arbitrary theme throws.
All 67 native and 168 reference tests pass, with bidirectional standalone types
and Rust lint; the original components suite now uses native symbols too.
Screenshots verify all status marks, brand-dependent colors and Markdown/JSON
values. Detail/inspector cards, their width/wrapping dependencies, interactive
controls, terminal Markdown, CLI/transports and complete replacement qualification
remain open.

The internal `fast-string-width` replacement now runs scan order, block
accumulation and unmatched-codepoint width policy in Rust. Node retains its
Unicode RegExp tables, sticky matching, string operations, iterators and numeric
coercions. No npm runtime dependency is added. Differential checks cover Unicode
samples, emoji sequences, lone surrogates, ANSI/OSC, exact 1,000-unit block
arithmetic, custom widths, nested scans, iterator closure and thrown identity.
All 71 native and 168 reference tests, standalone declarations and package lint
pass. This internal prerequisite is not wired into cards yet; `fast-wrap-ansi`,
detail/inspector cards and the remaining replacement gates still require work.

The internal `fast-wrap-ansi` replacement now uses Rust for word/row wrapping,
whitespace decisions, escape tracking and SGR close/reopen selection, composed
with the native width policy. Node retains normalization, sticky regex execution,
string/array operations and iterator calls. Differential checks cover hard/soft
wrapping, trim modes, zero/negative/fractional widths, Unicode/surrogates, ANSI and
hyperlinks, changing options, coercion order, species and nested calls. All 74
native and 168 reference tests plus declarations and package lint pass. The
default design package is unchanged; cards still need to be wired to these
internal prerequisites, and complete replacement qualification remains open.

Detail and inspector cards now expose native composition at the design root and
both component subpaths, using the native width/wrapping prerequisites. Rust owns
section admission, prose selection, row composition and preview clipping. Node
retains themes, string/array methods, iterators and option evaluation order.
All 78 native and 173 original reference tests pass, with bidirectional standalone
declarations and package lint. Packed imports verify both public functions and
root/subpath identity without runtime dependencies. An ad hoc screenshot verifies
styled headers/badges, multiline metadata alignment, ANSI wrapping and clipped
previews. Interactive controls, terminal Markdown, CLI/transports and complete
replacement qualification remain open.

A local hot-call benchmark (Apple M5 Pro, Node 22.23.2, seven alternating-order
samples after warmup) exposes significant callback overhead. Median microseconds
per fixture invocation were JS/native: width 4.45/347.25, wrapping 22.61/2416.44,
detail 37.30/3458.08, inspector 52.38/5583.76. Width and wrapping each measured a
three-string ASCII/Unicode/ANSI cohort; card fixtures used those strings in prose,
metadata and previews. Outputs were compared before measurement. These numbers
describe this local candidate, not isolated production throughput. Reduce repeated
JS/native boundary crossings and remeasure without weakening API parity before
considering performance integration or a swap. Comparison dependencies have no
new manifest/lock declarations; the existing repository installations were used.

The width binding now retains numeric/boolean intermediates and block identifiers
in Rust instead of calling JavaScript for primitive arithmetic and comparisons.
Nonprimitive values still use the host coercion path; Math, RegExp, string and
iterator operations remain observable. IEEE arithmetic tests cover signed zero,
NaN, infinities and rounded increments. All 78 native and 173 reference tests,
standalone declarations and package lint pass without dependency changes.
A same-process comparison of the previous and new native binaries (same machine,
Node 22.23.2, 20 warmups, seven alternating-order samples, outputs checked first)
measured median microseconds per invocation as JS/previous/new: width
2.84/216.21/92.64, wrapping 18.67/1960.61/1553.16, detail
43.78/4294.67/3915.13, inspector 42.02/3856.12/3250.29. Width/wrap each use the
three-string cohort above; cards use those strings as prose/metadata or preview
and metadata, at width 48 with identity header/muted styling. Width uses 2,000
iterations per sample; the others use 100. This is a 2.33x native width speedup,
but it remains 32.6x slower than JavaScript on this local fixture. More substantial
boundary reduction and fresh measurements remain necessary for swap qualification.

ANSI wrapping now shares the primitive host representation, retaining numeric
comparisons, strict equality and increments in Rust while preserving nonnumeric
coercions and observable Math calls. The package passes 79 native and 173
reference tests, declarations and lint. With the same card/cohort fixtures and
seven alternating samples of 100 invocations, median microseconds JS/before/after
were wrapping 28.54/2104.99/1558.11, detail 57.43/4654.75/3219.31,
inspector 51.24/4164.81/3049.32. The baseline already includes the width improvement.
That gives additional native speedups of 1.35x, 1.45x and 1.37x, respectively;
these fixtures still run 54.6–59.5x slower than JavaScript. Cross-run timings vary
with shared host load; only each same-process comparison supports its speedup.

Command registries, overlay managers, live viewports and wrapped tail selection
now expose native interaction policy at the design root and matching
`command-registry`, `overlay-manager` and `viewport` subpaths. Rust controls
duplicate rejection, dispatch admission, overlay lifecycle, retention, scrollback
selection and traversal. Node retains host collections, command/signal/array
identity, methods, iterators and callbacks. Differential cases cover live command
lists, duplicate getter ordering, iterator cleanup, sparse/species arrays,
collection truthiness overrides, reentrant snapshots and aborts, arbitrary throws,
fractional/nonfinite offsets and exact method descriptors. All 87 native and 180
reference tests pass, along with bidirectional types, Rust/binding/JS lint and
isolated packed root/subpath declarations and behavior. No external dependencies
were added. Task/event groups, metrics/notices, the complete interactive controls,
dashboard/explorer, terminal Markdown, CLI/transports and replacement qualification
remain open; this checkpoint does not switch existing consumers.

Explorer text-cell fitting, centering, padding and grapheme-offset splitting now
have native policies at `explorer/render/text`. The `dashboard/terminal-width`
subpath exports the five original helpers. Existing numeric-only ingress for
terminal widths was replaced with host-aware policy after reproducing its
string/object starting-column mismatch. Rust controls code-point range order,
flag/variation selection, tab arithmetic and cell layout; Node retains ICU,
coercions, string/array methods and iterator cleanup. Tests cover fractional and
nonfinite widths, lone surrogates, changing code-point values, tab starts,
arbitrary throws and early iterator closure. All 91 native and 183 reference
tests, bidirectional declarations and package/JS lint pass. Packed exports and
standalone declarations pass without runtime dependencies. An inspected screenshot
confirms alignment, centering, clipping, tabs and combining marks. The complete
dashboard/explorer, dependent task/event/notice renderers, Markdown and the
remaining Toolcraft surfaces still require implementation and qualification.

Notices, metrics and progress groups now expose native policy at the design root
and `inline-notice`, `metric` and `progress-group` subpaths. Rust controls capacity
validation, eviction/expiry decisions, status selection, progress admission and
spark selection. Node retains host collections, clocks, spreads, numeric methods
and observable expressions. Differential coverage includes changing getters,
inherited notice levels, sparse/species arrays, nonfinite/fractional widths,
clock receivers, setter capture and reentrant finite checks. All 99 native and
189 reference tests, bidirectional declarations, package/JS lint and isolated
packed consumers pass with no new dependency declarations. An inspected screenshot
confirms markers, percentages, clipping and sparklines; the screenshot font lacks
some CJK/emoji glyphs, whose outputs are covered by string parity tests. Task/event
groups, performance monitoring, full interactive rendering and the other remaining
Toolcraft surfaces are still open. No default integration or speedup is claimed.

Grouped events now expose native retention, expansion, row-selection and rendering
policy at the root and `event-groups` subpath. Node retains Map identity, spreads,
method lookup and nested iterator cleanup. Tests cover child/group eviction,
replacement order, isolated snapshots, fractional/nonfinite windows, getter order,
reentrant toggles, captured setters, sparse/species arrays and nested early-exit
cleanup. All 105 native and 193 reference tests, bidirectional types, package/JS
lint and isolated packed consumers pass with no dependency changes. An inspected
screenshot confirms collapsed/expanded headers, error rows, clipping and scrolled
windows. Task trees, render monitoring and full interactive surfaces remain open.

Task trees now expose native hierarchy admission, cycle/capacity checks, subtree
removal, iterative viewport traversal and rendering at the root and `task-tree`
subpath. Node retains indexed collections, spreads, method capture and explicit
iterator behavior. Coverage includes reparenting/insertion order, orphan parents,
isolated snapshots, nonfinite/fractional windows, changing getters, reentrant
snapshots, sparse/species arrays and inherited-marker coercion. A separate notice
fix reproduces and corrects marker conversion occurring after the text getter.
All 115 native and 199 reference tests, bidirectional declarations, package/JS
lint and isolated packed consumers pass without dependency changes. An inspected
screenshot verifies hierarchy indentation, collapse state, status marks, durations
and clipping. Render monitoring, full interactive surfaces, Markdown and remaining
Toolcraft contracts still require implementation and qualification.

Render-performance monitoring now exposes native capacity validation, repaint
admission, hitch accounting, frame-rate bucket traversal and percentile selection
at the root and `render-performance` subpath. Node retains clocks, typed-array
operations, Math lookups, compound assignments and formatting methods. Tests cover
rolling eviction, zero/nonfinite durations, repeated getters, clock receivers,
typed-array sorting, detached methods and reentrant clock/Math/frame callbacks.
All 123 native and 205 reference tests, bidirectional declarations, package/JS lint
and isolated packed consumers pass without dependency changes. An inspected
screenshot confirms diagnostics at wide, medium and narrow widths. This port
preserves monitoring semantics and makes no performance improvement claim. Full
interactive rendering, Markdown, CLI/transports and complete swap qualification
remain open.

Static menus and spinner snapshots now expose native selection, format dispatch,
status/timer admission and immutable frame policy. Root exports, `staticRender`,
`static/index`, `static/menu`, `static/spinner`, `spinner-frames` and the matching
`render-*` subpaths share identities. Host operations retain color/theme receivers,
JSON serialization, string methods, repeated getters and sparse/species array
behavior. A custom-forEach differential case caught and fixed an unintended
callback return value before delivery. All 129 native and 218 reference tests,
bidirectional declarations, package/JS lint and isolated packed consumers pass
with no dependency changes. An inspected screenshot verifies active/inactive menu
items, hints and success/failure stopped states. The screenshot font lacks the
animated spinner glyph; its exact output is covered by string parity tests. Live
spinner/prompt lifecycle, full dashboard/explorer and terminal Markdown remain open.

The `escape-terminal-text` subpath now uses native control/directional-code-point
classification, retaining host iteration, codePointAt, numeric comparisons and
hex/padding methods. Differential coverage includes every C0/C1 control, direction
marks, surrogate halves, exotic iterables, coercion order and arbitrary throws.
All 132 native and 222 reference tests, bidirectional declarations, package/JS lint
and isolated packed consumers pass without dependency changes. An inspected
screenshot confirms visible escape sequences for terminal controls, newlines, tabs
and directional marks. Markdown parsing/rendering and live interactive surfaces
remain unported.

Plaintext rendering from `MdNode` ASTs is now available as root `renderPlaintext`,
with standalone AST/token and `PlaintextRenderOptions` declarations. Rust controls
inline/block dispatch, announcements, list/table policies, footnote selection and
separator trimming. Node retains observable collection/string methods, option
getters, coercions and iterator cleanup. The reference parser is used only to
supply test fixtures; no runtime import or claimed parser port is introduced.
All 139 native and the existing 222 routed reference tests pass, as do types,
package/JS lint and isolated packed root consumers. An inspected screenshot checks
headings, task/ordered lists, table sentences and footnote numbering. The original
plaintext suite still awaits native Markdown parsing; full Markdown entry points,
deep-recursion/resource qualification and other interactive surfaces remain open.

The internal Markdown code highlighter now has a Rust UTF-16 tokenizer for all
five families and the complete reference language/alias/keyword tables. Adjacent
tokens coalesce as source ranges before the binding materializes JS objects.
The adapter preserves supplied-token identity, repeated getters and lazy language
admission. This is an internal prerequisite, not a new public export or a claim
that HTML/Markdown parsing is complete. All 142 native tests and 237 routed
reference tests pass, including the original highlighter suite, every alias and
vocabulary, malformed strings, surrogate halves and seeded differential cases.
Package and scoped JS lint pass without dependency changes. Exotic non-string
source objects and patched string/collection intrinsics still need qualification
before the swap. A warmed five-round median benchmark (300 calls/round, 1.85–4.1k
UTF-16 units) measured native/reference ratios of 2.92x TS, 9.03x JSON, 7.49x YAML,
4.63x CSS and 5.34x HTML. This is slower, not a performance integration gate pass;
native-to-JS token materialization remains a performance concern.

Root `renderHtml(ast, options)` and standalone `HtmlRenderOptions` are now
available. Rust controls block/inline dispatch, escaping, URL scheme admission,
list/table policy, frontmatter circular detection and footnote selection. Node
retains property/method lookup, array species, JSON replacers, iterator cleanup,
coercion and arbitrary thrown values. Native highlighting is integrated for
`syntaxHighlight: true`; supplied tokens retain host array behavior. A failing
adversarial test caught truthy non-boolean membership results, fixed in the host
adapter before delivery. All 152 native tests, 237 currently routed reference
tests, bidirectional declarations, Rust/binding and JS lint, and isolated packed
runtime/types consumers pass. A Safari screenshot comparison of native and
reference output matches headings, styles, task lists, aligned tables, highlighted
code, escaped raw HTML and footnotes. The original HTML suite still depends on
unported parser/terminal entry points and is not claimed as routed. Full Markdown
subpaths, highlighter exotic-input qualification, recursion/resource limits and
interactive surfaces remain open.

The terminal Markdown renderer's internal text prerequisites are now ported:
whitespace/break tokenization, trailing-space trimming, grapheme word splitting,
wrapping with formatter callbacks and HTML-tag stripping. Rust owns token ranges,
wrapping decisions and state transitions; Node retains ICU, array methods,
formatter receivers, numeric coercions and iterator cleanup. Differential tests
load the original renderer's private functions with only import-specifier and
export adjustments, rather than copying their implementations. All 157 native
tests, the existing 237 routed reference tests, types and scoped lint pass.
The inspected terminal screenshot confirms wrapping and nested styles; its font
lacks the CJK/emoji sample glyphs, so Unicode boundaries are verified by the
differential cases. The public terminal renderer is still unported. Text
tokenization currently accepts primitive strings; exotic source objects and
modified split/collection intrinsics remain an explicit qualification gap.

The internal terminal Markdown inline collector now uses native policy for
nested formatting, inline code, autolink detection, link suffixes, image
placeholders, HTML text and footnote admission/numbering. Host adapters preserve
getter order, formatter receivers and nested iterator cleanup. Tests share a
reference-loader utility that changes imports/exports only. All 161 native tests,
237 routed reference tests, types and lint pass; a terminal screenshot verifies
bold/italic/struck text, accented code/links, image placeholders and footnotes.
These helpers are internal; complete terminal block/table rendering and the
public `render`/Markdown-string entry points still require implementation.

Root terminal `render(ast, options)` and standalone `RenderOptions` are now
available. Rust controls AST dispatch, width admission, heading/alert/code styles,
list and block separation, grid/stacked table selection and alignment, frontmatter
and expanding footnote output. The HTML frontmatter value/circular policy is
shared internally. Host adapters preserve theme method receivers and lazy lookup,
array species, numeric built-ins, property/coercion order and thrown identity.
All 170 native tests, 237 currently routed reference tests, types, Rust/binding
and scoped JS lint, and isolated packed runtime/declaration consumers pass.
Forced-color wide/narrow screenshot fixtures are byte-equal to the original
renderer and visually checked, including stacked tables, alerts, styled code and
footnotes. Original code lines remain unwrapped, including when longer than the
border. The original terminal Markdown suite still requires the unported parser
and is not counted as routed. All three AST renderers are now present; parsing,
Markdown string wrappers/subpaths, exotic text/intrinsic qualification and
deep-recursion/resource/platform gates remain required.

The Markdown parser's lexical prerequisites now have an own Rust UTF-16 core:
code spans, bracketed labels, escaped link destinations/titles, angle and literal
autolinks, inline HTML, escape decoding and byte-offset maps. Differential tests
expose the reference's original private scanners without copying their algorithms,
cover every admitted HTML tag, malformed attributes, URL/email boundaries,
surrogate halves, fractional/large offsets and seeded malformed input. Literal
autolink trailing-bracket accounting scans once instead of rescanning each suffix.
All 175 native tests, 237 currently routed reference tests, declarations and scoped
lint pass with no dependency changes. These are internal primitives, not a public
parser or completed Markdown subpath; AST assembly, delimiter matching, footnote
membership, source-range descriptors and block parsing remain required.

Inline delimiter admission and pairing now also live in Rust, including flanking,
underscore restrictions, strike minimums, mutable run lengths, the multiple-of-
three rule, trapped-delimiter pruning and ordered pair identity. The admission
primitive accepts character-class flags from its caller so runtime Unicode
classification remains a host responsibility. Tests compare original helpers
against every two-run combination of markers/flags/lengths, adjacent positions,
nested real syntax and 700 seeded delimiter graphs. All 178 native tests, 237
routed reference tests, declarations and scoped lint pass without dependency
changes. AST assembly and the actual inline/block parser adapters remain open;
these internal native functions do not make `parseInline` publicly available.

The internal `parseInline` adapter now assembles and normalizes the Markdown AST
with the native scanners and matcher, including nested link labels, images,
footnotes and hard breaks. Rust owns grammar, tree construction and normalization;
the JS host retains its runtime's Unicode whitespace/punctuation classification,
offset-map getters/slicing, range merging and footnote callback receivers/errors.
Ranges preserve their non-enumerable, writable, configurable descriptors. A failing
adversarial case caught nullish custom slice results; nested labels now rebuild
default offsets as the reference does. All 183 native tests, 237 currently routed
reference tests, declarations, Rust/binding/JS lint and isolated packed runtime
checks pass without dependency changes. Wide/narrow forced-color screenshots were
inspected and their terminal output is byte-equal to the reference. Seeded syntax,
surrogate halves, sparse/nonmonotonic/NaN maps and thrown-value identity are covered.
Native and reentrant host traversal have a 128-frame guard and recover after
RangeError. That limit differs from the engine-dependent reference stack limit;
deep-resource qualification, exotic source/base-offset values and patched
intrinsics/descriptor timing still block an exact default swap. Public Markdown
parsing/string wrappers/subpaths still require the block/frontmatter parser.
A warmed five-round median benchmark (300 calls/round) measured 1,365-unit plain
input at 0.136 ms native versus 0.0219 ms reference (6.20x), and 1,420-unit rich
input at 0.616 ms versus 0.118 ms (5.23x). These are slower; no performance gate
is claimed. Default byte-offset array materialization and host crossings remain
optimization candidates.

Block-parser lexical rules are now native: CR/LF line boundaries, BOM/indent
admission, fences and metadata, ATX/setext headings, thematic breaks, list/task
markers, quotes/alerts/footnotes, escaped pipe cells/alignment and block HTML.
Inline/block HTML share one attribute scanner while retaining separate allowed
tag sets and closing policies. Differential tests cover every admitted block tag,
tab/BOM behavior, UTF-16 positions, malformed/seeded lines, escaped trailing pipes
and numeric list starts; 500 additional long decimal starts matched JS conversion.
All 188 native tests, 237 routed reference tests, declarations and scoped lint
pass with no dependency changes. These are internal grammar primitives; native
block construction, mapped indentation and frontmatter integration are next.

The internal Markdown body parser now constructs blocks and maps indentation in
Rust, then applies the native inline parser after collecting recursive footnote
labels. It covers fenced code, ATX/setext headings, thematic breaks, nested
lists/tasks, quotes/alerts, tables, raw HTML and footnote definitions. Default
source maps and range arithmetic stay native; JS supplies runtime Unicode classes
and materializes hidden range descriptors. The maintained package route passed
193 native tests and 237 routed reference tests; an additional passing adversarial
test brings native coverage to 194 and checks nonfinite/signed offsets and
character-host thrown identity. Types, Rust/binding/JS lint and isolated packed
runtime checks pass without dependency changes. Wide/narrow terminal screenshots
were inspected; terminal/HTML/plaintext fixture output matches the reference.
Differential cases include CRLF, BOM, virtual tab indentation, escaped table-cell
offsets, recursive definitions and 500 seeded block combinations. The 128-frame
native/reentrancy limits, exotic input and patched-intrinsic/descriptor timing
qualification remain open. Public document parsing still requires frontmatter
integration and Markdown string/export wrappers. A warmed five-round median
benchmark (300 calls/round, alternating order) measured native/reference times:
1,365-unit plain paragraphs 0.0224/0.0583 ms (0.384x), 1,420-unit rich inline text
0.687/0.190 ms (3.62x), and 1,310-unit mixed blocks 0.513/0.190 ms (2.70x). Plain
input improves, but rich input remains slower; the performance gate is not passed.

Public Markdown document parsing and string wrappers are now available at the
root and matching parser/renderer subpaths: `parse`, `renderMarkdown`,
`renderMarkdownHtml` and `renderMarkdownPlaintext`. Frontmatter embeds the own
Rust YAML/configuration implementation and retains metadata identity and hidden
UTF-8 ranges. Embedding exposed a design/frontmatter/config dependency cycle;
the existing template core, binding and JS host now live in the private own
`toolcraft-template-rust` workspace, with design retaining its Rust module paths.
Configuration adapters copy the shared engine from that package. No external
npm packages, Cargo packages or registry versions were added.

The new standalone engine also preserves arbitrary thrown host values through
explicit callback failure signaling, including getters, partials, coercion,
lambdas and iterator cleanup. Validation passed 11 Rust template tests and three
standalone host tests; design passed 197 native host tests and 567 selected
original tests (demo-content fixture tests still use the original fixture).
Config mutations and frontmatter maintained suites pass, as do the four adapted
dependent package suites: agent MCP config, agent skill config, config extends
and Poe config. Bidirectional Markdown subpath declarations and namespace keys,
packed standalone runtime/types consumers, Rust/binding lint and scoped JS lint
pass. Wide/narrow screenshots match the original byte-for-byte and were inspected.
Repository-wide unit and type routes are still running. Repository ESLint reports
zero errors after correcting redundant shell-fixture escapes, but its completeness
check rejects unrelated checkout symlink boundaries; that is not a full lint pass.

An indicative public-parser benchmark during concurrent builds (five warmed
rounds, 300 calls/round, alternating order) measured 1,350-unit plain input at
0.126/0.109 ms native/reference and 1,189-unit mixed/frontmatter input at
0.515/0.251 ms. Concurrent load limits these timings; no performance gate passed.
Remaining Markdown qualification includes testing wildcard subpaths,
complex YAML diagnostics, embedded error-constructor identity, patched intrinsics,
exotic inputs and deep-resource behavior. Default JavaScript exports remain active.

The Markdown demo-content subpath now stores its seven examples in Rust and
preserves the optional-name default and undefined result for unsupported names.
All 198 native host tests and 567 original design tests pass; the original demo
tests now route to the native package too. Bidirectional subpath types, packed
standalone runtime/types, Rust/binding/JS lint and an inspected terminal screenshot
pass without dependency changes. Release run 36971784710 for public Markdown
commit 064442fcff failed its build on unresolved Safe FS runtime-core declarations
and downstream Safe Bash types; publication is not verified. Broad local checks
are being rerun after rebuilding those declarations and finishing this checkpoint.

Packed screen styles now have a Rust core and root/subpath exports. It preserves
8-bit channel masking, intensity reset ordering, underline/inverse changes and
SGR code deduplication. Numeric transitions stay native; host-backed operands
retain repeated JavaScript coercion order and arbitrary thrown identity. The
adapter preserves observable array-push/Set/join operations and environment color
defaults. The maintained design route passed 201 native host tests and 568 selected
original tests, plus bidirectional types, Rust/binding/JS lint and packed runtime
and standalone types. A terminal screenshot was byte-equal to the original and
inspected. A warmed alternating five-round median over 100,000 numeric
transitions measured 0.000344 ms native versus 0.000137 ms reference (2.51x).
Per-call binding overhead remains; no performance gate passed. Screen buffers,
ANSI-to-cell conversion and terminal driver remain required.

Repository-wide type checking completed successfully after the Markdown work.
The maintained whole-unit route is running again after the Safe FS guarded-build
fix and serializing broad build operations. Markdown release run 36972439586
completed its build successfully, but validation and publication jobs were
skipped; successful publication remains unverified.

The remaining sequence is still required. Definition declarations currently
import existing schema/design/config contract types. Standalone type packaging
must be finished before a swap. Direct higher-order assignment of the generic
stream factories also needs shared contract identity: independent recursive
declarations make TypeScript infer the stream context as services during that
assignment, although matching generic instantiations and inferred SDK consumers
pass. Do not treat those narrower checks as proof of full factory interchangeability.


The additive `Screen` class now exposes root and `screen/screen` APIs. Rust owns
bounds, drawing, legacy style packing, clipping, wide-cell invalidation and frame
diff traversal. The host retains visible fields/arrays, grapheme iteration,
property/coercion ordering, dynamic subclass calls and arbitrary thrown values.
The package route passes 206 native host tests and 571 selected original tests;
public shape/constructor types, standalone packed runtime/types, Rust/binding
lint and scoped JS lint pass. Independent private class declarations still block
direct nominal assignment between packages; shared constructor/type identity is
required before a swap. Wide/narrow screenshots were inspected and their input
bytes match the reference; the bundled screenshot font lacks the CJK glyph.

A warmed alternating five-round benchmark of 100 frames (40 columns, 8 rows)
measured 1.0570 ms native versus 0.01887 ms reference per frame (56.03x slower).
Host callbacks dominate this compatibility path; no performance gate passed and
this is not ready for default integration. Further optimization must retain the
observable mutable screen state. ANSI-to-cell conversion and terminal driver
remain required.

The latest whole-unit attempt stopped during the Safe Bash build: a missing
`tryGetMemoryDirectoryEntryNamesSync` import and stale built runtime-core exports
prevented execution. The source/export evidence was recorded for the assigned
runtime work. Repository-wide types had passed previously; that does not make
the failed whole-unit route a pass.


The `screen/ansi-text` subpath now exposes `ansiToCells`. Rust applies SGR colors,
concealment, line erasure, tabs, carriage returns, backspaces and terminal-string
filtering before regrouping styled graphemes. Plain terminal rows reuse this
parser, removing duplicate cursor handling. Cell arrays remain independent and
preserve UTF-16, widths and packed channels. Batched string/typed-array transfer
avoids constructing each public object through N-API.

The maintained route passed 209 native host tests and 572 selected original tests,
including mixed-control differential cases and segmentation thrown identity.
The final transfer optimization passed focused parity again, standalone packed
runtime/types, Rust/binding and JS lint. Wide/narrow terminal screenshots matched
the original input bytes and were inspected. Five warmed alternating rounds of
500 calls measured 0.1486/0.06357 ms native/reference for repeated plain lines
(2.34x), and 0.1736/0.1353 ms for styled cursor-edited lines (1.28x). The earlier
per-cell N-API transfer measured 7.18x and 1.91x respectively. Concurrent builds
limit these timings; no performance gate passed. Boxed/malformed inputs,
patched intrinsics, public dashboard parseAnsi/baseStyle, aggregate resource
qualification and terminal driver APIs remain outstanding.

Release build 36973400474 failed on the Safe JS portable fixture's stale memory
filesystem import. The missing Safe Bash helper import and that fixture import
were fixed separately in 28eb2e2392, verified on remote main. The Safe Bash build,
229 filesystem cases (2 skipped) and all 20 Safe JS built-runtime probes pass.
The whole-unit route has been restarted; release 36974802405 is running and
publication remains unverified.


The `terminal/output` subpath now exposes `createFrameWriter`. Rust owns the
opened/closed lifecycle and terminal control sequences; Node performs stream I/O,
process listener registration and signal delivery. State transitions precede
fallible writes, matching repeated calls, option-getter timing, write failures,
reentrant closes and arbitrary fatal values. Host string interpolation preserves
frame coercion. All 212 native host tests and 575 selected original tests pass,
as do declarations, Rust/binding/JS lint and standalone packed runtime/types.
The synchronized-frame screenshot was inspected and its ANSI bytes equal the
reference. No dependencies changed.

A warmed five-round alternating sink benchmark of 100,000 writes per round
measured 0.000140 ms native versus 0.0000149 ms reference (9.36x); this isolates
per-call binding overhead and excludes terminal I/O. No performance gate passed.
Input parsing, timer behavior and the public terminal driver remain outstanding.
The whole-unit run and remote release checks are still running; publication is
not yet verified.


The `terminal/input` subpath now exposes `createInputParser`. Rust owns byte
classification, incremental parsing, paste/CSI/SS3 handling, navigation modifiers,
mouse fields and Escape timer decisions. JavaScript retains Buffer semantics,
locale case conversion, timers and callbacks, including repeated property reads,
callback receivers, arbitrary thrown identity and reentrant feeds. Every tested
byte split matches the reference, including malformed UTF-8 and the original
paste state retained after destroy. A changing onEvent getter initially exposed
a different TypeError message; direct host method invocation fixed it.

All 216 native host tests and 588 selected original tests pass, along with type
parity, Rust/binding/JS lint and packed standalone runtime/types. The input-event
screenshot was inspected and its ANSI bytes match the reference. Five warmed,
alternating rounds of 200 feeds measured 0.7199/0.01172 ms native/reference on
88-byte text chunks (61.43x) and 0.4253/0.009882 ms on mixed control chunks (43.04x).
Callback overhead dominates; no performance gate passed. Patched-intrinsic and
aggregate resource qualification still remain, alongside the public driver.
No external dependencies were added.

The prior full-unit attempt stopped in the optional Safe Bash compiler on a
missing RootShellState type import. That import is fixed in 336d69d2bd and verified
on remote main; optional compilation and a fresh playground kernel bundle pass.
The public memory export had already been restored by 69c3414d17. The maintained
whole-unit route is running again. Release 36975507223 completed its build but
skipped validation and publication; this is not a verified publication.


`createTerminalDriver` now has root and `terminal/driver` exports, composing the
native input parser and frame writer. Rust owns start/stop transitions and finite
geometry normalization; Node retains streams, subscriptions and live Set iteration.
Tests preserve stream operation order, repeated starts/stops, partial start
failures, dimension getter order and listener removal/addition during dispatch.
All 218 native host tests and 589 selected original tests pass, with public type
parity, Rust/binding/JS lint and standalone packed runtime/types. The driver
screenshot was inspected and its ANSI transcript matches the reference.

A warmed alternating five-round benchmark (100,000 getSize calls per round)
measured 0.00009295 ms native versus 0.000006783 ms reference (13.70x); no
performance gate passed. No dependencies changed. Input and driver APIs remain
additive; patched globals/intrinsics and full runtime/platform qualification are
still required before changing defaults.

The maintained whole-unit route reached root tests: 4,441 tests passed, 3 failed,
and 39 files failed overall. Most collection failures concern unresolved
workspace-local filesystem import aliases; one cache test and two Safe Bash
workerd probes also failed. These are being validated against current main.
Release 36975809073 completed successfully but skipped release-stable, so it does
not verify publication. Its public job graph was checked after the API rate limit.

The terminal driver is delivered in 62ced7b6c3. Root test source aliases are fixed
in 4ca3348d48, and seven audited build command strings covering eleven current
stages are admitted to the existing cache in a14fc9dfb3. All 146 focused tests,
changed-file ESLint and workflow lint pass. Full tests and type checking are
still running. Repository-wide ESLint reports no code diagnostics but remains
incomplete at unrelated filesystem boundaries. Driver release 36977537868 and
cache-fix release 36977763016 are queued; neither verifies publication yet.

`note` now has root, `note`, and `prompts/primitives/note` exports. Rust owns
format selection, layout and output sequencing; the host retains string/array
semantics, live colors, writers and arbitrary thrown values. Tests cover terminal,
Markdown and JSON bytes, UTF-16 widths, ANSI stripping, nullish titles, custom
split iterators, coercion order, reentrancy and the default stdout binding.
All 221 native host tests and 620 selected original tests pass, with bidirectional
types, Rust/binding/JS lint and a standalone packed runtime/types consumer using
`types: []`. The note screenshot was inspected and its ANSI bytes match reference.
No dependencies changed.

Five warmed alternating rounds of 1,000 three-line terminal notes measured
median 0.14095 ms native versus 0.10933 ms reference (1.29x). Other builds were
active on the machine; these figures are informational and no performance gate
passed. Prompts, cancellation, live spinners, dashboards and remaining public
surfaces still require implementation and full qualification before a swap.

The note implementation is delivered in a9dbf6c40e. All 36 root suites that had
failed collection now pass (1,453 tests). The broad test/type retries stopped at a
missing Safe Bash ShellResult import, already fixed independently in 98360168cd;
the maintained full unit route is running again against that fix. Release runs
36977537868 (driver), 36977763016 (cache), and 36978348923 (note) completed their
builds but skipped validation and release-stable. No publication is verified.

`openExternal` now has root, `open-external`, and `components/browser` exports.
Rust selects platform commands and handles launcher exit status; Node retains
URL parsing, process creation, events and promises. Mocked process tests compare
normalized URLs, separate Windows command arguments, option getter ordering,
strict platform/status comparisons and arbitrary process-error identity.
No real browsers are launched by these tests. All 223 native host tests and
623 selected original tests pass, together with public type parity,
Rust/binding/JS lint and the packed standalone runtime/types consumer.
No dependencies changed.

Five warmed alternating rounds of 10,000 mocked launches measured median
0.001915 ms native versus 0.0003121 ms reference (6.14x). This measures binding and
promise overhead without actual process/browser cost, while other builds were
running. It does not pass a performance gate or qualify real platform launchers.

The browser launcher is delivered in 4f877dbe66. The maintained full unit retry
reached 247 passing root files, 5,927 passing tests and 65 unexecuted cases in a
failed collection, with three files failing overall. Two Workerd probes still
fail. The third failure came from missing relative package-resolution context
in the public built-shell consumer plugin; assigning the owning chunk directory
restores all 65 tests without changing their public package assertions.

Prompt output now includes `intro`, `introPlain`, `outro`, `cancel`, `log`, and
`isCancel`, with their original direct and primitive subpaths. Rust owns format
selection, guide layout and output sequencing. Node retains writable streams,
live colors, arrays/iterators, string coercion and the shared cancellation-symbol
identity. Differential tests check all three formats, blank lines, custom spacing,
option getters, custom split iterators, arbitrary writer throws and writer lookup
order. The selected native host checks cover 227 cases and all 624 selected
original tests pass. Public declarations, Rust/binding/JS lint and a standalone
packed runtime/types consumer pass. The rendered screenshot was inspected and
its ANSI bytes equal the reference. No external dependencies changed.

Five warmed alternating rounds of 1,000 two-line `log.message` calls measured
median 0.02267 ms native versus 0.01173 ms reference (1.93x). Binding costs remain
visible; this does not pass a performance gate. Interactive prompts, live
spinners, dashboards and complete platform/resource qualification remain open.

Prompt output is delivered in 48cbe58cae; the built-shell test resolution fix is
delivered in f1903a0d0b. The browser release run 36978892330 built successfully
but skipped validation/publication. Prompt-output release 36979984258 is queued.
The maintained root type route is running again after the independent type fixes.

The live `spinner()` now exposes root, `spinner` and `prompts/primitives/spinner`
contracts. Rust owns lifecycle, fallback, frame and exit-code decisions; Node
retains streams, timers and shared frame identity. Differential tests cover
captured formats, environment/TTY fallbacks, repeated calls, timer truthiness,
writer/timer failures and reentrant writer/clear/scheduling callbacks. The checks
cover 231 native host cases and all 624 selected original tests pass, with
bidirectional declarations, Rust/binding/JS lint and packed standalone runtime
and `types: []` consumption. No dependencies changed.

The spinner ANSI transcript equals the reference. Screenshot inspection exposed
an existing PNG font limitation: its embedded regular TTF has glyph id zero for
all four original spinner circles, so the active frame is a missing-glyph box;
the success/error rows render correctly. This renderer defect is recorded for
follow-up. The original repeated-start timer leak was also concretely reproduced
with mocked timers and recorded; this additive port preserves it until both
implementations can change together.

Five warmed alternating rounds of 10,000 active `message` updates with mocked
timers and a sink writer measured median 0.003817 ms native versus 0.0001481 ms
reference (25.77x). This isolates binding overhead, not terminal latency; no
performance gate passed. `withSpinner`, interactive prompts, dashboard/explorer
surfaces and full runtime/platform/resource qualification remain outstanding.

`withSpinner` now has root and `with-spinner` exports. Rust chooses output
branches, callback order, elapsed labels and final presentation; Node retains
async execution, timers, stream access and thrown-value identity. The native
host suite passes 234 tests and 634 selected original tests pass (624 existing
cases plus the ten original `withSpinner` cases). The three `confirmOrCancel`
cases remain explicitly unported. Public type parity, Rust/binding/JS lint,
packed runtime with external imports rejected, and standalone `types: []`
consumption pass. The inspected PNG and ANSI transcript match the reference.
No external dependencies changed.

Five warmed alternating rounds of 1,000 non-TTY calls, including stop/subtext
callbacks and a sink writer, measured median 0.01554 ms native versus 0.01367 ms
reference (1.14x). These measurements include binding and output formatting
overhead on a shared machine; no performance gate passed. Interactive prompts,
dashboard/explorer surfaces and full runtime/platform/resource qualification
remain outstanding.

`promptTheme` now exposes the original root and `prompts/theme` contracts. Its
symbol data comes from Rust; its mutable objects and live accent getter retain
JavaScript identity and follow the active brand, including mutated brand colors.
All 235 native host cases, 625 selected design cases and ten spinner-wrapper
cases pass. The three confirmation-wrapper cases remain explicitly unported.
Type parity, Rust/binding/JS lint, a packed standalone runtime/type consumer and
visual comparison of purple/blue prompt states pass. No dependencies changed.

The interactive `Prompt` core and `core`, `keys`, and `wrap` subpaths now have
a Rust policy layer. It handles admission, grapheme cursor edits, validation
transitions, cancellation, frame replacement and line-boundary decisions. Node
retains EventEmitter/readline/stream lifetimes, UTF-8 decoding, weak references,
promises and callback receivers. Iterator cleanup and live property/method
lookup order are preserved at the host boundary.

All 242 native host cases, 1,222 selected original design cases and ten original
spinner-wrapper cases pass. Original interactive subclasses exercise the native
core, key mapping and wrapping; those subclasses themselves remain JavaScript
and are still unported. Public helper type equivalence, a typed Prompt subclass,
Rust/binding/JS lint, and packed standalone runtime/declarations pass. Active
and submitted PNGs were inspected; native/reference ANSI is identical. The font
also lacks U+754C (glyph id zero), recorded with the existing renderer follow-up.
No new dependencies were added.

Five warmed alternating rounds of 1,000 single-grapheme insertions measured
median 0.01129 ms native versus 0.0002277 ms reference (49.61x), without actual
TTY I/O. This exposes callback-boundary overhead; no performance gate passed.
Interactive prompt subclasses/wrappers, dashboard/explorer surfaces and full
platform/resource qualification remain outstanding. The root type route's
Safe Bash environment-map and callback typing failures were repaired separately
and verified through its maintained build closure and focused checks.

The `prompts/interactive/confirm` and `glyphs` subpaths now use Rust presentation
and event policy. They preserve initial-value defaults, arrow toggles, Y/N
shortcuts, cancellation, event/reentrant callback order and non-TTY admission.
Glyph selection retains platform/environment short circuiting, module-load
selection, mutable glyph objects and live color-method lookup order.

All 246 native host cases, 1,222 selected original design cases and ten spinner
wrapper cases pass. Three confirmation-wrapper cases remain explicitly unported.
Rust/binding/JS lint, option/helper type parity and packed standalone runtime and
declarations pass. Active/submitted/cancelled screenshots were inspected and the
ANSI transcript equals the reference. No external dependencies changed.

Direct cross-package confirmation-function assignment exposes a remaining type
gate: both packages share `Symbol.for("poe.cancel")` at runtime, but their
separate `unique symbol` declarations are nominally distinct. The type fixture
records that incompatibility explicitly; cancellation declarations must share
identity before a swap. Existing private-class declaration gates also remain.

Five warmed alternating rounds of 1,000 active confirmation renders measured
median 0.06214 ms native versus 0.03845 ms reference (1.62x slower), without TTY
I/O. No performance gate passed. Text/password/select/multiselect subclasses,
public wrappers and namespace, dashboard/explorer and full platform/resource
qualification still require completion.

The `prompts/interactive/text` and `password` subpaths now use native cursor,
fallback, validation-finalization and presentation policy. Node preserves
constructor fields, optional callback receivers, grapheme segmentation and
string operations. Differential cases cover Unicode edits, multi-character and
empty masks, placeholder/default values, state/property lookup order, arbitrary
validation throws, cancellation and piped UTF-8 input.

All 249 native host cases, 1,222 selected original design cases and ten spinner
wrapper cases pass. Rust/binding/JS lint, public option types, local cancellation
unions and packed standalone runtime/declarations pass. Initial, active, error,
submitted and cancelled screenshots were inspected; ANSI is reference-identical.
Separate cancellation-symbol declarations remain an explicit type swap gate.
No external dependencies changed.

Five warmed alternating rounds of 1,000 active renders measured native/reference
medians of 0.09914/0.02048 ms for text (4.84x) and 0.12524/0.02046 ms for passwords
(6.12x), excluding TTY I/O. Neither passes a performance gate. Select/multiselect,
pagination, public wrappers/namespace and the broader remaining ports and
qualification are still required. Prompt-core release 36984849384 completed its
queue check, but skipped build execution, validation and publication; it is not
evidence of a published release. Confirmation release 36985857838 is pending.

`limitOptions` now exposes `prompts/interactive/pagination` with Rust windowing,
row-budget trimming and overflow-marker decisions. The host retains numeric
coercion, live array operations/species and styling callback identity; wrapping
uses the existing native implementation. Differential coverage includes narrow
and zero row budgets, multiline/Unicode options, fractional and nonfinite
geometry/cursors, callback failures and observable property access order.

All 251 native host cases, 1,222 selected original design cases and ten spinner
wrapper cases pass, along with full pagination type equivalence, Rust/binding/JS
lint and packed standalone runtime/declarations. First/middle/last windows and
a narrow terminal screenshot match the reference ANSI and were inspected.
No external dependencies changed. The original select/multiselect subclasses
exercise native pagination in these suites; those subclasses are still unported.

Five warmed alternating rounds of 500 twelve-option styled window calculations
measured median 0.87098 ms native versus 0.01954 ms reference (44.58x), including
native wrapping and excluding TTY I/O. No performance gate passed. The remaining
selection subclasses, wrappers/namespace, broader ports and compatibility gates
remain required. Text/password commit 613c5d797c is verified on remote main;
release 36986392323 is pending, with publication still unverified.

`selectPrompt` and `findNonDisabled` now expose the `prompts/interactive/select`
subpath. Rust owns admission, enabled-option traversal, cursor event decisions,
non-TTY defaults and rendering. Node retains options/typed-value identity,
array callbacks and live property/method lookup. Cases cover disabled/sparse
options, wraparound, initial selection, arbitrary truthy results from overridden
array methods, mutable options, cancellation and full frame/event parity.

All 254 native host cases, 1,222 selected original design cases and ten spinner
wrapper cases pass, plus Rust/binding/JS lint, generic option/helper types and
packed standalone runtime/declarations. The shared cancellation type identity
gate remains explicit. Screenshots of active, submitted and cancelled selections
were inspected, with identical ANSI bytes. No dependencies changed.

Five warmed alternating rounds of 500 active four-option renders measured median
0.93578 ms native versus 0.12532 ms reference (7.47x), excluding TTY I/O. No
performance gate passed. Multiselect and public wrappers/namespace are still
required, alongside dashboard/explorer and the broader parity qualifications.
Confirmation release 36985857838 completed but skipped publication. Pagination
commit 6a271f3db1 is pushed; release 36986761254 completed but skipped validation
and publication. Workflow success is not evidence of a published release.

`multiselectPrompt` now exposes `prompts/interactive/multiselect` with Rust
admission, validation, navigation/toggle decisions and rendering. Node retains
array operations/species, mutable option/value identity and callback receivers.
Differential cases cover toggle-all/invert, required selection, disabled options,
initial-value copying, SameValueZero/strict-removal differences for NaN, getter
and setter lookup order, arbitrary failures and all rendered states.

All 257 native host cases, 1,222 selected original design cases and ten spinner
wrapper cases pass. Rust/binding/JS lint, generic option types, local cancellation
unions and packed standalone runtime/declarations pass. Active/error/submitted/
cancelled screenshots match the reference ANSI and were inspected. No external
dependencies changed; cancellation declaration identity remains a swap gate.

Five warmed alternating rounds of 500 four-option active renders measured median
0.73156 ms native versus 0.09509 ms reference (7.69x), excluding TTY I/O. No
performance gate passed. Public prompt wrappers/namespace, dashboard/explorer and
the broader port/qualification work remain required. Select release 36987354672
failed on two missing pythonRstrip references in the Safe Bash CSV adapter; the
existing helper import is being repaired separately and its build is running.

The public prompt API now exposes root/direct-subpath `select`, `multiselect`,
`promptText`, `confirm`, `password`, `confirmOrCancel` and `PromptCancelledError`,
plus the genuine ESM `prompts` namespace and `prompts/index`. Existing primitives
and spinner functions retain shared identities. Rust controls confirmation
cancellation/result policy; Node preserves async/thenable adoption, error
construction/stack hooks and arbitrary thrown-value identity.

All 261 native host cases, 1,222 selected original design cases and all 13 original
prompt-wrapper cases pass with no wrapper exclusions. Public option/helper and
constructor types, Rust/binding/JS lint, packed runtime with external imports
rejected and standalone declarations pass. Interactive selection/cancellation
screenshots were inspected and their ANSI is reference-identical. No dependencies
changed. Independent cancellation declarations remain a nominal type swap gate.

Five warmed alternating rounds of 1,000 non-TTY `confirmOrCancel` calls measured
median 0.01183 ms native versus 0.003248 ms reference (3.64x). No performance gate
passed. Root inventory is 107 native versus 106 reference exports: six missing
dashboard/explorer exports and seven additional native preview/layout helpers.
Full export/type/resource/platform qualification and the broader Toolcraft
CLI/transport/testing surfaces still require completion.

Multiselect is delivered in 18c9a36e27. The CSV helper import landed independently
in 51482a101f; the duplicate local repair was dropped during rebase. Its maintained
Safe Bash build closure, 66 CSV tests and scoped lint passed. Multiselect release
36988631335 then failed on unreachable Mac-mode comparisons in the ASCII-only
dos2unix sync adapter; the separate repair preserves non-ASCII fallback and passes
its maintained build closure, lint/type checks and all 81 package tests.
Publication remains unverified.

### Dashboard keymap checkpoint

`dashboard/keymap` now exposes `createKeymap` and `canonicalizeBinding` with
standalone overloads and bidirectional declaration compatibility. Rust owns the
default inventory, parsing decisions, modifier normalization, matching and
sequence transitions. Node retains observable string/array methods, Map/Set
storage, live command arrays, getter ordering and iterator cleanup. Explorer has
an independent key resolver and is not covered by this checkpoint.

Missing-subpath differential tests failed before implementation. The maintained
package route passes 264 native host tests, 1,222 selected design tests, all 13
prompt-wrapper tests and the five original dashboard-keymap tests; the other
107 tests in the shared dashboard suite are explicitly excluded. Rust/binding/JS
lint, packed runtime with external imports rejected and standalone declarations
with `types: []` pass. An inspected screenshot shows default keys, a two-key
sequence, modifiers and an unbound input with reference-equal command results.
No external dependencies were added.

Five warmed alternating rounds of 14,000 events measured a median 57.81 µs/event
native versus 0.206 µs/event reference (280.79× slower) on this Node 22 ARM64 host.
The fine-grained host callback path requires batching before a performance swap;
no performance gate passed. The repository-wide `npm run lint:types` begun at
the prior prompt checkpoint completed successfully, including dependency builds
and contracts; keymap inputs were edited during that run, so its result is not
an exact-head keymap qualification. Focused keymap checks ran after those edits.
Full dashboard/explorer, remaining Toolcraft surfaces and swap gates remain open.

### Dashboard admission checkpoint

Root `shouldUseInteractiveDashboard`, the dashboard namespace, and direct
`should-use-interactive-dashboard` / `dashboard/should-use-dashboard` subpaths
now share a native policy. Rust preserves strict enablement, format resolution
and stdin/stdout getter short-circuit order; Node supplies process defaults,
async output-format scope and Boolean coercion. Standalone declarations preserve
the existing IO shape and bidirectional function compatibility.

Two missing-API tests failed before implementation. All 266 native host tests,
1,222 selected design tests, 13 prompt-wrapper tests and five original keymap
tests pass, as do Rust/binding/JS lint and packed runtime/declarations with
external imports rejected and `types: []`. An inspected mode-selection screenshot
shows reference-equal enabled, disabled, JSON and non-TTY cases. No dependency
changes. Five warmed alternating 10,000-call rounds measured 1.989 µs/call native
versus 0.0309 µs reference (64.46× slower); no performance gate passed. Five
original root dashboard/explorer exports remain absent, along with broader
Toolcraft and platform/resource/type-identity qualification.

### Dashboard store checkpoint

`dashboard/store` now provides the original four-method `createStore` contract,
and `dashboard/types` supplies standalone structural dashboard declarations.
Rust controls initialization, preview decisions, ID matching, retention and state
transitions. Node retains observable array operations, object spreads, returned
object identity and live listener iteration. Reentrant getters and listeners see
the same state ordering; notifications happen after committing each new state.
Retention remains 256 items with existing bounded message/detail previews.

Missing-subpath tests failed before implementation; a function-shape regression
also failed and was corrected before delivery. All 269 native host tests, 1,228
selected design tests, 13 prompt-wrapper tests and 11 original shared dashboard
keymap/store tests pass (101 unrelated shared-suite cases are excluded). Scoped
Rust/binding/JS lint, bidirectional types and packed standalone runtime/declarations
pass with no external imports or dependency additions. An inspected screenshot
shows an ID-based replacement retaining its row ahead of a later status message.

Five warmed alternating rounds of 300 operations at full retention capacity
measured append medians of 3.935 µs native / 0.873 µs reference (4.51× slower),
and keyed-update medians of 95.59 µs / 2.573 µs (37.15× slower). No performance
gate passed. Remaining dashboard rendering/lifecycle, explorer and broader
Toolcraft replacement gates remain open.

### Composer layout checkpoint

`dashboard/composer-layout` now exposes `layoutComposer` with standalone
structural state and layout declarations. Rust owns cache admission, wrapping,
tab/newline rules, UTF-16 row starts and caret placement. Node retains the weak
cache and mutable returned layout identity, ICU segmentation and observable
property/array/numeric operations. Width coercion and getter order match the
reference, including normalized narrow widths and non-cacheable NaN.

Three missing-subpath tests failed before implementation. All 272 native host
tests, 1,228 selected design tests, 13 prompt-wrapper tests and 11 shared dashboard
keymap/store tests pass. Four original composer navigation tests also pass with
only layout redirected to native; ten other editor tests are excluded and the
editor itself is not yet ported. Scoped Rust/binding/JS lint, bidirectional types,
and packed runtime/declarations with external imports rejected and `types: []`
pass. The inspected ASCII screenshot checks wrapped rows and carets at widths
4/6/10; Unicode cell and UTF-16 behavior are covered by differential tests.
The bundled screenshot font lacks CJK/emoji glyphs, so it is not Unicode visual
qualification. No dependencies were added.

Five warmed alternating rounds measured cache hits at 2.040 µs native / 0.0186 µs
reference (109.90× slower, 10,000 calls/round), and relayout at 49.44 µs / 3.709 µs
(13.33× slower, 300 calls/round) for a short multiline Unicode draft. No performance
gate passed. The composer editor, legacy ANSI/style/buffer/terminal surfaces,
full dashboard lifecycle, explorer and broader replacement gates remain open.

### Dashboard elapsed-time checkpoint

`dashboard/elapsed` now exports `formatElapsed`. Rust selects safe input and
hour/minute/second decomposition, while host numeric/string operations preserve
JavaScript coercion, rounding, large-number formatting and observable Math order.
Standalone declarations preserve the original function contract.

Two missing-subpath tests failed before implementation. All 274 native host tests,
1,228 selected design tests, 13 prompt-wrapper tests, 12 selected shared dashboard
tests (including the original elapsed-format test) and four composer-layout
integration tests pass. Scoped Rust/binding/JS lint, bidirectional types and packed
standalone runtime/declarations pass with no dependency additions. An inspected
screenshot checks zero/subsecond, multi-hour, over-24-hour, negative and NaN output.
Five warmed alternating 10,000-call rounds measured 4.513 µs native / 0.1446 µs
reference (31.21× slower); no performance gate passed. Legacy dashboard rendering,
composer editing, explorer and broader replacement qualification remain open.

### Legacy dashboard ANSI checkpoint

`dashboard/ansi` now exports `parseAnsi`, `plainTerminalText` and `hasAnsi` with
standalone styled-line declarations. The existing Rust terminal parser now
retains ordered style properties, explicit false/undefined fields, base resets,
and arbitrary host base-value identity. Opaque values remain host slots during
the call; Rust does not retain host handles. Shared UTF-16 style strings avoid
copying a large base-color value per cell. Existing packed-screen consumers use
the same parser and retain their behavior.

Three missing-subpath tests failed before implementation. All 277 native host
tests, 1,282 selected design tests (including all 54 original ANSI cases), 13
prompt-wrapper tests, 12 shared dashboard tests and four composer-layout
integration tests pass. Scoped Rust/binding/JS lint, bidirectional declarations
and packed runtime/standalone declarations pass. An inspected screenshot checks
foreground/base resets, bold toggling, RGB backgrounds and progress-line overwrite.
No dependencies were added. Boxed/custom string-like inputs, modified parsing
intrinsics and complete resource/platform qualification remain outside this
checkpoint's verified string-input scope.

Five warmed alternating 300-call rounds measured 800-unit plain parsing at
81.53 µs native / 60.18 µs reference (1.35× slower), and repeated styled/control
text at 82.13 µs / 68.88 µs (1.19× slower). No performance gate passed. Legacy
ScreenBuffer/terminal, composer editing, dashboard rendering/lifecycle, explorer
and broader Toolcraft replacement gates remain open.

### Composer editor checkpoint

`dashboard/composer` now exports `createComposerState`, `editComposer` and their
standalone state/submission declarations. Rust owns focus/key dispatch, movement,
word/line deletion, preferred-column navigation and submission decisions. Node
retains lazy ICU `Segments.containing`, string operations, state spreads and
observable getter order. Paste uses native legacy ANSI parsing; vertical movement
uses the native composer layout. Ordinary insertion and submission do not segment
untouched draft text, and navigation examines only adjacent graphemes/deleted words.

Two missing-subpath tests failed before implementation. The getter-trace probe was
corrected to avoid recording its own deep comparison of returned proxies. Final
checks pass 279 native host tests, 1,282 selected design tests, 13 prompt-wrapper
tests, 12 shared dashboard tests and all 14 original composer tests with no editor
exclusions. Scoped Rust/binding/JS lint, bidirectional declarations and packed
standalone runtime/declarations pass. Inspected snapshots verify sanitized paste,
line-start insertion, caret location and message submission after a plan. No new
dependencies or default integration changes.

Five warmed alternating 1,000-call rounds on a short multiline Unicode draft
measured native/reference medians: insertion 13.19/0.272 µs (48.55× slower),
backspace 10.15/1.106 µs (9.17×), and vertical movement 56.33/6.708 µs (8.40×).
No performance gate passed. Legacy ScreenBuffer/terminal, full dashboard rendering
and lifecycle, explorer and broader replacement qualification remain open.

### Legacy dashboard buffer checkpoint

`dashboard/buffer` now exports `ScreenBuffer`, `diff` and `cellToAnsi`. Rust owns
style normalization, clipping, continuation cells, resizing, diff decisions and
color-chain selection. The host retains observable objects, numeric coercions,
array creation, iteration and ICU grapheme segmentation. The buffer preserves
legacy behavior independently of the newer packed `Screen`, including underline
normalization, newline flattening, public `get` dispatch and runtime-private
fields/methods. No dependencies were added.

Four missing-export tests failed before implementation. Final maintained package
checks pass 283 native host tests, 1,282 selected design tests, 13 prompt-wrapper
tests, 30 shared dashboard tests and all 14 composer tests. Scoped Rust/binding/JS
lint, bidirectional public structural types, packed runtime without external
imports and standalone declarations with `types: []` pass. Separate private
class declarations remain an explicit nominal replacement gate. An inspected
ASCII screenshot checks rectangle clipping, tabs, underline, ANSI/base colors,
resize and partial clearing; Unicode behavior is covered differentially.
Boxed/custom string inputs, modified parsing intrinsics, exhaustive reentrancy
and resource/platform qualification remain unverified.

Five warmed alternating 100-call rounds measured native/reference medians of
296.08/6.267 µs for short text writes (47.25× slower) and 2535.36/1.507 µs for a
20×3 buffer diff (1682.76× slower). Per-cell host crossings dominate this policy
path; a batched native data path is required before any performance-driven swap.
No performance gate passed. Legacy terminal, full dashboard rendering/lifecycle,
explorer and the broader Toolcraft replacement gates remain open.

### Legacy dashboard terminal checkpoint

`dashboard/terminal` now exports `createTerminalDriver`, `parseKeypress` and
standalone driver/keypress types. Rust owns lifecycle guards, state transitions,
sparse cursor movement, size normalization, input-event mapping and readline
keypress classification. Node retains streams, listener collections, timers,
readline and callback execution. Mode state changes occur after effects, retaining
the original behavior when an effect throws or reenters. Streaming input uses the
ported native input parser; cell rendering uses the native legacy buffer.

Three missing-export tests failed before implementation. Maintained checks pass
286 native host tests, 1,294 selected design tests (including all 12 original
legacy terminal tests), 13 prompt-wrapper tests, 30 shared dashboard tests and
all 14 composer tests. Scoped Rust/binding/JS lint, bidirectional declarations,
packed runtime with external imports rejected and standalone declarations with
`types: []` pass. The declaration explicitly references the existing Node types,
matching its Node stream/Buffer API. An inspected screenshot checks captured
adjacent output, colors, underline and inverse styling; captured output bytes
also match the original driver. No dependencies or default integration changes.

Five warmed alternating 100-call rounds measured native/reference medians of
466.18/13.575 µs for a 40-cell flush (34.34× slower) and 16.129/5.677 µs for a
modified-arrow `parseKeypress` call (2.84× slower). No performance gate passed.
Full dashboard renderers/lifecycle, explorer and broader Toolcraft replacement
qualification remain open, including batching, platform coverage and exhaustive
resource/reentrancy qualification.

### Dashboard border checkpoint

`dashboard/components/border` now exports `renderBorder` and `BorderOptions`.
Rust owns frame/title clipping, side and footer placement, pane visibility and
junction selection. Host operations preserve numeric coercion, live getters,
buffer method dispatch and existing native terminal-width/text behavior.
`dashboard/layout` reexports the existing native geometry function and types;
the root implementation is unchanged.

Four missing-export tests failed before implementation. Differential checks cover
140 compact/full/degenerate frame and title combinations, custom divider extents,
buffer integration, style identity, getter order, reentrant drawing and thrown
identity. Maintained checks pass 290 native host tests, 1,294 selected design tests,
13 prompt-wrapper tests, 42 shared dashboard tests and 14 composer tests. Scoped
Rust/binding/JS lint and packed runtime/standalone declaration checks pass. The
structural type assertion was made concrete to avoid generic variance retaining
the buffer's private-class identity; an explicit nominal mismatch check remains.
Inspected screenshots show full and compact borders, junctions and title clipping.
No dependencies or default integration changes.

Five warmed alternating 100-call rounds on an 80×24 layout with a no-op drawing
surface measured 239.994 µs native / 20.949 µs reference (11.46× slower). This
isolates renderer overhead from buffer writes and does not pass a performance
gate. Modified intrinsics, complete reentrancy/resource/platform qualification,
remaining dashboard renderers/lifecycle, explorer and broader replacement gates
remain open.

### Dashboard footer checkpoint

`dashboard/components/footer` now exports `renderFooter`, `defaultHints` and
`FooterHint`. Rust owns hint selection, fallback clipping, centering, session
column allocation, theme style selection and default hint content. Node retains
array mapping/species/iteration, observable callbacks and string operations.
The renderer uses the existing native theme, terminal-width and buffer surfaces.

Three missing-export tests failed before implementation. Differential checks
cover complete-hint fitting, fresh defaults, control sanitization, Unicode cells,
session rows, active brands, getter order, array species, method receivers and
thrown identity. Maintained checks pass 293 native host tests, 1,299 selected design
tests (including five original session-footer cases), 13 prompt-wrapper tests,
50 shared dashboard tests and all 14 composer tests. Scoped Rust/binding/JS lint,
bidirectional public structural types and packed standalone runtime/declarations
pass. The separate private buffer type remains an explicit nominal swap gate.
Inspected screenshots verify hints and session clipping at 72, 40 and 12 columns;
Unicode is covered differentially. No dependencies or default integration changes.

Five warmed alternating 100-call rounds on an 80-column session footer with a
no-op drawing surface measured 457.788 µs native / 28.154 µs reference (16.26×
slower). No performance gate passed. Output/stats/context renderers, dashboard
lifecycle and snapshots, explorer, native batching and broader replacement
qualification remain open.

### Explorer detail renderer checkpoint

`explorer/render/detail` exposes `renderDetail` with the original declaration.
Rust selects empty/loading, Markdown blob and titled-list modes, clamps scroll,
draws selection/subtitle/badge rows, clips grapheme cells and composes the pane
frame and percentage/loading indicator. Existing native detail preparation,
theme, geometry, pane and text helpers supply its dependencies. Host operations
preserve live property reads, callback receivers, AbortSignal construction,
JavaScript coercions, render-error handling and iterator cleanup.

Four missing-export tests preceded implementation. Differential coverage includes
400 layout/scroll combinations, custom title and row-search callbacks, getter
traces, nested rendering, arbitrary thrown-value identity and prepared-cell
iterator closing on clipping/errors. Maintained checks pass 363 native host tests,
1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 155 explorer cases. Original detail/integration suites now
exercise native detail rendering. Rust/binding and scoped JS lint, bidirectional
declarations and packed runtime/types pass; packed imports reject external ESM
dependencies and declaration consumers compile with `types: []`.
No dependencies or default integration changed.

Inspected 72-column and 32-column Markdown, titled-list and loading screenshots;
native/reference original-ScreenBuffer output is byte-identical. The screenshot
font still lacks the existing braille loading glyph.

Five warmed alternating 100-render Node 22 ARM64 rounds retaining 32 call arrays
measured 1,047.943 µs native / 104.978 µs reference for a 72×12 Markdown preview
(9.98× slower), and 1,032.317 µs / 128.069 µs for the titled detail list
(8.06× slower). These are microbenchmarks, not full-application performance gates.
Modal/combined rendering, reducer, runtime/public namespace, batching and broader
swap qualification remain open.

### Explorer pane frame checkpoint

`explorer/render/pane` exposes `drawPaneFrame` and the same `paneBodyRect` function
as `explorer/layout`. Rust owns frame geometry, clipping decisions, title/indicator
composition and ordered screen calls, using the existing Rust text-cell helpers.
The host retains screen method lookup/receiver behavior, repeated option reads,
coordinate coercion, string-repeat lookup order and arbitrary thrown values.
One-column panes and the reference's UTF-16 indicator-length accounting remain
unchanged.

Four missing-export tests preceded implementation. Differential coverage includes
1,008 geometry/title/indicator combinations, malformed inputs, live getters,
coercion traces, method identity and reentrant drawing. Maintained checks pass
345 native host tests, 1,379 selected design cases, 13 prompt wrappers,
132 dashboard/queue cases, 14 composer cases and 149 explorer cases, including
the original rendering integration snapshots. Rust/binding and scoped JS lint,
bidirectional types and packed runtime/declarations pass. Packed imports reject
external ESM dependencies and the type consumer uses `types: []`.

Inspected 72-column and 36-column pane screenshots. Both produce byte-identical
original-ScreenBuffer output for native/reference drawing, including clipped
titles, tabs, indicators and single-row/column frames. The screenshot font lacks
the tested CJK/emoji glyphs; these show placeholders in both paths. No dependency
or default integration changed.

Five warmed alternating 500-frame Node 22 ARM64 rounds retaining 32 call arrays
measured 611.864 µs native / 113.255 µs reference for a 48×12 ASCII-title pane
(5.40× slower), and 605.423 µs / 93.765 µs for a Unicode/tab title (6.46× slower).
No full-render performance gate passed. Remaining renderers, reducer,
runtime/public namespace, batching and broader swap qualification remain open.

### Dashboard output checkpoint

`dashboard/components/output-pane` now exports `computeVisualLines`,
`renderOutputPane` and `VisualLine`. Rust owns paragraph and styled-segment
wrapping, status prefixes, viewport painting, conversation folding, duration
labels and streamed Markdown cache decisions. Node retains observable objects,
iteration, array operations, ICU segmentation and the weak cache; existing native
Markdown, ANSI, width, viewport and buffer implementations supply dependencies.

Four missing-export tests failed before implementation. Differential checks cover
Unicode/ANSI/control text, narrow rectangles, preformatted rows, scroll clamping,
conversation/details modes, getter order, drawing receivers, thrown identity and
streamed/invalid/footnoted Markdown. Maintained checks pass 297 native host tests,
1,322 selected original design tests, 13 prompt-wrapper tests and 14 composer
tests; the expanded shared dashboard suite passes 69 selected tests. Rust/binding
and scoped JS lint pass. Bidirectional structural types, packed runtime rejecting
external imports and standalone declarations with `types: []` pass. The buffer's
private-class nominal identity remains a separate swap gate. Inspected screenshots
at 56 and 28 columns verify prefixes, wrapping, colors, folding and Markdown.
No dependencies or default integration changes.

Five warmed alternating 100-call Node 22 ARM64 rounds on four output items at
56 columns measured native/reference medians of 1,563.52/16.06 µs for wrapping
(97.34× slower) and 1,765.30/19.28 µs for rendering into a no-op surface
(91.54× slower). No performance gate passed. Stats/context/run-view rendering,
dashboard lifecycle and snapshots, explorer, batching and broader API/resource/
reentrancy/platform qualification remain open.

### Dashboard context checkpoint

`dashboard/components/context-pane` now exports `renderContextPane`. Rust owns
row reservation, active-plan versus queued-plan overflow selection, clipping and
drawing decisions. The host preserves array map/species/flat/slice/forEach
behavior, object spreads and live property access. Native output wrapping, ANSI
sanitization and width helpers provide all dependencies.

Two missing-export tests failed before implementation. Differential checks cover
empty/degenerate panes, rectangle identity, short/long/Unicode/control text,
queue overflow, array species, getter order, receivers and thrown identity.
Maintained checks pass 299 native host tests, 1,326 selected original design
tests (including all four context tests), 13 prompt-wrapper tests, 69 selected
shared dashboard tests and 14 composer tests. Rust/binding and scoped JS lint,
bidirectional structural types, packed runtime with external imports rejected
and standalone declarations with `types: []` pass. Inspected screenshots cover
40×12, 40×4, 30×4 and 48×2 panes with room retained for live output. No dependencies
or default integration changes.

Five warmed alternating 100-call Node 22 ARM64 rounds on three context entries in
a 40×12 rectangle with no-op drawing measured 792.26 µs native / 14.10 µs reference
(56.20× slower). No performance gate passed. Stats/run-view rendering, dashboard
lifecycle and snapshots, explorer, batching, private-class nominal identity and
broader API/resource/reentrancy/platform qualification remain open.

### Dashboard stats checkpoint

`dashboard/components/stats-pane` now exports `statsToLines`, `renderStatsPane`,
`renderCompactStatsPane`, `formatNumber` and the existing native `formatElapsed`.
Rust owns status styles, grapheme clipping, column alignment, action wrapping,
short-pane priorities and compact summary composition. The host retains observable
objects, array operations, live numeric/string coercion and Intl number formatting.
The output, elapsed, theme and terminal-width dependencies use existing native
implementations.

Three missing-export tests failed before implementation. Differential checks cover
all status tones, number edge cases, Unicode/ANSI actions, narrow/short rectangles,
progress totals, getter order, drawing receivers, reentrancy and thrown identity.
Maintained checks pass 302 native host tests, 1,335 selected original design tests
(including all nine stats-context tests), 13 prompt-wrapper tests, 78 selected
shared dashboard tests and 14 composer tests. Rust/binding and scoped JS lint,
bidirectional structural types, packed runtime rejecting external imports and
standalone declarations with `types: []` pass. Inspected screenshots verify full,
three-row and one-row sidebars plus compact one/two-row summaries. No dependencies
or default integration changes.

Five warmed alternating 100-call Node 22 ARM64 rounds with a current action and
32-column stats measured native/reference medians of 1,299.09/90.68 µs for line
formatting (14.33× slower), 1,797.54/103.90 µs for a 13-row no-op sidebar (17.30×)
and 505.95/76.19 µs for a two-row no-op compact pane (6.64×). No performance gate
passed. Run-view rendering, dashboard lifecycle and snapshots, explorer, batching,
private-class nominal identity and broader replacement qualification remain open.

### Dashboard run-view checkpoint

`dashboard/components/run-view` now exports `renderRunView` and `RunViewOptions`.
Rust owns responsive geometry, plan/task windows, follow-up labels, metrics,
composer placement, cursor coordinates and hint wrapping. Host operations retain
observable getters, array iteration/callbacks, string coercion and drawing
receivers. Existing native output, composer layout, theme and stats modules
supply the component dependencies. Hidden work-list titles and step names remain
unread until visible.

Three missing-export tests failed before implementation. Differential checks
cover 48 layout/mode combinations, ten real-buffer status/Unicode combinations,
draw sequences, return values, getter order, receivers and thrown identity.
Maintained checks pass 305 native host tests, 1,376 selected original design tests
(including all 41 run-view tests), 13 prompt-wrapper tests, 78 selected shared
dashboard tests and 14 composer tests. Rust/binding and scoped JS lint,
bidirectional structural types, packed runtime rejecting external imports and
standalone declarations with `types: []` pass. Inspected screenshots verify
120×28 sidebar, 40×12 compact editing and 80×20 scrolled work-list layouts.
No dependencies or default integration changes.

Five warmed alternating 100-call Node 22 ARM64 rounds on a 120×28 no-op drawing
surface with conversation, composer and 30 tasks measured 2,909.12 µs native /
291.19 µs reference (9.99× slower). No performance gate passed. Dashboard lifecycle
and snapshots, explorer, batching, private-class nominal identity and broader
API/resource/reentrancy/platform qualification remain open.

### Dashboard snapshot checkpoint

`dashboard.renderDashboardSnapshot` and `dashboard/snapshot` now expose the
snapshot renderer and `SnapshotOptions`. Rust owns nullish defaults, sample
events, rendering order and row serialization, composed from the existing Rust
dashboard components. The host retains live option reads, one default clock
read, coercions and thrown-value identity. Preview helpers and layout now live
in dedicated modules so the root namespace does not introduce a cycle through
the ANSI parser; the shared dashboard suite reproduced that cycle before repair.

Three missing-export tests failed before implementation. Differential coverage
includes eight sizes (empty, narrow, wide and fractional), ANSI/Unicode output,
default/nullish/custom options, getter order, thrown identity, reentrant getters
and namespace identity. Maintained checks pass 308 native host tests, 1,379
selected original design tests (including three compact-layout tests), 13 prompt
wrapper tests, 78 selected shared dashboard tests and 14 composer tests.
Rust/binding and scoped JS lint, bidirectional declarations, a packed runtime
rejecting external imports and standalone declarations with `types: []` pass.
Inspected screenshots cover 80×20 and 40×12 default snapshots. No dependencies or
default integration changes.

Five warmed alternating 10-call Node 22 ARM64 rounds for an 80×20 default ANSI
snapshot measured 45,919.65 µs native / 2,926.19 µs reference (15.69× slower).
No performance gate passed. Dashboard lifecycle, explorer, batching, private-class
nominal identity and broader API/resource/reentrancy/platform qualification
remain open.


### Dashboard lifecycle checkpoint

`dashboard.createDashboard`, `dashboard/dashboard` and `dashboard/index` now
expose the complete dashboard runtime and namespace declarations. Rust owns
creation defaults, lifecycle transitions, render scheduling, history holding,
queue navigation, submission outcomes, responsive component orchestration and
cleanup order. Node retains live getters, stream/timer registration, array
callback semantics, promise turns, callback receivers and thrown-value identity.
The existing native component ports supply rendering and input editing. No new
dependencies or default integration changes.

The original dashboard and queue suites first failed on the missing native
runtime. Five differential tests cover byte-identical frames, restart and
idempotent teardown, subscriptions, fallback getter order, arbitrary thrown
values, live handler iteration, reentrant teardown, callback receivers and
submission promise turns (including rejection after destroy). Full dashboard
namespace keys and bidirectional declarations match the current API. The
repeated-update layout test now uses a controlled clock and an explicit repaint
cadence, with separate terminal-size cases; it previously exceeded the 3-second
timeout because real native frame time triggered extra synchronous paints.

Maintained checks pass 313 native host tests, 1,379 selected original design
tests, 13 prompt-wrapper tests, all 132 dashboard/queue cases and 14 composer
tests. Rust/binding and scoped JS/TS lint, packed runtime with external imports
rejected, and packed declarations with `types: []` pass. Inspected screenshots
cover 80×20 panels, 120×28 conversation input and 40×12 compact editing.

Five warmed alternating five-cycle Node 22 ARM64 rounds, each cycle starting an
80×20 dashboard, forcing four status paints and destroying it, measured median
275,821.72 µs native / 3,474.87 µs reference (79.38× slower). No performance gate
passed. Explorer, CLI/transports/testing, batching, private-class nominal
identity and broader API/resource/reentrancy/platform qualification remain open.


### Explorer keymap checkpoint

`explorer/keymap` now exposes `resolveBindings`, both accelerator/bare-binding
validators, `keymapToHelp` and their public types. Rust owns builtin bindings,
configuration filtering, validation precedence, first-wins key assignment,
event normalization and help structure. Host adapters preserve array iteration,
Map identity, observable getters, callback receivers, primitive errors and
reentrancy. Explorer configuration/event types are bundled declarations only;
configuration normalization, state initialization and the runtime remain open.

Three missing-export differential tests preceded implementation. Coverage checks
selection/reorder combinations, overridden defaults, protected quit, normalized
collisions, duplicate action IDs, live returned maps, malformed inputs, exact
validation diagnostics, getter order and reentrant configuration reads. One
malformed accelerator exposed a Reflect.apply diagnostic mismatch; direct
primitive host invocation preserves the original TypeError wording.

Maintained checks pass 316 native host tests, 1,379 selected original design
tests, 13 prompt wrappers, 132 dashboard/queue cases, 14 composer tests and all
four original explorer-keymap tests. Rust/binding and scoped JS lint,
bidirectional declaration checks, external-import-rejecting packed runtime and
packed declarations with `types: []` pass. Inspected generated help screenshot.
No dependencies or default integration changes.

Five warmed alternating 1,000-call Node 22 ARM64 rounds with three action
accelerators measured median 313.06 µs native / 5.04 µs reference (62.09× slower).
No performance gate passed. Explorer state/runtime, batching and the broader
swap qualification remain unfinished.


### Explorer configuration and state checkpoint

`explorer/state` now exposes `normalizeExplorerConfig`, `createInitialState`,
`resolveExplorerLayoutMode`, region masks and the original state/config types.
Rust owns validation, list/companion selection, nullish defaults, aborted detail
results, initial state shape, responsive modes, action deduplication and pane
definitions. Node retains async callback receivers and promise sequencing,
array iteration/species, live property reads and rendering closure identities.
Legacy configurations retain their exact object identity.

Three missing-export tests preceded implementation. Differential checks cover
39 size combinations, seeded rows, action maps, validation failures, option
getter order, legacy identity, companion list/detail/empty cases, callback
receivers and abort-after-start timing. All 15 selected original explorer
keymap/state/pane tests pass, including integration with the original reducer
and action context. Maintained checks also pass 319 native host tests, 1,379
selected design tests, 13 prompt wrappers, 132 dashboard/queue cases and 14
composer tests. Rust/binding and scoped JS lint, bidirectional declarations and
packed runtime/type consumers pass without new dependencies. Original rendering
fed native and reference initial states produces identical frames; inspected
120×18 and 70×12 first-paint screenshots.

Five warmed alternating 500-call Node 22 ARM64 rounds, with two panes and 20
seeded rows at 120×24, measured median 298.02 µs native / 5.54 µs reference
(53.82× slower). No performance gate passed. Explorer runtime/public namespace,
remaining dependencies and broader swap/performance qualification remain open.

### Explorer geometry checkpoint

`explorer/layout` now exposes `computeExplorerLayout`, `paneBodyRect` and all
original public geometry types. Rust calculates responsive geometry in one
native batch; the binding retains conditional option reads, arbitrary thrown
values and JavaScript coordinate coercion. No external dependencies were added.

Three missing-export tests preceded implementation. Differential coverage checks
2,496 viewport/option combinations, non-finite and malformed dimensions,
getter order, reentrancy, UTF-independent coordinate coercion and exact errors.
All ten original layout cases run against the native port, including the legacy
pane re-export identity check. Maintained checks pass 322 native host tests,
1,379 selected design tests, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 25 explorer cases. Rust/binding and scoped JS lint and
bidirectional declaration checks pass. Inspected 120×18, 90×18, 70×12 and 45×8
screenshots; original renderers given native/reference geometry emit identical
frames.

Five warmed alternating 10,000-call Node 22 ARM64 rounds, cycling 64 viewport
options and retaining 64 result objects, measured median 2.855 µs native /
0.0417 µs reference (68.45× slower). The batch reduces absolute callback cost,
but this remains API-parity work, not a passed performance gate. Explorer
filtering/actions/jobs/reducer/render/runtime, public namespace and the broader
swap qualification remain open.

### Explorer action checkpoint

`explorer/actions` exposes `resolveAction`, `buildActionContext` and the original
public action source/runtime handle types. Rust owns accelerator availability,
row/detail fallback, selection, pane snapshots and context construction. Node
retains live callbacks, Map/Set receivers, array species and arbitrary thrown
values. Runtime handles, row overrides and selected sets retain their identities.

Three missing-export tests preceded implementation. Differential checks cover
36 target/availability/running combinations, 108 source/focus/selection/override
combinations, empty state, property order, array subclasses and reentrant reads.
Maintained checks pass 325 native host tests, 1,379 selected design tests, 13
prompt wrappers, 132 dashboard/queue cases, 14 composer cases and 28 explorer
cases, including all three original action cases and pane integration. Rust,
binding and scoped JS lint and bidirectional declarations pass. No dependencies
or default integration changed.

Five warmed alternating 500-call Node 22 ARM64 rounds, creating action contexts
for 20 rows with three selections and retaining 32 results, measured median
77.14 µs native / 0.746 µs reference (103.44× slower). Callback batching and
performance acceptance remain open along with filtering, jobs, reducer,
rendering, runtime/public namespace and broader swap qualification.

### Explorer filtering checkpoint

`explorer/filter` exposes `filterRows`, `FilterMatch` and `FilterRowsOptions`.
Rust owns subsequence scoring, lexicographic position ties and projection from
folded text to original grapheme offsets. The best-prefix recurrence removes
the predecessor scan while retaining a separate adjacent-character bonus.
Node preserves whole-string locale casing, ICU segmentation, SGR stripping,
array species/iteration and observable getter order. No dependencies or default
integration changed.

Three missing-export differential tests preceded implementation. Coverage
includes 68,442 short-query/row comparisons, 300 seeded longer cases, sparse
arrays, live option reads, arbitrary thrown values, reentrancy and casing-call
traces for English, Turkish and Lithuanian. Greek context, astral characters,
lone surrogates and expansion/contraction projection retain original behavior.
Maintained checks pass 328 native host tests, 1,379 selected design tests,
13 prompt wrappers, 132 dashboard/queue cases, 14 composer cases and 123
explorer cases, including original filter, reducer and list-renderer tests.
The explorer suite enables the reference snapshots' color environment.
Rust/binding and scoped JS lint, bidirectional declarations and packed runtime
and declaration consumers pass. Packed runtime rejects external ESM imports;
packed declarations compile with `types: []`. Inspected 100-column and 70-column
filter screenshots; native/reference results produce identical original-renderer
frames. The screenshot font lacks emoji glyphs, but UTF-16 spans and highlighted
cells are covered by the original renderer tests.

Five warmed alternating Node 22 ARM64 rounds retaining 32 results measured
61.10 µs native / 16.87 µs reference for 20 short labels (1,000 calls/round,
3.62× slower), and 703.54 µs / 5,199.02 µs for 20 dense repeated labels
(30 calls/round, 7.39× faster). This is workload-specific improvement, not a
passed replacement gate. Jobs, detail preparation, theme, reducer, remaining
renderers, runtime/public namespace and broader swap qualification remain open.

### Explorer detail jobs checkpoint

`explorer/jobs` exposes `createDetailJobs`, `LOADING_INDICATOR_MS` and
`DETAIL_DEBOUNCE_MS` with the original declarations. Rust controls scheduling,
debounce decisions, abort suppression, loading/completion/error event payloads,
and timer/listener cleanup. The host preserves async turns, callback receivers,
AbortController instances, timers, context spread and arbitrary thrown values.
Replacement jobs still emit stale completions for the reducer to discard;
explicit abort suppresses them. Reentrant abort retains the reference cleanup
and error ordering.

Four missing-export differential tests preceded implementation. Tests cover
five replacement gaps, 21 clock/abort combinations, arbitrary rejection values,
emit failures, thrown coercion identity, context getters and reentrant abort.
Maintained checks pass 332 native host tests, 1,379 selected design tests,
13 prompt wrappers, 132 dashboard/queue cases, 14 composer cases and 130 explorer
cases, including all seven original jobs cases. Rust/binding and scoped JS lint,
bidirectional declarations and packed runtime/type consumers pass. Inspected
120×16 loading and completion screenshots; the original reducer and renderer
produce identical frames from native/reference job events. No dependencies or
default integration changed.

Five warmed alternating 500-call Node 22 ARM64 rounds with controlled timers,
resolved item promises, spaced scheduling and 32 retained promises measured
13.816 µs native / 0.588 µs reference (23.49× slower), with all 5,200 events and
zero remaining timers. This measures scheduling overhead, not wall-clock loading
latency. Performance batching remains open, along with detail preparation,
theme, reducer, rendering, runtime/public namespace and broader swap qualification.

### Explorer detail preparation checkpoint

`explorer/detail-content` exposes `prepareDetailContent` and its original result
type. Rust owns width/cache decisions, the UTF-16 content hash and physical-line
grouping, calling the existing Rust Markdown renderer and ANSI-cell adapter.
The host retains cache object identities, mutable cached results, custom string
readers, width coercion and arbitrary exceptions. The current reference's hash
collision behavior is preserved: `costarring` and `liquid` at the same width
reuse the first result. This behavior requires a separate coordinated correction.

Three missing-export tests preceded implementation. Differential tests cover
54 source/width combinations, grapheme styling, blank inputs, width revisits,
mutated results, hash collisions, getter order, patched character readers and
malformed-input diagnostics. Maintained checks pass 337 native host tests,
1,379 selected design tests, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 143 explorer cases, including original detail preparation
and detail-renderer tests. Rust/binding and scoped JS lint, bidirectional types
and packed runtime/declarations pass; the packed runtime rejects external ESM
imports and the type consumer uses `types: []`. No dependencies or default
integration changed.

Inspected 72-column and 36-column prepared-cell screenshots. Native/reference
preparation yields identical original-Screen frames with wrapping and styling.
The screenshot ANSI parser counts a combining mark as an extra cursor column,
which shifts a later absolutely positioned border one column left; this was
reproduced independently with an original Screen frame and is not a port
difference.

Five warmed alternating Node 22 ARM64 rounds retaining 32 results measured
2.438 µs native / 0.249 µs reference for cached preparation (5,000 calls/round,
9.79× slower), and 281.04 µs / 84.58 µs for unique short Markdown sources
(10 calls/round, 3.32× slower). No performance gate passed. Theme, reducer,
remaining renderers, runtime/public namespace and broader swap qualification
remain open.

### Explorer theme checkpoint

`explorer/theme` exposes `getExplorerTheme`, `getExplorerStyles` and the original
interfaces. Rust projects palette styles, formats badge/match text and preserves
palette reads and callback invocation order. The host retains function/style
identities, live callback receivers, object-literal property creation, spread
semantics, coercion and arbitrary thrown values. The highlight style is a fresh
copy; inherited setters cannot intercept result properties.

Three missing-export tests preceded implementation; a fourth reproduced and
corrected inherited-setter interception before delivery. Maintained checks pass
341 native host tests, 1,379 selected design cases, 13 prompt wrappers,
132 dashboard/queue cases, 14 composer cases and 144 explorer cases, including
the original theme suite. Rust/binding and scoped JS lint, bidirectional types
and packed runtime/declarations pass. The packed runtime rejects external ESM
imports and its type consumer uses `types: []`. No dependencies or default
integration changed.

Inspected dark/light screenshots for three brands. Direct ANSI theme output and
original-Screen frames match reference output byte-for-byte. Screen retains its
existing reduction of hexadecimal colors to the basic palette.

Five warmed alternating 5,000-call Node 22 ARM64 rounds retaining 32 results with
color enabled measured 5.463 µs native / 0.263 µs reference for theme projection
(20.76× slower), 9.233 µs / 0.233 µs for style projection (39.58× slower), and
1.492 µs / 3.841 µs for a captured success badge (2.57× faster). These are small
operation costs, not a full-render performance gate. Native/host batching,
remaining renderers, reducer, runtime/public namespace and broader swap
qualification remain open.

### Explorer header checkpoint

`explorer/render/header` exposes `renderHeader` with the original declaration.
Rust controls top/divider borders, active-filter selection, optional companion
list counts, selection/loading indicators, clipping and screen-call order.
The adapter uses the existing Rust theme and text-cell implementations. Host
operations preserve locale lowercasing, receiver binding, clearing side effects,
getter/coercion ordering, nullish fallbacks and arbitrary thrown values.

Three missing-export tests preceded implementation. A fourth reproduced and
corrected the diagnostic for a modified string-repeat method. Differential
coverage includes 280 layout/state combinations, custom counts/title methods,
live getters, malformed fields and reentrant clearing. Maintained checks pass
349 native host tests, 1,379 selected design tests, 13 prompt wrappers,
132 dashboard/queue cases, 14 composer cases and 151 explorer cases, including
the original header and rendering integration snapshots. Rust/binding and
scoped JS lint, bidirectional types and packed runtime/declarations pass;
packed runtime imports reject external ESM dependencies and declarations
compile with `types: []`. No dependencies or default integration changed.

Inspected 72-column and 36-column header screenshots for typed/empty filters,
companion-list counts, selection/loading state and narrow-terminal hints.
Native/reference original-ScreenBuffer output matches byte-for-byte.

Five warmed alternating 500-render Node 22 ARM64 rounds retaining 32 call arrays
measured 698.832 µs native / 158.450 µs reference for a 72-column primary-list
header (4.41× slower), and 684.508 µs / 133.758 µs for a companion-list header
(5.12× slower). No full-render performance gate passed. Other explorer renderers,
reducer, runtime/public namespace, batching and broader swap qualification
remain open.

### Explorer footer checkpoint

`explorer/render/footer` exposes `renderFooter` with the original declaration.
Rust owns modal/action hint selection, accelerator fallbacks, bulk-selection
labels, running-action styles, reorder checks and clipped drawing. Host
operations preserve iterable/destructuring cleanup, callback receivers, live
property reads, string coercions and arbitrary thrown values. Reorder readers
retain JavaScript truthiness and short-circuit behavior. Existing Rust theme and
text-cell helpers provide styling and width calculations.

Four missing-export tests preceded implementation; a fifth reproduced and
corrected custom reorder readers returning nonboolean truthy values. Differential
tests cover 98 layout/state combinations, lazy label coercion, action-key
fallbacks, malformed fields, iterator closing and reentrant drawing. Maintained
checks pass 354 native host tests, 1,379 selected design cases, 13 prompt wrappers,
132 dashboard/queue cases, 14 composer cases and 155 explorer cases, including
all original footer snapshots. Rust/binding and scoped JS lint, bidirectional
types and packed runtime/declarations pass; packed runtime imports reject
external ESM dependencies and declarations compile with `types: []`.
No dependencies or default integration changed.

Inspected 140-column and 45-column footer screenshots for actions, selection,
running state, detail focus, input/confirmation controls and reorder hints.
Native/reference original-ScreenBuffer output is byte-identical.

Five warmed alternating 500-render Node 22 ARM64 rounds retaining 32 call arrays
measured 593.755 µs native / 9.958 µs reference for actions/selection at 100 columns
(59.62× slower), and 177.767 µs / 3.582 µs for input-dialog controls (49.63× slower).
No full-render performance gate passed. Remaining renderers, reducer,
runtime/public namespace, batching and broader swap qualification remain open.

### Explorer list checkpoint

`explorer/render/list` exposes `renderList`, `visibleStart` and `DisplayLine`
with the original declarations. Rust builds group/row/subtitle lines, finds
the visible cursor region, budgets badge/focus columns and applies UTF-16 match
positions to whole grapheme cells. Truncation ellipses remain unhighlighted.
Rendering uses the existing native theme, pane and text-cell implementations;
host primitives retain property/coercion order, iterable cleanup, custom cursor
search callbacks, callback receivers and arbitrary thrown values.

Four missing-export tests preceded implementation. Differential tests cover
240 layout/state combinations, 308 cursor/height/scrolloff combinations, Unicode
titles, missing rows, grouping, loading/empty states, live getters, clearing
effects, iterator closing and reentrancy. Maintained checks pass 358 native host
tests, 1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 155 explorer cases. Existing list/integration suites now
exercise native drawing, including Turkish/Lithuanian casing and UTF-16 emoji
highlight spans. Rust/binding and scoped JS lint, bidirectional declarations and
packed runtime/types pass; packed imports reject external ESM dependencies and
types compile with `types: []`. No dependencies or default integration changed.

Inspected 72-column and 32-column grouped, scrolled and empty-list screenshots.
Native/reference original-ScreenBuffer output is byte-identical.

Five warmed alternating 100-render Node 22 ARM64 rounds retaining 32 call arrays
measured 2,442.585 µs native / 201.852 µs reference for a grouped 72×12 list
(12.10× slower), and 3,187.551 µs / 178.890 µs for a scrolled 20-row list
(17.82× slower). No full-render performance gate passed. Detail/modal/combined
rendering, reducer, runtime/public namespace, batching and broader swap
qualification remain open.

### Explorer modal checkpoint

`explorer/render/modal` exposes `renderModal` with the original declaration.
Rust owns dialog dimensions, centering, titles, help/confirmation/input/content
lines, command-palette filtering, cursor markers and drawing order. Native ANSI,
theme and text helpers handle stripping, styling and cell-aware fitting. Host
operations preserve custom iterators, locale casing, callback receivers, repeated
property reads and arbitrary exceptions.

Four missing-export tests preceded implementation. Differential tests cover
270 modal/geometry combinations, 16 strict action-eligibility combinations,
ANSI/OSC and Unicode content, custom truthy search results, mutable getters,
iterator closing and reentrant drawing. Maintained checks pass 367 native host
tests, 1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 155 explorer cases. Rust/binding and scoped JS lint,
bidirectional declarations and packed runtime/types pass; packed imports reject
external ESM dependencies and declarations compile with `types: []`.
No dependencies or default integration changed.

Inspected 72-column help/palette/content and 36-column input/confirmation/palette
screenshots. Native/reference original-ScreenBuffer output is byte-identical.
Five warmed alternating 200-render Node 22 ARM64 rounds retaining 32 call arrays
measured 702.703 µs native / 84.208 µs reference for the command palette at 72×14
(8.34× slower), and 709.905 µs / 80.374 µs for content (8.83× slower).
No full-render performance gate passed. Combined rendering, reducer,
runtime/public namespace, batching and broader swap qualification remain open.

### Explorer composite renderer checkpoint

`explorer/render/index` exposes `renderExplorer` and identity-preserving exports
of all five regional renderers. Rust constructs the layout request, selects dirty
regions, repaints open dialogs above partial updates and places toast messages
last. JavaScript retains the original region-array iteration and method receivers;
region flags come from the native explorer state module. All rendering dependencies
now use the additive native package, with no default integration changes.

Four missing-export tests preceded implementation. Differential tests cover every
six-bit dirty mask, 18 width/focus combinations, partial-update dialog layering,
toast clearing effects, live getters and bitwise coercion, arbitrary exceptions,
reentrant drawing and re-export identities. Maintained checks pass 371 native host
tests, 1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 155 explorer cases. Existing explorer snapshots now execute
the complete native render composition. Rust/binding and scoped JS lint,
bidirectional types and packed runtime/declarations pass. Packed imports reject
external ESM dependencies; declarations compile with `types: []`.

Inspected 120-column split panes, 70-column focused detail and 72-column dialog
plus toast screenshots. Native/reference original-ScreenBuffer output is
byte-identical; the known screenshot-font loading-glyph limitation remains.
Five warmed alternating 100-render Node 22 ARM64 rounds retaining 32 call arrays
measured 4,758.241 µs native / 585.952 µs reference for full 120×16 rendering
(8.12× slower), and 887.933 µs / 225.508 µs for header-only redraws (3.94× slower).
These composed-render microbenchmarks do not pass the performance gate.
The reducer, runtime/public explorer namespace, batching, broader Toolcraft
coverage and final API/platform/performance qualification remain open.

### Explorer reducer checkpoint

`explorer/reducer` exposes `step(state, event, runtimeHandles?)` with the original
signature. Rust handles event routing, modal/filter/navigation precedence, cursor
and selection updates, reordering, stale detail tokens, scrolling, action-state
recomputation, destructive confirmation and deferred effects. Existing native
filtering, layout, detail preparation, grapheme and action-context code supplies
its dependencies. JavaScript owns asynchronous closures, collection iteration,
spread/coercion semantics and external callbacks. No-op state identities and the
shared no-effect array are retained; suspend effects capture rows and invoke
handlers only when executed. Resume callbacks reread live action IDs.

Five missing-export tests preceded implementation. Added regression coverage
caught and corrected invalid callback diagnostics. Nine differential tests cover
all builtin commands across list/detail/filter/modal states, stale and fresh data
events, successive transitions, selected row capture, nonboolean availability,
callback receivers, shared identities, iterator cleanup, arbitrary synchronous
and deferred failures, and reentrancy. Deep property traces cover 72 builtin/modal
combinations. Maintained checks pass 380 native host tests, 1,379 selected design
cases, 13 prompt wrappers, 132 dashboard/queue cases, 14 composer cases and
155 explorer cases. Original reducer and rendered-navigation tests now run the
native reducer. Rust/binding and scoped JS lint, bidirectional declarations and
packed runtime/types pass; packed imports reject external ESM dependencies and
declarations compile with `types: []`. No dependencies or defaults changed.

Inspected 120-column navigation/select-all, 70-column focused detail and 72-column
palette screenshots after reducing real key events. Native/reference original
ScreenBuffer output is byte-identical. Literal terminal Space still maps to a
filter character in the reference keymap; the native path preserves that behavior
pending a coordinated correction. Named `space` events exercise selection in
existing reducer tests; Ctrl+A was used for the screenshot select-all flow.

After other checks completed, five warmed alternating Node 22 ARM64 rounds with
32 retained results measured 71.483 µs native / 0.410 µs reference for cursor
movement (1,000 calls/round, 174.45× slower), and 201.017 µs / 2.575 µs for refreshing
20 rows (200 calls/round, 78.08× slower). No performance gate passed. Explorer
runtime/public namespace, host-call batching, broader Toolcraft coverage and
final API/platform/performance qualification remain open.

### Explorer runtime checkpoint

`explorer/runtime` now exposes `runExplorer(config)` with the original generic
result declaration. Rust owns terminal lifecycle decisions, input routing,
row/detail event dispatch, rendering coalescence, effect routing, stale request
checks, reorder rollback, modal/toast state, suspension and exit cleanup.
JavaScript retains promises, timers, iteration, callback receivers, exception
identity and filesystem tracing. All runtime rendering and state dependencies
use the additive native implementation; JavaScript remains the default and no
external dependencies were added.

Ten missing-export reference cases preceded implementation. Twenty-one additional
differential cases compare frames, getter order, callback receivers, stale loads,
asynchronous detail failures, live reload callbacks, confirmation/input cleanup,
suspension, action failures, toast expiry, reorder races, after-exit rejection and
trace records. Negative tests caught and corrected three invalid-callback message
mismatches. A native-host integration case runs actual terminal input, screen and
frame-writer composition without driver mocks. The previously omitted overhaul
and wrapped-preview reducer suites now run against native reducer/render/cache
modules, including shared Markdown preparation and physical scroll bounds.

The maintained package build, unit and lint routes pass: 381 native host tests,
1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 209 explorer cases. Scoped JS lint, bidirectional runtime
declarations and packed runtime/types pass. Packed imports reject external ESM
dependencies and the declaration consumer compiles with `types: []`.

Inspected actual runtime screenshots after navigation/focus changes at 120 and
70 columns and text-input/palette opening at 72 columns. Native/reference terminal
screen output is byte-identical. Five warmed alternating Node 22 ARM64 rounds of
10 cycles, retaining 32 outputs, measured 180.336 ms native / 7.393 ms reference
(24.39× slower) for 100×20 startup, initial detail completion, focus/palette input,
repainting and Ctrl+C cleanup. No performance gate passed.

Public explorer namespace/root exports, host-call batching, remaining concrete
wildcard subpaths, broader Toolcraft coverage and final API/platform/performance
qualification remain open. The root export audit also identified the existing
native `createDashboard` function still needing its direct root re-export.

### Dashboard root export correction

The root now re-exports the existing `createDashboard` function and its
`Dashboard`/`DashboardOptions` types, matching the original root contract.
A missing-export test preceded the change. The direct and namespaced factory
identities match; runtime regression cases, dashboard reference cases, bidirectional
root types and scoped JS lint cover the correction. No runtime behavior changed.

### Explorer public API checkpoint

The root exports `explorer`, `runExplorer`, `singleDetail` and
`normalizeExplorerConfig`, with the original explorer types. `explorer/index`,
`run-explorer` and `single-detail` expose their original function/type sets and
share function identities with the root. Rust assembles the single-detail
configuration and item; JavaScript keeps the asynchronous item function and
synchronous renderer closure, preserving captured row/context identities,
function names/lengths, property descriptors and arbitrary thrown values.

Missing-export cases preceded implementation. Three native differential cases
cover namespace/direct-path identities, getters, deferred callbacks, return and
promise identities, and failures. The original public explorer tests now use the
native namespace. The audit also added narrow-layout, global-quit, Unicode-editing,
detail-scroll and modal suites, and mapped state creation throughout the selected
explorer fixtures to the native implementation. There are now 315 selected
explorer cases. The maintained package unit route passed 384 native host tests,
1,379 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and the then-selected 211 explorer cases; the expanded explorer
route and subsequent direct-path checks passed separately. Build, Rust/binding and
scoped JS lint, bidirectional root/namespace types and packed standalone
runtime/declarations pass. Packed imports reject external ESM dependencies and
packed declarations compile with `types: []`. No new dependencies or defaults.

Inspected a 100-column live view using the public root `runExplorer` and
`singleDetail`; native/reference terminal output is byte-identical. Five warmed
alternating Node 22 ARM64 rounds of 10,000 create/items/render cycles retaining
32 results measured 3.909 µs native / 0.086 µs reference (45.58× slower).
No performance gate passed.

Every original root runtime export name is present, but seven experimental native
root exports remain additional. This is not exact root-surface qualification.
Concrete wildcard subpaths, demos, source/packaging checks and ten unselected
original design suites still require auditing. Those suites are ACP components,
templates, dashboard demo/output-preview/pipeline-scenario, explorer demo/import
boundaries, root exports, internal helpers and subpath exports. Host-call batching,
broader Toolcraft and final API/platform/performance qualification remain open.

### Flat design subpath checkpoint

Added the 48 missing flat re-export entry points, preserving each original
runtime and declaration export set. Re-exports retain the existing native
function/object identities without wrapper calls. Template initialization and
its declarations now live in a dedicated native template module shared by the
root, direct helpers and `components/template`.

A missing-import test preceded the additions. The maintained native test derives
all 74 pure flat re-export modules from the original source and compares export
names, module property descriptors and root/plain-formatter identities. The
standalone escape helper has no second root identity; its existing native
behavior tests remain applicable. Bidirectional declaration checks cover all
74 modules and their explicitly exported types. Existing cancellation-symbol
nominal differences remain asserted as a swap gate rather than silently widened.
The original root, representative subpath and template suites now run against
native module resolution, adding 57 reference cases.

Build, scoped JS lint and the maintained package unit route pass: 385 native host
tests, 1,436 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 315 explorer cases. All 74 flat imports work through a
packed-package self-reference with external ESM imports rejected. Their packed
declarations compile with `types: []`; template rendering and root/subpath
function identity pass in the packed consumer. These aliases introduce no new
per-call implementation, dependency or default integration.

The root symbol audit finds no missing names but still finds seven extra native
runtime exports and three extra layout types. Nested subpaths, demos and remaining
reference suites still need qualification. Cancellation-symbol nominal alignment,
performance, broader Toolcraft and final platform/swap gates remain open.

### Exact design root export checkpoint

Removed seven native-only root runtime exports and three root-only layout types.
The original dashboard namespace APIs stay available; geometry and its declarations
live at `dashboard/layout`, with `Rect` imported from `dashboard/types`. Screen
and layout consumers now use those declarations directly. The wildcard-admitted
`index` subpath resolves to the same root module without a wrapper.

Three failing tests preceded the correction. Runtime root names and module
property descriptors, all declaration export names and root/index identity now
match the original. Existing behavioral and bidirectional declaration checks
continue to cover their implementations. Packed root/index/layout self-imports
work with external ESM dependencies rejected, and packed declarations compile
with `types: []`. No rendering algorithms, dependencies or default integration
changed. Nominal cancellation types, remaining nested modules, performance and
the broader Toolcraft swap gates remain open.

### ACP agent-message checkpoint

The native ACP namespace now exposes `renderAgentMessage` and `AcpOutputState`.
Rust defines streaming/success/error glyph styles and message text composition;
the existing native Markdown renderer supplies terminal formatting. JavaScript
retains JSON serialization, live color property access, state-key coercion and
inherited properties, writer lookup and async-local scopes. All four original
ACP import paths (`index`, `components`, `plan`, `writer`) preserve their export
sets and root namespace function identities.

Four failing native cases preceded the implementation. Differential coverage
includes three formats, state defaults and malformed/inherited state keys,
Markdown/code blocks, raw UTF-16, coercion and JSON callback traces, arbitrary
throws, reentrant writers and asynchronous scope restoration. All 15 original
ACP component cases now run against the native implementation. Maintained build,
unit and lint routes pass: 392 native host tests, 1,451 selected design cases,
13 prompt wrappers, 132 dashboard/queue cases, 14 composer cases and 315 explorer
cases. Scoped JS lint, bidirectional module/types and packed standalone imports
and declarations pass. Packed ESM rejects external dependencies and declarations
compile with `types: []`. No new dependencies or default integration changes.

Inspected 100-column and 44-column streaming, completed and failed messages with
headings, lists and code. Native/reference ANSI output is byte-identical; the
screenshot font still lacks the CJK sample glyph. Five warmed alternating Node 22
ARM64 rounds of 200 formatted messages with 32 retained outputs measured
840.863 microseconds native / 123.571 microseconds JavaScript (6.80 times slower).
This does not pass the performance gate. Remaining nested modules, nominal
cancellation types, batching and broader Toolcraft/platform/swap gates stay open.

### Nested utility import checkpoint

Added thirteen original nested entry points: the component barrel and its color,
text and logger modules; dashboard line buffers and output previews; explorer
event types; color support, output format, ANSI stripping, theme detection and
state; and the interactive prompt barrel. Named re-exports preserve the existing
function and cancellation-symbol identities. The component barrel imports its
individual component modules. Added standalone color-support/theme-state types
and corrected both preview constants to their original literal declaration types.

Missing-import and declaration tests preceded the changes. The new checks compare
runtime export sets, module descriptors, implementation identities and every
exported declaration name for all thirteen modules. Bidirectional assignments
cover modules and named types; the existing nominal cancellation-symbol difference
remains an explicit swap gate for the interactive barrel. Original internal-utility
and output-preview suites now use native resolution, adding 65 cases.

Build, scoped JS lint and the maintained package unit route pass: 394 native host
tests, 1,516 selected design cases, 13 prompt wrappers, 132 dashboard/queue cases,
14 composer cases and 315 explorer cases. Final component-barrel adjustments also
pass focused runtime and declaration checks. Packed self-imports, shared theme
state and cancellation identity pass with external ESM dependencies rejected;
packed declarations including the preview literal types compile with `types: []`.
These aliases add no per-call wrappers, algorithms or dependencies; no rendering
or default integration changes, and no new performance claim.

Source plus the original tsconfig (which excludes only `*.test.ts`) still identify
eight missing concrete modules: dashboard demo/terminal strings, explorer demo
and runtime test helpers, dashboard pipeline scenario, explorer render fixtures,
prompt test helpers and Markdown theme fixture. Four original suites remain
unselected: dashboard demo/pipeline scenario and explorer demo/import boundaries.
Already-exposed modules still require the complete package-wide swap audit.
Broader Toolcraft, nominal typing, performance and platform gates remain open.

### Public terminal-string tail checkpoint

`dashboard/terminal-strings` now exposes its original two functions. The stream
filter retains its existing implementation identity; `terminalControlTailStart`
uses a new Rust control-boundary policy with host operations for observable
index/length reads, comparisons, character methods and the live `Math.min` call.
The no-control ingress path returns the original start value without coercion.
It does not expose the bounded internal preview helper as the public function;
that helper's numeric-only contract and loop bound would change observations.

Four missing-subpath cases preceded implementation. Five final differential cases
cover ordinary and boxed strings, CSI/C1 and incomplete escapes, UTF-16, fractional
and nonnumber starts, repeated coercion, live getters/method overrides, error
messages, arbitrary thrown values and reentrancy. Public export names, descriptors,
function metadata and filter identity match. The original nonterminating public
scan for infinite control-bearing starts has not been exercised; complete resource
and performance qualification remains open.

Build, Rust/binding and scoped JS lint, package unit and bidirectional declaration
checks pass: 399 native host tests, 1,516 selected design cases, 13 prompt wrappers,
132 dashboard/queue cases, 14 composer cases and 315 explorer cases. Packed imports
run with external ESM dependencies blocked and standalone declarations compile
with `types: []`. A control-trimming screenshot was inspected; its full-style,
partial-parameter, post-parameter and incomplete-control output is byte-identical
to the reference. No dependencies or default integration changed.

Five warmed alternating Node 22 ARM64 rounds with 32 retained results measured
0.01537 microseconds native / 0.01455 microseconds JavaScript for plain text
(100,000 calls/round), and 9.6193 / 0.03813 microseconds for a short control-boundary
scan (1,000 calls/round, 252.31 times slower). No performance gate passed.
Seven concrete demo/testing modules, the complete existing-surface audit, batching
and broader Toolcraft/platform/swap qualification remain open.

### Dashboard demonstration checkpoint

The original `dashboard/demo` import now exports `startDashboardDemo` and `main`.
Rust owns demo content, counters, progress fields and lifecycle decisions. Node
retains timers, dashboard callbacks, signal handlers and direct-entry execution.
The missing import was reproduced by three failing cases before implementation.
Differential tests cover callback metadata/receivers, runtime getter order,
random coercion and patched Math methods, reentrancy, retained timer callbacks,
initialization TDZ errors and arbitrary thrown values. Nine additional main
cases compare quit/signals, idempotent shutdown and startup/shutdown failures;
the two original demo tests now run against the native module.

Build, Rust/binding and scoped JS lint, package unit and bidirectional declaration
checks pass: 402 native host tests, 1,516 selected design cases, 13 prompt wrappers,
143 dashboard/queue/demo cases, 14 composer cases and 315 explorer cases. Packed
imports pass with external ESM dependencies blocked; standalone declarations
compile with `types: []`. The inspected five-message dashboard screenshot has
byte-identical reference output. No dependencies or default integration changed.

Five warmed alternating Node 22.23.2 ARM64 rounds, 200 demo lifecycles per round
and 32 retained results, measured 113.091 microseconds native / 1.442 microseconds
JavaScript (78.44 times slower). Each lifecycle initializes, emits five output
and stats updates, finishes and repeats cleanup with injected timers. This
isolates demo policy overhead; it is not a real-time dashboard benchmark or a
passed performance gate. Six concrete demo/testing modules, the existing-surface
audit, batching and broader Toolcraft/platform/swap qualification remain open.

### Public terminal testing harness checkpoint

`prompts/interactive/test-helpers` now exports `createPromptHarness` and `tick`;
`explorer/runtime.test-helpers` exports `FakeTerminalDriver`. Rust owns prompt
dimension/TTY defaults, captured-write sequencing and driver lifecycle/key-event
policy. Node retains streams, mutable public fields, listener sets and iterator
cleanup. Three missing-subpath failures preceded implementation. Differential
coverage checks descriptors and function metadata, default/getter order, live
captured arrays, tick scheduling, idempotence, listener mutation during iteration,
coercion, arbitrary throws and abrupt iterator closing. An additional failing
case exposed nonfunction writes-method diagnostics; the adapter now matches the
original TypeError messages.

The existing prompt suites and explorer runtime suite now use these native
harnesses. Build, package unit, Rust/binding and scoped JS lint pass: 406 native
host tests, 1,516 selected design cases, 13 prompt wrappers, 143 dashboard cases,
14 composer cases and 315 explorer cases. Packed imports reject external ESM
dependencies, standalone declaration consumers compile with `types: []`, and
prompt declarations/public driver members assign bidirectionally. The driver's
private declarations remain nominally distinct between packages; the explicit
negative type assertion leaves final alias-swap qualification open. An inspected
interactive confirmation screenshot has byte-identical reference frames.

Five alternating warmed Node 22.23.2 ARM64 rounds, 1,000 calls per round and
32 retained values, measured 11.932/1.056 microseconds native/reference for
prompt-harness construction, two writes and cleanup (11.30 times slower), and
35.008/0.959 microseconds for driver creation, five writes/key dispatches and
stop (36.50 times slower). Stream cleanup is drained between rounds. No
performance gate passed and no dependencies or defaults changed. The remaining
missing concrete design modules are `explorer/demo`, `explorer/render/test-fixtures`,
`dashboard/testing/pipeline-scenario` and
`terminal-markdown/testing/theme-render-fixture`; the existing-surface audit,
batching and broader Toolcraft/platform/swap qualification remain open.

### Explorer rendering fixture checkpoint

`explorer/render/test-fixtures` now exposes all six reference helpers. Rust owns
fresh fixture data, default/override construction and screen traversal; Node
retains async handlers, host maps/sets, live property access and rendering
capabilities. Three missing-import cases preceded implementation. Differential
coverage compares exported metadata, fresh data identities, nested callbacks,
default/filter/narrow/modal states, override getter/enumeration order, screen
dimension reads, method receivers and arbitrary throws. Existing explorer
rendering and wrapped-reducer suites now resolve this helper module natively.

Build, maintained package unit, Rust/binding and scoped JS lint pass: 414 native
host cases, 1,521 selected design cases, 13 prompt wrappers, 143 dashboard cases,
14 composer cases and 331 explorer cases. Packed imports run with external ESM
dependencies blocked; standalone declarations and bidirectional non-buffer
signatures pass. `dumpScreen` retains the original private ScreenBuffer contract,
with explicit negative cross-package assignments keeping nominal alias-swap
qualification open. Default, filtered and help screenshots were inspected and
their ANSI output is byte-identical to the reference.

Five alternating warmed Node 22.23.2 ARM64 rounds, 20 complete 80x14 fixture/state
snapshot renders per round and 32 retained strings, measured 47,654.115
microseconds native / 5,117.042 microseconds JavaScript (9.31 times slower). No
performance gate passed. No dependencies or default integration changed.
`dashboard/testing/pipeline-scenario` is the remaining missing concrete design
module; the complete existing-surface audit, native batching and broader
Toolcraft/platform/swap qualification remain open.

### Markdown theme fixture checkpoint

`terminal-markdown/testing/theme-render-fixture` now reproduces the original
side-effect-only import. Rust owns the two sample documents, theme/render/output
ordering and validation branches; Node supplies environment access, native
Markdown rendering, streams and process exit. Five missing-module failures
preceded implementation. The same differential cases cover successful output,
both missing-ANSI diagnostics, equal outputs and arbitrary rendering failures.
They also caught an unbound-render/reset receiver mismatch, fixed in the host
adapter. The module exports no public values or types, matching the reference.

Build, package unit, Rust/binding and scoped JS lint pass: 406 native host cases,
1,521 selected design cases, 13 prompt wrappers, 143 dashboard cases, 14 composer
cases and 315 explorer cases. Packed imports pass with external ESM dependencies
blocked; standalone and bidirectional declaration checks pass. Real child
processes produce identical stdout, empty stderr and successful exit. The
combined dark/light Markdown screenshot was inspected.

Five alternating rounds after two warmup pairs on Node 22.23.2 ARM64 measured
258.405 ms native / 239.918 ms JavaScript for complete process startup, imports,
theme rendering and validation (1.08 times slower), retaining all 14 outputs.
This small process benchmark does not isolate rendering or pass a performance
gate. No dependencies or default integration changed. Three concrete design
modules remain missing: `explorer/demo`, `explorer/render/test-fixtures` and
`dashboard/testing/pipeline-scenario`. The complete existing-surface audit,
native batching and broader Toolcraft/platform/swap qualification remain open.

### Explorer demonstration checkpoint

`explorer/demo` now exposes the reference option parser, configuration builder,
option interfaces and `main`. Rust owns parsing, sample data, detail shaping and
action-message policy; Node retains live callbacks, shared row arrays, promises,
timer/signal behavior and direct entry. Three missing-import failures preceded
implementation. Five final native comparisons cover export/function metadata,
shared identities, changing getters, inherited record keys, coercion order,
arbitrary throws and runtime admission. Thirteen lifecycle comparisons cover
fast/slow detail resolution, cancellation (including already-aborted signals),
signal failures and main success/rejection. The three original demo tests now
run against native exports.

Build, Rust/binding and scoped JS lint, standalone and bidirectional declarations,
and the maintained package unit route pass. The full run passed 410 native-host
cases, 1,521 selected design cases, 13 prompt wrappers, 143 dashboard cases,
14 composer cases and 331 explorer cases. An additional admission comparison
was then added and all five final demo native cases passed in a focused rerun.
Packed imports reject external ESM dependencies. Real direct-entry runs match
reference non-TTY and invalid-option stdout/stderr/exit behavior.

The original demo's refresh/archive/resolve actions still emit legacy `key`
fields that current `createInitialState` rejects. Both original modes and their
native equivalents reject with the same bare-key diagnostic. This additive port
preserves that behavior; unchanged interactive demo admission is not qualified.
Screenshots of both data modes were inspected with explicit preview-only
`key`-to-`accelerator` adaptation applied equally to both implementations, and
the resulting frames are byte-identical. This is visual/data evidence, not proof
that the unmodified demo starts successfully.

Five alternating warmed Node 22.23.2 ARM64 rounds, 500 cycles each and 32 retained
outputs, measured 98.320 microseconds native / 2.667 microseconds JavaScript
(36.87 times slower) for option parsing, config/rows/detail creation and all
review-mode action callbacks. No performance gate passed. No dependencies or
default integration changed. `explorer/render/test-fixtures` and
`dashboard/testing/pipeline-scenario` remain missing; the existing-surface audit,
batching and broader Toolcraft/platform/swap qualification remain open.


### Pipeline scenario checkpoint

`dashboard/testing/pipeline-scenario` now matches the reference side-effect-only
import and empty declaration namespace. Rust owns options, scenario selection,
stats, counters, output data/loops and timer policy; Node retains dashboard and
line-buffer objects, callbacks, interval handles and process signals. Eighteen
missing-module comparisons failed before implementation. The final 33 differential
cases cover every named scenario, null/default and arbitrary scenario inputs,
method receivers/getter order, repeat calls/failures, arbitrary thrown values,
callback metadata, reentrant append getters, synchronous/undefined timer returns,
repeated non-idempotent shutdown and retained timer callbacks. All six original
pipeline tests now run with native imports and the real native line buffer.

Build, package unit, Rust/binding and scoped JS lint pass: 414 native host tests,
1,521 selected design cases, 13 prompt wrappers, 182 dashboard cases, 14 composer
cases and 331 explorer cases. Standalone packed imports pass with external ESM
dependencies blocked and exercise real dashboard setup/cleanup; packed declarations
compile with `types: []`, and the empty namespace assigns in both directions.
Empty, Unicode, cursor-control and queued-run snapshot screenshots were inspected;
reference/native ANSI output is byte-identical. The known screenshot font lacks
some CJK/emoji glyphs. Real line-buffer scenario output also matches, including
the newline-free case. Snapshot previews use the snapshot renderer's layout and
footer defaults; they do not qualify the entire interactive scenario lifecycle.

Five alternating warmed Node 22.23.2 ARM64 rounds, 200 simulated streaming
lifecycles each with 32 retained outputs, measured 1,135.652 microseconds native /
9.039 microseconds JavaScript (125.64 times slower). A lifecycle includes initial
202 messages, one timer tick and repeated cleanup with injected dashboard/timers;
module loading and real dashboard rendering are excluded. No performance gate
passed. No dependencies or default integration changed.

All previously inventoried concrete design modules now have native entry points.
This is not a completed package parity audit. The complete export/type/import
surface, original-suite admission, native batching, nominal types and broader
Toolcraft SDK/CLI/HTTP/MCP/platform/resource/swap gates remain open. The prior
fixture commit's build succeeded, but its release step was skipped and its
follow-on Release run was cancelled; publication is not verified.


### Complete design export-name inventory checkpoint

A source/tsconfig-derived inventory now covers 207 public design paths rather
than a hand-maintained module list. Its runtime comparison loads 205 modules and
checks namespace keys, value kinds and function names/arities; the two import-time
scenario modules retain their dedicated lifecycle comparisons. The declaration
comparison uses the TypeScript checker to resolve named exports from all 207
reference/native declaration pairs. This checks names, not complete assignability
of every exported type or the behavior of every value.

The first regression run passed the runtime check and failed declaration parity
on eleven paths. Ten native declaration files lacked explicit empty export
boundaries, allowing helper types to become importable in declaration modules;
the shared dashboard-mode declaration affected two public paths. Added `export {}`
to preserve only the explicit exports, matching the reference. No function,
parameter, return type, runtime or dependency changes were needed. Build, the new
two-case native inventory suite, existing bidirectional declaration checks and
scoped JS lint pass. The test reads declarations/config in memory and writes no
fixtures. No new screenshot or performance claim applies to these type boundaries.

The maintained selection currently includes 106 of the original 107 design test
files. The remaining `explorer/imports.test.ts` examines the original TypeScript
source graph and its local parser helpers rather than an imported runtime API;
running it unchanged would not establish native import architecture. Native
import/packaging architecture and the remaining whole-surface behavior/type/swap
gates still need qualification. The pipeline port is verified on remote main at
b3cda6bb18399a79eac4a0d2c596c7c116868eac; its release publication remains pending.


### Toolcraft design entry-point checkpoint

`toolcraft-rust/design` and all 72 existing flat `toolcraft/design/*` helper paths
now forward declaratively to `toolcraft-design-rust`. The native design dependency
was already declared; no dependencies or default integrations changed. These
modules preserve type-only exports, explicit named exports, wildcard exports and
namespace exports. They add no function wrappers or per-call work.

Two failing public-import/declaration tests preceded implementation. The maintained
native tests derive the path list and re-export clauses from the reference source,
compare runtime keys, value kinds and function metadata, and verify exact native
implementation and namespace identities. Explicit namespace exports retain their
precedence over wildcard exports. The TypeScript checker compares every public
export name, including type-only names, across all 73 modules. Consumer checks cover
table options/rendering, Markdown, theme functions, typed selection and explorer
configuration, including rejection of invalid selection values. The original
Toolcraft design-subpath suite is selected with its runtime design import remapped;
its source-text bridge assertion still inspects the original source as written.

Build, Rust/binding lint, scoped JS lint and the maintained Toolcraft package unit
route pass: 118 native tests and 1,566 reference/integration cases in 43 files,
plus declaration checks. Initial unit verification caught a missing reference
`runtime-platform.js`; the reference package's maintained build regenerated it and
all checks then passed. The broader selected workspace dependency build stopped
on an already-declared but uninstalled `@peculiar/x509` package in the OpenSSL
workspace; this checkpoint does not claim that dependency closure build passed.

Packed Toolcraft/native-design artifacts load all 73 imports with other external
ESM packages blocked. Packed standalone declarations compile with `types: []`.
A table rendered through the public Toolcraft imports was inspected as a screenshot
and has byte-identical reference/native ANSI output. Direct re-export identities
establish zero added per-call wrapper overhead; no new benchmark or underlying
design performance improvement is claimed. Full Toolcraft CLI, transport and other
subpath ports, declaration standalone/nominal swap qualification and broader
resource/platform/performance gates remain open.


### CLI stack-diagnostic prerequisite checkpoint

The internal `stack-trim` module now has a Rust policy for cause-section splitting,
framework/runtime frame classification, summary pluralization and raw-mode selection.
Node retains source-map activation and observable string/array methods, callbacks,
iteration and arbitrary thrown values. No public `toolcraft-rust/cli` entry point is
claimed: full CLI parsing, snapshots, execution and result rendering remain open.
The existing CLI renderer's YAML serialization dependency also needs qualification
before that renderer can be ported without importing the JavaScript implementation.

Four missing-module failures preceded implementation. Five final native tests
compare runtime exports/metadata, all six hidden-frame patterns, Windows paths,
Unicode/lone surrogates, nested causes, unchanged boxed-string identity, raw-mode
identity, custom method receivers/order, abrupt iterator closing, malformed input,
primitive thrown values, reentrant callbacks and live array callback metadata.
Source-map checks cover optional absence/null, getter failure, nonfunction errors,
receiver and arbitrary throws. All five original stack-trim tests now resolve the
native implementation through the maintained Toolcraft reference route.

Build, Rust/binding and scoped JS lint, bidirectional declarations and package unit
checks pass: 123 native tests and 1,571 reference/integration cases in 44 files.
The packed internal module works with external ESM packages blocked, and its
standalone declarations compile with `types: []`. The inspected nested-error
screenshot has byte-identical reference/native text. No dependencies or default
integration changes.

Five alternating warmed Node 22.23.2 ARM64 rounds of 2,000 seven-line nested-stack
calls with 32 retained results measured 50.384 microseconds native / 1.416
microseconds JavaScript (35.57 times slower). This does not pass the performance
gate. Callback reentrancy uses the current adapter guard; full stack/resource and
platform qualification remains open with the broader replacement gates.

### Shared numeric schema checkpoint

The internal `number-schema` module now owns number/integer admission, ordered
bounds checks and expected-value descriptions in Rust. Node retains live
`Number` member calls, comparison/template coercion and array methods. Native SDK
validation uses the shared helper, removing duplicate validation and description
logic. It remains an internal module, matching the reference export boundary.

Four failures preceded implementation: three missing-module comparisons and an
SDK regression proving that captured Number predicates ignored later changes.
Five helper comparisons and nine SDK comparisons now pass, covering nonboolean
short-circuit results, getter order, changing bounds, method receivers, array
callback metadata/overrides, string/numeric coercion, reentrancy and arbitrary
thrown values. The shared literal host capability also retains all five stack
diagnostic comparisons. The complete maintained Toolcraft package unit route
passes 129 native tests and 1,571 reference/integration cases across 44 files,
plus bidirectional declarations. Build, Rust/binding lint and scoped JS lint pass.

The packed helper loads with external ESM dependencies blocked. A packed helper
type consumer compiles with `types: []`, resolving the existing native schema
declarations from the checkout. This is not full isolated dependency packaging
qualification. Inspected numeric-description output is reference-identical.
No new dependencies or default integration changes.

Five alternating warmed rounds on Node 22.23.2 ARM64, 2,000 validation/description
pairs per round and 32 retained results, measured 4.946 microseconds native /
0.082 microseconds JavaScript (60.32 times slower). This does not pass the
performance gate. Full CLI/renderer/transports and resource/platform/swap gates
remain open. The preceding stack commit is verified on remote main; its release
build remains pending, with no publication verified.

### Renderer YAML dependency investigation

Direct comparisons of the existing own Rust YAML serializer against
`YAML.stringify` matched ordinary scalar/mixed-array output, nonfinite numbers,
BigInt, repeated references, cycles, Date values and Unicode/lone-surrogate
strings. They exposed different errors for symbols and functions: the native
snapshot used stringified values instead of constructor names. Two differential
regressions failed before the fix, including missing constructor getter calls.

The host snapshot now retains the first unsupported scalar in traversal order
and resolves its constructor name only after all source hooks finish. Host error
construction preserves UTF-16 names, template coercion and arbitrary thrown
values. A third regression verifies that a later source-hook failure takes
precedence over unsupported-scalar diagnostics. All nine YAML native comparisons
pass, along with the maintained configuration and embedding frontmatter package
unit/declaration routes and scoped JS lint. No dependency declarations changed.
This fixes a demonstrated prerequisite defect; it does not qualify arbitrary YAML
Document/node values, all host intrinsics, complete renderer behavior or a default
integration. No performance claim applies to the error-path correction.

Numeric validation is verified on remote main at
f938732656d536dff0bbf26ff5758f4263f7933f. Its Release run 37049166253 is pending;
publication remains unverified.

### Result renderer checkpoint

The internal renderer now exposes `renderResult`, `renderObjectTable` and
`renderArrayTable` with the reference declarations. Rust owns result-mode and
custom-hook selection, MCP payload/error routing, label disambiguation, nested
row/section admission and scalar presentation. Node retains object identities,
observable collection/string/JSON operations, callbacks and stream writes. Rich
cards and tables use the native design workspace. The existing own
`@poe-code/config-mutations-rust` workspace is now a declared runtime dependency
for YAML fallback; no external dependency was added. No default implementation
or public CLI entry point changed.

Four missing-module failures preceded implementation. Eight final differential
tests cover ordinary values and output modes, cyclic/mixed YAML arrays, BigInt,
marked MCP ownership, error-stream routing, custom callback identity/receivers,
getter order, repeated table reads, named filter callbacks, arbitrary write
failures, default process-stream receivers and reentrant rendering. An additional
failing comparison caught V8 error-text differences from dynamic custom-member
calls; explicit host member calls now retain those diagnostics. All 150 original
renderer tests run against native imports. The maintained Toolcraft route passed
136 native tests and 1,721 reference/integration cases across 45 files, plus
bidirectional declarations. The final default-stream/reentrancy test was then
added and all eight renderer comparisons passed in a focused rerun. Build,
Rust/binding lint and scoped JS lint pass.

Packed Toolcraft, native design and native YAML artifacts execute the renderer
with other external ESM imports blocked. The packed type consumer compiles with
`types: []`; existing contract dependencies still resolve from the checkout, so
this is not complete standalone type packaging evidence. An inspected screenshot
covers a nested rich card, Markdown table, JSON and mixed-array YAML output;
native/reference ANSI text is byte-identical.

Five alternating warmed Node 22.23.2 ARM64 rounds of 100 calls each, retaining
32 results, measured native/reference medians of 1,249.696/155.745 microseconds
for the rich card (8.02 times slower), 37.522/2.581 for the Markdown table
(14.54 times slower), 13.980/0.965 for JSON (14.48 times slower), and
17.989/17.459 for mixed-array YAML (1.03 times slower). These are local fixture
measurements, not a performance-gate pass. YAML-library Document/node inputs,
all host-intrinsic behavior, complete resource/platform qualification and full
CLI/transport/swap gates remain open.

Release publication remains unverified. API access recovered after rate limits;
the numeric commit's Release run 37049166253 and the YAML fix's Release run
37049781865 both still report pending validation jobs. The browser also requires
organization SSO before showing the run. No failed or completed release is inferred.

The selected maintained dependency build subsequently passed:
`npm run build:workspaces -- --workspace=toolcraft-rust`. Missing links for
already-declared local workspaces were restored without installing dependencies.
Safe Bash's private LLM workspace profile was corrected to reflect its existing
hash dependency; its build and postbuild passed. The identical metadata correction
arrived independently on remote main, so rebase dropped the duplicate local fix.
The selected build covered 230 build tasks from the derived 290-workspace closure;
this is build evidence, not additional test or release-publication evidence.

### CLI naming and global controls checkpoint

The internal CLI policy module now implements word boundaries and kebab/snake
naming, control resolution, custom output-format admission, reserved global flags
and global command-tree option descriptions in Rust. Node retains indexed reads,
live Unicode/string/array operations, callback identities, object enumeration,
iteration and caller-realm errors. Log-level choices derive from the existing
native log-level inventory. No public CLI entry point, dependencies or default
implementation changed. Schema field collection, command-tree assembly, parsing,
help and execution remain open.

Four missing-module tests preceded the port. Seven final differential tests use
the actual private reference functions extracted with the existing TypeScript
parser in memory, without copying their implementation or writing fixture files.
They cover all 256 control/preset/version combinations, global option order,
custom-format diagnostics, Unicode and lone surrogates, boxed/indexed inputs,
repeated getters, live casing methods, callback metadata, iterator closing,
arbitrary thrown values and reentrancy. A failing malformed-array-method case
demonstrated V8 error-text differences; explicit host expressions now preserve
the original collection names. Maintained package verification passes 144 native
tests and 1,721 reference/integration cases in 45 files, plus declarations.
Build, Rust/binding lint and scoped ESLint pass.

Packed CLI policies execute with the packed own native schema dependency and
other external ESM packages blocked. Packed declarations compile with `types: []`,
but existing contract types still resolve from the checkout; this does not prove
complete isolated type packaging. The inspected global-option table preview uses
identical reference/native data and ANSI output; it is not a complete CLI/help
integration screenshot. The adapter retains the existing 128-entry reentrancy
guard, whose complete resource compatibility remains unqualified.

Five alternating warmed Node 22.23.2 ARM64 rounds, 1,000 calls per fixture and
32 retained results, measured native/reference medians of 90.760/1.042 microseconds
for a 23-character name (87.10 times slower), 11.100/0.070 for controls with a
custom output format (159.13 times slower), and 16.361/0.103 for all global options
(158.46 times slower). These fixtures do not pass the performance gate. Reducing
native/host crossings remains required before considering a default swap.

The renderer is verified on remote main at
c16ca651544a6b7057158027852fe97cba711db3. Its Toolcraft package workflow 37053617629
is running and main Release workflow 37053618196 remains pending; publication is
not yet verified. After rebasing incoming command-package moves, the maintained
Safe Bash dependency closure was rebuilt successfully and its installed `pwd`
smoke check passed again. The underlying startup/artifact coupling remains open.

### Node 18 release-probe repair

The CLI-policy commit is verified on remote main at
b8c907ac8879eba650c97fe6818231d19071632c. Renderer package Release workflow
37053617629 subsequently failed before publication: its Node 18.18 SafeJS
postbuild reported three portable-realm failures and an optimization-probe failure.
All four reproduced on the installed Node 18.20.8 against current built artifacts.
Instrumented probes identified absent global Web Crypto (`randomUUID`) and a V8
trace parser that missed Node 18's completed `[optimizing ... - took ...]` lines.

The portable probe now supplies Node's built-in Web Crypto before clearing Node
globals, matching the browser/Worker capability it simulates. The optimization
probe recognizes the older completion wording while retaining its warmup and
post-GC recompilation assertions. All 20 built-artifact probes pass with no skips
on Node 18.20.8, 20.20.0, 22.23.2 and 24.14.0; Node 22 uses the maintained SafeJS
postbuild command. Scoped ESLint passes. No runtime code or dependencies changed.
This repairs demonstrated release prerequisites; Node 18.18 and successful
publication still require CI confirmation.

### CLI schema-field checkpoint

The internal field module now uses Rust policies for nested schema traversal,
optional/default admission, discriminated and ordinary union selectors, branch
fingerprints and required-field metadata, dynamic record/object-array admission,
CLI aliases and attributes, positional mutation, reserved flag handling and
duplicate flag diagnostics. Node retains live collection/string operations,
iteration, callbacks, opaque schema/default identity, property reads and writes,
and caller-realm errors. No public CLI entry point or dependency was added.
Command-tree assembly, dynamic help rows, parsing and execution remain open.

Five missing-module tests preceded implementation. Ten final field comparisons
exercise the actual private reference functions extracted in memory with the
existing TypeScript parser. The same extraction helper also serves the earlier
control-policy comparisons. Coverage includes nested variants, changing
discriminators, schema/default/path identities, repeated getters, positional
setters and duplicates, conflicting aliases, malformed inputs and methods,
callback metadata, abrupt iterator closing, arbitrary throws and reentrancy.
Three additional failing comparisons exposed set-method lookup order,
variant-array method lookup before metadata reads, and path-method TypeError
wording; the host boundaries now preserve each original expression/order.

Build, Rust/binding lint, scoped ESLint and the maintained Toolcraft package unit
route pass: 154 native tests, 1,721 reference/integration cases across 45 files,
and declaration checks. Packed field policies execute with the packed own native
schema dependency and other external ESM packages blocked. Packed declarations
compile with `types: []`; checkout contract-type resolution still prevents a claim
of completely isolated type packaging. The inspected parameter/flag table preview
is byte-identical for native/reference field data. Full CLI/help integration is
not yet available. Existing adapter recursion guards still need complete resource
qualification before a swap.

Five alternating warmed Node 22.23.2 ARM64 rounds, 100 calls per fixture and
32 retained results, measured 1,289.090/20.508 microseconds native/reference for
nested fields plus uniqueness validation (62.86 times slower), and
2,644.675/41.899 for discriminated/ordinary union collection (63.12 times slower).
These comparisons do not pass the performance gate; JavaScript remains default.

The Node 18 probe repair is verified on remote main at
c3112b01b8059440e0af74fbb8a7b7c6905c55cc. Its main Release workflow 37055408248
completed successfully but skipped publication after queue supersession, so it
does not establish a release. A fresh Toolcraft workflow was dispatched at
119999784433470b15b05b6352c2964ab8d21335, which contains that repair. Workflow
37055529265 last showed all four Node matrix jobs running. Later REST polling
hit a rate limit; no new terminal status or publication is inferred.

### CLI field-help checkpoint

The internal help-field module now uses Rust for positional/boolean/value flag
policies, name/format/pattern hints, compact enum signatures, echo suppression,
required/default metadata, nested record/object-array help rows, enum choices,
JSON help types and lexical help-token roles. Node retains observable string and
collection methods, iteration, coercion, JSON serialization and caller-owned
values. Public CLI entry points and defaults are unchanged; full help documents,
command-tree assembly, parsing and execution remain open.

Four missing-module tests preceded the port. Seven final native comparisons cover
scalar/array hints, compact/oversized enums, defaults and serialization failures,
dynamic nested rows, whitespace/brackets/arguments/Unicode tokenization, repeated
indexed reads, method receivers, coercible closing offsets, callback metadata,
normalization iterator closing, arbitrary throws and reentrancy. A separate frozen
positional-field regression exposed a test-harness mismatch: extracted reference
functions lacked the strict semantics of their source ES module. The extraction
helper now explicitly enables strict mode; existing field/control comparisons and
the new help comparisons all pass against that corrected reference.

Build, Rust/binding lint, scoped ESLint and the maintained Toolcraft package route
pass: 162 native tests, 1,721 reference/integration cases across 45 files, and
declaration checks. Packed helpers execute with the packed own schema dependency
and other external ESM imports blocked. Packed types compile with `types: []` but
still resolve existing contract declarations from the checkout, so fully isolated
type packaging remains open. The inspected help-row preview renders native token
roles and matches reference ANSI bytes; it is not a complete CLI help screen.
Adapter recursion and complete platform/resource behavior remain unqualified.

Five alternating warmed Node 22.23.2 ARM64 rounds, 100 calls per fixture and
32 retained results, measured native/reference medians of 949.615/14.955
microseconds for field help rows (63.50 times slower), and 176.377/0.370 for a
mixed option/argument token string (476.15 times slower). These measurements do
not pass the performance gate; JavaScript remains default.

Field collection is verified on remote main at 7996cd0f00. GraphQL monitoring
recovered release visibility after REST throttling: fresh Toolcraft workflow
37055529265 has passed every Node 18.18/20/22/24 matrix job, confirming the earlier
Node 18 probe repair in CI. Its publish job is still running; successful npm
publication is not yet claimed.

### CLI command-tree snapshot checkpoint

The internal snapshot module now assembles command/group trees with Rust policies
for root normalization, program-name inference, scope visibility, default-command
selection and ordered option metadata. It composes the native approval wiring,
field collection and help policies. Node retains live path/collection operations,
getters, iterators, callback metadata, object identity and Promise behavior.
Dynamic help metadata is evaluated before snapshot rows, retaining serialization
failures even when the corresponding help text is omitted from the result.
No public CLI entry point, dependency declaration or default implementation changed.

Four missing-module failures preceded the port. Eight final comparisons cover
multiple roots, casing/global controls, hidden/non-CLI nodes, nested visibility,
approval injection, defaults, field conflicts, live Boolean replacement, callback
receivers, repeated getters, arbitrary throws, alias iterator cleanup, reentrancy
and malformed inputs. Two failing diagnostic comparisons exposed V8 member-name
differences; explicit host expressions preserve group-alias and default-scope
TypeError wording. Both original snapshot tests now resolve the native module.
The maintained package route passes 170 native tests and 1,723 reference/integration
cases across 46 files, plus bidirectional declarations. Rust/binding and scoped JS
lint pass.

Packed snapshots run with only the packed own schema package admitted as an
external ESM dependency. Packed declarations compile with `types: []`; existing
contract types still resolve from the checkout, so isolated type packaging remains
open. An inspected snapshot-data table has reference-identical ANSI output; this
does not qualify a complete CLI/help screen. Full CLI execution, transports and
platform/resource/swap qualification remain open, including adapter recursion limits.

Five alternating warmed Node 22.23.2 ARM64 rounds of 100 command-tree snapshots,
retaining 32 results, measured 1,262.012 microseconds native / 25.425 microseconds
JavaScript (49.64 times slower). This does not pass the performance gate.

Help-field policies are verified on remote main at 41b75114ff. The earlier Toolcraft
release workflow 37055529265 has successful schema, Toolcraft and OpenAPI publish
steps and packed-signature verification. Registry/attestation and installed-signature
verification remain in progress; a completed verified release is not yet claimed.

### CLI argument-scanning checkpoint

The internal argv module now uses Rust for comma-separated array tokenization,
negative-number recognition, array option boundaries, numeric-array normalization,
output/help format precedence and debug-mode selection. Node retains observable
indexing, string/collection methods, numeric conversion, callback metadata and
caller-realm errors. Optional schema wrappers retain native traversal. No public
CLI entry point, dependency declaration or default implementation changed.

Four missing-module failures preceded implementation. Eight final comparisons use
the actual reference functions extracted in memory. They cover attached/aliased
options, required/optional values, negative lists, `--` termination, custom formats,
Unicode/lone surrogates, empty slots, identity, nonboolean method results, live
Number replacement, changing getters, reentrant calls and arbitrary throws.
Two failing regressions caught optional-token and array-push TypeError wording;
explicit host expressions now preserve the original diagnostics. The maintained
Toolcraft route passes 178 native tests and 1,723 reference/integration cases in
46 files, plus declarations. The canonical full CLI execution suites are still
unported; private-function comparisons do not establish their coverage.

Build, Rust/binding lint and scoped JS lint pass. Packed argv helpers execute
with all external ESM imports blocked; packed declarations compile with `types: []`
but still resolve existing contract types from the checkout. An inspected
normalization-preview screenshot has reference-identical ANSI output; it is not
a complete CLI execution screenshot. Fully isolated type packaging and current
adapter reentrancy limits remain unqualified.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 invocations with
32 retained results measured native/reference medians of 53.130/0.247 microseconds
for numeric-array normalization (215.21 times slower) and 13.801/0.068 for output
scanning (201.97 times slower). These local fixtures do not pass the performance
gate. Full parsing, dynamic options, prompting, help integration, transports and
resource/platform/swap qualification remain open.

Command-tree snapshots are verified on remote main at f9d76811f8. Its main Release
workflow 37060818999 is pending. Separately, Toolcraft package workflow 37055529265
completed successfully on 1199997844, including actual publication of
`toolcraft-schema@0.0.750`, `toolcraft@0.0.750` and `toolcraft-openapi@0.0.750`,
registry/attestation availability and installed-signature checks. That release
verifies the earlier Node 18 repair; it does not publish these later private Rust
CLI changes or authorize switching the default implementation.

### Unicode-length prerequisite repair

CLI string-validation dependency inspection reproduced a mismatch in the native
schema package's public `unicodeLength`: its UTF-16-only binding rejected boxed
strings and arbitrary iterables and ignored replacement string iterators. The
reference uses spread iteration, counting yielded values. Three differential
regressions failed before repair, covering iterable admission, getter/receiver
order, arbitrary thrown identity, live string iterators and reentrant iteration.

The Node adapter now performs the reference spread operation; Rust reads the
resulting native array length without converting elements or allocating a second
collection. This also restores the reference function name/arity. Primitive
strings retain Unicode/lone-surrogate counts, while invalid inputs now throw the
original TypeError. This repairs a demonstrated API dependency defect, not the
still-unported CLI scalar parser.

The maintained schema route passes 64 native tests, all 2,634 reference cases in
23 files, package declarations and all six original compile-check fixtures.
Rust/binding and scoped JS lint pass. Packed public imports preserve boxed/custom
iteration and invalid-input errors with external ESM dependencies blocked. No
dependency declarations or defaults changed.

Five alternating warmed Node 22.23.2 ARM64 rounds, 10,000 calls and 32 retained
results, measured native/reference medians of 0.510/0.383 microseconds for a
repeated mixed-Unicode primitive string (1.33 times slower) and 2.235/2.172 for
its boxed form (1.03 times slower). This is compatibility evidence with measured
overhead, not an overall performance-gate pass. Full platform/resource qualification
and the remaining replacement gates stay open.

Argument scanning is verified on remote main at 878461e8ed. Its main Release
workflow 37061810895 remains pending; no later publication is inferred from the
separate successful Toolcraft 0.0.750 release.

### CLI scalar and array value checkpoint

The internal value module now uses Rust for scalar dispatch, nullable admission,
boolean/enum selection, string and array bounds, pattern admission, received-value
descriptions, JSON catch routing and missing-parameter diagnostics. It composes
the native numeric validator, repaired Unicode helper and array scanner. Node
retains observable Number/String/JSON/RegExp operations, iteration, callbacks,
coercion order and caller-owned values. No public CLI entry point, dependency
declaration or default implementation changed.

Five missing-module failures preceded implementation. Nine final comparisons use
the actual reference functions extracted in memory, now with their original
numeric, Unicode and suggestion dependencies. They cover nullable/optional values,
negative zero, enum choices, Unicode/lone surrogates, boxed string identity,
patterns and invalid patterns, bounds, malformed methods, changing getters,
custom map/find callbacks, reentrancy and arbitrary throws. JSON tests retain
catch boundaries and errors thrown while formatting parser failures; pattern
tests retain constructor/test receivers and nonboolean results.

Build, Rust/binding lint, scoped JS lint and the maintained Toolcraft route pass:
187 native tests, 1,723 reference/integration cases across 46 files, and declaration
checks. Full CLI execution suites remain unported. Packed parsers run with the
packed own schema package and other external ESM dependencies blocked. Packed
types compile with `types: []`, but existing contract declarations still resolve
from the checkout, so fully isolated type packaging remains open. An inspected
diagnostic preview has reference-identical ANSI output; it is not a full CLI run.

Five alternating warmed Node 22.23.2 ARM64 rounds, 1,000 calls and 32 retained
results, measured native/reference medians of 5.309/0.062 microseconds for numeric
parsing (86.21 times slower), 42.934/0.117 for a five-number array (368.27 times
slower) and 16.989/5.352 for an enum suggestion error (3.17 times slower). These
fixtures do not pass the performance gate. Complete host-intrinsic/resource
qualification, dynamic options, prompting/help, transports and swap gates remain
open.

The Unicode repair is verified on remote main at 7229db6674. Its main Release
workflow 37062360512 is running the build job; successful publication is not yet
claimed. The preceding argv Release workflow completed with release-stable
skipped, so it did not establish publication of those later changes.

### Suggestion host-semantics repair

Value-parser dependency inspection reproduced three gaps in the original native
suggestion adapter: custom map callbacks saw records without distances, boxed or
indexed strings were rejected by UTF-16 ingress, and live Array/Math methods were
bypassed. Rust now controls suggestion admission, default selection, distance
matrix traversal and sort branching. Node retains the original chained collection
calls, matrix allocation/access/assignment, coercion and locale comparison.
The public function's name, arity, signature and original candidate identity are
preserved. No dependencies or default integration changed.

Six final regressions cover those failures plus sparse candidates, matrix proxy
access order, repeated comparator reads, NaN strict comparison, limits, malformed
sources, arbitrary throws and reentrancy. The maintained Toolcraft route passes
193 native tests, all 1,723 reference/integration cases in 46 files and declaration
checks. Rust/binding and scoped JS lint pass. Existing CLI parser comparisons
also pass with the corrected dependency.

Packed public suggestions preserve custom/boxed sources with only the packed own
schema dependency admitted as external ESM. Packed declarations compile with
`types: []`; checkout contract-type resolution still prevents a claim of fully
isolated type packaging. An inspected suggestion preview has reference-identical
ANSI output. Complete host/resource/platform and swap qualification remain open.

This correctness repair has a substantial performance cost. Five alternating
warmed Node 22.23.2 ARM64 rounds of 100 five-candidate lookups, retaining 32 results,
measured native/reference/previous-native medians of 1,237.673/21.056/2.748
microseconds. The corrected path is 58.78 times slower than JavaScript and 450.40
times slower than the previous native path, which failed the compatibility tests.
The earlier scalar-checkpoint enum timing is superseded by a fresh five-round,
100-call comparison: 218.771/7.387 microseconds native/reference (29.62 times
slower). Reducing native/host crossings while retaining semantics remains necessary
before a swap; these measurements do not pass the performance gate.

Scalar/array parsing is verified on remote main at 746d31522e. GraphQL confirms
its main Release workflow 37063531308 completed but skipped release-stable;
this is not publication. REST monitoring hit a rate limit; GraphQL remains usable.

### JSON parse-location diagnostic checkpoint

The internal JSON diagnostic module now uses Rust for cause/direct/message
location precedence, finite own-property admission, message digit scanning,
UTF-16 source offsets, suffix removal and diagnostic assembly. Node retains live
property/method access, numeric conversion, source rendering and string coercion.
Cause line/column locations precede direct offsets and parsed message positions;
method lookup and quoted/unquoted path timing match the reference. The complete
CLI entry point and default implementation remain unchanged; no dependency was added.

Four missing-module failures preceded implementation. Nine differential tests
extract the actual reference helpers in memory and cover UTF-16/lone surrogates,
numeric extremes, own-property precedence, live Number/Math predicates and
methods, repeated digit coercion, parseInt lookup before slice, getter order,
reentrant source access, malformed inputs and arbitrary thrown identity.
Build, Rust/binding lint, scoped ESLint and the maintained package route pass:
202 native tests, 1,723 reference/integration cases in 46 files and declarations.

Packed diagnostic imports execute with only packed own schema/design packages
admitted as external ESM dependencies. This internal module's packed declarations
compile with types: [] and skipLibCheck: false without contract-type dependencies;
that does not qualify the rest of the package's standalone declarations. An
inspected diagnostic screenshot matches the reference text, path, gutter and
caret; it is not a complete CLI execution screenshot.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 calls, retaining
32 results, measured native/reference medians of 54.293/0.047 microseconds for
a 20-code-unit source offset (1,165.51 times slower) and 65.184/1.063 for a full
file diagnostic (61.30 times slower). Per-character native/host crossings remain
an optimization requirement; this does not pass the performance gate. Full CLI,
transport, resource/platform, reentrancy-limit and swap gates remain open.

The suggestion repair is verified on remote main at ae63fd1f94. Its main Release
workflow 37064376497 completed successfully with release-stable skipped, so no
new publication is inferred.

### CLI option-construction checkpoint

The internal option module uses Rust for alias grouping, reserved-global-flag
collisions, boolean negation, scalar/JSON/variadic flag selection and Commander
attribute policy. Node retains the existing Commander constructor/prototype,
field getters, alias iteration, flatMap callbacks, parser closures and attribute
accessors. Commander is an existing dependency, not a newly added package; its
replacement and qualification remain part of the complete rewrite.

Four missing-module failures preceded implementation. Eight final comparisons
extract the original functions and cover all schema branches, aliases, reserved
flags, actual Commander parsing, live parser/attribute identity, changing getters,
custom flatMap results, prototype method receivers, reentrant construction and
arbitrary thrown values. A declaration-consumer name collision was repaired.
Build, Rust/binding lint, scoped ESLint and the maintained package route pass:
210 native tests, 1,723 reference/integration cases in 46 files and declarations.

Packed runtime options construct and parse with only the packed own schema and
the already-installed Commander package admitted as external ESM imports. Packed
types compile with types: []; schema/contract types still resolve from the
checkout, so complete standalone declaration packaging remains open. An inspected
Commander help preview matches the reference output; this does not qualify the
complete Toolcraft CLI, dynamic options, prompts or rich help integration.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 boolean-option
constructions with an alias, retaining 32 results, measured native/reference
medians of 14.213/1.324 microseconds (10.74 times slower). No performance or swap
gate passes. Native platform/resource and adapter reentrancy limits remain open.

JSON diagnostic construction is verified on remote main at 4be52b7a3d. Its
Release workflow 37065772483 is running validate/build; publication is unverified.

### Primitive source-offset performance repair

The JSON location benchmark identified a host callback for every source code
unit. Primitive strings with primitive numeric live bounds now scan their UTF-16
prefix in Rust. The binding queries the string length and copies at most the
admitted prefix plus a terminator; a short offset into a large source does not
copy the whole source. Boxed/indexed sources and nonnumeric live Math.max results
retain the observable host loop. Math.max/Math.floor lookup and coercion still
occur before native admission. No dependencies or public signatures changed.

A failing Rust scan test preceded implementation. Two further differential tests
cover fractional/nonfinite/custom bounds, primitive/boxed sources, inherited
string indices and inherited location setters. The first native object builder
failed the setter comparison; results now use the original host object literal,
preserving own data properties and their descriptors. All 11 diagnostic
comparisons pass. The maintained package route passes 212 native tests, Rust
tests, 1,723 reference/integration cases across 46 files and declarations.
Rust/binding and scoped JS lint pass. Packed imports exercise optimized and
fallback paths with only packed own schema/design imports allowed. An inspected
diagnostic preview remains reference-identical.

A final benchmark after local test/lint jobs completed used Node 22.23.2 ARM64,
five alternating warmed rounds and 32 retained results. Native/JavaScript/prior
native medians in microseconds were:

| Case | Calls per round | New native | JavaScript | Prior native |
| --- | ---: | ---: | ---: | ---: |
| 20-code-unit offset | 1,000 | 1.400 | 0.039 | 42.132 |
| 4,096-code-unit offset | 100 | 2.796 | 6.629 | 7,372.236 |
| 20-code-unit offset into 4 MiB source | 1,000 | 0.906 | 0.044 | 28.709 |
| Full JSON file diagnostic | 1,000 | 24.258 | 0.918 | 59.229 |

The longer offset is 2.37 times faster than JavaScript; short offsets improve
30.10 times over the previous native path but remain 35.47 times slower than JS.
Full diagnostics improve 2.44 times over prior native and remain 26.44 times
slower than JS. These narrow measurements do not pass the overall performance
gate. Prefix allocation still scales with the scanned length; complete resource,
platform and reentrancy qualification remain open alongside CLI/transports/swap.

Option construction is verified on remote main at f378f04216. Its Release run
37066397357 is still building. The JSON diagnostic run 37065772483 completed
successfully but skipped release-stable, so it did not establish publication.

### CLI field-consumption checkpoint

The internal field-consumption module uses Rust for scalar/array/JSON dispatch,
inline and following-token precedence, implicit/explicit booleans, variadic array
boundaries, nullable early completion and option validation-error collection.
It composes native scalar/array parsers and numeric-option scanning. Node retains
iteration and cleanup, live coercion/getters, original successful values, error
catch boundaries and the existing Commander InvalidArgumentError constructor.
No dependency declarations or default implementation changed.

Four missing-module tests preceded implementation. Eight final comparisons use
the actual extracted reference helpers, covering nullable values, inline inputs,
negative arrays, missing arguments, bounds, parsed object identity, iterator
cleanup on null/failure, live Array.isArray, index coercion, error-property order,
malformed inputs, arbitrary thrown identity and reentrant calls. The maintained
package route passes 220 native tests, Rust tests, 1,723 reference/integration
cases across 46 files and declarations. Rust/binding and scoped JS lint pass.

Packed field consumers run with only packed own schema and existing Commander
admitted as external ESM imports. Packed declarations compile with types: [];
schema/contract declarations still resolve from the checkout, leaving full
standalone types unqualified. An inspected collected-error table matches the
reference ANSI output. Complete CLI construction, dynamic values, prompting,
rich help integration, transports and resource/platform/swap gates remain open.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 variadic numeric-field
consumptions, retaining 32 results, measured native/reference medians of
41.220/0.338 microseconds (122.07 times slower). This composed path needs fewer
native/host crossings and does not pass the performance gate.

Primitive source-offset optimization is verified on remote main at 3cfebd1944;
Release workflow 37067379403 is building. Option-construction Release workflow
37066397357 completed successfully with release-stable skipped. No new package
publication is claimed.

### Dynamic CLI path-resolution checkpoint

The internal dynamic-path module now uses Rust for optional-schema traversal,
scalar leaf admission, object/record/indexed-array descent, numeric selectors,
qualified diagnostics and longest-prefix field selection. Node retains live
entries/keys, array sort/find/map/every calls, destructuring/iterator cleanup,
path spreading, string methods and original field/schema identity. It composes
the existing native CLI casing and available-value formatting modules. No
dependency declarations, public CLI entry point or default implementation changed.

Four missing-module tests preceded implementation. Eight final comparisons use
actual extracted reference helpers and cover casing, leading-zero indices,
unsupported shapes, longest prefixes, getter order, custom collection callbacks,
entry/selector iterator cleanup, coercion, reentrancy and arbitrary throws.
Malformed-input tests caught generic path-spread TypeError wording; separate
output/display expressions and the original path-join parameter preserve it.
The maintained package route passes 228 native tests, Rust tests, 1,723
reference/integration cases across 46 files and declarations. Rust/binding and
scoped JS lint pass.

Packed paths resolve original schema/field identities with only the packed own
schema admitted as an external ESM import. Packed declarations compile with
types: []; existing contract dependencies still resolve from the checkout, so
standalone type packaging remains open. An inspected path/diagnostic table has
reference-identical ANSI output; this is not complete CLI execution coverage.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 indexed-object flag
resolutions, retaining 32 results, measured native/reference medians of
63.205/1.227 microseconds (51.50 times slower). This does not pass the performance
gate. Dynamic value assembly, full CLI/prompts/help, transports and
resource/platform/reentrancy/swap qualification remain open.

The source-offset and field-consumption Release workflows 37067379403 and
37068176439 both completed successfully with release-stable skipped. This
establishes successful workflows, not later package publication.

### Dynamic CLI value-assembly checkpoint

The internal dynamic-value module now uses Rust for optional/null admission,
JSON validation routing, indexed-object array conversion, numeric/contiguous
index checks, recursive object/record assembly, default selection and required
field diagnostics. It uses native schema validation/default cloning. Node
retains computed property assignment, own-property record construction, live
collection methods, getters, iterator cleanup and original unchanged values.
No dependency declarations or default implementation changed.

Four missing-module tests preceded implementation. Eight final comparisons
extract the actual reference helpers and cover JSON constraints, scalar identity,
nullable and unsupported shapes, cloned defaults, required fields, sparse and
noncanonical indices, issue paths, computed-key/default getter ordering, inherited
setters, __proto__ record keys, live Number.isInteger/sort/some callbacks, iterator
cleanup, malformed inputs, arbitrary throws and reentrancy. The maintained
package route passes 236 native tests, Rust tests, 1,723 reference/integration
cases across 46 files and declarations. Rust/binding and scoped JS lint pass.

Packed value assembly runs with only the packed own schema admitted as an
external ESM dependency, retaining independent default clones and nested errors.
Packed declarations compile with types: []; existing contract types still
resolve from the checkout, so complete standalone declarations remain open.
An inspected indexed-array/required-field diagnostic table matches the reference
ANSI output; complete CLI execution has not been qualified.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 two-record indexed
array assemblies with numeric/JSON defaults, retaining 32 results, measured
native/reference medians of 76.874/2.247 microseconds (34.21 times slower).
This does not pass the performance gate. Dynamic argv integration, full
CLI/prompts/help, transports and resource/platform/reentrancy/swap gates remain.

Dynamic path resolution is verified on remote main at 412a868244. Its Release
workflow 37069094544 is pending build; no new publication is claimed.

### Dynamic CLI argv integration checkpoint

The internal dynamic argv parser now composes native path resolution, field
consumption and nested value assembly. Rust controls option/positional routing,
terminators, negation, attached values, raw field stores and own-property nested
writes. Node retains Map/Set construction and methods, array callbacks, property
descriptors and the reference's live label replace operation. Repeated flags,
provided-field IDs, validation errors and positional order follow the reference.
No dependencies or default implementation changed; a public CLI entry point is
still unavailable.

Four missing-module tests preceded implementation. Eight final comparisons use
the original extracted parser and dependencies, covering records/indexed objects,
booleans, arrays, duplicate flags, missing and unknown arguments, terminators,
getter order, custom Map/Set operations, final Map constructor lookup before
filter evaluation, inherited containers, __proto__/constructor keys, property
descriptors, reentrancy and arbitrary thrown values. The maintained package route
passes 244 native tests, Rust tests, 1,723 reference/integration cases across
46 files and declarations. Rust/binding and scoped JS lint pass.

Packed consumers parse dynamic flags into values and positionals with only
packed own schema and existing Commander admitted as external ESM imports.
Packed declarations compile with types: []; existing contract declarations still
resolve from the checkout. An inspected result/positional preview matches the
reference ANSI output. Full CLI construction, command selection, prompting/help,
transports and platform/resource/reentrancy/standalone-type gates remain open.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 two-job dynamic argv
parses, retaining 32 results, measured native/reference medians of
422.750/6.909 microseconds (61.19 times slower). This composes the current
compatibility paths and does not pass the performance or default-swap gates.

Dynamic value assembly is verified on remote main at 83f07b0782. Its Release
workflow 37069837816 is running validate/build; publication remains unverified.

### CLI argument-preparation checkpoint

The internal argument preparer now uses Rust for command/alias/default selection,
short option clusters, attached/required/optional value consumption, verbose
normalization, first-help-path capture and dynamic scalar flag normalization.
Node retains Commander objects, live find callbacks, loader invocation, property
reads, string methods, slice/spread operations and arbitrary thrown identity.
Only user errors from dynamic resolution are suppressed, matching the reference.
No dependencies, public CLI entry point or default implementation changed.

Four missing-module failures preceded implementation. Nine final differential
tests extract the actual reference helpers and cover terminators, unknown flags,
command aliases/default retries, changing default-name getters, output/help
precedence, dynamic scalar/boolean/array fields, callback/receiver order, live
Set and array methods, spread iteration, malformed inputs and reentrancy.
A separate failing regression caught the path-push TypeError wording; distinct
path and normalized-array host expressions now preserve the reference message.
The maintained package route passes 253 native tests, Rust tests, 1,723
reference/integration cases across 46 files and declarations. Rust/binding and
scoped JS lint pass. Complete CLI execution suites are not redirected yet.

Packed consumers select defaults and normalize dynamic flags with only packed
own schema and existing Commander admitted as external ESM imports. Packed
declarations compile with types: []; existing contract declarations still
resolve from the checkout, so standalone type qualification remains open.
An inspected normalization/help-target preview has reference-identical output;
it is not a complete interactive CLI run.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 command/alias/dynamic
flag/help preparations, retaining 32 results, measured native/reference medians
of 112.408/2.356 microseconds (47.71 times slower). Native/host crossings still
need optimization; the performance/default-swap gates remain unpassed. Full CLI
construction and execution, prompts/help integration, transports and complete
resource/platform/reentrancy/packaging qualification remain open.

Dynamic argv integration is independently verified in remote main at d67b4261af.
Its Release workflow 37070671678 remains pending build at the latest check.
The preceding value-assembly workflow 37069837816 completed successfully with
release-stable skipped. Neither observation establishes new publication.

### CLI command-tree construction checkpoint

Native command construction now composes the existing field collector, option
builder, numeric-array normalization and scope visibility policies. Rust selects
commands/groups, filters scope, attaches hidden defaults with collision-free
internal names, controls lazy field initialization, routes parsed operands and
unknown flags, and validates global output/debug/log-level options. Node retains
the existing Commander constructors, live collection callbacks and method lookup,
iterator cleanup, private closure state and asynchronous action callback timing.
The action passes the original command, declaration path, dynamic fields,
positionals, options and raw argv into execution. No external dependencies or
default implementation changed; full Toolcraft execution is still unfinished.

Four missing-module comparisons preceded implementation. Ten final differential
tests use extracted reference declarations and actual Commander parsing. They
cover scoped trees, aliases, reserved child names, hidden-default collisions,
lazy field identity, retry after collection failure, option parser diagnostics,
getter/registration order, async receiver/timing/rejection identity, malformed
inputs and reentrant loaders. A composition test runs native tree construction,
argument preparation, Commander dispatch and dynamic-value parsing together.
It does not substitute for the remaining complete CLI suites.

The maintained package route passes 263 native tests, Rust tests, 1,723 original
reference/integration cases across 46 files and declaration consumers.
Rust/binding and scoped JS lint pass. Packed runtime consumers perform the
composed parse/dispatch path with only packed own schema and existing Commander
admitted as external ESM imports. Packed types compile with types: [], while
contract declarations still resolve from the checkout. An inspected Commander
root/leaf help screenshot matches the reference output exactly; Toolcraft's
rich help and prompts are not yet wired to native execution.

Five alternating warmed Node 22.23.2 ARM64 rounds, 500 calls and 32 retained
results, measured 771.795/50.405 microseconds native/reference for constructing
a one-command tree, loading fields, preparing alias/dynamic/numeric-array argv,
parsing with Commander and assembling dynamic values through an async action.
Native is 15.31 times slower for this larger fixture. This is a different workload
from the prior preparation-only benchmark, not evidence of a speedup. No
performance/default-swap gate passed. Full handler/parameter execution,
prompts/help, transports, standalone types and platform/resource/reentrancy
qualification remain open, as does replacing/qualifying existing Commander.

Argument preparation is verified on remote main at 3f66a675ff. Its Release
workflow 37071728185 and the preceding dynamic-argv workflow 37070671678 completed
successfully, both with release-stable skipped; no later publication is inferred.

### CLI field-prompt checkpoint

Native field prompting now uses a Rust continuation engine for enum option
loading, enum/boolean/text selection, labels/defaults, stream merging,
cancellation and returned-value parsing. The adapter uses native design prompts
and native schema default cloning. Node retains promises/thenables, callback
receivers, live method access, object spread and terminal streams. Each reference
await has one matching continuation boundary; concurrent option loaders keep
independent state. No external dependencies or default implementation changed.

Four missing-module failures preceded implementation. Nine differential tests
extract the actual private reference declarations and inject only prompt I/O
capabilities. They cover loaded/static choices, scalar/array/JSON parsing,
cloned defaults, cancellation, getter and thenable order, arbitrary thrown
identity, spread descriptors/symbols, malformed helpers and concurrent loaders
resolving out of order. A cold dynamic import initially exhausted the per-test
timeout; static module import removed that work from the test body without
increasing the timeout. The maintained package route passes 263 native Node
tests, Rust tests, 1,732 reference/parity cases in 47 files and declaration
consumers. Rust/binding and scoped JS lint pass.

Actual in-memory TTY input separately verified text, boolean, enum selection,
invalid numeric input and Ctrl-C against reference output, errors and raw-mode
transitions. The inspected screenshot matches the reference. Packed consumers
exercise a real numeric prompt with only packed own schema/design dependencies
admitted as external ESM imports. Packed declarations compile with types: [];
contract types still resolve from the checkout, leaving standalone type
qualification open. Full CLI execution suites are still not redirected.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 non-interactive enum
default prompts, retaining 32 results, measured 15.034/1.528 microseconds
native/reference (9.84 times slower). This fixture includes the native design
prompt path but no human input wait; it does not pass the performance/default
swap gate. Parameter resolution, variants/presets, full handler execution,
rich help, transports and platform/resource/reentrancy qualification remain.

Command construction is independently verified in remote main at ccd30abfdb.
Its Release workflow 37073128505 failed in Build workspace and CLI outputs.
GraphQL confirms the failing step; REST logs are rate-limited, and the root cause
of that exact run remains unverified. Later main includes the independently
reproduced SQLite private-build dependency repair 253b699e5e and packaging
follow-up f912a37695. Rebase includes those changes; a later successful build
must verify the combined state before treating the delivery as build-qualified.
No new publication is claimed.

### CLI variant-resolution checkpoint

Rust now controls active variant selection, parent-branch admission, inactive
branch diagnostics, selected-branch defaults and required scalar/dynamic fields.
The adapter composes native field prompts, schema cloning and nested writes.
Host for-of loops preserve iterator closing and await only actual prompt calls;
own-property lookup retains the caller's live path.reduce behavior. No external
dependencies or default implementation changed; full CLI execution remains open.

Four missing-module failures preceded implementation. Nine final differential
tests cover selectors, nested variants, defaults, custom Map/Set receivers,
getter ordering, special property names, arbitrary prompt rejection, iterator
closing, thenables, concurrent runs and synchronous-branch timing. Verification
passes 263 native Node tests, Rust tests, 1,741 reference/parity cases across
48 files, declarations, Rust/binding lint and scoped ESLint. Packed consumers
exercise selection, cloned defaults and required prompts. Packed declaration
checks still resolve contract types from the checkout, so standalone packaging
is not qualified. Actual in-memory terminal comparison and the inspected
screenshot match reference output, state and raw-mode transitions.

Five alternating warmed Node 22.23.2 ARM64 rounds of 1,000 selected-local-branch
resolutions, retaining 32 results, measured native/reference medians of
33.263/0.832 microseconds (40.00 times slower). The fixture uses a provided path,
cloned JSON and dynamic defaults without prompting. No performance/default-swap
gate passed. Presets, full parameter/handler execution, generated help,
transports and platform/resource/standalone-packaging qualification remain.

Field prompting is independently verified on remote main at da2a334da7. Its
Release workflow 37074373451 completed successfully, including validate/build;
release-stable was skipped. This verifies a later combined build after the
earlier command-tree build failure; it does not establish that failure's exact
cause or any new publication. Variant resolution is independently verified on
remote main at 5347c2bf72. Its Release workflow 37075570583 completed successfully
with validate/build passing and release-stable skipped; no publication occurred.

### CLI preset-loading checkpoint

Native preset loading now reads JSON files through the Node filesystem capability
and uses Rust for read-error policy, scalar/array validation, nested-field routing,
dynamic-schema validation admission, defaults and diagnostic selection. Existing
native schema, numeric-validation and JSON-location modules supply dependencies.
Node retains actual file reads, JSON parsing, live array callbacks, Map methods,
object property access and ordered entry iteration. Exactly one read await is
preserved. No external dependencies or default implementation changed.

Four missing-module failures preceded implementation. Nine final differential
tests extract the actual reference declarations, including their own-property
helper, and use memfs for files. They cover valid nested presets, integer/string/
array constraints, nullable/JSON/enum values, dynamic defaults and nested issues,
read and parse failures, getter/method ordering, duplicate paths, special keys,
arbitrary thrown identity, parser causes, thenables and independent concurrent
loads. The maintained package route passes 263 native Node tests, Rust tests,
1,750 reference/parity cases in 49 files and declarations. Rust/binding lint and
scoped ESLint pass. Packed runtime consumers load actual files, preserve nested
defaults and report missing files. Packed declarations compile with types: [],
but contract declarations still resolve from the checkout. The inspected preset
result/JSON source-snippet screenshot matches the reference output exactly.

Five alternating warmed Node 22.23.2 ARM64 rounds of 500 complete preset loads,
retaining 32 results, measured native/reference medians of 140.539/90.426
microseconds (1.55 times slower). This fixture includes actual warmed file reads,
JSON parsing, scalar/array/dynamic validation and defaults. It is not comparable
to earlier no-I/O helper workloads and does not pass the performance gate.
Full parameter/handler execution, generated help, transports, standalone
packaging and platform/resource/reentrancy/default-swap gates remain open.

Preset loading is independently verified on remote main at ed612f5713. Its
Release workflow 37076564082 completed successfully with validate/build passing
and release-stable skipped; this is build verification, not publication.

### CLI parameter-resolution checkpoint

The native parameter resolver now composes dynamic argv parsing, scalar options,
positionals, presets, whole-root defaults, missing-value callbacks, actual field
prompts and variant constraints. Rust controls precedence, admission, continuation
transitions, default/prompt selection and scalar/dynamic validation. Host loops
retain iterator closing and reference await boundaries. Node preserves live
collection callbacks, property access, callback receivers and shallow context
snapshots. Existing native SDK validation-error policy is reused. No external
dependencies, public CLI entry point or default implementation changed.

Five missing-module failures preceded implementation. Twelve final differential
tests compare the extracted reference with native dependencies, including
positional/option/preset precedence, cloned root defaults, explicit dynamic
overrides, combined/truncated diagnostics, missing-value callbacks and choices,
synthetic variant roots, getters/receivers, cancellation, arbitrary rejections,
iterator closing and concurrent continuations. A composed test constructs a
command tree, prepares aliases/dynamic arguments, dispatches through Commander
and resolves the complete parameter object. Actual in-memory terminal input
separately verifies selector and required-branch prompts, output and raw-mode
transitions; its screenshot was inspected. This does not qualify full handler
execution, rich generated help or the complete public CLI suites.

The maintained package route passes 263 native Node tests, Rust tests, 1,762
reference/parity cases in 50 files and declarations. Rust/binding and scoped JS
lint pass. Packed runtime consumers resolve parameters, clone defaults and run
actual branch prompts. Packed declarations compile with types: [], while contract
declarations still resolve from the checkout; standalone packaging remains open.

After local checks finished, five alternating warmed Node 22.23.2 ARM64 rounds
of 500 parameter resolutions, retaining 32 results, measured native/reference
medians of 596.109/24.975 microseconds (23.87 times slower). The fixture includes
scalar options, a dynamic record override, cloned JSON/default fields and active
variant validation, with no file read or interactive wait. An earlier measurement
overlapped local checks and was superseded. No performance/default-swap gate
passed. Full execution/fixture runtime, generated help, transports and complete
platform/resource/reentrancy/standalone-packaging qualification remain open.

Parameter resolution is independently verified on remote main at 371895e848.
Release workflow 37077825873 completed successfully with validate/build passing
and release-stable skipped. No new publication is claimed.

### CLI fixture-runtime checkpoint

The native fixture runtime now loads and selects named/indexed scenarios, matches
request arguments, supplies service proxies, constructs fetch responses and
filesystem fixtures, and selects normal or fixture capabilities. Rust controls
matching, read/write defaults, scenario/runtime admission, diagnostic policy and
continuations. Host loops preserve iterator cleanup; Node retains actual file
reads, Request/Response/Headers, proxies, environment access, live collection
methods and promise lookup/assimilation. Embedded execution bypasses fixture mode
and retains injected capability identity. Existing native source metadata,
secrets, runtime I/O, numeric-selector and JSON-diagnostic modules are reused.
No external dependencies or default implementation changed.

Five missing-module failures preceded implementation. Ten final differential
tests use the extracted reference and memfs, covering partial/prefix/array
matching, response identity, synchronous errors versus async proxy rejection,
fetch headers/status/body semantics, own-property filesystem maps, named/indexed
scenarios, read/JSON diagnostics, normal/embedded runtime, synthetic credentials,
getter and promise lookup order, arbitrary thrown identity, iterator closing,
read timing and concurrent loads. Tests inspect only synthetic environment values.
The maintained route passes 263 native Node tests, Rust tests, 1,772 reference/
parity cases in 51 files and declarations; Rust/binding and scoped JS lint pass.

Packed runtime consumers load an actual scenario file and exercise service,
fetch/filesystem adapters and embedded bypass. Packed declarations compile with
types: [], while contract types still resolve from the checkout. The inspected
fixture result/scenario diagnostic screenshot matches reference output exactly.
Full command execution and public CLI integration remain unfinished.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 calls, retaining 32
results, measured native/reference medians of 705.338/543.963 microseconds
(1.30 times slower). The fixture includes a real warmed scenario-file read,
runtime/environment construction, a service match, fixture filesystem read and
fixture fetch JSON response. It does not pass the performance/default-swap gate.
Full execution, generated help, transports and complete platform/resource/
reentrancy/standalone-packaging qualification remain open.

Fixture runtime is independently verified in remote main at 346598b3fb. Its
Release workflow 37079355930 completed successfully with validate/build passing
and release-stable skipped; this does not establish a new publication.

### CLI command-execution checkpoint

Native execution now composes fixture/runtime selection, parameter resolution,
requirements, native-schema and embedded validation, confirmation, approval
routing, handler invocation, managed streams and result/error presentation.
Rust controls admission and transitions; Node retains actual awaits, for-await
iteration, callback receivers, signal/listener identity and try/finally cleanup.
Runtime creation remains outside the error-report catch, and resolved parameter
and secret context is exposed only after the same reference validation stages.
No dependency declarations or default implementation changed. Public runCLI and
executeCLICommand orchestration and generated help are still unfinished.

Five missing-module failures preceded implementation. Thirteen differential
tests compare extracted reference code with native dependencies, including
requirements, defaults, diagnostics, approval output, custom rendering, MCP error
exit status, arbitrary rejection identity, error-report scope, callback receivers
and property order, native JSON-schema validation, concurrent handlers, status
and secret refresh, stream cancellation/closing and SIGINT listener cleanup.
A composed test builds commands, prepares argv, dispatches through Commander,
resolves parameters, executes the handler and renders JSON. The maintained
package route passes 263 native Node tests, Rust tests, 1,785 reference/parity
cases across 52 files and declarations; Rust/binding and scoped JS lint pass.

Packed runtime consumers execute ordinary and embedded handlers with only packed
own schema/design/config-codec packages and existing Commander admitted as external
ESM imports. Packed declarations compile with types: [], but contract types still
resolve from the checkout, leaving standalone type qualification open. An actual
in-memory TTY prompt-to-handler run matches reference output and raw-mode
transitions; its rich/JSON screenshot was inspected. This does not qualify the
full public CLI or all original CLI suites.

Five alternating warmed Node 22.23.2 ARM64 rounds of 500 calls, retaining 32
results, measured native/reference medians of 142.938/8.634 microseconds
(16.56 times slower). The workload uses prebuilt command fields and includes
normal runtime construction, scalar/dynamic/default parameters, handler execution
and JSON rendering, with no I/O or interactive wait. It differs from earlier
parameter-only workloads and does not pass the performance/default-swap gate.
Public CLI/help, transports and complete platform/resource/reentrancy/standalone
packaging qualification remain open.

Command execution is independently verified in remote main at 1a5029d7c1. Its
Release workflow 37080772388 completed successfully with validate/build passing
and release-stable skipped; no new publication is claimed.

### Generated CLI help checkpoint

Generated group/leaf help now composes native command visibility, field
collection, positional assignment, help-field formatting and design rendering.
Rust controls help-output precedence, target/alias selection, unknown-command
diagnostics, secret/example policy, parameter signatures and collapsing, command
traversal, global-field deduplication, section ordering and JSON/terminal output.
Node retains live string/array/Map methods, callback order, iterator cleanup,
property access, JSON serialization, terminal dimensions and output-format scope.
Existing output-format name enumeration is shared with the control module.
No dependency declarations or default implementation changed.

Four missing-module failures preceded implementation. Nine differential tests
cover root/leaf/nested help in rich, Markdown and JSON modes; aliases, hidden
defaults, scope, suggestions, casing, root naming and control combinations;
global-field deduplication, secrets, examples and variadic positionals; terminal
width, optional signature collapsing, actual styled TTY output, property order,
arbitrary writer failures, output precedence, fallback program names and iterator
cleanup. A missing native import for output-format names failed the custom-format
comparison and was corrected by exposing the existing enumeration. The maintained
package route passes 263 native Node tests, Rust tests, 1,794 reference/parity
cases across 53 files and declarations; Rust/binding and scoped JS lint pass.

Packed runtime consumers render roots, aliases, leaves and JSON help with only
packed own schema/design/config-codec packages and existing Commander admitted as
external ESM imports. Packed declarations compile with types: [], but contract
types still resolve from the checkout. Root and leaf help screenshots were
inspected after exact reference comparisons, including JSON and Markdown outputs.
Public runCLI/executeCLICommand orchestration, CLI error handling and the complete
original CLI test suites still require integration; this module is internal.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 calls, retaining 32
results, measured native/reference medians of 3,123.320/85.801 microseconds
(36.40 times slower). The workload renders extended root help from prebuilt
definitions, including field collection, command traversal, optional signatures,
global controls and plain terminal formatting. Native/host crossings still need
optimization; no performance/default-swap gate passed. Transports and complete
platform/resource/reentrancy/standalone-packaging qualification also remain open.

Generated help is independently verified on remote main at 91af5a9e3c. Its
Release workflow 37081801459 completed successfully with release-stable skipped;
this verifies the build, not a new publication.

### Public CLI and error-handling checkpoint

The public `toolcraft-rust/cli` entrypoint now exposes standalone `runCLI`,
invocation-local `executeCLICommand`, command snapshots, naming, theme configuration
and error-report rendering. Rust owns startup/dispatch/error/cleanup decisions,
Commander diagnostic traversal, unknown-command admission, usage pointers and
HTTP/problem-details/GraphQL presentation. Node retains actual await boundaries,
callbacks, streams, live object methods and finally cleanup. The adapter composes
native parameter, execution, help, schema, design and proxy modules. Optional
proxy discovery remains lazy and is excluded from basic CLI bundles. Existing
Commander still supplies parser objects; no dependency declarations or default
implementation changed.

Eight initial missing-module fixtures were separately validated against the JS
reference before implementation. The root now exports the same declined-error
constructor as the approval subpath. Public differential tests cover standalone
and embedded output, aliases, dynamic flags, help/version, usage errors, defaults,
abort identity, option getter order, thenable flush timing/failures, initialization
outside the try/finally boundary, concurrent continuations and runtime export
names. Additional mocked-boundary comparisons verify proxy discovery, help and
handler cleanup, discovery/close failures and embedded discovery rejection.
Original approval/CLI integration runs through native dependencies. HTTP error
comparisons cover redaction, problem details, GraphQL, output modes and stacks.

Enabling the original large CLI suite exposed a real native SIGSEGV. LLDB showed
recursive napi-rs exception conversion; the isolated original inherited-location
case and a minimal native regression both reproduced it. An Object.prototype
cause made the private error carrier inherit a cyclic cause chain. Giving the
carrier its own undefined cause prevents traversal and inherited getters while
retaining arbitrary thrown identity. The separate fix 14f25e00a4 is independently
verified on remote main; Release workflow 37083989733 is still running at this
checkpoint. The original 181-case CLI suite now passes in full. This was not a
Safe Bash failure.

The original CLI compile-check exposed a native/reference recursive Command type
mismatch in error-report context. The native public context now uses the native
Command declaration with the same fields. The unchanged original consumer and
additional CLI service/invocation consumers pass. Contract-only imports still
refer to the JS package, so this is not standalone declaration qualification.

Maintained package verification passes 266 native Node tests, Rust tests, 5,098
reference/parity cases across 82 files, declaration consumers and the original
CLI compile-check. Rust/binding lint and scoped ESLint pass. The original bundle
suite also includes the unported MCP entrypoint and is not counted as passing;
a separate maintained native test verifies lazy optional discovery. Packed public
consumers execute standalone/embedded commands, dynamic flags, defaults, help and
errors with only packed own schema/design/config-codec packages and existing
Commander admitted as external ESM imports. A basic packed CLI bundle executes
with its native binary sidecar. Packed types compile with types: [], while
reference contract declarations still resolve from the checkout.

Actual in-memory TTY input verifies a required text prompt through the public
CLI into its handler. Prompt output, raw-mode transitions, root/leaf help, JSON
results and unknown-command output match the reference; the combined terminal
screenshot was inspected. Temporary evidence is removed after recording delivery.

After local checks finished, five alternating warmed Node 22.23.2 ARM64 rounds
of 300 public embedded executions, retaining 32 results, measured native/reference
medians of 546.921/38.498 microseconds (14.21 times slower). The fixture includes
command construction, aliases/dynamic argv parsing, defaults, validation, handler,
JSON rendering and invocation flush, using prebuilt definitions. It differs from
the earlier execution-only workload and does not establish a speedup. No
performance/default-swap gate passed. MCP/HTTP/OAuth public entrypoints, remaining
subpaths, standalone types and complete platform/resource/reentrancy qualification
remain open, as does replacing/qualifying Commander.

Public CLI delivery is independently verified on remote main at 790a90a872.
Release 37084694820 completed successfully with release-stable skipped. The crash-fix Release 37083989733 finished
with failures: all four Bash jobs rejected eager PDF imports, and fresh unit
validation rejected obsolete browser fixtures and build-cache admission. The
cached unit job, build, audit and checks passed; no publication is claimed.

The optional-engine repair 423004a5c5 is independently verified on remote main.
diffpdf now loads the PDF parser when invoked; dot and rsvg-convert load the SVG
renderer only when needed. Focused esbuild graph failures preceded the repair.
All 37 command tests, scoped lint/types, the 221-stage selected Safe Bash build
closure and all 170 maintained runner checks pass, including the original root
lazy-import guard. Release 37085699359 completed successfully with release-stable skipped.

The cache-admission repair fd137a8e75 is independently verified on remote main.
The original failing repository-admission test exposed the shortened spreadsheet
build, extracted ssconvert build, and new externalized diagram builds. All three
exact commands now join the allowlist. HarfBuzz verification uses repository
inputs covered by the fingerprint; provider generation and bundling also use
tracked scripts, source and declared dependency inputs. All 43 cache tests and
scoped ESLint pass. Release 37085920172 completed successfully with release-stable
skipped; this and the two preceding successful workflows verify builds, not a
fresh complete CI matrix or npm publication. The browser-fixture
repair is already present in abdc4745b9; its fresh Release rerun is still active.

### MCP metadata checkpoint

The native MCP prerequisite now normalizes root groups, formats snake/camel field
names and snake-only tool paths, collects nested parameter descriptions, renders
examples and admits complete allowlist prefixes. The existing Rust CLI word
boundary policy is shared without changing CLI casing behavior. Rust controls
optional/default decisions, description assembly and value serialization routing;
Node preserves live string/array methods, JSON serialization, property access,
iteration and host identities. No dependencies or default implementation changed.

Eight missing-module failures preceded implementation. Differential tests extract
the actual MCP declarations in memory and compare Unicode and lone surrogates,
string-like access order, root/child identity, nested optional and inherited
defaults, empty objects, examples, allowlist short circuit and receivers, getter
order, arbitrary thrown values and iterator cleanup. Maintained verification
passes 266 native Node tests, Rust tests, 5,106 reference/parity cases in 83 files,
declaration consumers and the original CLI compile-check. Rust/binding lint and
scoped ESLint pass. A packed consumer executes the metadata module with packed
own native dependencies and existing Commander; no new public MCP subpath is
claimed. There is no CLI presentation change in this checkpoint.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 metadata calls, retaining
32 results, measured medians of 300.509 microseconds native and 6.083 microseconds
JavaScript (49.40 times slower). Each call formats a three-segment tool name,
builds a nested parameter/example description and checks its allowlist prefix.
Native/host crossings require optimization; no performance/default-swap gate
passed. MCP schema conversion, input/result validation, enumeration, server and
stream lifecycle, HTTP/OAuth and complete platform/resource/packaging qualification
remain open.

MCP metadata is independently verified on remote main at 614d10938d. Release
37086389418 completed successfully with release-stable skipped; fresh rerun
37086536500 was cancelled. No publication or full fresh matrix is claimed.

### MCP input-validation checkpoint

MCP input traversal now uses the existing Rust SDK structural validation policy
with invocation-local wire casing and host capabilities. It covers objects,
records, sparse/method-overridden arrays, discriminated and exclusive unions,
scalar constraints, nullable values, cloned defaults, alias errors and bounded
parameter diagnostics. MCP native JSON schemas validate and retain the original
input value; SDK-only normalization is not applied. Rust also owns MCP received-
value classification, enum suggestion admission and top-level argument handling.
Node retains live methods, own-property definitions, regular expressions, JSON
serialization, callbacks and error identity. No dependencies/defaults changed.

Eight initial missing-module tests preceded the implementation. A ninth failing
regression exposed the shared alias check calling the prototype helper instead
of live Object.hasOwn; SDK and MCP now use the reference operation. Ten final
differential tests extract original MCP declarations and cover scalar/Unicode
constraints, sparse mapping, casing/defaults/aliases, descriptors and special
keys, accessor ordering, arbitrary thrown values, native JSON-schema identity,
records/JSON/unions, missing arguments, diagnostic truncation and reentrant
getters with different casing. A test-fixture mistake initially passed a compiled
validator instead of a schema; it was corrected to use each implementation's
withJsonSchema rather than weakening the value-identity assertion.

Maintained verification passes 266 native Node tests, Rust tests, 5,116 parity
cases across 84 files, declarations and the original CLI compile-check.
Rust/binding lint and scoped ESLint pass. A packed consumer verifies wire casing,
defaults, user errors and native-schema input identity using packed native
dependencies. No public MCP server/transport integration is claimed yet.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 calls, retaining 32
results, measured 197.624 microseconds native versus 3.541 microseconds JavaScript
(55.81 times slower). The valid-input fixture includes nested object wire casing,
an array, a string constraint and a defaulted numeric field. It is not a
performance/default-swap gate pass. MCP output serialization/schema conversion,
tool enumeration, server/stream lifecycle, HTTP/OAuth and full platform/resource/
standalone-packaging qualification remain open.

MCP input validation is independently verified on remote main at e47f071bc9.
Release 37086984688 is pending.

### MCP output-validation checkpoint

Rust now projects declared result keys to wire casing, recursively validates
objects/arrays/records/unions, clones defaults, preserves native JSON-schema
input identity, rejects missing/unexpected fields and retains admitted extras
without overwriting declared wire names. Input/output share existing constraint
helpers and host capabilities. Node preserves live methods, descriptors, callback
order, arbitrary exceptions and native ToolError constructor identity. The
existing own tiny-stdio-mcp-server-rust dependency moved from development to
runtime; no external dependency or default implementation was added.

Nine failing missing-function comparisons preceded implementation. The final
differential suite extracts actual MCP source and covers snake/camel projection,
validated defaults, additional/alias/special keys, sparse and overridden maps,
discriminated/exclusive unions, native-schema-before-optional ordering, getters,
descriptors, arbitrary thrown values, reentrancy and bounded ToolError diagnostics.
The metadata/input/output prerequisite suites remain internal; public MCP server
and wire/stream lifecycle integration are not yet claimed.

Maintained verification passes 266 native Node tests, Rust tests, 5,125 reference/
parity cases in 85 files, declaration consumers and the original CLI compile-check.
Rust/binding lint and scoped ESLint pass. A packed consumer uses only packed own
native dependencies to verify result casing/defaults and shared ToolError identity.
Five alternating warmed Node 22.23.2 ARM64 rounds of 300 result validations,
retaining 32 results, measured 258.215 microseconds native versus 4.455 microseconds
JavaScript (57.96 times slower). The fixture includes nested casing, a default,
an array and an admitted extra field. No performance/default-swap gate passed.
Schema projection/enumeration, the public MCP server, HTTP/OAuth and full platform,
resource and standalone packaging qualification remain open.

MCP result validation is independently verified on remote main at ae6a793708.
Release 37087484789 completed successfully with release-stable skipped;
Toolcraft package workflow 37087484577 is running
standalone-bundle jobs for Node 18.18, 20, 22 and 24. No publication is claimed.

### MCP schema-projection checkpoint

Rust now projects input/output JSON schemas, including nested object/array/record
members, discriminated/exclusive branches, cloned defaults, input-only default
requiredness and optional-alias constraints. Native JSON-schema documents retain
identity when explicitly supplied. Node performs live array/object operations,
metadata spreads, property access and actual schema serialization. The port reuses
native result validation for default projection; no dependency or default changed.

Twelve missing-module failures preceded implementation. Differential tests extract
the original MCP functions and compare six schema placements, scalar/object/array
defaults, snake/camel keys, both directions, optional aliases, discriminator and
nullable branch metadata, native documents, unmatched branch identity, invalid
JSON defaults, getter order, arbitrary thrown values and reentrant projection.
Maintained checks pass 266 native Node tests, Rust tests, 5,137 parity cases across
86 files, declarations and the original CLI compile-check. Rust/binding lint and
scoped ESLint pass. Packed native consumers verify requiredness and compile the
projected alias constraints to check accepted/rejected wire arguments.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 projections, retaining
32 results, measured native/reference medians of 598.124/11.835 microseconds
(50.54 times slower). The fixture includes nested defaults, optional aliases,
an array and a discriminated branch. No performance/default-swap gate passed.
Tool enumeration and public MCP lifecycle/transport integration, HTTP/OAuth and
complete platform/resource/standalone packaging qualification remain open.

MCP schema projection is independently verified on remote main at f60ebee457.
Release 37087862488 completed successfully with release-stable skipped. This
verifies its build, not a full fresh matrix or new publication.

### MCP tool-enumeration checkpoint

Native enumeration now composes MCP scope filtering, full-path allowlists,
snake-only tool names, field-name validation, input/output schemas and descriptions.
Rust controls traversal, admission and collision checks. Node preserves live
command properties, annotations/metadata spreads, callback identity and for-of
iterator cleanup. Root omission and empty synthetic roots follow the reference
semantics, and command objects retain identity. No dependencies/defaults changed.

Six missing-module failures preceded implementation after correcting a syntax
error in the new fixture. Differential tests extract the original enumerator
and cover nested ordinary/stream commands, metadata/schema composition, both field
casings, allowlist prefixes, single/synthetic roots, scoped fields, invalid params,
tool and input/output/event field collisions, getter order, annotation copying,
arbitrary thrown values and nested iterator cleanup. Maintained verification
passes 266 native Node tests, Rust tests, 5,143 parity cases across 87 files,
declarations and the original CLI compile-check. Rust/binding lint and scoped
ESLint pass. A packed consumer verifies tool names, both schemas and original
command identity using packed own native dependencies.

Five alternating warmed Node 22.23.2 ARM64 rounds of 100 three-tool enumerations,
retaining 32 results, measured medians of 1,488.770 microseconds native and 34.372
microseconds JavaScript (43.31 times slower). Each call includes one nested group,
scoped params, defaults, descriptions, output schemas and collision checks.
No performance/default-swap gate passed. Public MCP handler, approval/error,
stream and transport lifecycle integration, HTTP/OAuth and full platform/resource/
standalone packaging qualification remain open.

MCP tool enumeration is independently verified on remote main at b5dc169902.
Release 37088180709 completed successfully with release-stable skipped; this
verifies the build, not publication or a full fresh matrix.

### MCP approvals and error-mapping checkpoint

Rust now classifies pending approvals and protocol errors, preserves existing
ToolError identity, maps client/server HTTP statuses and redacted envelopes, and
selects pending/declined content. Node retains actual Error/ToolError construction,
live property/JSON operations and the async handler await/catch boundary. Existing
native HTTP diagnostics and the own MCP server dependency are reused. No external
dependencies or default implementation changed.

Six missing-module failures preceded implementation. Differential tests extract
the reference functions and compare pending-record short circuits, exact content
blocks, reason getters, Error/UserError/ToolError identity, HTTP status families,
redaction/envelopes, property order, arbitrary rendering/mapping failures,
reentrant string conversion, thenable timing, handler receiver/argument identity,
sync/async failures and independent concurrent calls. The final maintained route
passes 266 native Node tests, Rust tests, 5,149 parity cases across 88 files,
declarations and the original CLI compile-check. Rust/binding lint and scoped
ESLint pass. Packed consumers preserve own UserError-to-ToolError classification,
approval rendering and async failure identity with packed native dependencies.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 calls, retaining 32
results, measured native/reference medians of 38.939/4.441 microseconds (8.77 times
slower). Each call recognizes/renders a pending approval and maps a synthetic HTTP
429 error with redaction/report metadata. No performance/default-swap gate passed.
Public MCP handler/server/stream integration, HTTP/OAuth and full platform,
resource and standalone packaging qualification remain open.

MCP approvals/error policies are independently verified on remote main at
03362ba040. Release 37088582464 built successfully; fresh unit checks exposed a
configuration-companion API mismatch, and Bash jobs exposed a cancellation test
fixture using a Proxy receiver for a private-field getter. Publication is not
claimed. The output checkpoint's Toolcraft package workflow 37087484577 passed
standalone bundles on Node 18.18, 20, 22 and 24 and is publishing.

### Configuration runtime async compatibility repair

The fresh unit failure was reproduced by the unchanged bidirectional namespace
type check: the reference resolveRuntime returns a Promise and accepts an injected
filesystem, while the native companion still returned synchronously. Three new
in-memory behavior checks also failed on the companion and passed on the reference.
Runtime resolution now preserves async return/rejection, uses injected stat and
realpath methods in reference order, maps only ENOENT/ENOTDIR to missing-path
diagnostics, and retains symlink containment and arbitrary filesystem failures.
A fourth comparison exposed process-cwd resolution of relative roots; paths now
resolve from the portable filesystem root. Host fallback uses Node async I/O.

Before rebasing, the maintained configuration-companion unit route passed 85 native Node checks,
Rust tests, 193 reference/parity cases in nine files and bidirectional public API
type checks. Scoped ESLint passes. No dependency declarations or default
implementation changed in this work. Concurrent upstream commit 22c613302a also
repaired the async contract and retained a synchronous internal runner API. The
rebase preserves that implementation and its existing filesystem contract import;
our remaining code fix resolves relative async runtime paths from the portable
root, with the new in-memory parity suite. This is a host-adapter repair, not a
new Rust performance claim or qualification of browser-native execution. Final
post-rebase verification again passes all 85 native Node checks, Rust tests, 193
reference/parity cases, bidirectional types and scoped ESLint.

### Cancellation fixture receiver repair

All four Bash jobs in Release 37088582464 failed the same four falsy-cancellation
cases. The unchanged focused test reproduces the failure: its filesystem Proxy
passes the proxy receiver to MemoryFileSystem.capabilities, whose private field
requires the actual filesystem receiver. The fixture now forwards getters and
methods to their owning filesystem/descriptor in a local repair, passing all 156
checks in the containing suite. Concurrent upstream commit 22c613302a instead
restored proxy-aware capabilities in MemoryFileSystem itself. Our unpushed fixture
repair was dropped to retain the original proxy interception coverage. No shell
cancellation implementation change is claimed.
The unchanged upstream fixture also passes all 156 checks after the rebase.

### MCP handler execution checkpoint

Ordinary MCP tool invocation now composes native secrets, requirements, argument
validation, approvals, result validation and protocol errors. Rust controls the
execution stages and result/error branches. Node retains the three exact await
boundaries, callback receivers, context spreads, explicit result identity and
error-report persistence. Abort reasons take precedence over invocation failures;
declined approvals retain their dedicated content. No dependencies/defaults changed.

Seven missing-module tests preceded implementation. Eight final differential cases
extract the actual ordinary-tool handler expression from the reference MCP source
using TypeScript, with no production reference import. They cover service/context
identity, progress, secrets and requirements ordering, invalid parameters/results,
pending/declined approvals, explicit MCP content, custom projection errors,
cancellation boundaries, awaited report failures, getter order, arbitrary thrown
values, thenable timing and independently completing concurrent invocations.
Fixtures stay in memory. The selected maintained workspace build passes, followed
by 266 native Node tests, Rust tests, 5,157 parity cases across 89 files,
declaration consumers and the original CLI compile-check. Rust/binding lint and
scoped ESLint pass. Packed consumers verify defaults, result casing, native error
identity and cancellation using packed own native dependencies and the existing
Commander dependency. There is no visual CLI change in this checkpoint.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 handler invocations,
retaining 32 results, measured 258.627 microseconds native versus 8.702 microseconds
JavaScript (29.72 times slower). The fixture includes request-service resolution,
input validation, handler execution and object/array result projection. This does
not pass a performance/default-swap gate. Public MCP server/stream integration,
HTTP/OAuth, remaining exports, Commander replacement and full standalone types,
platform/resource/packaging qualification remain open.

### Public MCP dependency ingress repair

Public MCP integration exposed three differences in the own native stdio server:
custom parameters with undefined object properties failed admission, unvalidated
arguments lost their original identity, and undefined structured array entries
were dropped before output validation. Three differential failures preceded the
repair. Request snapshots now omit undefined object properties recursively while
Node retains original custom parameters and unvalidated tool arguments. Declared
outputs use strict JSON admission and native protocol-error selection. Existing
untyped content conversion retains its separate policy.

Five differential checks cover direct and SDK custom calls in both protocol
versions, original argument identity, null rejection, and explicit/raw invalid
structured arrays/objects. A new test initially assumed null should default to an
empty object; direct inspection of the current JavaScript implementation disproved
that assumption. The attempted null-default change was removed; the original Rust
lifecycle test is unchanged. Maintained dependency verification passes Rust tests,
362 native Node checks and declarations. The shared protocol workspace passes its
Rust/Node tests and both crates pass maintained lint; scoped ESLint passes.

This does not qualify arbitrary host request values: accessor properties, custom
prototypes, cycles and undefined/sparse arrays remain restricted by native ingress.
No external dependencies or default implementation changed.

The earlier MCP output checkpoint's package workflow 37087484577 completed with
successful standalone bundles on Node 18.18, 20, 22 and 24 and a successful publish
job. This is distinct from the skipped stable-root publication in its Release run.
The dependency repair is independently verified on remote main at 6c09ddd088;
Release 37091470539 completed successfully with release-stable skipped; this
verifies its build, not a fresh complete matrix or publication.

### Public MCP server and stream checkpoint

The public `toolcraft-rust/mcp` entry point now exports createMCPServer, runMCP,
MCP_STREAM_METHODS and the reference's internal transport-construction function.
Rust owns startup selection, tool registration policy, stream admission, event
validation, subscription ownership, notification suppression and cleanup decisions.
Node retains promises, transport/callback receivers, original values, async
iteration and the notification queue. Deferred discovery is lazy and shared across
concurrent consumers, and failed resolution permits a retry. No external dependency
or default implementation changed.

Four missing-module failures preceded integration. Public comparisons cover export
names, real session discovery/tool calls, stream status/data/end, unsupported
transport rejection, getter order and server registration. Deferred comparisons
cover concurrent listen/connect/await, failure reset and runMCP sequencing.
Thirteen original MCP suites and the human-approval integration suite now run
against native entry points and own native transport dependencies. The existing
entrypoint test uses a partial server mock so the real content helper remains
available. Its original behavior assertions are unchanged. All fixtures are in
memory; subprocess/disk-based proxy integration is not included in this unit route.

Maintained verification passes Rust tests, 266 native Node checks, 5,978 reference/
parity cases across 105 files, bidirectional MCP declarations and the original CLI
type consumer. Rust/binding lint and scoped ESLint pass. Packed public consumers
verify discovery, defaults, wire casing, error codes and stream delivery using eight
packed own native packages and only existing Commander as an external runtime
dependency. MCP declarations intentionally retain canonical reference Server and
RunMCPOptions contracts; standalone native type packaging remains unqualified.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured server creation at 713.183 microseconds native versus 318.759
microseconds JavaScript (2.24 times slower), and real-session tool calls at
147.033 versus 21.532 microseconds (6.83 times slower). Each server registers one
MCP-scoped tool with a defaulted input and declared output; calls validate and
project a string field. Preflight assertions check discovery and successful output.
An initial fixture omitted MCP scope and was rejected by the packed consumer;
its empty-server/missing-tool measurements were discarded. These workloads differ
from earlier internal-helper benchmarks and do not establish an improvement.
No performance/default-swap gate passed. HTTP/OAuth, remaining exports, Commander
replacement and complete standalone types/platform/resource qualification remain
open. Internal MCP integration does not change CLI presentation.

Public MCP delivery is independently verified on remote main at 1d0338a3ec.
Release 37091546615 completed successfully with release-stable skipped. Package
publication 37091546450 remains pending. The successful Release verifies the build,
not a fresh complete matrix or package publication.

### Hosted OAuth configuration checkpoint

The native HTTP prerequisite validates hosted URLs, required provider hooks,
unique non-reserved login fields and callback paths, scope names and production
storage capabilities. Rust controls validation order, admission and field labels/
types. Node retains URL construction, live string/array methods, object spreads,
Set iteration and async prepare methods with the caller's receiver. Preparation
reads current configuration and the current production environment; it does not
snapshot them at factory creation. No external dependencies or defaults changed.

Six missing-module comparisons preceded implementation. Eight final comparisons
extract the reference declarations in memory and exercise invalid configuration
matrices, inherited discriminants, Unicode field labels, property/method order,
borrowed receivers, overridden methods, arbitrary thrown values, reentrancy and
production defaults. An additional failed comparison exposed strict-boolean
handling of an overridden startsWith result; the host capability now preserves
JavaScript truthiness. Maintained verification passes Rust tests, 266 native Node
checks, 5,986 reference/parity cases across 106 files, existing declarations and
the original CLI type consumer. Rust/binding lint and scoped ESLint pass. A packed
consumer verifies configuration identity, preparation, field translation and
production rejection with external runtime imports restricted to packed own
dependencies and existing Commander.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured 48.367 microseconds native versus 3.518 microseconds
JavaScript (13.75 times slower). Each operation creates a configuration, asserts
production readiness and translates an API-key login field. No performance or
default-swap gate passed. Hosted storage, login rendering, HTTP/OAuth runtime and
public exports remain open, along with the existing full replacement gates.

Hosted OAuth configuration is independently verified on remote main at f65b5efe7d.
Release 37092065054 completed successfully with release-stable skipped; build
verification does not imply a fresh complete matrix or publication.

### Hosted OAuth development storage checkpoint

Rust now selects hosted credential retrieval/update outcomes, transaction cloning,
per-subject promise queue admission/release, missing-credential errors and signing
key memoization. Node retains opaque credential identity, Maps, async callbacks,
structuredClone and platform cryptography. The adapter reuses the own native OAuth
authorization store. Built-in public KeyObject JWK export replaces the reference's
JOSE export for generated P-256 keys; no external dependency was introduced.
The existing mcp-oauth-server-rust workspace is now a declared runtime dependency.

Five missing-module failures preceded implementation. Six final comparisons include
the original storage conformance contract, explicit development admission, live
credential identity, cloned interactions, clone failures, independently progressing
subjects, queued failure propagation/recovery, stable signing keys and opaque
subject namespaces. An added failing comparison caught import-time capture of
structuredClone; the adapter now uses the current host function and preserves
arbitrary thrown values. Fixtures remain in memory.

The maintained selected workspace build initially failed resolving a newly pulled
SoX workspace. Source, declarations and manifest/lockfile registrations were present,
but seven already-declared local workspace symlinks were absent. Restoring those
links required no install or source change. The complete maintained selected build
then passed. Final Toolcraft verification passes Rust tests, 266 native Node checks,
5,992 reference/parity cases in 107 files, declarations and the original CLI type
consumer. Rust/binding lint and scoped ESLint pass. Packed consumers use the own
native OAuth server to verify credentials, cloned transactions, signing keys and
authorization-store records, with undeclared external runtime imports rejected.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured 21.399 microseconds native versus 7.142 microseconds JavaScript
(3.00 times slower). Each operation sets/updates a credential, clones a transaction
on write/read and derives a subject HMAC; signing-key generation is outside the
measurement. No performance/default-swap gate passed. Hosted login rendering,
request handling, HTTP/OAuth public exports and complete replacement qualification
remain open.

Hosted storage delivery is independently verified on remote main at 97e8467d1a.
Its package workflow 37093203015 completed successfully with standalone-bundle
and publish skipped; this is not new publication evidence. The root Release
workflow 37093203193 remains pending; these are separate delivery stages.

### Hosted OAuth login rendering checkpoint

Rust now assembles login and expired-connection HTML and content security policy
as UTF-16, preserving lone surrogates and exact interpolation/coercion order.
It selects field types, autocomplete and echoed values, and directs the ordered
escaping operations. Node retains live replaceAll/map/join methods, URL parsing,
cryptography and template coercion. Cookie names retain the SHA-256 namespace.
No external dependencies or defaults changed.

Six missing-module failures preceded implementation. Six final differential
cases cover exact HTML/CSP, password/API-key suppression, Unicode, cookie names,
URL failures, getters, custom collection methods, arbitrary thrown values,
Symbol interpolation and reentrant rendering. The maintained unit route passes
Rust tests, 266 native Node checks, 5,998 reference/parity cases across 108 files,
declarations and the original CLI type consumer. Maintained Rust/binding lint and
scoped ESLint pass. A packed consumer verifies the internal renderer, complete
nonce-normalized HTML/CSP, expiry markup and cookie names.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured 96.136 microseconds native versus 9.387 microseconds
JavaScript (10.24 times slower). Each operation renders an email/password form
with submitted email, an error, a fresh cryptographic nonce and CSP. No performance
or default-swap gate passed.

Native Chrome accessibility checks verified ordinary, error and expired pages.
Screenshot verification remains pending: automatic approval review rejected
whole-window capture because private browser bookmarks/profile metadata remain
visible, and no tab-scoped browser backend is available. User approval for that
incidental metadata capture has been requested. This is not completed visual QA.

### Safe Bash discovery performance observation

During hosted HTTP work, the routine Safe Bash command
`rg --files -g AGENTS.md packages/toolcraft-rust packages` remained live for more
than 12 minutes without returning its inventory. The identified child still used
41.8% CPU at 12:37 elapsed. Native ripgrep completed the same command from the same
checkout in 0.39 seconds and listed six instruction files. The unnecessary Safe
Bash scan was terminated after its process identity was verified. This records
an observed performance difference; ignored-directory traversal, symlink behavior
and other possible causes have not yet been isolated. No Safe Bash code was changed.

### Hosted OAuth HTTP helper checkpoint

Rust now controls chunk conversion/admission, exact byte-limit rejection, header
array normalization, default request paths, body inclusion, response forwarding
order and missing-credential admission. Node retains async iteration and iterator
cleanup, live platform constructors, original promises/thenables, Buffer operations
and credential callback receivers. No external dependencies or defaults changed.

Six missing-module failures preceded implementation. Eight final differential
cases exercise mixed chunks, exact limits, NaN limits, rejected iterator cleanup,
UTF-8 conversion, header filtering, URL/method behavior, response ordering and
thenables, original failures, live credential methods and opaque identity. Added
failures caught late constructor lookup, inherited body setters, a leaked
response.end return value and strict-boolean treatment of overridden Buffer and
array predicates. Constructors now retain reference evaluation order, body is an
own property, response forwarding preserves the reference's void callback, and
host predicates preserve truthiness. Fixtures remain in memory.

The final maintained unit route passes Rust tests, 266 native Node checks,
6,006 reference/parity cases across 109 files, declarations and the original CLI
type consumer. Maintained Rust/binding lint and scoped ESLint pass. A packed
consumer verifies body reading, Web Request conversion, response forwarding and
opaque credential identity against the reference without adding dependencies.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured 83.728 microseconds native versus 39.923 microseconds
JavaScript (2.10 times slower). Each operation reads two chunks, creates a POST
request, reads its text, forwards a Web Response and reads an opaque credential.
Timings varied across rounds; no performance/default-swap gate passed. Full hosted
runtime routing, HTTP/OAuth public exports and complete replacement qualification
remain open. These helpers introduce no visual presentation change; the earlier
login screenshot verification remains pending.

Login rendering and HTTP helpers are independently verified on remote main at
ece5a18562 and e95d87689f, respectively. Release 37094787512 remains pending;
Pages 37094787318 was cancelled. No completed release/publication is claimed.

### Hosted OAuth runtime checkpoint

The internal prepareHostedOAuthRuntime now composes the native configuration,
login/HTTP helpers and own native OAuth authorization server. Rust selects startup
metadata, routes health/custom/form/protocol requests, validates CSRF/expiry and
provider account IDs, chooses safe login failures and response policies, and
projects verified token identity. Node retains the exact await boundaries,
callback receivers, abort events, stream I/O and opaque credential references.
Custom interactions and credential-backed request services are included. No
external dependencies or default implementation changed.

Seven missing-module comparisons preceded implementation. Ten final differential
cases cover secured login startup, health failure, protocol/unhandled paths,
custom callback completion, CSRF and replay rejection, successful/failed form
connection, safe versus arbitrary errors, token projection, credential admission,
abort wiring, cleanup failures, live configuration getters and setup rejections.
Additional failures caught the handler's async function shape, writeHead lookup
after redirect getters and late Response constructor capture. Those now preserve
the reference's function kind and evaluation order without an extra async proxy.
Fixtures stay in memory.

The final maintained unit route passes Rust tests, 266 native Node checks,
6,016 reference/parity cases across 110 files, declarations and the original CLI
type consumer. Maintained Rust/binding lint and scoped ESLint pass. Packed own
Toolcraft/OAuth packages pass a full in-memory flow with real client registration,
PKCE, signed CSRF cookies, safe login retry, authorization-code exchange, access
token verification, credential-backed services, transaction replay rejection,
refresh-token revocation and health. A loader rejects undeclared external imports
from packed native modules. The same flow also passes against the reference.

The first packed fixture incorrectly expected refresh-token revocation to
immediately invalidate an issued access token. Direct execution of the original
JavaScript flow disproved that assumption. The corrected fixture verifies the
reference behavior: the issued access token remains verifiable and refreshing
with the revoked refresh token returns invalid_grant. No authorization-server
behavior was changed to satisfy the mistaken expectation.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured 7.410 microseconds native versus 1.609 microseconds JavaScript
(4.61 times slower). Each operation handles a health request and resolves services
through stored credentials using a prepared runtime; runtime construction and key
generation are outside the measurement. This is a different workload from earlier
helper benchmarks, not evidence of a speedup. No performance/default-swap gate
passed. Public HTTP/OAuth exports, standalone types and complete replacement
qualification remain open. The earlier login screenshot verification also remains
pending; no new visual verification is claimed here.

### Shared HTTP and stdio protocol errors

Public HTTP integration reproduced two original Toolcraft failures: handler and
missing-credential errors became successful isError results instead of protocol
rejections. The native HTTP build embeds the stdio adapter, creating a second
ToolError constructor. Both adapters now import the shared constructor from the
existing own mcp-protocol-rust/errors subpath. The two servers promote that own
workspace from development to runtime dependencies; no third-party package is
added. Error lookalikes remain ordinary errors.

Two failing native regressions preceded the fix. The final regression compares
reference stdio behavior with native stdio and HTTP, verifies constructor identity,
and checks exact code/data preservation and ordinary-error handling. An initial
reference HTTP comparison accidentally mixed constructors from two installed
stdio copies; ESM resolution proved the separate nested installation. It was
replaced with the reference stdio error contract. Original Toolcraft HTTP
assertions are unchanged and all 6,099 cases across 117 files now pass.

Maintained protocol and stdio unit routes passed before the HTTP regression was
corrected; the corrected HTTP route passes Rust tests, 50 native checks, 443
reference cases across 21 files, and declarations. All three maintained lint
routes and scoped ESLint pass. Three packed own dependencies independently
verify shared class identity and an exact protocol error response.

The earlier hosted-runtime Release 37095895081 completed successfully with the
build passing and release-stable skipped. This is build verification, not new
publication. The public HTTP checkpoint still has declaration/packaging/build
qualification in progress and is not included in this dependency repair.

### Public HTTP and hosted OAuth checkpoint

The public toolcraft-rust/http and http/hosted-oauth entry points now expose
HTTP server startup, authorization, hosted configuration/storage/runtime and
OAuth server helpers. Rust selects authorization and token projection, forwarded
transport/listener controls, stream admission, hosted identity and canonical
listener paths. Node retains live getters, callback receivers, original thrown
values, promise timing, I/O and application/provider service composition. The
existing own tiny-http-mcp-server-rust workspace is now a runtime dependency.
No third-party dependencies or JavaScript defaults changed.

Seven missing-module failures preceded implementation. Eight final differential
cases verify public export names, issuer/resource validation, token projection,
getters/symbols, own session flags, service precedence, listener paths, source-map
startup, live token reads across await and arbitrary thrown identity. All six
original HTTP suites execute native adapters, own transports and in-memory HTTP
support. Their original assertions are unchanged. The Node global require shim
was separately reproduced as missing and now matches reference import behavior.

The maintained selected workspace build passes. Local installation repair restored
already-declared compression/ts-ast/AST-grep/rgrep workspace links, picomatch 4.0.7
and its locked types. The wrong installed picomatch 2 had pulled Node path into
a browser build. No manifest dependency was introduced for these repairs.
The maintained npm test route selecting protocol, stdio, HTTP and Toolcraft
passes, including dependency builds and the root posttest hook: Toolcraft has
6,100 cases across 117 files and 266 native checks; HTTP has 443 reference cases
across 21 files and 50 native checks; stdio has 362 native checks. Rust tests,
public HTTP/hosted declaration consumers, the original CLI compile-check and
maintained/scoped lint pass. A type fixture initially supplied credential
services to an EmptyServices group; explicitly declaring the services fixes
the same contract for both implementations, without widening the API.

Eleven packed own packages pass public stateful/stateless HTTP discovery, defaulted
input/output projection, protocol rejections, stream delivery and unsupported
stream admission. A full hosted flow verifies health/metadata, registration, PKCE,
CSP/CSRF, safe retry, token exchange, credential services, replay rejection,
refresh-token revocation and missing-credential rejection. Packed native ESM
imports are confined to packed packages, Node builtins and existing Commander.
Public declarations still re-export canonical reference HTTP contracts; full
standalone types remain unqualified. The earlier login screenshot gate remains
open; this checkpoint does not claim additional visual QA.

Five alternating warmed Node 22.23.2 ARM64 rounds of 300 operations, retaining
32 results, measured HTTP server creation at 598.618 microseconds native versus
253.591 JavaScript (2.36 times slower). A real initialized stateful HTTP tool
call through the shared in-memory HTTP fixture measured 215.132 versus 60.613
microseconds (3.55 times slower), including request/response JSON and declared
input/output processing. Preflight checks validate actual returned values. No
performance/default-swap gate passed. Remaining subpaths, Commander replacement,
standalone types and complete platform/resource/packaging qualification remain open.

The shared-error dependency fix is verified on remote main at a7625be369. Its
Release 37097600121 remains pending and package workflow 37097600054 is running;
no new release publication is claimed.

### Core public subpaths checkpoint

The runtime, user-error and mcp-proxy public paths now expose the already-ported
native implementations. Runtime exports explicitly match the reference namespace
without the root-only package metadata helpers. Error classes, command factories
and proxy functions retain their existing identities; no new policy, dependency
or per-call forwarding function is introduced.

The reference suite initially failed on the missing runtime export, and independent
Node imports reproduced ERR_PACKAGE_PATH_NOT_EXPORTED for all three paths. Three
final cases compare export sets, shared identities, command cloning/defaults,
cross-bundle user errors, proxy cache/refresh policy and empty proxy lifecycle.
Vitest's transformed namespace order is normalized only in its comparison; the
packed Node consumer separately checks the exact native ESM namespace order.
Invalid slash-bearing cache names retain the reference rejection.

The selected maintained build and npm test -- --workspace=toolcraft-rust pass,
including 6,103 cases across 118 files, 266 native checks, Rust tests, bidirectional
subpath declaration consumers, the original CLI compile-check and root posttest.
Maintained Rust/binding lint and scoped ESLint pass. Eleven packed own packages
verify public namespaces, shared root/error identities, cloning and proxy lifecycle
with non-Node ESM imports restricted to packed packages and existing Commander.
Runtime/proxy declarations retain canonical reference types; standalone packaging
remains open. No new per-call algorithm warrants a separate timing comparison,
and cold-import costs are not qualified by this checkpoint.

The earlier HTTP checkpoint is independently verified on remote main at 590b9ebb02.
Its Release 37098144968 and package workflow 37098144780 remain pending. The
shared-error package workflow 37097600054 remains running. GitHub briefly returned
a rate-limit error; a subsequent quota read and specific workflow reads recovered.
No new publication is claimed. HTTP temporary artifacts were purged.

The next dependency export audit found defaultStdioSpawn and
snapshotHttpTransportHeaders missing from tiny-mcp-client-rust. Its root also
exposes four additional diagnostic helpers. Resolve those public-surface differences
before wiring Toolcraft's tiny-mcp-client subpath. Export-name inventories match
for native agent definitions, agent MCP config, auth store, config mutations,
frontmatter and process runner; that is inventory evidence, not fresh behavior
or standalone-type qualification. All broader replacement gates remain open.

### MCP client public host helpers

The native client now exports defaultStdioSpawn and snapshotHttpTransportHeaders.
The named spawn capability retains the reference function's name/arity, opaque
arguments and returned process identity; it is also the stdio default. Header
ownership and sanitized validation errors use the same live platform constructor
as the existing HTTP adapter, now shared with the public helper. These are host
capabilities; the Rust protocol and transport policies are unchanged. No external
dependency or JavaScript default changes.

Three failing native tests preceded the exports. Final comparisons cover owned
normalized headers, invalid/private inputs, a replaced live Headers constructor,
spawn receiver/argument/result identity and arbitrary thrown spawn values. Fixtures
are in memory and the process capability is mocked without spawning in unit tests.
The maintained client route also discovered a newer portable-stdio suite with no
verified native import. The own conditional process capability and resolver now
route its original assertions to the native transport and an own rejection stub.
The same two assertions verify explicit injection and lifecycle preservation.

The selected maintained build and npm test -- --workspace=tiny-mcp-client-rust
pass: Rust tests, 83 native checks, 445 reference cases across 56 files, declarations
and the root posttest route. Maintained Rust/binding lint and scoped ESLint pass.
A single packed client artifact with external ESM imports forbidden verifies header
ownership and a real default Node subprocess. A separate Node run with browser
conditions rejects the default process capability and verifies an injected process
lifecycle. This is conditional host-capability evidence, not browser execution of
the native addon. The unchanged Node primitives do not establish a Rust speedup.

The package still exposes its four documented native diagnostic helpers. Toolcraft's
client subpath should forward the exact reference export set rather than leaking
those additions. That public subpath, remaining dependencies/testing/composition,
standalone types and full replacement qualification remain open.

Core subpaths are verified on remote main at 20e52d140e; Release 37098829515 remains
pending. HTTP Release 37098144968 completed successfully with its build passing and
release-stable skipped. Shared-error package workflow 37097600054 has passed its
Node 18.18/20/22/24 standalone jobs and is still in the publish job. Those workflow
checks do not qualify the native platform matrix. No new publication is claimed.
Core-subpath temporary artifacts were purged.

### Shared protocol error declaration packaging repair

A strict client declaration audit reproduced TS7016 for mcp-protocol-rust/errors:
the public export referenced errors.d.ts, but only errors.js reached dist. The
protocol build and unit scripts now copy the existing own error declaration.
This package-scoped change leaves generated native declarations and the shared
Cargo build behavior unchanged. No dependency or runtime behavior changed.

The selected maintained build, npm test -- --workspace=mcp-protocol-rust and
Rust/binding lint pass. A packed consumer passes strict TypeScript checking,
including rejection of nonnumeric error codes, with workspace declaration
fallback forbidden. The original client compiler check no longer reports the
protocol error declaration failure; it still correctly reports missing client
capability/tool types. Those and the missing stored-session export are next.

### MCP client standalone declaration repair

Strict compilation reproduced eight undeclared-type errors, and a new consumer
fixture reproduced missing ClientCapabilities, Tool and StoredOAuthSession exports.
The client now declares the first two against own wire types and exports the
existing embedded OAuth session contract. Maintained declaration checks disable
skipLibCheck and compare reference assignments in both directions, reject invalid
schemas/capability flags and guard against implicit any in discovered tools.

The existing own tiny-stdio-mcp-server-rust package moves from development to
installed dependencies because the public declarations import its wire contracts.
The lockfile records the same promotion. No third-party dependency was added and
no runtime policy changed. The own OAuth/credential implementation remains embedded.

The selected maintained build, client npm test route, Rust/binding lint and scoped
TypeScript fixture lint pass. The route retains 445 reference cases across 56 files
and 83 native checks. Three packed own packages pass strict consumer checking with
workspace fallback forbidden, using only installed own declarations and the existing
Node/compiler type environment. This qualifies the client declaration closure on
this host, not all Toolcraft declarations or the native platform matrix.

### Public MCP client subpath checkpoint

The new toolcraft-rust/tiny-mcp-client facade explicitly forwards the reference
runtime and type export set to tiny-mcp-client-rust. It preserves own class and
function identities and excludes the native package's extra diagnostic exports.
Its declarations use only own installed contracts, unlike the remaining canonical
Toolcraft declaration facades. No new dependency or execution policy is introduced.

The focused test first failed on the missing public package specifier. A compiler
inventory then verified all 112 runtime/type export names and strict declaration
checking. Both new runtime cases pass, including actual discovery, calls and
cleanup; eleven packed own packages independently pass those checks with ESM
imports confined to packed packages, Node and existing Commander. The client
subpath passes strict packed consumer checking with workspace fallback forbidden.

The new bidirectional helper-type assignments exposed overly broad native
createTestPair/createSdkTestPair server and connection declarations. A separate
client repair derives the public server shape from own types without requiring
native diagnostic session methods or the native SDK-compatible overload. It
matches the original void-returning connection constraint. The reference itself
therefore rejects a McpClient factory because McpClient.connect returns metadata;
negative fixtures preserve that observed limitation without changing the target API.
The client's maintained route again passes 445 reference cases, 83 native checks,
strict declarations, lint and packed types. The final maintained Toolcraft route
passes 6,105 cases across 119 files, 266 native checks, strict client declarations,
the original CLI compiler fixture and the root posttest hook. Maintained Rust/binding
lint and scoped JS/TypeScript lint pass. Export forwarding adds no new per-call
algorithm; existing client performance limitations and all default-swap gates remain.

The first selected build reproduced a Safe Bash private-workspace profile failure:
pdf-ast declared the existing safe-fs development dependency, but Safe Bash's
admission profile omitted it. Remote main already contained c6e06a4699, which fixes
that exact mismatch; rebasing adopted it without an additional local repair.
During the subsequent dependency rebuild, the Safe Bash launcher transiently failed
to import safe-bash-command-exiftool/dist/command.js while that package was being
rebuilt. This is an observed shared-artifact availability failure, not an isolated
shell-engine defect. After the build completed, the same Safe Bash launcher read
succeeded. The selected maintained Toolcraft build passed after the rebase.

The protocol declaration repair and client type repair are verified on remote main
at ea5a0bf6bd and a67e3466d5. Package workflow 37097600054 completed successfully,
including its toolcraft-schema/toolcraft/toolcraft-openapi publication steps.
Workflow 37100150751 also completed successfully but skipped publication. Main
Release 37100151018 completed successfully with its build passing and stable
publication skipped. Earlier Release runs 37099510137 and 37098829515 and package
workflow 37098144780 have also completed successfully. No native publication is claimed.

An early audit of agent definitions, agent MCP config, auth store, config mutations,
frontmatter and process runner passed their existing type suites with skipLibCheck
disabled. Their type export inventories have no missing names, but agent MCP config,
frontmatter and process runner have extra native types that their facades must omit.
That is workspace compiler evidence only; their facade and packed-runtime
qualification remain ahead, as do broader performance/platform/swap requirements.

### Public agent catalog subpath checkpoint

The agent-defs public path forwards the own Rust catalog, preserving its catalog
objects, function identities, aliases, capability policy, model specifiers and
telemetry hooks. The existing own agent-defs-rust workspace becomes an installed
dependency. No third-party dependency or new execution policy is introduced.
The client-only strict compiler route is renamed to dependency-types and now
includes both public dependency facades.

The focused test reproduced the missing public package specifier before the
export was added. Two differential cases verify exact namespaces, own identities,
complete catalog values, frozen arrays, mixed-case aliases/model specifiers,
all capability lists and telemetry arguments. The selected maintained build and
combined catalog/Toolcraft npm test route pass: 63 reference cases across four
catalog files and six native catalog checks; 6,107 cases across 120 Toolcraft files
and 266 native checks; Rust tests, both strict dependency declaration consumers,
the original CLI compiler fixture and root posttest. Maintained and scoped lint pass.

Twelve packed own packages independently verify the public catalog namespace,
identities, aliases, capabilities and telemetry. Strict packed declarations compile
with no workspace or external type fallback. The reexport adds no per-call algorithm
or claimed speedup; complete standalone Toolcraft declarations and performance,
platform, packaging and default-swap gates remain open.

The preceding client facade and helper type repair are verified on remote main
at 7c3138e5b8 and 278463fa91. Release 37101346847 is in progress. The completed
client checkpoint's temporary packed artifacts and logs were purged.

### Credential transaction cancellation repair

Running the original Node credential suites through the proposed public auth-store
entry point exposed six failures: changing a caller's options.signal while an
initial filesystem path check awaited could discard the original cancellation or
adopt an unrelated replacement signal. The raw lock and encrypted-file wrapper
now capture options before their first suspension, matching the current reference.
The shared source also supplies the embedded OAuth and MCP client credential stores.

Six standalone native regression cases failed before the fix and pass afterward,
covering file, Keychain and raw locks in both cancellation directions. All 93
focused credential cases pass without changing the original assertions. This is
a host cancellation compatibility repair; the bakery ticket/owner coordination
policy is still JavaScript and remains required Rust implementation work.

The selected maintained npm test route passes for auth-store-rust, mcp-oauth-rust,
tiny-mcp-client-rust and toolcraft-rust, including the root posttest hook. The
credential package passes 28 native checks; embedded OAuth passes 114 native
checks and 772 reference cases; the client passes 83 native checks and 445
reference cases. Maintained Rust/binding lint and scoped JavaScript lint pass.

### Public Node credential-store subpath checkpoint

The toolcraft-rust/auth-store entry point forwards the own auth-store-rust runtime
and standalone declarations, preserving the original Node namespace and own class
identities. The existing own workspace becomes an installed dependency; no new
third-party dependency is introduced. Its missing-entry test failed before the
export was implemented.

Two new facade cases verify exact exports, provider keys including lone surrogates,
encrypted-document interoperability, deterministic ciphertext, file permissions and
deletion using memfs. Four unchanged original Node suites now run through the
native facade: auth-store, provider-store, keychain-process and transaction-lock.
The resolver keeps the native implementation inside Vitest's module graph so the
original crypto and child-process mocks reach the adapters. All 93 focused cases
pass after the separate cancellation repair. Strict type fixtures check the public
factories/options, class methods, migration readOnly option and generic lock result,
including negative backend and secret-value assignments.

The selected maintained build passes. The maintained Toolcraft route passes 6,200
cases across 125 files, 266 native checks, both compiler routes, the original CLI
type fixture and root posttest. Maintained Rust/binding lint and scoped JS/TS lint
pass. Thirteen packed own packages independently verify the Node store facade,
reference ciphertext, lock results/cleanup, injected Keychain command behavior and
migration. Strict packed types compile without workspace declaration fallback;
package ESM imports are confined to packed own packages, Node and existing Commander.

This checkpoint qualifies the Node entry point only. The original credential
dependency also exports ./portable and browser/workerd/worker conditions with a
SafeFsSecretStore, whose implementation and original suite are still unported.
Filesystem bakery-lock ticket/owner policy also remains in the JavaScript adapter.
Both are required remaining dependency work; neither is waived by Node parity.
The facade adds no per-call algorithm or performance claim. Standalone types for
the remaining Toolcraft surfaces, platform distribution, performance and swap
qualification remain open.

The catalog checkpoint is verified on remote main at 92e0361fe0. Main Release
37101346847 completed successfully with its build passing and stable publication
skipped. The catalog Release 37102178832 remains pending; no native publication
is claimed.

### Credential filesystem lock admission checkpoint

The shared Rust credential core now owns timeout admission, canonical positive
safe-integer claim PID validation, own/non-claim filtering and protected lock-path
selection. The native adapter injects the same policy into standalone auth-store,
embedded OAuth and embedded MCP client bindings. Node retains filesystem promises,
process liveness probes, cancellation objects, JSON host semantics and cleanup.
Ticket selection and predecessor ordering still remain in the JavaScript adapter;
this is a partial lock port, not completion of the credential dependency rewrite.

Three Rust tests first failed because the lock module was missing. They now cover
the timer domain including Infinity, safe-integer PID boundaries and Windows/Unix
path protection. Three additional native differential tests cover over 1,100 claim names,
invalid timeout types and abort precedence, root paths, symlinks, lone surrogates
and observable filesystem callback order against the original lock implementation.
The original 26 transaction-lock cases remain in the full Toolcraft reference route.

The maintained four-package test route passes: OAuth retains 772 reference cases
and 114 native checks, the client 445 cases and 83 native checks, and Toolcraft
6,200 cases across 125 files plus 266 native checks. The credential route was run
again after adding the differential fixtures and passes all 31 native checks,
Rust tests and strict types. Both routes finish their root posttest hook. Maintained
Rust/binding lint and scoped JavaScript lint pass. Thirteen packed own packages
again pass credential runtime and strict standalone-type verification.

An indicative warmed, alternating seven-round benchmark on Node 22.23.2 ARM64
(300 acquisitions per round, memfs, uncontended lock with callback result checks)
measured 118.925/89.314 microseconds native/reference for an empty lock directory
(1.33 times slower), and 132.609/98.114 microseconds with 32 ignored staging names
(1.35 times slower). Concurrent build load limits cross-run comparisons. No
performance or replacement gate passed, and no dependency was added.

The cancellation repair and Node facade are verified on remote main at 4684028a6b
and 122ef299fd. Their queued release runs were superseded. Descendant Release
37103492044 completed successfully with its build passing and stable publication
skipped; no native package publication is claimed.

### Credential lock ticket policy checkpoint

Rust now selects the next bakery ticket, rejects unsafe ticket overflow, admits
choosing predecessors and orders numeric tickets with UTF-16 claim-name ties.
Bindings retain ECMAScript numeric coercion and use an injected relational primitive
for nonnumeric host values. The adapter no longer owns the maximum-ticket reduction
or predecessor search. JSON claim-document admission, stale-owner cleanup and
asynchronous lock lifecycle remain in the adapter and still require an ownership
audit/port; portable credential storage remains unimplemented.

The new Rust tests first failed on missing next-ticket and predecessor policy.
Native differential tests cover numeric coercion, BigInt/Symbol rejection or
comparison as appropriate, null/undefined, safe-integer overflow, UTF-16 ties and
short-circuiting. A failing opaque-exception case showed that napi's Function call
converted a thrown object to a generic Error. A per-invocation adapter capture now
preserves the original thrown value, including undefined, null, symbols and objects
whose stringification itself throws, without leaking exception state across
reentrant calls.

The maintained four-package route passes again: 772 OAuth reference cases and
114 native checks; 445 client reference cases and 83 native checks; 6,200 Toolcraft
cases across 125 files and 266 native checks, strict types, the original CLI type
consumer and root posttest. After the final opaque-exception fixture was added,
the maintained credential route was rerun and passes 34 native checks, Rust tests,
types and posttest. Maintained Rust/binding lint and scoped JS lint pass. A fresh
packed credential package verifies mutual exclusion, waiting timeouts, cleanup,
callback results and encrypted storage using only injected memfs capabilities.

The same local warmed seven-round benchmark (300 uncontended memfs acquisitions
per round, alternating implementations, Node 22.23.2 ARM64) measured 85.019/74.292
microseconds native/reference for an empty directory (1.14 times slower), and
117.225/81.370 microseconds with 32 ignored staging names (1.44 times slower).
These shared-host measurements do not support cross-run speedup claims. No
performance/default-swap gate passed and no dependency was added.

The admission policy checkpoint is verified on remote main at 99ea07cb4e.
Release 37103665561 is pending behind the active workspace/CLI build in
37103531071. Publication remains unverified. The completed facade/admission
checkpoint's temporary output was purged.

### Embedded HTTP client spawn mapping repair

The final credential-consumer audit found a third host-source embedding in
tiny-http-mcp-server-rust, in addition to standalone OAuth and the client package.
Its maintained route reproduced ERR_PACKAGE_IMPORT_NOT_DEFINED in two native test
files: the copied client transport imports #tiny-mcp-spawn, but the HTTP package
did not declare that internal import. The HTTP manifest now maps Node/default and
browser/worker/workerd conditions to the already-copied own spawn adapters. No
runtime dependency was added and the existing host boundary is preserved.

Two fresh packed own packages (HTTP and protocol) pass the public test-token helper
and native client/server discovery, echo calls and cleanup with package imports
confined to those packages and Node builtins. Node and --conditions=browser runs
both verify the expected internal spawn resolution. The browser-condition Node
check does not qualify a browser-native addon or a browser deployment.

The HTTP maintained route passes all 50 native checks, Rust tests, 443 reference
cases across 21 files, declarations and root posttest after the separate reference
scheduling repair below. Its maintained native lint also passes. This expands the
credential ticket checkpoint's verification to every discovered adapter embedding.

### HTTP reference scheduling repair

After spawn resolution was repaired, the parallel HTTP reference run reproduced
a two-second timeout in the root-entry import-isolation case. The same unchanged
four-case file passes alone in 702 ms total (299 ms test execution). The native
reference configuration now uses one worker and serial files, matching the other
large native conformance routes. The two-second test timeout is unchanged and no
original assertion is modified. The maintained route then passes all 443 cases
across 21 files in 7.53 seconds, along with its 50 native checks, declarations,
Rust tests and posttest. Scoped configuration lint passes.

During log inspection, the installed Safe Bash rg Unicode-alternation limitation
was reconfirmed: printf 'x×y\n' piped to rg 'a|×' exits 2 with the non-NUL ASCII
C/POSIX-profile diagnostic; native rg prints the line and exits 0. Safe Bash's
literal rg '×' succeeds. The regex engine's admitAscii guard rejects code units
above 127. This is an observed command compatibility limitation, not a Toolcraft
failure, and no Safe Bash source was changed in this checkpoint.

### Credential claim-document admission checkpoint

The native credential binding now owns object admission, inherited ticket presence,
numeric/safe-integer checks, positivity and the final captured ticket value. Node
retains JSON.parse and a guarded ECMAScript comparison primitive. Invalid/incomplete
live documents still mean choosing, never an expired claim that can be stolen.
The binding deliberately preserves four distinct ticket reads: inherited getters
can change between the type, integer, positivity and final-value steps. The final
value retains its original identity, including undefined, functions, symbols,
BigInt and cycles when supplied by changing getters.

The focused suite failed first because native claim admission was missing. Four
new native suites compare the original predicate, property/proxy traces, rejection
short-circuiting and thrown values without stringification. Public raw-lock
differentials cover malformed/duplicate-key JSON, numeric boundaries, selected
publication tickets, operation results and cleanup with memfs. The final extended
identity cases also pass. The maintained five-package route passes: 38 credential
native checks; 772 OAuth reference cases and 114 native checks; 445 client cases
and 83 native checks; 443 HTTP cases and 50 native checks; and 6,200 Toolcraft cases
across 125 files with 266 native checks. Rust tests, declarations, the original CLI
type consumer and root posttest pass. Maintained native lint for all five packages
and scoped JS lint pass. A freshly packed credential package verifies valid and
malformed claim admission, publication tickets, callback results and retained-peer
cleanup without reference implementation imports.

A warmed, alternating seven-round Node 22.23.2 ARM64 benchmark (300 uncontended
memfs acquisitions per round) measured 73.432/74.967 microseconds native/reference
with no peer, and 97.378/91.000 microseconds with one live peer that retires before
the waiting scan (1.07 times slower). The empty case does not exercise claim parsing;
shared-host timing variance precludes a cross-run improvement claim. Performance,
portable credential storage and replacement gates remain open. No dependency was
added. The wasm32-unknown-unknown compiler target is already available for the
remaining portable-runtime work; its availability is not browser qualification.

The preceding ticket, HTTP mapping and test scheduling commits are verified on
remote main at 29e3372169, 5ef26dd451 and 923c4eb18d. Release 37104688079 completed
successfully with its workspace/CLI build passing and stable publication skipped.
No native package publication is claimed.

### Credential lock lifecycle checkpoint

Rust now owns claim/temporary-file cleanup ownership, cleanup target order and
deadline-based wait delays. Exclusive-create collisions preserve another owner's
file; partial writes retain cleanup responsibility. Node performs filesystem,
timer and AbortSignal effects and preserves original thrown values and aggregate
error ordering. No external dependency or public API changed.

Two Rust cases and a missing-native-constructor case failed before implementation.
The new native suite compares deadline edge values and nine public acquisition
scenarios against the original lock using memfs, including write collisions,
partial writes, rename failures/partial moves, operation failures and cleanup
failures. The maintained five-package route passes: 40 credential native checks;
772 OAuth reference cases plus 114 native checks; 445 client cases plus 83 native
checks; 443 HTTP cases plus 50 native checks; and 6,200 Toolcraft cases across 125
files plus 266 native checks. Rust tests, strict declarations, the original CLI
type consumer and root posttest pass. Maintained lint for all five packages and
scoped JavaScript lint pass. A packed credential artifact verifies partial-write
cleanup, preserving an unowned staging file, waiter timeouts and holder cleanup.

Seven alternating warmed rounds of 300 memfs acquisitions on Node 22.23.2 ARM64
measured native/reference medians of 66.562/71.098 microseconds without a peer,
and 84.953/78.793 microseconds with one retiring peer (1.078 times slower).
Shared-host timing does not establish a cross-run improvement or replacement
readiness. Portable credential storage, remaining dependency facades, standalone
Toolcraft types and performance/platform/default-swap qualification remain open.

Claim validation is verified on remote main at 4326346862. Its Release workflow
37105342163 remains pending; no native publication is claimed.


### Portable credential WebAssembly checkpoint

The credential dependency now exposes ./portable and the original browser,
worker, workerd, Node and default conditions. Portable construction remains
synchronous. A dependency-free Rust/WASM module owns path normalization and
ancestor selection, key/document admission, encrypted length validation, provider
keys and migration/rollback decisions. Host adapters retain filesystem effects,
WebCrypto, UTF-8/base64, promises, property access and error objects. The workerd
condition imports a compiled WASM module; browser/default portable consumers load
an embedded module. Node retains its original native-addon entry point.

The existing own safe-fs package supplies the shared FsError identity and exact
FileSystem type contract. Its existing xml-ast/noble runtime closure is included
in packed verification; no new third-party package or dependency version was
introduced. This shared host dependency remains part of the complete dependency
and packaging audit. Build/lint explicitly select rustup's stable WASM compiler:
the local Homebrew compiler did not have the target installed even though rustup
did. The package scripts build the WASM artifact before running native consumers.

Rust path/key/document tests failed on the missing module, and the public runtime
test failed on the missing ./portable export. Five new differential suites now
verify exact browser namespaces, encrypted interoperability, UTF-16 paths, public
class members, path/key failures, getter order, malformed documents, staging-file
ownership, symbolic links and original failure identity. Fixtures use memfs.
The maintained credential route passes 45 native checks and all 27 unchanged
original portable-storage/provider tests across two files, Rust tests, strict
Node/portable declarations and root posttest. All five credential-consumer routes
pass: OAuth 772 reference/114 native, client 445/83, HTTP 443/50 and Toolcraft
6,200 reference cases across 125 files plus 266 native checks. The original CLI
type consumer and remaining strict declarations pass. Maintained lint for the
five packages, WASM-target Clippy and scoped JS/TS lint pass.

Four packed artifacts independently verify portable encryption/deletion and the
Node export with imports confined to the installed artifacts and Node builtins.
Strict packed portable declarations resolve 122 modules entirely inside the
consumer, without workspace type fallback. Both workspace and packed artifacts
execute encryption, migration and cleanup in workerd without Node compatibility.
The packed browser-condition bundle also executes its embedded WASM in a VM with
browser capabilities and no runtime imports; this is VM evidence, not an actual
browser deployment or native-platform qualification. Toolcraft's auth-store
facade inherits the matching browser namespace and own class identities.

Seven warmed alternating rounds of 200 encrypted reads using memfs and WebCrypto
on Node 22.23.2 ARM64 measured 164.172 microseconds reference and 164.441
microseconds WASM. These shared-host measurements show no speedup. Full portable
lifecycle/host-semantics audit, standalone Toolcraft declarations, remaining
facades/testing/composition, Commander replacement and performance/platform/swap
qualification remain required. JavaScript stays the default implementation.

The lock lifecycle commit is verified on remote main at 3a89bc159a. Descendant
Release 37106007262 succeeded with the workspace/CLI build passing and stable
publication skipped. No native publication is claimed.


### Public agent MCP configuration subpath checkpoint

The agent-mcp-config subpath explicitly forwards the six reference runtime exports
and five public type exports to the existing own Rust package. Native-only helper
types remain private to that dependency's namespace. The package becomes an
installed own dependency; no third-party dependency or default execution path is
added. Configure/unconfigure retain injected filesystem capabilities and the
existing declarative agent configuration registry.

The new public test failed first on the missing subpath. A compiler inventory
verifies all eleven runtime/type export names. Two differential cases compare
namespace/function identities, aliases, support status, platform-specific paths,
and actual JSON/TOML/YAML configuration edits through memfs for all six agents
and all three platform options. They cover dry runs, idempotent configuration,
retaining a second server and removal. The platform options exercise path policy,
not native-addon execution on three operating systems.

The maintained selected build passes its declared dependency closure. The combined
configuration/Toolcraft test route passes 63 original configuration cases and
13 native checks, then 6,202 Toolcraft cases across 126 files plus 266 native checks,
Rust tests, strict dependency declarations, the original CLI type consumer and
root posttest. Maintained native lint and scoped JS/TS lint pass. Two packed own
artifacts independently configure/remove servers for every supported agent, with
ESM imports confined to those artifacts and Node. Strict packed declaration checks
load 195 source files only from the packed consumer and TypeScript libraries;
workspace reads are forbidden by the compiler host, with existing Node/undici
declarations copied into the consumer.

Seven alternating warmed rounds of 100 fresh memfs Claude stdio configurations
on Node 22.23.2 ARM64 measured reference/native medians of 211.324/411.980
microseconds (1.95 times slower). The facade adds no per-call transformation;
this sample characterizes the existing native dependency under shared-host load.
The dependency's documented YAML diagnostic limitations and broader type,
performance/platform/default-swap gates remain open.

Portable credential delivery is verified on remote main at 056d5a2c71. Its
Release 37106896772 remains pending. Package workflow 37106896675 succeeded with
standalone-bundle/publication skipped; descendant package workflow 37106921154
is checking standalone bundles on Node 18.18, 20, 22 and 24. No native publication
is claimed. The completed portable checkpoint's temporary artifacts were purged.


### Public JSONC assignment projection repair

A public configMutation.transform reproduction showed different callback keys and
written files for an authored __proto__ field: the reference JSONC parser assigns
properties before cloning its own fields, while the native standalone codec
retains every field. Public mutation, template and testing entry points now use a
Rust projection of that assignment-and-clone policy. It tracks whether each raw
parsed object still exposes the inherited prototype setter, including null
prototype transitions, duplicate fields, arrays and nested prototype objects.
It computes the resulting own fields without setting JavaScript prototypes.
The standalone native JSON codec retains its existing own-field contract.

The public callback/file trace test and Rust missing-function test failed before
the repair. Regression coverage now includes merge, prune guards, transform,
dry-run and template/current-document behavior using memfs. Public parseJson is
compared against 162 paired/nested duplicate-key documents plus escaped-key
coverage, including own descriptors and cloned prototype identity. The maintained
four-package route passes: configuration 73 native checks and 261 original cases;
agent MCP 13/63; skill configuration 8/137; and Toolcraft 266 native checks plus
6,202 reference cases across 126 files. Rust tests, declarations, the original CLI
type consumer and root posttest pass. All selected maintained lint and scoped
JavaScript lint pass. Three packed own artifacts verify mutation callbacks and
exact output, MCP unconfiguration and the standalone/MCP/skill embedded codec
projections, with imports confined to the artifacts and Node builtins. The skill
package's separate async helper aliases still reference its canonical package;
this codec verification does not qualify those unrelated helpers as rewritten.

Seven alternating warmed Node 22.23.2 ARM64 rounds of 1,000 public parseJson calls
measured reference/native medians of 96.483/117.916 microseconds for 64 ordinary
fields (1.22 times slower), and 7.829/3.937 microseconds for a small nested and
duplicate prototype-field document (1.99 times faster). Outputs were compared
before timing and 32 results retained. Shared-host, workload-specific results do
not establish an overall speedup or satisfy replacement performance gates.
No dependency or default JavaScript implementation changed.

The next verified configuration gap is TOML table admission: the current locked
reference accepts [[section] at EOF as {section:[{}]}, while native parsing
rejects it. With a following value line, both reject but produce different error
messages/locations. Both current consumers resolve smol-toml 1.7.0, so the older
README/test claim about different SDK versions is stale. This needs public-contract
reconciliation; direct-codec standards fixes do not establish swap parity.

The public agent MCP facade is verified on remote main at 2b1ebdad72. Release
37107639647 succeeded with its workspace/CLI build passing and stable publication
skipped. Native package publication remains unverified.

### TOML table-header consumption parity

The public parser now follows the current reference's table-array terminator
consumption, including accepting `[[section]` at EOF and consuming one further
UTF-16 unit. The earlier native check rejected such files, causing public
configuration mutations to create invalid-file backups and discard accepted
table content. Both consumers resolve smol-toml 1.7.0; stale version-divergence
claims and oracle exclusions were removed.

Rust and public mutation/parser regressions failed before the repair. Differential
checks cover plain, dotted and quoted Unicode keys with ten suffixes, complete
error diagnostics, merge/transform file traces, backups and dry runs. The maintained
four-package route passes configuration 75 native/261 original cases, agent MCP
13/63, skill configuration 8/137 and Toolcraft 266 native/6,202 original cases
across 126 files, plus Rust, declaration and root posttest checks. Maintained lint
for all four packages and scoped JavaScript lint pass. Three freshly packed
artifacts verify standalone/MCP/skill embedded TOML values and diagnostics with
runtime imports confined to those artifacts and Node. Packed public mutation
preserves the accepted section without creating an invalid-file backup.

The preceding JSONC repair is verified on remote main at 62abc4f3d8. Its Release
37108412662 is pending at this checkpoint. No dependency, default implementation
or publication claim changes. Async skill helper delegation, remaining public
facades/types, YAML diagnostics, resource bounds and platform/performance/swap
qualification remain open.

### Async skill discovery ownership

The native package's public discoverSkillsAsync export was the canonical
JavaScript function itself. It now uses an own Rust discovery state machine for
UTF-16 child ordering, root/file admission, traversal and successfully loaded path
deduplication. The host retains injected filesystem calls, POSIX path operations,
text decoding, cancellation checkpoints and original foreign exception identities.
The already-existing own safe-fs package supplies its bridge/type/path contracts;
the lockfile adds only that workspace edge, with no new third-party package or
version. Five other async skill helpers still delegate to the canonical package.

The ownership test and missing Rust module test failed before implementation.
Six Node differential checks cover exact filesystem traces, repeated roots,
Unicode ordering, string/byte BOM decoding, symbolic roots/children/files,
nonregular files, missing/error admission by operation, foreign error identity,
cancellation/iterator closure and a real in-memory safe-fs capability. Two Rust
tests independently exercise traversal state and errors. The maintained package
route passes 14 native checks and 137 original cases, Rust tests, bidirectional
public types and root posttest. Maintained/scoped lint and the selected build
with its declared dependency closure pass.

Packed discovery runs with imports confined to its artifact, packed safe-fs/xml-ast,
the existing noble package and Node. Its independent declaration consumer passes
strict checking with 253 source files and a compiler host forbidding workspace
reads. These checks target the discovery module: the root still imports the five
canonical async aliases and is not independently qualified as rewritten.

Seven alternating warmed rounds of 100 calls on Node 22.23.2 ARM64 discover 16
memfs skills from a repeated directory. Reference/native medians are
178.374/245.577 microseconds (1.38 times slower); outputs match before timing and
28 results are retained. This is not a performance improvement or default-swap
qualification. No browser/Worker native-addon support is claimed.

TOML delivery is verified on remote main at 3ebac55815. Releases 37108901356
(TOML) and 37108412662 (JSONC) remain pending at this checkpoint. JavaScript
remains the default; all remaining dependency, facade/type, platform and
performance/swap gates stay open.

### Async skill-reference resolution ownership

The public async resolver now shares the own Rust validation, alias/catalog,
path-planning and result-construction policy with synchronous lookup. The host
executes the ordered stat requests through the existing safe-fs bridge and retains
error admission and cancellation timing. Malformed and unknown-agent references
return before acquiring a filesystem capability. Four async helpers still delegate:
exclude append/removal and bridge/cleanup. Arbitrary malformed JS values/accessors,
remaining independent root packaging, platform and default-swap gates remain open.

The ownership regression and missing Rust search-plan API failed before the port.
Three native tests cover malformed string references, six agents and their aliases,
project-before-user lookup, a project file with a user directory fallback, exact
provider call traces, admitted/missing/denied stat errors and cancellation.
A Rust test proves that preparing the shared plan performs no filesystem stat.
The maintained route passes 17 native checks, 137 original cases, Rust tests,
bidirectional public declarations and root posttest. Maintained Rust lint and
scoped JavaScript lint pass; the binding's free-function visibility was corrected
when the lint build exposed it as unreachable.

Fresh packed lookup matches canonical outcomes using only packed artifacts and
Node at runtime. Its strict independent type consumer loads 255 source files
with workspace reads forbidden. As with discovery, this qualifies the new module,
not the four remaining delegated root aliases. No dependency is added here.

Seven alternating warmed rounds of 1,000 project skill lookups on Node 22.23.2
ARM64 measured reference/native medians of 5.720/22.116 microseconds (3.87 times
slower). Outputs match before timing and 28 results are retained. This sample
shows no speedup and leaves performance qualification open.

Discovery is verified on remote main at 5e820498b3, including ancestry after
remote main advanced. Its Release 37109364927 and package workflow 37109364787,
plus the preceding JSONC/TOML releases, are still pending at this checkpoint.
JavaScript remains the default, and native publication is not claimed.

### Async Git exclude lifecycle ownership

The native package now owns appendExcludeBlockAsync and removeExcludeBlockAsync.
The own Rust state machine searches parent directories, recognizes worktree
gitdir files, checks metadata ancestors, transforms run-owned blocks and controls
write/rename/cleanup requests. This preserves the async reference's distinct
behavior instead of substituting the synchronous Git subprocess and cleanup
policies. The JavaScript host retains filesystem capabilities, per-provider
promise queues, arbitrary foreign errors and final cleanup-error precedence.
Only async bridge and cleanup still delegate to the canonical skill package.

Ownership and missing-core regressions failed before implementation. Six native
tests compare exact provider traces and final in-memory files for missing/existing
excludes, incomplete markers, repeated/concurrent run IDs, parent lookup, worktree
files, symlinks, validation order, cancellation, queue recovery, partial writes,
rename failures and cleanup-error precedence. Entries are read again after the
queue delay: late newline entries remain admitted. An additional failing case
exposed Symbol coercion divergence after validation; the host now preserves
Array.join conversion behavior for late nullish/object/Symbol values. Two Rust
tests cover traversal and publication state independently.

The maintained package route passes 23 native checks, 137 original cases, Rust
tests, bidirectional public declarations and root posttest. Maintained Rust lint,
scoped JavaScript lint and diff checks pass. Fresh packed code runs worktree
lookup, queued append/removal and cleanup with imports confined to packed own
artifacts, the existing noble package and Node. Strict packed declarations pass
with 254 source files and workspace reads forbidden. This qualifies the exclude
module, not the two remaining delegated root aliases. No dependency was added.

Seven alternating warmed rounds of 100 append/remove cycles on Node 22.23.2 ARM64
measured reference/native medians of 94.934/184.550 microseconds (1.94 times
slower), with the initial file restored after each sample and 28 retained results.
No performance improvement or default-swap readiness is claimed.

Async lookup is verified on remote main at 6bfb99f86f. Release 37109849456 remains
pending. Discovery package workflow 37109364787 succeeded with standalone-bundle
and publication skipped; it does not verify a native publication. The preceding
root releases and remaining dependency/type/platform/performance gates stay open.

### Skill-directory path injection parity

Preparing the async bridge port exposed a public API omission: resolveSkillDir
ignored the canonical fifth path argument and its declaration rejected it. Native
resolution now uses the supplied join/resolve methods with their original receiver
and evaluation order, reads only the selected configuration field, and obtains a
default home only for global scope. Rust retains the scope/home-expansion policy.

Three runtime tests and an explicit five-argument type consumer failed before
the fix. They cover all six agents with portable POSIX and Windows path primitives,
custom path receivers/getters, unused configuration fields and default-home timing.
The maintained route passes 26 native checks, 137 original cases, Rust tests,
public declarations and root posttest. Maintained/scoped lint passes. Fresh packed
configuration paths match the reference, and strict standalone declarations load
192 sources with workspace reads forbidden. This exercises path policies, not a
Windows native-addon deployment. No dependency or default implementation changes.

Async excludes are verified on remote main at 727123dbd9, including ancestry after
main advanced. Release 37110534115 remains pending. Earlier JSONC Release
37108412662 completed successfully through its queue check, but build, validation
and publication were skipped; this does not verify publication. Async bridge and
cleanup, complete root independence and the wider rewrite/swap gates remain open.

### Async skill bridge and cleanup ownership

The last two canonical async skill aliases are replaced with an own Rust bridge
engine. Rust owns registry claims, SHA-256 fingerprints, collision policy, binary
tree copies, rollback, selective cleanup and reference counts. A standard-library
polled Future bridge requests host I/O without threads, an executor, unsafe code
or a new dependency. The Node host retains filesystem/path/UUID operations,
promise queues, manifest entry identities and original errors. Queued references
are observed when work starts; serialized manifests resolve through bridgeId.
Rollback clears cancellation only for its cleanup operations.

Native ownership, missing Rust module and explicit bridgeId declaration tests
failed before the implementation. The maintained package route passes 34 native
checks, 141 original cases across six files, Rust tests, bidirectional public
types and root posttest. Maintained Rust lint, scoped JavaScript/TypeScript lint
and diff checks pass. Differential coverage includes successful binary copies,
warnings, shared ownership, serialized cleanup, source/target/token changes,
collisions and symlinks, copy/token/exclude failures, cancellation and racing
target creation. It also checks queued reference mutations, retained entry arrays,
cleanup getter timing, provider identity and foreign primary-error identity.
Successful scenarios explicitly assert entries, warning kinds, bytes and cleanup.

Freshly packed artifacts now qualify the complete public skill-package root:
all 20 runtime exports match the canonical namespace, and discovery, lookup,
exclude updates, binary bridging, overlapping ownership and serialized cleanup
pass for all six agents. The import guard admits only the packed own packages,
existing noble package and Node builtins. No canonical skill package or workspace
fallback is available. Strict packed root declarations pass with 265 source
files, skipLibCheck disabled and compiler reads outside the packed consumer and
TypeScript standard library forbidden. The consumer includes bridgeId and the
optional fifth resolveSkillDir path argument.

Seven alternating warmed rounds of 100 in-memory bridge/cleanup cycles on Node
22.23.2 ARM64 measured reference/native medians of 279.515/1062.699 microseconds
(3.80 times slower). Each cycle bridges one skill with a nested 256-byte asset;
outputs match before timing and original excludes are checked after each round.
There are 28 retained results. This does not demonstrate an overall speedup or
qualify the implementation for a default swap.

Path injection is verified on remote main at 26f68ecef3. Releases 37108412662,
37108901356, 37109364927, 37109849456, 37110534115 and 37110983516 completed
successfully through queue checks with build/validation/publication skipped;
package workflow 37109364787 also skipped standalone bundling and publication.
These are not verified builds or native releases. JavaScript remains the default;
arbitrary malformed/accessor behavior, host-reply JSON resource limits, portable
artifacts, remaining Toolcraft facade/type/dependency coverage and performance
qualification remain open. No new third-party dependency was added.

### Public configuration-mutation subpath checkpoint

The missing toolcraft-rust/config-mutations export now exposes the own Rust
configuration-mutation package through the same Toolcraft entry point. Runtime
exports and public types are direct reexports, preserving dependency identities
without adding a wrapper, package dependency or lockfile change. The reference
namespace has ten runtime exports; both runtime identity and bidirectional
declaration consumers cover the facade.

The public import test failed on the missing export before implementation. The
maintained Toolcraft route now passes 266 native checks and 6,205 reference-route
cases across 127 files, including three new facade checks. Rust tests, public
declarations, the original CLI compile-check consumer, strict dependency types
and root posttest pass. Maintained Rust lint and scoped JavaScript/TypeScript lint
pass. The new facade cases compare JSON/TOML/YAML merge, prune and transform,
dry runs, no-op updates, observer traces, filesystem helpers, template writes and
foreign transform-error identity using memfs.

Two fresh packed own artifacts verify all ten exports, successful edits in all
three formats, exact file contents, observer traces and repeated/dry-run outcomes.
An import guard forbids runtime fallback outside those artifacts and Node
builtins. The strict packed subpath declaration consumer reads 194 source files
with skipLibCheck disabled and workspace reads forbidden. This qualifies this
subpath, not independent installation of every Toolcraft public entry point.

Seven alternating warmed rounds of 100 64-field in-memory JSON merge/prune/
transform cycles on Node 22.23.2 ARM64 measured reference/native medians of
345.875/404.670 microseconds (1.17 times slower), including fixture construction.
Outputs match before timing and after each round; 28 results are retained. The
facade adds no per-call transformation and this sample establishes no speedup.
The underlying YAML diagnostic/resource-limit gaps and JavaScript property
operation policies remain recorded in the dependency README.

Async skill bridge delivery is verified on remote main at abf4df0a21. Release
37112297042 remains pending; no native publication is claimed. Temporary bridge
checkpoint artifacts were purged. JavaScript remains the default, with remaining
public facades, dependency fidelity, portable artifacts and swap gates open.

### Frontmatter line-counter object compatibility

Auditing the next public facade reproduced a dependency mismatch: native
parseFrontmatterDocument line counters enumerated methods before lineStarts and
assigned field-inferred names to callbacks that are anonymous in the reference.
The host now creates its data property and callback properties in the original
constructor order. Detached callbacks retain their lexical receiver and observe
replacement lineStarts arrays. No parsing policy or dependency changes.

The descriptor/order regression failed before the repair. The maintained
frontmatter package route passes ten native checks, all 18 original cases, Rust
tests, declarations and root posttest; maintained and scoped lint pass. This
small host-object correction does not establish complete YAML conformance or
portable artifact qualification. The public Toolcraft frontmatter entry point
remains to be added.

Configuration-mutation facade delivery is verified on remote main at b831d95b5c.
Its Release 37112770887 and bridge Release 37112297042 remain pending. Temporary
configuration-facade checkpoint artifacts were purged. No release or speedup is
claimed.

### Frontmatter option-error compatibility

A direct comparison exposed an incorrect exception-identity assumption in the
native tests: parseFrontmatter must wrap errors thrown by the uniqueKeys getter
as FrontmatterParseError, while parseFrontmatterDocument preserves the original
thrown value. The parser host now follows those distinct entry-point boundaries.
Absent and incomplete fences still do not read options. The differential
regression failed before the repair and covers Error, TypeError, null, string and
plain-object throws, including the reference's unknown-parse-error fallback.
The maintained frontmatter route passes ten native checks, 18 original cases,
Rust tests, declarations and root posttest; maintained/scoped lint pass.
This does not close the remaining YAML diagnostic or resource-boundary gaps.

### Public frontmatter subpath checkpoint

The missing toolcraft-rust/frontmatter entry point now reexports the seven public
functions/classes and five named public types from the own Rust dependency.
Explicit exports preserve the canonical surface without exposing the dependency's
implementation-only counter type. The manifest and lockfile add only the already
existing own frontmatter-rust workspace edge; no third-party package or version
was added. The public import test failed before implementation.

The maintained two-package route passes Toolcraft's 266 native checks and 6,207
reference-route cases across 128 files, plus frontmatter's ten native checks and
18 original cases. Rust tests, public declarations, the original CLI consumer,
strict dependency types and root posttest pass. Maintained Toolcraft Rust lint,
scoped JavaScript/TypeScript lint and diff checks pass. Public facade cases cover
exact namespace/identity, BOM and LF/CRLF/CR fences, duplicate keys, Markdown body
and UTF-16 preservation, source positions, counter property order, stringify
output, typed kind errors and entry-point-specific option-error handling.

Two fresh packed own artifacts pass runtime checks with an import guard forbidding
workspace and canonical-package fallback. The strict packed declaration consumer
reads 193 sources with skipLibCheck disabled and compiler reads confined to the
packed consumer and TypeScript standard library. This qualifies the frontmatter
subpath, not the full Toolcraft artifact or every YAML diagnostic/recovery case.

Seven alternating warmed rounds of 1,000 public parses of a 64-field YAML
frontmatter document on Node 22.23.2 ARM64 measured reference/native medians of
477.743/98.055 microseconds (4.87 times faster for this workload). Parsed values
match before timing and after each round; 28 results are retained. This is a
workload-specific parsing improvement, not an overall Toolcraft speedup or swap
qualification. The underlying YAML warnings, complex keys, recovery diagnostics
and resource limits remain open.

Both prerequisite fixes are verified on remote main: counter descriptors at
3614227713 and option-error wrapping at 4f2ab53d35. Release 37113109684 for their
pushed head remains pending, as do bridge Release 37112297042 and configuration
facade Release 37112770887. No native publication is claimed. JavaScript remains
the default; process-runner, safe-bash, testing and composition entry points and
the wider dependency/platform/performance qualification remain unfinished.

### Process filesystem capability compatibility

The process-runner facade audit exposed two dependency gaps. Packed declarations
failed because WorkspaceTransferEnv imports the existing own safe-fs contract
without declaring that package. The process package now declares that workspace
edge. No third-party package or version is added.

A differential capability reproduction also showed that native upload/download
converted supplied Uint8Array views into Buffer copies before passing them to
destination callbacks; the reference retains the original views. Generated
archives likewise reached callbacks as Buffer instead of Uint8Array. The adapter
now preserves payload objects and confines Buffer views to the native hashing
and tar boundaries. Ignore-file decoding remains explicit UTF-8, including when
the input is a nonzero-offset byte view.

The callback identity/constructor regression failed before the repair. Two added
capability cases cover separate local/remote providers, binary copies, ignored
files, conflict refusal and overwrite, nonzero offsets, original upload/download
byte identity and archive constructors. The maintained process package route
passes 22 native checks and 170 reference-route cases across ten files, plus Rust,
declaration and root posttest checks. Maintained and scoped lint pass. Packed
runtime checks exercise capabilities and original byte views without canonical
fallback; standalone declarations now resolve the declared filesystem contract.
The public Toolcraft facade is being qualified separately. Real-engine, platform,
malformed/getter and broader performance gates remain open.

### Public process-runner subpath checkpoint

The missing toolcraft-rust/process-runner entry point now exposes all 14 runtime
exports and the canonical named public types from the own Rust process package.
Direct reexports retain dependency identities; implementation-only Docker build
type aliases are not added to the Toolcraft namespace. The manifest and lockfile
add the existing own process-runner-rust workspace edge. No new third-party
package or version is introduced. The public import regression failed before
implementation.

The maintained two-package route passes Toolcraft's 266 native checks and 6,210
reference-route cases across 129 files, plus the process dependency's 22 native
checks and 170 reference-route cases across ten files. Rust tests, declarations,
the original CLI compile-check consumer, strict dependency types and root
posttest pass. Maintained Rust lint and scoped JavaScript/TypeScript lint pass.
The facade tests cover exact exports and identities, Docker/Podman context
arguments, mock stream bytes and results, command lookup, pre-aborted handles and
host environment capability and lifecycle outcomes.

Fresh packed artifacts verify a real Node subprocess with piped input, UTF-8
stdout/stderr, explicit environment and nonzero exit, pre-aborted execution, mock
streams, host lifecycle and capability-based workspace upload/download. Runtime
imports are confined to packed own artifacts, the existing noble package and
Node builtins. Binary callback identity and ordinary Uint8Array archives are
asserted. Strict packed public declarations pass with 260 sources, skipLibCheck
disabled and compiler reads confined to the consumer and TypeScript library.
These checks qualify this subpath; real Docker engines, all malformed/getter
behavior, platform artifacts and the full Toolcraft installation remain open.

Seven alternating warmed rounds of 1,000 simulated mock-runner create/exec/result
cycles on Node 22.23.2 ARM64 measured reference/native medians of 0.687/2.374
microseconds (3.46 times slower). Outputs match before timing and after each
round, with 28 retained results. This measures native policy/adapter overhead,
not real process or container latency, and establishes no speedup.

Frontmatter facade delivery is verified on remote main at 9131703e03. Root
Releases 37112297042, 37112770887, 37113109684 and 37113411495 completed through
queue checks with actual builds, validation and publication skipped. The separate
package workflow 37113411412 has passed real standalone bundles on Node 22/24;
Node 18/20 checks remain active. It tests existing Toolcraft packaging and does
not establish native artifact publication. JavaScript remains the default.
Safe Bash, testing and composition entry points and broader replacement gates
remain unfinished.

### Native Safe Bash command integration

The missing toolcraft-rust/safe-bash entry point now owns toolcraftDefaults,
createToolcraftCommandExecutor and toolcraftCommands. Rust controls command/root
admission, declaration-path discovery, schema-position regex rejection, default
validation, root selection, aliases, capability overrides, filesystem write flags
and registration. Its per-invocation output budget retains pending bytes until a
sink succeeds, including the byte that exceeds the one-MiB limit. Node preserves
object/array operations, live getters, original callback receivers, promises,
streams, AbortSignals, filesystem capabilities and arbitrary errors. Execution
uses the existing native CLI; there is no canonical Toolcraft runtime import.
The manifest adds only the existing own Safe Bash workspace for public contracts.
No third-party dependency or default implementation changes.

Missing public-module and Rust-budget tests failed before implementation. All
three canonical Safe Bash suites now resolve this module, native definitions,
schema and approval policies. The maintained route passes 269 native checks and
6,249 reference-route cases across 133 files, plus Rust tests, declarations,
the original CLI consumer, both original Safe Bash compile-check fixtures,
strict dependency types and root posttest. Bidirectional public namespace types
and handler-capability augmentation pass. Maintained Rust and scoped JavaScript/
TypeScript lint pass. Differential coverage includes root accessor order,
registration receivers, live service options, default isolation, all schema
positions, arbitrary throws, cancellation precedence, virtual write flags,
inherited missing-file codes, captured cwd, live symlink predicates, explicit
approval revocation, output limits and sink failures. A final failing regression
also repaired the adapter's captured Array.isArray function: root accessors may
replace that host operation before the second library-shape check.

Fresh packed runtime checks exercise all three public exports, typed-schema
commands, configured defaults, aliases, filesystem reads, environment/services,
streaming, plugin capability forwarding and pre-aborted execution. The import
guard confines runtime resolution to packed own artifacts, existing Commander
and Node builtins and rejects canonical Toolcraft/schema/design fallback. Help
and JSON output match the canonical bytes; an ad hoc CLI screenshot was inspected.

Strict standalone declarations are NOT qualified. The isolated consumer exposed
remaining canonical type imports through root definitions, schema, CLI and
human-in-loop declarations. Its raw workspace Safe Bash tarball also retains
private workspace type imports; that tarball does not exercise the maintained
Safe Bash publication packager and is not evidence of a released-package defect.
The next type qualification must remove canonical contract imports and exercise
actual published Safe Bash contract packaging, rather than add workspace fallback
or relax the strict consumer. The new module's ordinary compile consumers pass,
but they do not close this installation gate. Its 128-entry synchronous callback
guard also remains a resource-parity boundary, not an exact engine stack limit.

Seven alternating warmed rounds of 200 command executions on Node 22.23.2 ARM64
measured reference/native medians of 63.235/1115.129 microseconds (17.63 times
slower). The workload parses a numeric flag, applies a configured string default,
reads an injected environment value and emits JSON through a local async sink;
it includes invocation fixture construction. Outputs match before timing and
at the end of every sample; 14 results are retained. Shared-machine load limits
cross-run comparisons. This establishes no performance improvement or swap
readiness.

Process capability and facade delivery are verified on remote main at a515d143b7
and 4b420c9b77. Root Release 37114410087 completed successfully through its queue
check with actual build, validation and stable publication skipped; package run
37114409834 remains pending at this checkpoint. The earlier package workflow
37113411412 completed real standalone bundles on Node 18.18/20/22/24, published
canonical Toolcraft/schema/OpenAPI and verified installed signatures. That is
verified JavaScript package publication, not native artifact publication.
Testing/composition entry points, standalone types, dependency fidelity, portable
artifacts, resource behavior and performance qualification remain unfinished.
