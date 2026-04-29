---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: scaffold-package
    title: Scaffold @poe-code/agent-script package
    prompt: |
      Create a new package at packages/agent-script with package.json
      (name "@poe-code/agent-script", zero runtime deps), tsconfig.json
      matching the workspace style, README stub, and src/index.ts that
      re-exports parse, lint, run, dump, restore (placeholders). Wire
      it into the workspace package list and the build pipeline.
    status:
      "impl ement": open
      commit: done
      implement: done

  - id: parser-tokenizer
    title: Tokenizer for the agent-script subset
    prompt: |
      In packages/agent-script/src/parse/tokenizer.ts implement a hand-
      written lexer producing tokens for: identifiers, keywords (const,
      let, if, else, for, while, return, break, continue, try, catch,
      finally, throw, async, await, import, from, as, true, false, null,
      undefined, in, of), numeric and string literals, template strings
      (no tagged templates), punctuators, optional-chaining, nullish-
      coalescing, spread/rest. Emit positional info (line/column/offset)
      with each token. Reject regex literals and BigInt suffix.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-literals-identifiers
    title: Parse literals, identifiers, template strings
    prompt: |
      In packages/agent-script/src/parse/parser.ts implement parsing of
      number, string, boolean, null, undefined literals; array and
      object literals with computed keys, shorthand props, spread; and
      template strings (no tagged templates). Identifiers are bare names
      only. AST nodes carry source spans. Reject regex literals at parse
      time with a clear message.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-expressions
    title: Parse arithmetic, logical, optional-chaining, nullish, ternary
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts with binary +
      unary operators (arithmetic, comparison, logical, bitwise where
      supported), the conditional (ternary) operator, optional-chaining
      (?., ?.()), and nullish-coalescing (??). Maintain JS precedence
      and associativity. Add unit tests for tricky precedence cases
      (e.g. `a ?? b && c`).
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-member-call-spread
    title: Parse member access, function calls, spread/rest
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts to handle dotted
      and computed member access (a.b, a[c]), function calls f(...args)
      with spread arguments, and rest patterns in array/object/param
      destructuring. Reject `new` and `this` at parse time with a
      DisallowedSyntaxError.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-arrow-functions
    title: Parse sync and async arrow functions
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts with arrow
      function parsing — single-param shorthand (x => x), parenthesized
      params, default params, rest param, destructured params, async
      arrows (`async (x) => ...`). No `function` keyword, no generators,
      no method shorthand. Body can be expression or block.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-destructuring
    title: Parse object and array destructuring
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts to support
      destructuring in let/const declarations, function params, and
      assignment targets. Support nested patterns, defaults
      (`{ a = 1 } = ...`), rename (`{ a: b } = ...`), rest in arrays
      and objects. Reject any pattern that uses computed property
      names without an identifier source.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-control-flow
    title: Parse if/else, for, for-of, while, return, break, continue
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts with statement
      forms: block statements, if/else, C-style `for (init; test;
      update)`, `for...of`, `while`, `return [expr]`, `break`,
      `continue`. Reject `do/while`, `switch`, `for...in`, labels, and
      `var` with DisallowedSyntaxError naming the offending construct.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-try-catch-throw
    title: Parse try/catch/finally and throw
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts to support
      try/catch/finally with optional catch binding (`catch { ... }`
      and `catch (e) { ... }`), and the throw statement. Tests should
      cover try/finally without catch and try/catch without finally.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-imports
    title: Parse ES module imports (named, default, namespace, alias)
    prompt: |
      Extend packages/agent-script/src/parse/parser.ts to support
      `import { x } from "name"`, `import { x as y } from "name"`,
      `import x from "name"`, `import * as ns from "name"`. Specifier
      must be a string literal that contains no slash, dot, or
      protocol — relative paths and URL imports are rejected with a
      message naming the bad specifier.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: parser-error-format
    title: Format parse errors with code excerpt and caret
    prompt: |
      In packages/agent-script/src/parse/format-error.ts produce parse
      diagnostics shaped { kind: "ParseError", filename, line, column,
      excerpt, caret, message }. Excerpt shows two lines of context
      above and one below the offending token; caret aligns under the
      offending column. Used by the parser's throw path.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: ast-node-ids
    title: Assign stable AST node IDs for snapshots
    prompt: |
      Add a deterministic post-parse pass in
      packages/agent-script/src/parse/assign-ids.ts that walks the AST
      in source order and assigns each node a stable integer id. The
      ids are used by snapshots to refer to code pointers; identical
      source must produce identical ids. Add a test that re-parsing
      the same source twice yields identical id maps.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: ast-content-hash
    title: Hash parsed AST for snapshot validation
    prompt: |
      In packages/agent-script/src/parse/hash.ts compute a content hash
      over the parsed AST (structure + literal values, ignoring source
      spans). Use a simple non-cryptographic hash (FNV-1a or similar) —
      no new dependencies. Snapshots store this hash; restore compares
      it to the rehashed source and rejects on mismatch.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as001-disallowed-syntax
    title: Lint AS001 — disallowed syntax
    prompt: |
      In packages/agent-script/src/lint/rules/AS001.ts implement the
      AS001 rule: report error on any of `function`, `class`, `new`,
      `this`, generators, `var`, `do/while`, `switch`, `with`, labels,
      regex literals, `eval`, `Function`. Each diagnostic names the
      construct and points at its source span.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as002-mutable-capture
    title: Lint AS002 — closure captures mutable binding
    prompt: |
      In packages/agent-script/src/lint/rules/AS002.ts implement
      AS002: a lambda may close over `const` bindings, parameters, and
      module imports — closing over a `let`-bound name from an outer
      scope is an error. Hint suggests changing to `const` or passing
      as a parameter. Test with nested closures and Promise.all
      branches.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as003-unknown-identifier
    title: Lint AS003 — unknown identifier with suggestions
    prompt: |
      In packages/agent-script/src/lint/rules/AS003.ts report errors
      for identifiers that don't resolve in the current scope chain or
      module imports. Suggest near-matches (Levenshtein distance ≤ 2)
      drawn from in-scope names. List the in-scope names if no near
      match.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as004-005-modules
    title: Lint AS004/AS005 — unknown module and unknown export
    prompt: |
      In packages/agent-script/src/lint/rules/AS004.ts and AS005.ts
      report errors when an import names a module not in the
      registered module list (AS004) or imports a name not exported by
      the module (AS005). Each diagnostic lists the available module
      names / exports for the offending import. The lint API takes a
      `modules` map of name → exported names.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as006-007-unused
    title: Lint AS006/AS007 — unused imports and bindings
    prompt: |
      In packages/agent-script/src/lint/rules/AS006-007.ts report
      warnings for imports that are never referenced (AS006) and for
      `const`/`let` bindings that are declared but never read (AS007).
      Skip names prefixed with `_`. Severity is warning, not error.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as008-await-scope
    title: Lint AS008 — await outside async function or top level
    prompt: |
      In packages/agent-script/src/lint/rules/AS008.ts report an
      error when `await` appears outside an `async` arrow function and
      outside the script's top-level scope. The check tracks scope
      depth during AST traversal.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as009-async-no-await
    title: Lint AS009 — async arrow returning host promise without await
    prompt: |
      In packages/agent-script/src/lint/rules/AS009.ts report an
      error when an async arrow returns a value from a host call
      without `await`-ing it (likely a forgotten await). Hint suggests
      adding `await` or documenting an explicit Promise return.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as010-unread-let
    title: Lint AS010 — top-level let with unread host result (warning)
    prompt: |
      In packages/agent-script/src/lint/rules/AS010.ts emit a warning
      when a top-level `let` is assigned the result of a host call
      and never read afterwards. Skip when the binding is reassigned
      or referenced anywhere else in the script.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as011-prototype-access
    title: Lint AS011 — prototype access
    prompt: |
      In packages/agent-script/src/lint/rules/AS011.ts report errors
      for any property access whose property name is `__proto__`,
      `prototype`, or `constructor` (whether dotted or computed
      member with a string literal key).
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as012-disallowed-method-args
    title: Lint AS012 — disallowed property method arguments
    prompt: |
      In packages/agent-script/src/lint/rules/AS012.ts report errors
      for known unsupported method-argument shapes: `String#split`,
      `String#replace`, `String#replaceAll` with a regex literal or
      a function replacer; `Array#sort` with a comparator that isn't
      an arrow returning a number. Static analysis is best-effort —
      the runtime also enforces these.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as013-reserved-names
    title: Lint AS013 — reserved module-name shadowing
    prompt: |
      In packages/agent-script/src/lint/rules/AS013.ts error when a
      top-level binding (`const`/`let`) shadows a registered module
      name (`agent`, `git`, `mcp`, `harness`, etc.). The set of
      reserved names is taken from the registered module map.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as014-cyclic-import
    title: Lint AS014 — cyclic import detection
    prompt: |
      In packages/agent-script/src/lint/rules/AS014.ts detect cyclic
      imports across modules registered as agent-script source files.
      In single-file mode (the only supported mode today) this rule
      is a no-op but the structure should be in place for future
      multi-file support.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-as015-promise-race-single
    title: Lint AS015 — Promise.race with a single argument (warning)
    prompt: |
      In packages/agent-script/src/lint/rules/AS015.ts emit a
      warning when `Promise.race` is called with a single-element
      iterable literal. Hint suggests `await` instead.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: lint-driver-and-types
    title: Lint driver, diagnostic shape, and CLI export
    prompt: |
      In packages/agent-script/src/lint/index.ts wire each rule into a
      single deterministic pass and export the public `lint(source,
      { filename, modules }) => Diagnostic[]` API. Diagnostic shape:
      { code, severity, message, filename, line, column, span, hint? }.
      Order diagnostics by (line, column, code).
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-scaffold
    title: Async tree-walking interpreter scaffolding
    prompt: |
      In packages/agent-script/src/interp/interpreter.ts implement an
      async function that walks the AST. Top-level entry returns a
      Result `{ ok, returnValue?, error?, snapshot, stats }`. Set up
      the dispatch table over node kinds and a Scope class. No host
      calls yet — implement literal evaluation and identifier lookup.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-value-model
    title: Sandbox value space (no host references leak in)
    prompt: |
      In packages/agent-script/src/interp/values.ts define the
      sandbox value model: primitives, plain objects (own keys only,
      no prototype walking), plain arrays, subset closures, subset
      Promises. Provide deepCopyToSandbox / deepCopyFromSandbox
      helpers used at the host boundary.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-scope
    title: Scope chain with const/let semantics
    prompt: |
      In packages/agent-script/src/interp/scope.ts implement a Scope
      class with parent linkage, declare(name, kind, value),
      assign(name, value) — error on assigning to const, error on
      assigning to undeclared name — and lookup(name). Block scope is
      modeled as a child Scope with its own bindings.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-budgets
    title: Step, time, depth, and size budget enforcement
    prompt: |
      In packages/agent-script/src/interp/budget.ts implement a Budget
      object holding stepsUsed, deadline (wallclock), peakCallDepth,
      and limits for stringLength/arrayLength. Each AST visit
      increments stepsUsed; allocations check size limits; call/await
      paths check depth. Exceed → SandboxError with which budget was
      hit and the current count.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-globals-console-json
    title: Built-in globals — console and JSON
    prompt: |
      In packages/agent-script/src/interp/globals/console-json.ts
      register `console.log`, `console.error`, `JSON.parse(text)`,
      `JSON.stringify(value, null?, indent?)`. Output goes through a
      configurable sink (default: host console). JSON.parse rejects
      input larger than the string-length budget.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-globals-math
    title: Built-in globals — Math
    prompt: |
      In packages/agent-script/src/interp/globals/math.ts register
      Math.{min, max, abs, floor, ceil, round, trunc, sign, pow, sqrt,
      log, log2, log10, exp, sin, cos, tan, PI, E, random}. random is
      seedable from the runner so snapshots can replay if requested.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-globals-object-array
    title: Built-in globals — Object, Array, coercion fns
    prompt: |
      In packages/agent-script/src/interp/globals/object-array.ts
      register Object.{keys, values, entries, fromEntries, freeze,
      assign}, Array.{isArray, from, of}, and the bare coercion
      functions String, Number, Boolean (NOT constructors — calling
      with `new` is already rejected by parser/lint).
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-globals-error
    title: Built-in globals — Error, TypeError factories
    prompt: |
      In packages/agent-script/src/interp/globals/error.ts implement
      sandbox-internal Error(message) and TypeError(message)
      factories that produce subset error values with name, message,
      and stack (sandbox stack only — host frames stripped).
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-string-methods
    title: String prototype method interception
    prompt: |
      In packages/agent-script/src/interp/methods/string.ts intercept
      and implement string methods listed in the design — length,
      charAt, charCodeAt, codePointAt, includes, startsWith, endsWith,
      indexOf, lastIndexOf, slice, substring, substr, split (string
      separator only), replace/replaceAll (string args only), case
      transforms, trim variants, padStart/padEnd, repeat, concat,
      normalize. Reject regex/function args at runtime with a clear
      message.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-array-methods
    title: Array prototype method interception
    prompt: |
      In packages/agent-script/src/interp/methods/array.ts intercept
      array methods — length, map, filter, find, findIndex, some,
      every, reduce, reduceRight, forEach, flatMap, flat, includes,
      indexOf, lastIndexOf, join, slice, concat, sort (with subset-
      closure comparator), reverse, push, pop, shift, unshift. Closure
      callbacks re-enter the interpreter under the same budget.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-number-methods
    title: Number prototype method interception
    prompt: |
      In packages/agent-script/src/interp/methods/number.ts intercept
      Number methods toString(radix?), toFixed(digits),
      toPrecision(precision). Argument validation matches ECMAScript
      ranges; out-of-range values throw a subset RangeError.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-async-await
    title: Async function evaluation and await semantics
    prompt: |
      In packages/agent-script/src/interp/async.ts implement async
      arrow evaluation (returns a subset Promise) and await semantics
      — `await p` resolves to the value or throws the rejection. Top-
      level await is supported. Each await is a yield point usable by
      the snapshot system.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-promise-builtins
    title: Promise built-ins (all/race/allSettled/any/resolve/reject)
    prompt: |
      In packages/agent-script/src/interp/promise.ts implement subset
      Promise.all, Promise.race, Promise.allSettled, Promise.any,
      Promise.resolve, Promise.reject. Internally schedule on host
      Promise.* but expose subset Promises as values. No then/catch/
      finally chaining; the subset is await-only.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-try-catch-throw
    title: Runtime try/catch/finally and throw
    prompt: |
      In packages/agent-script/src/interp/exceptions.ts implement
      runtime semantics for try/catch/finally and throw. Subset errors
      thrown from host functions arrive as sandbox values (host stack
      stripped). Finally always runs on normal, throw, return, break,
      continue exits.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: interpreter-cancellation
    title: AbortSignal-driven cancellation
    prompt: |
      In packages/agent-script/src/interp/cancel.ts wire the
      runner's `signal` so that on abort the next host call throws a
      SandboxError("aborted") and any in-flight `await` rejects with
      the same. Scripts can try/catch to clean up. Add a test using
      a manual AbortController.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: host-fn-wrapping
    title: Wrap caller-injected globals across the boundary
    prompt: |
      In packages/agent-script/src/interp/host-bridge.ts implement
      the wrapping for caller-injected functions: subset args are
      deep-copied to host values, host fn runs, return is deep-copied
      back into sandbox space. Host throws become sandbox Error
      values with the host stack stripped. No live host references
      ever cross the boundary.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: host-callback-rewrap
    title: Wrap subset closures passed to host as callbacks
    prompt: |
      Extend packages/agent-script/src/interp/host-bridge.ts so that
      subset closures passed into a host call (e.g. as a callback) are
      wrapped: invoking them from the host re-enters the interpreter
      under the same step/time budget and returns a host Promise the
      caller can await. Test by passing a lambda into a host fn that
      calls back twice.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-registry
    title: Module registry and import binding
    prompt: |
      In packages/agent-script/src/modules/registry.ts implement the
      module registry: name → ModuleExports map. The interpreter
      resolves each `import` against this map at script start and
      binds the named/default/namespace forms into the top-level
      scope. Missing module / missing export errors surface from
      lint, but also defensively at runtime.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-agent
    title: makeAgentModule factory (spawn)
    prompt: |
      In packages/agent-script/src/modules/agent.ts export
      makeAgentModule(spawnAgent) returning a module with `spawn`.
      `spawn(agentDef, { prompt, mcp?, model?, mode?, cwd?, timeoutMs? })`
      returns a Promise resolving to { exitCode, stdout, stderr,
      summary, durationMs }. Throws on non-zero exit. spawnAgent is
      injected by the harness package.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-harness
    title: makeHarnessModule factory (frontmatter access)
    prompt: |
      In packages/agent-script/src/modules/harness.ts export
      makeHarnessModule(frontmatter, meta). The returned module
      exposes `tasks`, `agents`, and `meta`. `meta` includes kind,
      version, filepath, and the raw frontmatter. Pure-data, sync.
      Frontmatter values are deep-copied so the script can't mutate
      the harness's own state.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-git
    title: makeGitModule factory (head/checkpoint/commit/revert/diff)
    prompt: |
      In packages/agent-script/src/modules/git.ts export
      makeGitModule(cwd) exposing head(), checkpoint(),
      commit({ message, files? }), revert(savepoint), diff(). All
      async. Uses simple-git or shells out to `git` directly — no new
      runtime dep on the agent-script package itself; git lives in a
      separate makeGitModule package consumer.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-mcp
    title: makeMcpModule factory (server/client)
    prompt: |
      In packages/agent-script/src/modules/mcp.ts export
      makeMcpModule(connectMcp). The module exposes `server({ command,
      args?, env? })` returning a server handle, and `client(handle)`
      returning a client with `tools()` and `tool(name, args)`.
      connectMcp is injected — agent-script never depends on
      @poe-code/tiny-mcp-client directly.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-metric
    title: makeMetricModule factory (npm metric:* runner)
    prompt: |
      In packages/agent-script/src/modules/metric.ts export
      makeMetricModule(npmRunner). The module exposes
      `run(name) => Promise<number>`, where `name` resolves to an
      npm script `metric:<name>`. Non-numeric stdout is a runtime
      error. Used by experiment-loop.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-log
    title: makeLogModule factory (info/error/event channel)
    prompt: |
      In packages/agent-script/src/modules/log.ts export
      makeLogModule(sink) exposing info(...args), error(...args),
      event(name, payload). Events go to the sink — superintendent's
      TUI subscribes here. Default sink writes JSONL to stdout.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-env
    title: makeEnvModule factory (curated allow-list)
    prompt: |
      In packages/agent-script/src/modules/env.ts export
      makeEnvModule(allowList). The module exposes `get(name)`
      returning the value of `process.env[name]` only if `name` is in
      the configured allow-list — otherwise returns undefined. Never
      exposes the full process.env.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-fail
    title: makeFailModule factory
    prompt: |
      In packages/agent-script/src/modules/fail.ts export
      makeFailModule() with default-export `fail(message)` that
      throws a subset Error subclassed as HarnessFailure. The runner
      surfaces this as a non-zero exit with the message.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: module-time
    title: makeTimeModule factory (random/now/uuid)
    prompt: |
      In packages/agent-script/src/modules/time.ts export
      makeTimeModule({ seed? }). Exposes random() (seedable),
      now() (Date.now), uuid() (RFC 4122 v4 from crypto.randomUUID).
      Seeding is optional — when seeded, snapshots can deterministically
      replay; otherwise non-deterministic.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: snapshot-serialize
    title: Serialize live interpreter state to JSON
    prompt: |
      In packages/agent-script/src/snapshot/serialize.ts implement
      serialization of: source hash, current AST node id, scope chain
      ({ id, parentId, bindings }), call stack ({ astNodeId, scopeId,
      awaitingPromiseId? }), pending subset Promises, closures as
      { kind: "fn", astNodeId, capturedScopeId }, module bindings as
      name → moduleId. No host references serialized.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: snapshot-restore
    title: Restore interpreter state from a snapshot
    prompt: |
      In packages/agent-script/src/snapshot/restore.ts implement
      restoration: re-parse the source, hash it, reject on mismatch
      with a message that recommends --reset; reconstruct scopes and
      call stack from JSON; reattach modules by registry lookup;
      resume at the saved code pointer. A restored run shares the
      same Budget and signal as a fresh run.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: snapshot-promise-policy
    title: Per-primitive resume policy for in-flight promises
    prompt: |
      In packages/agent-script/src/snapshot/policy.ts implement the
      resume policy for pending host calls: idempotent calls (e.g.
      git.head, runMetric) are re-issued; non-idempotent calls (git.
      commit, agent.spawn that already exited) are tagged at issue
      time so resume can read the side effect rather than redo it.
      Policy is per-module; default is "re-issue" with explicit opt-
      out.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: snapshot-periodic
    title: Periodic checkpointing every N seconds
    prompt: |
      In packages/agent-script/src/snapshot/scheduler.ts wire a
      periodic checkpoint that fires every snapshotIntervalMs
      (default 30000) at the next yield point. Writes atomically
      (write to .tmp, rename) to snapshotPath. No checkpoint when
      snapshotPath is omitted.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: snapshot-signal-dump
    title: SIGINT/SIGTERM and explicit dump() at next yield
    prompt: |
      In packages/agent-script/src/snapshot/dump.ts implement the
      `dump(result)` API that flips a "snapshot requested" flag; the
      interpreter snapshots at the next yield and resolves the
      returned Promise with the serialized snapshot. Wire SIGINT and
      SIGTERM in the runner to call dump and then exit gracefully.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: file-format-frontmatter
    title: Markdown + YAML frontmatter splitter
    prompt: |
      In packages/agent-script/src/loader/frontmatter.ts implement a
      splitter that takes a markdown file and returns { frontmatter,
      body }. Frontmatter is delimited by leading `---\n` and a
      matching `---\n` line. Use js-yaml for parsing — it's already in
      the workspace. Reject documents with malformed frontmatter
      with a clear error pointing at the line.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: file-format-fenced-block
    title: Extract first js/ajs fenced block from markdown body
    prompt: |
      In packages/agent-script/src/loader/extract-block.ts find the
      first fenced code block whose info string starts with `js` or
      `ajs` and return its source plus the line offset. Subsequent
      code blocks are inert prose. Track line offsets accurately for
      diagnostic reporting against the original file.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: runHarness
    title: runHarness orchestrator (load, lint, run, snapshot)
    prompt: |
      In packages/agent-script/src/runner/run-harness.ts export
      `runHarness(filepath, { signal, snapshotPath?, modulesFor })`.
      Reads the file, splits frontmatter, extracts the js block,
      builds the modules via modulesFor(frontmatter, meta), lints the
      script (abort on error severity), runs the interpreter,
      checkpoints to snapshotPath. Returns the same Result shape as
      `run`.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: runHarness-pure-ajs
    title: Support pure .ajs scripts (no frontmatter, no harness module)
    prompt: |
      Extend packages/agent-script/src/runner/run-harness.ts so that
      `.ajs` files (no markdown, no frontmatter) skip the splitter
      and the `harness` module. The script imports only what the
      runner registers. Used for hand-written scripts with no
      embedded data.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: cli-lint
    title: CLI — agent-script lint
    prompt: |
      Wire a `poe-code agent-script lint <path>` subcommand that
      reads the file, runs the lint pass with the runner's default
      module set, and prints diagnostics in compiler-style format
      (filename:line:column code message). Exit 1 on any error
      diagnostic, 0 otherwise. Implement in src/cli/commands/
      agent-script-command.ts following existing CLI conventions.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: cli-run
    title: CLI — agent-script run
    prompt: |
      Wire a `poe-code agent-script run <path>` subcommand that
      runs runHarness with the default module set. Flags: --reset
      (discard existing snapshot before running), --snapshot <path>
      (override snapshotPath), --no-snapshot (disable checkpointing).
      Implement in src/cli/commands/agent-script-command.ts.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: error-formatter
    title: Render runtime errors with code excerpt and caret
    prompt: |
      In packages/agent-script/src/error/format.ts implement a
      renderer that takes an interpreter error ({ kind, filename,
      line, column, message, ... }) and returns a multi-line string
      with two lines of context, a caret line, and the message. Used
      by the CLI and runHarness to print failures.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: package-deep-copy-helpers
    title: Public deep-copy helpers for module authors
    prompt: |
      Export deepCopyToSandbox and deepCopyFromSandbox from
      packages/agent-script/src/index.ts as public API. Module
      factories that wrap their own host code (custom modules) need
      these to safely cross the boundary. Document with a short
      example in the README.
    status:
      "impl ement": open
      commit: done
      implement: done

  - id: migrate-pipeline
    title: Migrate @poe-code/pipeline to runHarness
    prompt: |
      In packages/pipeline/src, replace the existing harness
      runtime with a thin wrapper that calls runHarness from
      @poe-code/agent-script. Register modules: agent (via
      @poe-code/agent-spawn), harness, mcp (via tiny-mcp-client),
      log, env, fail, time. Preserve the existing CLI surface
      (`poe-code pipeline run`, --yes, --tui, --reset). Migrate
      existing pipeline plans by updating their js block to import
      from registered module names.
    status:
      "impl ement": open
      test: done
      commit: done
      implement: done

  - id: migrate-superintendent
    title: Migrate @poe-code/superintendent to runHarness with TUI
    prompt: |
      In packages/superintendent/src, replace the existing inner
      loop with a wrapper around runHarness. Register the same
      modules as pipeline plus a TUI subscriber on the log module's
      event channel. Preserve the CLI surface and the maxRounds
      semantics by reading them from frontmatter and consuming them
      in the script body, not the harness.
    status:
      "impl ement": open
      test: done
      commit: open
      implement: done

  - id: migrate-experiment-loop
    title: Migrate @poe-code/experiment-loop to runHarness
    prompt: |
      In packages/experiment-loop/src, replace the bespoke loop
      runtime with a runHarness wrapper. Register modules: agent,
      harness, git (makeGitModule), metric (makeMetricModule), log,
      time. Migrate the experiment plan format so the loop body
      lives in the script's js block; frontmatter keeps just data
      (agents, metric, maxKept).
    status:
      "impl ement": open
      test: open
      commit: open

  - id: package-readme
    title: README for @poe-code/agent-script
    prompt: |
      Write packages/agent-script/README.md covering: what the
      package is, the public API (parse, lint, run, dump, restore,
      runHarness), the subset (in/out lists), the registered module
      shape, how to add a custom module, a minimal example, and the
      env vars / config options the runner reads. Follow the
      project's package-readme conventions.
    status:
      "impl ement": open
      commit: open

  - id: package-examples
    title: Worked examples in agent-script package
    prompt: |
      Add packages/agent-script/examples/ with three runnable files:
      a single-file pipeline (.md), a superintendent-style document
      (.md), and an experiment loop (.md). Each should be wired to
      run with `node --experimental-strip-types` against the
      package's CLI. Examples must lint clean and exercise the
      common module shapes.
    status:
      "impl ement": open
      test: open
      commit: open

  - id: integration-snapshot-roundtrip
    title: Integration test — snapshot roundtrip across pause/resume
    prompt: |
      Add packages/agent-script/test/integration/snapshot-roundtrip.test.ts
      that runs a 3-task pipeline, dumps the snapshot mid-loop,
      restarts a fresh process, restores from the snapshot, and
      verifies the run completes with no duplicate side effects
      (no double commit, no double spawn). Uses an in-memory
      filesystem and a stub agent module.
    status:
      "impl ement": open
      test: open
      commit: open

  - id: integration-budget-enforcement
    title: Integration test — budget enforcement
    prompt: |
      Add packages/agent-script/test/integration/budgets.test.ts
      verifying: a script that infinite-loops fails with a step-
      budget SandboxError; a script that builds a 20MB string fails
      with a string-length error; a script that recurses fails with
      a call-depth error. Each test asserts the error code,
      message, and that no host side effects fired after the budget
      hit.
    status:
      "impl ement": open
      test: open
      commit: open
---

```js
import { spawn } from "agent";
import { tasks, agents } from "harness";
import { event } from "log";

await tasks.reduce(async (previous, task) => {
  await previous;
  event("task.started", { id: task.id, title: task.title });
  event("task.completed", {
    id: task.id,
    title: task.title,
    durationMs: (await spawn(agents.builder ?? "claude-code", {
      prompt: `${task.id}: ${task.title}\n\n${task.prompt}`,
    })).durationMs,
  });
}, (async () => {})());
```

# Context

Implements [agent-script](js-subset-sandbox.md) — a JavaScript subset that *is* the harness. Goal: collapse pipeline / superintendent / experiment-loop into a single interpreter + module-registry model with zero runtime deps, adversarial-safe execution, and snapshot/restore.

Build order: parser → lint → interpreter core → modules → snapshot → loader/runner → CLI → migrations → polish. Each task carries `implement` / `test` / `commit`; tasks that don't lend themselves to unit tests (scaffolding, README, examples) skip `test`.
