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
