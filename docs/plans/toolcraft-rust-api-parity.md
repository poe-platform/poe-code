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

The remaining sequence is still required. Definition declarations currently
import existing schema/design/config contract types. Standalone type packaging
must be finished before a swap. Direct higher-order assignment of the generic
stream factories also needs shared contract identity: independent recursive
declarations make TypeScript infer the stream context as services during that
assignment, although matching generic instantiations and inferred SDK consumers
pass. Do not treat those narrower checks as proof of full factory interchangeability.
