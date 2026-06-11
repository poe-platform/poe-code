---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: function-declarations
    title: Support hoisted function declarations
    prompt: >
      In packages/agent-script, support `function` declarations (sync and
      async).

      Parser (src/parse/parser.ts): add a FunctionDeclaration node

      { id: Identifier, params: same shapes as ArrowFunctionExpression params,

      body: BlockStatement, async: boolean, generator: false }. Today `function
      f() {}`

      fails with "Identifier 'function' is not defined".

      Interpreter (src/interp/interpreter.ts): hoist within the enclosing block
      via the

      same prologue pass as predeclareDeclarationBindings, but declare the
      *initialized*

      closure eagerly (no TDZ) so calls before the statement work. Two same-name
      function

      declarations in one scope keep the existing redeclare error. Evaluate
      bodies through

      the same closure machinery arrows use (src/interp/async.ts).

      Assign node IDs in src/parse/assign-ids.ts. Closures created from function

      declarations must round-trip through snapshot serialize/restore via

      astNodeId + capturedScopeId (extend src/snapshot tests).

      TDD; co-located .test.ts files; tests must be fast, no file I/O, no LLM.
    status:
      implement: done
      test: done
  - id: function-expressions
    title: Support anonymous and named function expressions
    prompt: >
      In packages/agent-script, support function expressions:

      `const f = function () {}` and named `const f = function check(n) { ...
      check(n-1) ... }`.

      Parser (src/parse/parser.ts): FunctionExpression node

      { id: Identifier | undefined, params, body, async, generator: false } in
      expression

      position. Interpreter: the name (when present) binds as `const` in a
      wrapper scope

      around the function's own call scope — visible only inside the body for

      self-recursion, invisible in the enclosing scope; assigning to it inside
      the body

      throws the existing const-assignment error.

      Assign node IDs (src/parse/assign-ids.ts); snapshot round-trip via

      astNodeId + capturedScopeId. TDD; fast unit tests only.
    status:
      implement: done
      test: done
  - id: method-shorthand
    title: Support object method shorthand
    prompt: >
      In packages/agent-script, support object method shorthand:

      `{ reset() { return 1; }, async load() {} }`. Parser
      (src/parse/parser.ts):

      parse shorthand methods into a regular Property whose value is a

      FunctionExpression (today it fails with "Expected '}'").

      Generator shorthand (`*gen() {}`) and getters/setters stay parse errors
      with

      clear messages. Closures from shorthand methods round-trip through
      snapshots

      like other function expressions. TDD; extend parser and interpreter tests.
    status:
      implement: done
      test: done
  - id: var-bindings
    title: Support var with function-scoped hoisting
    prompt: >
      In packages/agent-script, support `var` (currently DisallowedSyntaxError
      at two

      parser sites: the statement keyword check and the declaration-kind check
      in

      src/parse/parser.ts). Semantics:

      - Hoist to the nearest function boundary. Add a functionBoundary option to
      Scope
        (src/interp/scope.ts), set on the module root scope and on every function-form
        call scope including arrows. Add Scope#declareVar that walks up to the boundary.
      - Hoisted predeclaration initializes to undefined (no TDZ); the `var x =
      e`
        statement assigns. The hoist pass recurses into blocks, if/for/while/switch/try
        bodies, and stops at nested function bodies.
      - var-over-var redeclaration in the same function is legal (acts as
      assignment);
        var colliding with let/const/param in the same scope is an error.
      - Block escape: `if (c) { var n = 5; }` leaves n visible after the block.

      - `for (var i ...)`: the loop variable lives in the function scope; the
        per-iteration copying in Scope#iterationChild must not apply to var bindings,
        so closures created in the loop all see the final value.
      - Snapshot: var bindings serialize in their function-boundary frame; add
      kind
        "var" to VariableDeclarationKind and the snapshot frame schema.
      Update lint rules that assume kind is only const|let. TDD; fast unit
      tests.
    status:
      implement: done
      test: done
  - id: extract-patterns-module
    title: Extract shared binding-pattern module
    prompt: >
      In packages/agent-script, pure refactor: extract the
      bindDeclarationPattern

      family (object/array/default/rest/nested pattern binding, around line 876
      of

      src/interp/interpreter.ts) into a new src/interp/patterns.ts with
      signature

      bindPattern(pattern, value, target, scope, context) where target is

      { kind: VariableDeclarationKind } | { assign: true } ({ assign: true }
      assigns

      to existing bindings/member targets instead of declaring). interpreter.ts

      delegates to it. No behavior change; every existing test stays green
      untouched.

      Add patterns.test.ts covering the extracted surface directly.
    status:
      implement: done
      refactor: done
      test: done
  - id: param-destructuring
    title: Destructured parameters for arrows and functions
    prompt: >
      In packages/agent-script, support destructured parameters in arrows and
      all

      function forms: `({ type, payload }) => ...`, `([a, b]) => ...`,

      `({ a = 1 } = {}) => ...`, nested patterns, defaults, and rest. Today

      bindArrowParameter in src/interp/async.ts throws

      "Unsupported async arrow parameter pattern 'ObjectPattern'".

      Replace the bindArrowParameter family with calls to bindPattern from

      src/interp/patterns.ts. Parameters bind as `let` (reassignable inside the
      body,

      matching JS) instead of the current const. Defaults referencing earlier
      params

      keep working (`(a, b = a + 1)`). TDD; cover sync and async arrows plus
      function

      declarations/expressions.
    status:
      implement: done
      test: done
  - id: head-and-assignment-destructuring
    title: Destructuring in for...of heads and assignment position
    prompt: >
      In packages/agent-script, wire bindPattern (src/interp/patterns.ts) into
      two

      more positions:

      1. for...of heads: `for (const [k, v] of Object.entries(o))` — today
      throws
         "Unsupported for...of declaration pattern 'ArrayPattern'".
      2. Assignment expressions: `[a, b] = [b, a]` and parenthesized `({ x } =
      o)` —
         today fail with "Unsupported assignment target". Member targets
         (`[o.x, o.y] = pair`) are supported via the pattern module's MemberExpression
         handling. Un-parenthesized `{ x } = o` stays a syntax error (statement-position
         `{` parses as a block, like JS).
      Catch-clause destructuring already works — add regression tests only.

      TDD; fast unit tests in interpreter.test.ts and patterns.test.ts.
    status:
      implement: done
      test: done
  - id: for-in-statement
    title: Support for...in
    prompt: >
      In packages/agent-script, un-ban for...in (DisallowedSyntaxError sites in

      src/parse/parser.ts around the iteration-operator check and statement
      checks).

      Add a ForInStatement node (left: VariableDeclaration | Identifier, right,
      body).

      Semantics — own enumerable string keys only:

      - Objects: Object.keys order (integer-like keys ascending, then
      insertion).

      - Arrays: present indices as strings ("0", "1"); holes skipped; length not
      visited.

      - Strings: index keys. Map/Set/closures/regex: zero iterations.

      - null/undefined right-hand side: zero iterations, no throw.

      - Mutation during iteration: capture the key list once before the loop;
      before
        each visit re-check `key in obj` and skip deleted keys; keys added mid-loop
        are not visited.
      - Heads: const/let/var with Identifier only, bound via bindPattern; var
      heads
        hoist to the function boundary. A destructuring head is a parse error:
        "for...in keys are strings; destructure inside the body".
      Lint: remove for...in from disallowed lists; AS-unbounded-loop treats it
      as

      bounded. TDD; fast unit tests.
    status:
      implement: done
      test: done
  - id: switch-statement
    title: Support switch
    prompt: >
      In packages/agent-script, un-ban switch (two DisallowedSyntaxError sites
      in

      src/parse/parser.ts, around lines 3000-3008). Add SwitchStatement

      { discriminant, cases } and SwitchCase { test: Expression | undefined,
      consequent:

      Statement[] } nodes; assign node IDs in src/parse/assign-ids.ts.

      Interpreter (src/interp/interpreter.ts):

      - Strict-equality (===) case matching; fallthrough until
      break/return/throw;
        `default` legal in any position but matched only after all cases miss.
      - All cases share ONE child scope (per spec): `const x` in two case bodies
        without braces collides; braced case bodies get their own block scope.
      - Reuse the existing break completion kind. Verify: break inside
        switch-inside-loop exits only the switch; labeled break still exits the
        labeled loop; continue inside switch-inside-loop continues the loop.
      Lint: AS-unreachable must understand fallthrough (a case without a
      terminal

      break/return/throw flows into the next case). TDD; fast unit tests.
    status:
      implement: done
      test: done
  - id: array-method-additions
    title: Add modern array methods
    prompt: >
      In packages/agent-script src/interp/methods/array.ts, add eight methods to
      the

      closed method table: findLast, findLastIndex (mirror findIndexInArray
      reversed,

      async callbacks via the existing callClosure plumbing), fill, copyWithin

      (mutating — re-budget the array afterwards like splice does), toSorted
      (copy

      then the existing sortArray, supports async comparators), toReversed,
      toSpliced,

      with (copy + existing mutators; `with` throws RangeError on out-of-bounds
      index,

      per spec). Budget every produced array via the existing
      budgetProducedValue

      walker. TDD in src/interp/methods/array.test.ts; tests fast, no I/O.
    status:
      implement: done
      test: done
  - id: builtin-statics
    title: Add Object/String/Number statics
    prompt: >
      In packages/agent-script src/interp/globals/object-array.ts, add:

      - Object.hasOwn(value, key).

      - String.fromCharCode and String.fromCodePoint as properties on the String
        closure (budget the produced strings).
      - On the Number closure: parseInt, parseFloat, isSafeInteger functions and
        MAX_SAFE_INTEGER, MIN_SAFE_INTEGER, EPSILON, MAX_VALUE, MIN_VALUE constants.
      Number.parseInt/parseFloat coerce like the host (radix honored). No new
      global

      names, so lint known-globals is unchanged. TDD in object-array's test
      file.
    status:
      implement: done
      test: done
  - id: misc-globals
    title: Add structuredClone and coercing numeric globals
    prompt: >
      In packages/agent-script, create src/interp/globals/misc.ts exposing:

      - structuredClone(value): deep clone via the existing deepCopyToSandbox
      from
        src/interp/values.ts, charging the Budget for produced strings/arrays/objects
        (reuse the produced-value allocation walker); throws a TypeError on closures
        and promises, like the host API's DataCloneError.
      - parseInt, parseFloat, isNaN, isFinite as global functions with host
      coercion
        semantics (distinct from Number.isNaN/isFinite which don't coerce).
      Wire into the globals assembly in src/run.ts next to
      createObjectArrayGlobals.

      Add all four names plus structuredClone to KNOWN_RUNTIME_GLOBALS in

      src/lint/rules/known-globals.ts. TDD; misc.test.ts.
    status:
      implement: done
      test: done
  - id: string-function-replacers
    title: Function replacers for replace/replaceAll
    prompt: >
      In packages/agent-script src/interp/methods/string.ts, allow
      sandbox-closure

      replacers in String#replace and String#replaceAll with string (non-regex)

      search values: callback invoked as (match, offset, string), async closures

      awaited, result coerced to string and budget-allocated. Remove the
      parse-time

      rejection of function replacers in validateStringMethodArguments and the

      runtime isSandboxClosure rejection in callReplaceLikeMethod (keep
      rejecting

      regex search values — regex integration is a separate task; keep the
      existing

      error message for that case). The closure is called once per occurrence
      for

      replaceAll, once for replace. TDD in string.test.ts.
    status:
      implement: done
      test: done
  - id: closed-world-member-access
    title: Closed-world member access on primitives and arrays
    prompt: >
      In packages/agent-script, fix the host-prototype leak: today

      `typeof [1].toSorted` evaluates to "function" inside the sandbox (host

      Array.prototype leaks through raw property access) but calling it throws

      "Attempted to call a non-function value". In src/interp/interpreter.ts
      member

      access for arrays, strings, and numbers must resolve ONLY: numeric indices
      /

      own elements, "length", and the supported method tables in

      src/interp/methods/{array,string,number}.ts. Everything else evaluates to

      undefined. When a CallExpression's callee was a MemberExpression that
      resolved

      to undefined, throw TypeError naming the receiver type and property, e.g.

      "Array#shuffle is not a supported method." (receiver type from the
      evaluated

      object, property from the member access). Plain-object member access is

      unchanged (own properties only, as today). TDD: assert typeof leak is gone
      and

      the new error message shape for arrays, strings, and numbers.
    status:
      implement: done
      test: done
  - id: conformance-typeof-and-string-iteration
    title: Safe typeof and for...of over strings
    prompt: >
      In packages/agent-script src/interp/interpreter.ts, two spec-conformance
      fixes:

      1. `typeof undeclared` must evaluate to "undefined" instead of throwing
         UNBOUND_IDENTIFIER — special-case UnaryExpression with operator "typeof"
         over an unresolved Identifier. typeof of declared bindings is unchanged;
         plain `undeclared` references still throw.
      2. for...of must accept strings (today: "abc is not a supported iterable"
         even though [..."abc"] works). Iterate by code point, consistent with
         string spread. Widen the isForOfIterableValue gate.
      TDD; fast unit tests in interpreter.test.ts.
    status:
      implement: done
      test: done
  - id: this-expression
    title: Support this with scope-binding semantics
    prompt: >
      In packages/agent-script, support `this`. Design: `this` is a const scope

      binding, NOT interpreter context — this makes arrow lexical capture and

      snapshot/restore free.

      Parser (src/parse/parser.ts): ThisExpression node; `this` stays a keyword
      so

      users can never declare a binding named "this".

      Binding rules:

      - Every function-form call scope (function declaration/expression, method
        shorthand) declares `this` as const: for `o.f(args)` it is the member-access
        receiver; for bare `f()` it is undefined (strict semantics, no global boxing).
      - Arrows declare nothing — `this` resolves lexically through the scope
      chain,
        so an arrow inside a method sees the method's receiver.
      - Module top level: no binding exists; evaluating ThisExpression with no
        binding found yields undefined (do not throw).
      Wiring: CallExpression on a MemberExpression callee must evaluate the
      member

      access ONCE, keep the receiver, and pass it via a new thisValue field on

      SandboxCallContext (src/interp/values.ts) into the closure call; the

      closure-construction site in src/interp/async.ts declares the binding for

      function forms and ignores it for arrows. Optional calls o.f?.() use the
      same

      receiver. Builtin methods ignore thisValue (they close over their
      receiver).

      `this` inside array-method callbacks is undefined. Compound positions

      (this.x = v, this.n += 1, delete this.flags[k]) need no special code once

      ThisExpression returns the receiver. Snapshot: works through existing
      scope

      serialization — add a round-trip test with an arrow capturing a method's
      this.

      TDD; dedicated this test suite in interpreter.test.ts.
    status:
      implement: done
      test: done
  - id: function-call-apply
    title: Function#call and Function#apply
    prompt: >
      In packages/agent-script, create src/interp/methods/function.ts: a
      closed-world

      member table for sandbox closures exposing call(thisArg, ...args) and

      apply(thisArg, argsArray), both invoking the target closure immediately
      with

      thisValue = thisArg threaded through SandboxCallContext (same mechanism as

      method calls). `bind` is deliberately NOT supported — a bound closure
      could not

      be snapshot-serialized; f.bind resolves to undefined so calling it
      produces the

      closed-world error "Function#bind is not a supported method." Wire the
      table

      into member access for closure values in src/interp/interpreter.ts.
      Existing

      closure `properties` (e.g. String.raw) keep working and take precedence.

      TDD in function.test.ts.
    status:
      implement: done
      test: done
  - id: new-expression
    title: Generalize new to user constructor functions
    prompt: >
      In packages/agent-script, replace the Error-only `new` allowlist

      (parseAllowedNewExpression + isAllowedNewCalleeToken in
      src/parse/parser.ts,

      which desugars to CallExpression) with a real NewExpression node

      { callee: Expression, arguments } supporting member callees (`new a.b()`).

      new.target stays a parse error.

      Semantics (src/interp/interpreter.ts + src/interp/values.ts):

      - SandboxClosure gains optional construct?: (args, context) => value.

      - User function declarations and function expressions (not arrows, not
      method
        shorthand) get construct automatically: create this = {} (plain object),
        declare it in the call scope (the same const `this` slot the this-expression
        task added), execute the body; if the body returns an object that wins,
        any other return yields the this object. Async functions are not
        constructable (TypeError, matches JS).
      - new on a closure without construct (arrows, builtin methods) or on a
        non-closure: TypeError "<name> is not a constructor."
      - No prototypes: Foo.prototype resolves undefined under closed-world
      access;
        `x instanceof Foo` on a user constructor throws TypeError
        "Constructor prototypes are not supported; check a brand property instead."
      - Migrate the Error family (src/interp/globals/error.ts) onto construct,
        delegating to the existing call so both Error(x) and new Error(x) work and
        existing instanceof-Error behavior is preserved (existing tests must pass).
      TDD; new-expression suite covering construction, return override,
      non-constructors.
    status:
      implement: done
      refactor: done
      test: done
  - id: map-set-core
    title: Map and Set values, constructors, methods
    prompt: >
      In packages/agent-script, add Map and Set.

      Representation (src/interp/values.ts): brand-typed wrappers around host

      collections holding sandbox values — SandboxMap { kind: "map", entries:
      Map },

      SandboxSet { kind: "set", values: Set } with brand symbols and guards.
      Never

      expose raw host Map/Set. SameValueZero and object-key reference identity
      come

      free from the host collection.

      Globals (new src/interp/globals/collections.ts, wired in src/run.ts, names

      added to KNOWN_RUNTIME_GLOBALS in src/lint/rules/known-globals.ts):

      constructable closures Map and Set — construct only; calling without new
      throws

      TypeError "Constructor Map requires 'new'." Constructor args: new Map()
      empty;

      new Map(arrayOfPairs | anotherMap); new Set(array | string | Set).

      Method tables (new src/interp/methods/map.ts and set.ts, closed-world):

      - Map: get, set (returns the map for chaining), has, delete (returns
      boolean),
        clear, forEach (callback (value, key, map) via the existing callClosure
        plumbing, async callbacks awaited), keys, values, entries, size (data member).
      - Set: add (returns the set), has, delete, clear, forEach (callback
        (value, value, set)), keys, values, entries, size.
      - keys/values/entries return EAGER ARRAYS in insertion order (documented
        deviation from lazy host iterators), budget-allocated.
      Budget (src/interp/budget.ts): allocateCollectionEntries(count), charged
      on

      construction and each set/add; the produced-value walkers in

      src/interp/methods/array.ts and src/interp/globals/object-array.ts must
      learn

      to recurse into Map/Set contents.

      Truthiness always truthy; ==/=== by reference. TDD: full method matrix,

      chaining, insertion order, NaN/-0 keys, object-key identity, async
      forEach.
    status:
      implement: done
      refactor: done
      test: done
  - id: map-set-interop
    title: Map/Set iteration, interop, snapshots
    prompt: >
      In packages/agent-script, integrate the SandboxMap/SandboxSet values

      (src/interp/values.ts) with the rest of the runtime:

      - for...of and spread: Map yields [key, value] pair arrays, Set yields
      values,
        both insertion order (widen the iteration gate in src/interp/interpreter.ts
        and the spread paths). Destructuring heads compose:
        `for (const [id, todo] of index)`.
      - instanceof Map / instanceof Set: true via brand checks.

      - JSON.stringify(map) → {} and Object.keys(map) → [] (host parity);
        for...in over Map/Set: zero iterations.
      - structuredClone deep-clones Map/Set: extend deepCopyToSandbox /
        deepCopyFromSandbox in src/interp/values.ts.
      - Host bridge (src/interp/host-bridge.ts): module results containing host
        Map/Set convert to sandbox collections instead of being rejected.
      - Snapshot (src/snapshot/serialize.ts + restore path):
        { kind: "map", entries: [[k, v], ...] } and { kind: "set", values: [...] }.
        Keys and values participate in the existing heap-reference table: a shared
        object used as a key in two maps restores as ONE object; cycles (a map
        containing itself as a value) round-trip. Restore preserves insertion order.
      TDD: iteration, interop matrix, snapshot round-trips with shared keys and
      cycles.
    status:
      implement: done
      test: done
  - id: regex-engine
    title: Sandboxed step-budgeted regex engine
    prompt: >
      In packages/agent-script, build a sandboxed regex engine (host RegExp is

      banned for ReDoS reasons; the package philosophy is own-interpreter with

      Budget enforcement).

      - src/interp/regex/parse.ts: parse a regex source + flags into a pattern
      AST.
        Supported: flags g, i, m, s; literal chars and escapes; character classes
        incl. ranges and negation; "."; anchors ^ $; greedy and lazy quantifiers
        (* + ? {n} {n,} {n,m}); capturing and non-capturing groups; alternation;
        \d \w \s \b and their negations. Parse errors with clear messages for:
        backreferences, lookahead/lookbehind, named groups, unicode property escapes.
      - src/interp/regex/engine.ts: backtracking matcher over the AST. Every
      step
        charges a counter; add allocateRegexSteps(steps) to src/interp/budget.ts
        throwing SandboxError over a hard per-match-attempt cap, so catastrophic
        patterns like (a+)+b against "aaaaaaaaaaaaaaaaaaaaaaaaaaaX" terminate fast
        via budget, never hang.
      - Engine output: match result with index, matched text, and capture groups
        (undefined for non-participating groups), supporting global-flag iteration
        from a lastIndex.
      Pure functions, no interpreter coupling yet (integration is a separate
      task).

      TDD: feature matrix tests plus parity spot-checks against host RegExp for
      the

      supported subset; budget-exhaustion test must run in milliseconds.
    status:
      implement: done
      refactor: done
      test: done
  - id: regex-integration
    title: Regex values, string methods, snapshots, lint
    prompt: >
      In packages/agent-script, integrate the sandboxed regex engine

      (src/interp/regex/parse.ts and engine.ts) into the runtime:

      - New value SandboxRegex { kind: "regex", source, flags, lastIndex } with
      brand
        and guards in src/interp/values.ts. RegexLiteral AST nodes (already parsed)
        evaluate to it instead of erroring.
      - Regex member table (new src/interp/methods/regex.ts, closed-world):
      test,
        exec (with g-flag lastIndex statefulness), and data members source, flags,
        lastIndex (lastIndex writable).
      - String methods (src/interp/methods/string.ts): add match, matchAll,
      search;
        accept SandboxRegex in split, replace, replaceAll (function replacers receive
        (match, ...captureGroups, offset, string) for regex searches); remove the
        regex-rejection errors for these now-supported forms.
      - new RegExp(source, flags): a constructable RegExp global building
      SandboxRegex
        through the sandboxed parser (dynamic patterns get the same validation and
        step budget); add to KNOWN_RUNTIME_GLOBALS.
      - Snapshot: serialize { kind: "regex", source, flags, lastIndex } in
        src/snapshot/serialize.ts; restore re-parses via the engine.
      - Lint: retire regex-rejection diagnostics for supported forms; keep
      rejecting
        unsupported regex features with the parse-time messages.
      TDD across string.test.ts, regex method tests, snapshot round-trip tests.
    status:
      implement: done
      test: done
  - id: generator-syntax-and-channel
    title: Generator parsing and coroutine channel
    prompt: >
      In packages/agent-script, first half of sync generators (no interpreter

      integration yet):

      Tokenizer/parser (src/parse/tokenizer.ts, src/parse/parser.ts):
      `function*` on

      declarations and expressions (generator: true on the function nodes);

      YieldExpression { argument?: Expression, delegate: boolean } legal only
      inside

      a generator body (parser flag). Reserve `yield` as a keyword everywhere
      (users

      cannot declare bindings named yield). Targeted parse errors: yield outside
      a

      generator; `await` inside a sync generator body ("generators cannot await;
      use

      a regular async function"); `async function*`; generator method shorthand.

      Arrow generators do not exist. Assign node IDs (src/parse/assign-ids.ts).

      Coroutine channel (new src/interp/generator.ts): promise-handshake
      coroutine,

      createGeneratorChannel(body) returning { next(v), return(v), throw(e) }
      each

      resolving { value, done }:

      - next on an unstarted channel begins executing body; on a suspended one,
        resolves the pending resume deferred with { type: "normal", value: v }; then
        awaits whichever settles first: the next yield signal ({ value, done: false })
        or body completion ({ value: returnValue, done: true }).
      - The yield side: a yield(value) hook signals the yield deferred and
      awaits a
        fresh resume deferred, returning the resume completion
        { type: "normal" | "throw" | "return", value }.
      - throw(e)/return(v) deliver those completion types; on an unstarted
      channel,
        return(v) finishes without running the body, throw(e) rejects without
        running the body (host parity).
      - Reentrancy: next while running → TypeError "Generator is already
      running.";
        next after done → { value: undefined, done: true }.
      - Attach a rejection handler to the body promise at creation so an error
      thrown
        before the first next() await never becomes an unhandled rejection.
      TDD: channel tested standalone with plain async functions as bodies;
      immediate

      resolutions only, no timers; cover every bullet above.
    status:
      implement: done
      refactor: done
      test: done
  - id: generator-runtime-integration
    title: Generator objects, yield evaluation, iteration
    prompt: >
      In packages/agent-script, second half of sync generators, building on the

      coroutine channel in src/interp/generator.ts:

      - Calling a generator function (generator: true node) does NOT execute the
        body; it returns a SandboxGenerator value
        { kind: "generator", state: "start" | "running" | "suspended" | "done" }
        (brand + guards in src/interp/values.ts) wrapping a channel; params are bound
        at the original call per JS.
      - YieldExpression evaluation in src/interp/interpreter.ts: signal the
      channel,
        await the resume completion; "normal" → yield evaluates to the sent value;
        "throw" → throw at the yield site (catchable by the body's try, finally
        runs); "return" → propagate the interpreter's existing return completion
        from the yield site so finally blocks run.
      - yield* delegates to any internally iterable value (arrays, strings, Map,
        Set, other generators), forwarding next/throw/return to generator delegates
        and falling back to plain iteration otherwise.
      - Member table (new src/interp/methods/generator.ts, closed-world): next,
        return, throw returning { value, done } sandbox objects.
      - Iteration integration: widen for...of, spread, Array.from, and the
        new-Set/new-Map constructor gates to drive SandboxGenerator. CRITICAL: a
        for...of early exit (break, throw, or return from the loop body) must call
        gen.return() so generator finally blocks run.
      - Budget: body evaluation already charges node visits per resumption; each
        yielded value goes through the produced-value walker. Extend the
        AS-unbounded-loop lint note to mention generator sources.
      TDD: pull values, send values, throw caught by body try, return runs
      finally,

      yield* delegation incl. forwarded throw/return, for...of break runs
      finally,

      spread of generator, infinite generator halted fast by a small node-visit

      budget in the test.
    status:
      implement: done
      refactor: done
      test: done
  - id: generator-snapshot-guards
    title: Generator snapshot semantics and scheduler skip
    prompt: >
      In packages/agent-script, snapshot semantics for SandboxGenerator values

      (src/interp/values.ts, states start/running/suspended/done):

      - state "start" (never started): serialize { kind: "generator", state:
      "start",
        astNodeId, capturedScopeId } in src/snapshot/serialize.ts — restore
        re-creates an unstarted generator exactly like closure restoration in
        src/snapshot/restore.ts.
      - state "done": serialize { kind: "generator", state: "done" }; restores
      to an
        exhausted generator (next → { value: undefined, done: true }).
      - state "suspended" or "running": the continuation lives in host promise
      state
        and cannot be reconstructed from scope frames. Serialization throws a new
        typed UnsnapshotableValueError (exported from serialize.ts, carrying the
        value path) with message "Cannot snapshot a generator suspended
        mid-iteration; drain or discard it before the await boundary."
      - Scheduler (src/snapshot/scheduler.ts): periodic background dumps catch
        UnsnapshotableValueError, skip that dump with a logged warning, and retry
        next interval — a background dump must never kill a healthy run. An explicit
        final dump (--snapshot-path at completion) failing this way remains a real,
        surfaced error.
      TDD: round-trip start/done; suspended throws with the path; scheduler

      skip-and-retry under a mocked clock succeeds on the next interval.
    status:
      implement: done
      test: done
  - id: skill-doc-rewrite
    title: Rewrite the agent-script skill doc from the audit
    prompt: >
      In packages/agent-script/src/templates/skill/SKILL_agent-script.md,
      rewrite the

      "Supported JavaScript" and "Common Pitfalls" sections to match the actual

      runtime. The doc is stale today: it claims member assignment (obj.x = v),

      closures over outer `let`, do...while, and labels are unsupported — all
      work

      and have tests. Verify each claim against the current runtime before
      writing

      (build, then probe with:

      node --input-type=module -e "import { run } from './dist/index.js'; ..."

      using top-level statements ending in `const result = ...` and reading

      snapshot.bindings.result).

      Document the deliberate deviations: Map/Set keys()/values()/entries()
      return

      eager arrays; no prototype chains (Foo.prototype undefined, instanceof on
      user

      constructors throws); no Function#bind (use arrows); for...in
      destructuring

      heads rejected; bare-call `this` is undefined (strict semantics);
      generators

      cannot await; a generator suspended mid-iteration cannot be snapshotted.

      Keep the prose terse — no restating, no hedging. After editing the
      template run

      `npm run sync-skills`. Do not modify the package README (README changes
      need

      explicit user permission).
    status:
      implement: done
name: agent-script-reducer-language
state: archived
---

# Context

Pipeline conversion of the agent-script reducer-grade language plan. Goal: agent-script can express complex redux-style reducers — complete closures across every function form and binding kind, destructuring everywhere, switch, `this`/`new`, Map/Set, `for...in`, sync generators, sandboxed regex, and the missing array/string/object/number builtins.

Verified baseline (probed against `dist`, 2026-06-10): closures over `const`/`let` already work (factories, loop captures, mutual recursion, TDZ), as do member/index assignment, declaration/catch destructuring, spread, `do...while`, labels, tagged templates, optional chaining. Snapshot restore already reconstructs closures via `astNodeId` + `capturedScopeId`. Known sandbox bug: host prototype values leak through unknown members on arrays/strings (fixed by the closed-world task).

Decisions baked into the tasks (do not relitigate at runtime):

- `this` is a const scope binding declared in function-form call scopes; arrows resolve it lexically; bare calls get `undefined`; no `bind` (unserializable), `call`/`apply` only.
- No prototype chains or classes; `new` works on user constructor functions with `this = {}` and object-return override; `instanceof` user constructors throws a directed error.
- Map/Set are brand-typed wrappers over host collections; `keys`/`values`/`entries` return eager arrays (documented deviation); constructors require `new`.
- Regex is a step-budgeted in-sandbox engine (no host RegExp); no backreferences/lookaround/named groups.
- Generators are sync-only promise-handshake coroutines; `await` inside a generator body is a parse error; suspended generators are unsnapshotable — serializer throws typed `UnsnapshotableValueError`, background scheduler skips and retries.
- `for...in` destructuring heads are a parse error (keys are strings).
- Out of scope: classes, `Symbol`, `BigInt`, `WeakMap`/`WeakSet`, async generators, `Date`, `Proxy`, `globalThis`, `eval`, dynamic `import()`, `arguments`, getters/setters, `localeCompare`.

Task order is the build order; later tasks assume earlier ones landed (e.g. `new-expression` reuses the `this` binding slot; `map-set-interop` and `generator-runtime-integration` widen the same iteration gate). Repo rules apply: TDD, fast unit tests only (no file I/O outside memfs, no LLM calls), straight to main, monitor the release build after push.
