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
