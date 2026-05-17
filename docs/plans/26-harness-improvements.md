---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: interp-tagged-templates
    title: Tagged template literals
    prompt: |
      Add support for tagged template literals (`` tag`...${x}...` ``)
      to the agent-script interpreter
      (`packages/agent-script/src/interp/interpreter.ts`).

      The parser already emits `TaggedTemplateExpression` nodes with
      `tag` (an expression) and `quasi` (a `TemplateLiteral`). Confirm
      parser support first; if absent, add it in
      `packages/agent-script/src/parse/parser.ts`.

      Semantics: evaluate `tag`, then evaluate each interpolation in
      `quasi`. Call the tag with `(strings, ...values)` where `strings`
      is an array of cooked quasi values and also exposes `.raw` for
      raw quasi values. ECMAScript convention.

      Edge-case tests in `interp/interpreter.test.ts`:
        1. `` String.raw`a\nb` `` returns "a\\nb" (raw).
        2. `` myTag`x=${1} y=${2}` `` calls tag with `["x=", " y=", ""]`, 1, 2.
        3. `strings.raw` is a different array than `strings` and survives.
        4. Tag missing (undefined) throws clearly.
        5. Tag throws inside body — exception propagates as `throw` kind.
        6. Interpolation throws — tag never called.
        7. Nested tagged template inside an interpolation works.
        8. Budget: `stringLength` honored across quasis.

      Conventional commit: `feat(agent-script): tagged template literals`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-try-finally
    title: try/finally without catch
    prompt: |
      Verify and harden `try { ... } finally { ... }` support (no
      `catch` clause) in
      `packages/agent-script/src/interp/interpreter.ts`. The existing
      `evaluateTryStatement` may assume `catch` is present.

      Behavior to enforce:
      - Finally block runs on normal completion of try.
      - Finally runs on `throw` from try; rethrows after finally.
      - Finally runs on `return` from try; if finally itself returns,
        that return wins (ECMAScript semantics).
      - Finally runs on `break`/`continue` from inside a loop in try
        and the signal propagates after finally.

      Tests in `interp/interpreter.test.ts`:
        1. Normal completion: try body runs, finally runs, return value preserved.
        2. Throw from try: finally runs, error rethrown.
        3. Return from try: finally runs, return value preserved.
        4. Return from try, return from finally: finally's return wins.
        5. Throw from try, throw from finally: finally's error wins.
        6. break from try inside a for-of: finally runs, loop breaks.
        7. continue from try inside a for-of: finally runs, loop continues.
        8. No mismatch: `try { ... }` (no finally, no catch) is a parse error.

      Conventional commit: `feat(agent-script): try/finally without catch`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-do-while
    title: do/while statement
    prompt: |
      Add `do { ... } while (cond);` to the agent-script interpreter
      (`packages/agent-script/src/interp/interpreter.ts`). Symmetric
      with `WhileStatement` but the body runs at least once before
      the first test.

      Confirm parser support first; add if missing.

      Tests:
        1. `do { ... } while (false)` runs body exactly once.
        2. Counter loop: body runs the expected number of times.
        3. `break` exits.
        4. `continue` jumps to the test.
        5. `return` from body exits enclosing arrow.
        6. `throw` from body propagates.
        7. Infinite loop (`do {} while (true)`) capped at `maxSteps`.
        8. Budget: each iteration visits one node minimum.

      Conventional commit: `feat(agent-script): evaluate DoWhileStatement`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-labeled-break-continue
    title: Labeled break/continue for nested loops
    prompt: |
      Add label support for `break` and `continue` so nested loops can
      be controlled. Parser may need extension to attach `label` to
      `BreakStatement`/`ContinueStatement` and to recognize
      `outer: for (...) { ... }` label syntax.

      Interpreter changes in
      `packages/agent-script/src/interp/interpreter.ts`: when a
      labeled break/continue surfaces, the loop handlers compare to
      their own label and either consume the signal or propagate it.

      Tests:
        1. `outer: for (...) { for (...) { break outer; } }` exits the outer loop.
        2. `outer: for (...) { for (...) { continue outer; } }` continues the outer loop.
        3. Label collision (two adjacent labels named `outer`) — second masks first; break consumes second.
        4. Break to a label not in scope — clear error (`"Label 'foo' not found"`).
        5. Unlabeled break inside two nested loops still exits the inner only.
        6. Label preserved across try/finally.
        7. Label preserved across a return-and-rethrow finally pattern.

      Conventional commit: `feat(agent-script): labeled break/continue`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-spread-call-args
    title: Spread in function call arguments
    prompt: |
      Support `fn(...args)` in the agent-script interpreter
      (`packages/agent-script/src/interp/interpreter.ts`). Confirm
      whether `evaluateCallExpression` already handles `SpreadElement`
      argument entries; if not, add it.

      Semantics: evaluate the spread source; require a sandbox array;
      flatten into the positional arg list in order. Mixing positional
      and spread is allowed: `fn(a, ...mid, z)`.

      Tests:
        1. `fn(...[1, 2, 3])` is equivalent to `fn(1, 2, 3)`.
        2. `fn(a, ...mid, z)` correct order.
        3. `fn(...[])` is equivalent to `fn()`.
        4. Spread of non-array (string, object, primitive) throws clear error.
        5. Spread arg combined with rest param on the receiving arrow correctly aggregates.
        6. Budget: spreading a 10000-element array exceeds `arrayLength` and throws `budgetExceeded`.

      Conventional commit: `feat(agent-script): spread in call arguments`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-computed-optional-chain
    title: Computed optional chaining (arr?.[i])
    prompt: |
      Extend optional chaining support to computed access (`arr?.[i]`)
      in `packages/agent-script/src/interp/interpreter.ts`. The prior
      handler covered `obj?.prop` and `fn?.()` — computed-member is
      the remaining gap.

      Semantics: if `object` is `null`/`undefined`, short-circuit to
      `undefined` without evaluating the index expression.

      Tests:
        1. `arr?.[0]` with `arr = null` returns undefined.
        2. `arr?.[0]` with `arr = undefined` returns undefined.
        3. `arr?.[0]` with `arr = [10]` returns 10.
        4. Index expression NOT evaluated when object is nullish (side-effect free assertion).
        5. Chained `obj?.[k]?.[k2]` short-circuits at the first nullish.
        6. Non-nullish falsy values don't short-circuit (`""?.[0]` still indexes).
        7. Out-of-bounds index returns undefined (normal array behavior).

      Conventional commit: `feat(agent-script): computed optional chaining`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-number-statics
    title: Number.isFinite, isNaN, isInteger
    prompt: |
      Add static method support on the `Number` global. Currently
      `Number` is a coercion factory (`Number("1")` → 1). Extend it
      with `isFinite`, `isNaN`, `isInteger` as static methods —
      ECMAScript semantics (strict: no implicit coercion, unlike
      legacy global `isFinite`/`isNaN`).

      Locate the `Number` binding in
      `packages/agent-script/src/interp/globals/object-array.ts` (or
      wherever it lives) and add the three statics.

      Tests in the matching `*.test.ts`:
        1. `Number.isFinite(1)` true; `Number.isFinite(Infinity)` false; `Number.isFinite(NaN)` false; `Number.isFinite("1")` false (strict).
        2. `Number.isNaN(NaN)` true; `Number.isNaN(1)` false; `Number.isNaN("NaN")` false.
        3. `Number.isInteger(1)` true; `Number.isInteger(1.5)` false; `Number.isInteger("1")` false.
        4. Methods are functions (typeof "function").
        5. Lint recognizes `Number.isFinite` etc. once `lint-known-globals` is in place.

      Conventional commit: `feat(agent-script): Number.isFinite/isNaN/isInteger`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-array-flat
    title: Array.prototype.flat and flatMap
    prompt: |
      Add `flat` and `flatMap` to the array method registry in
      `packages/agent-script/src/interp/methods/array.ts`.

      `arr.flat(depth)`: depth defaults to 1; flattens nested arrays
      up to that depth. `arr.flat(Infinity)` flattens fully. Non-array
      elements pass through unchanged.

      `arr.flatMap(fn)`: equivalent to `arr.map(fn).flat(1)` but
      single-pass. `fn` is `(value, index)` returning a value (which
      may be an array).

      Tests:
        1. `[1, [2], [3, [4]]].flat()` returns `[1, 2, 3, [4]]`.
        2. `[1, [2, [3]]].flat(2)` returns `[1, 2, 3]`.
        3. `[1, [2, [3]]].flat(Infinity)` returns `[1, 2, 3]`.
        4. `[1, 2, 3].flatMap(x => [x, x * 2])` returns `[1, 2, 2, 4, 3, 6]` (requires BinaryExpression).
        5. flatMap with non-array fn return treats it as one-element: `[1].flatMap(x => x)` returns `[1]`.
        6. flatMap throw inside fn propagates.
        7. flatMap fn argument arity respected (value, index).
        8. Empty array: `[].flat()` is `[]`; `[].flatMap(fn)` is `[]`.
        9. Budget: flatten of huge array exceeds `arrayLength` → `budgetExceeded`.

      Conventional commit: `feat(agent-script): Array#flat and #flatMap`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-string-raw
    title: String.raw static method
    prompt: |
      Add `String.raw` as a static method on the `String` global.
      Useful for embedding literal escape sequences without
      interpretation.

      Implementation lives in the `String` global definition (see
      `interp/globals/`). Mirrors ECMAScript: `String.raw({ raw:
      [...] }, ...subs)` concatenates raw parts with substitutions
      interleaved.

      In conjunction with tagged template literals, `` String.raw`a\nb` ``
      should yield `"a\\nb"` (literal backslash-n, not newline).

      Tests:
        1. `String.raw({ raw: ["a", "b"] }, 1)` returns "a1b".
        2. Used as a tag with `interp-tagged-templates`: `` String.raw`\n${1}\t` `` returns "\\n1\\t".
        3. Missing `.raw` on the object throws a clear error.
        4. Substitutions array shorter than `raw` length leaves trailing parts.
        5. Empty raw array returns "".

      Conventional commit: `feat(agent-script): String.raw`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-unused-import
    title: AS-UNUSED-IMPORT lint rule
    prompt: |
      Add a new lint rule under
      `packages/agent-script/src/lint/rules/AS-unused-import.ts`
      (and matching test file). Diagnostic code `AS-UNUSED-IMPORT`,
      severity `warning`.

      Behavior: after parsing, walk the AST and collect every
      identifier reference. For each `ImportDeclaration` specifier
      (named or default), if its local name is never referenced
      outside the import itself, emit a warning. Type-only imports
      (TS-style) are not in scope — the subset is JS.

      Wire the rule into `packages/agent-script/src/lint/index.ts`.

      Tests:
        1. `import { a } from "x"; return a;` — clean.
        2. `import { a } from "x";` (no reference) — warning at the specifier span.
        3. `import { a, b } from "x"; return a;` — warning for `b` only.
        4. `import { a as alias } from "x"; return alias;` — clean (local name is `alias`).
        5. `import { a as alias } from "x";` — warning at the `a as alias` specifier (local `alias` unused).
        6. Reference inside a nested arrow function counts.
        7. Reference inside a template literal interpolation counts.
        8. Default import unused — warning.
        9. Namespace import (`import * as ns from "x"`) — same rule; warn if `ns.*` never accessed.
       10. `--fix` mode (when implemented) deletes the unused specifier; if the whole import becomes empty, deletes the line.

      Conventional commit: `feat(agent-script): AS-UNUSED-IMPORT lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-unreachable
    title: AS-UNREACHABLE lint rule
    prompt: |
      New rule under `packages/agent-script/src/lint/rules/AS-unreachable.ts`.
      Code `AS-UNREACHABLE`, severity `warning`. Flags statements that
      cannot execute because a prior statement in the same block ends
      with an unconditional `return`, `throw`, `break`, or `continue`.

      Tests:
        1. Statement after `return` — warning.
        2. Statement after `throw` — warning.
        3. Statement after `break` inside a for-of body — warning.
        4. Statement after `continue` inside a for-of body — warning.
        5. Statement after an `if` that both branches return — warning on the trailing statement.
        6. Statement after an `if` where only one branch returns — clean.
        7. Statement after `try` where try returns but catch does not — clean.
        8. Statement after a labeled break to an enclosing loop — warning.
        9. Empty block after return — no warning (nothing to flag).
       10. Warning span covers the first unreachable statement only (not the whole tail).

      Conventional commit: `feat(agent-script): AS-UNREACHABLE lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-await-non-promise
    title: AS-AWAIT-NON-PROMISE lint rule
    prompt: |
      New rule `AS-AWAIT-NON-PROMISE` (warning) under
      `packages/agent-script/src/lint/rules/AS-await-non-promise.ts`.
      Flags `await` applied to a value that is statically a literal
      or known-non-promise expression (number, string, boolean, array
      literal, object literal). Calls to host functions and local
      arrows are NOT flagged — they may legitimately return promises.

      Tests:
        1. `await 1` — warning.
        2. `await "x"` — warning.
        3. `await { a: 1 }` — warning.
        4. `await [1, 2]` — warning.
        5. `await await 1` — single warning on the inner.
        6. `await someFn()` — clean (unknown).
        7. `await Promise.resolve(1)` — clean (Promise-returning).
        8. `await fn?.()` — clean.
        9. `await (x ? Promise.resolve() : 1)` — clean (mixed; do not chase ternary branches).
       10. Span of the warning covers the awaited expression, not the `await` keyword.

      Conventional commit: `feat(agent-script): AS-AWAIT-NON-PROMISE lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-missing-async
    title: AS-MISSING-ASYNC lint rule
    prompt: |
      New rule `AS-MISSING-ASYNC` (error) under
      `packages/agent-script/src/lint/rules/AS-missing-async.ts`. An
      arrow function that uses `await` inside its body must itself be
      marked `async`. The existing parser/interpreter may already
      reject this at parse/run; verify, and either (a) move the
      diagnostic to lint so it surfaces earlier, or (b) keep both for
      defense-in-depth with a single shared message.

      Tests:
        1. `const f = () => await x;` — error at the arrow's params or arrow keyword.
        2. `const f = async () => await x;` — clean.
        3. `const f = () => { return x; };` — clean.
        4. Nested: outer non-async, inner async — only inner triggers (clean for outer).
        5. Nested: outer non-async with `await` outside the inner — error on outer.
        6. Top-level `await` (module-level) is allowed; rule does not fire.
        7. `--fix` adds the `async` keyword.

      Conventional commit: `feat(agent-script): AS-MISSING-ASYNC lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-async-not-needed
    title: AS-ASYNC-NOT-NEEDED lint rule
    prompt: |
      New rule `AS-ASYNC-NOT-NEEDED` (info) under
      `packages/agent-script/src/lint/rules/AS-async-not-needed.ts`.
      `async` arrow with no `await` in its body is wasteful — the
      caller pays for a promise wrap. Suggest removing `async`.

      Exception: the module's default-exported arrow may need to be
      async by convention even without await (the runner expects an
      async signature). Detect default-export context and suppress.

      Tests:
        1. `const f = async () => 1;` — info (no await).
        2. `const f = async () => await x;` — clean.
        3. `export default async () => 1;` — clean (default export exception).
        4. Inner async with no await inside outer async with await — info on inner only.
        5. `--fix` removes the `async` keyword.

      Conventional commit: `feat(agent-script): AS-ASYNC-NOT-NEEDED lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-needless-template
    title: AS-NEEDLESS-TEMPLATE lint rule
    prompt: |
      New rule `AS-NEEDLESS-TEMPLATE` (info) under
      `packages/agent-script/src/lint/rules/AS-needless-template.ts`.
      Flags template literals whose only content is a single
      interpolation with no surrounding static text: `` `${x}` `` →
      should be `x` or `String(x)`.

      Tests:
        1. `` `${x}` `` — info, suggest `String(x)`.
        2. `` `n=${x}` `` — clean (has prefix).
        3. `` `${x}!` `` — clean (has suffix).
        4. `` `${a} ${b}` `` — clean (two interpolations).
        5. `` `hello` `` — clean (literal-only).
        6. `` `${`${x}`}` `` — info on the inner template.
        7. `--fix` replaces `` `${x}` `` with `String(x)`.

      Conventional commit: `feat(agent-script): AS-NEEDLESS-TEMPLATE lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-jsdoc-types
    title: JSDoc type validation against module shapes
    prompt: |
      Opt-in: when the lint module registry passes a richer shape
      (with TypeScript-style types for each export), parse JSDoc
      `@type {...}` and `@param {...}` annotations in the .ajs source
      and warn on obvious mismatches. New rule `AS-JSDOC-TYPE` under
      `packages/agent-script/src/lint/rules/AS-jsdoc-type.ts`.

      Scope: this is intentionally narrow — only validate primitive
      types (`string`, `number`, `boolean`, `null`, `undefined`,
      array-of-primitive, object-with-primitive-fields) against
      explicit declarations and assignment expressions. Generics,
      unions involving objects, conditional types, etc. are not in
      scope.

      Tests:
        1. `/** @type {string} */ const x = "y";` — clean.
        2. `/** @type {string} */ const x = 1;` — warning.
        3. `/** @type {number[]} */ const xs = [1, 2];` — clean.
        4. `/** @type {number[]} */ const xs = ["a"];` — warning on the element.
        5. JSDoc on a function arrow: `/** @param {string} name */ const greet = (name) => name;` — clean.
        6. Unknown JSDoc tag is ignored (no false positive).
        7. Malformed JSDoc (`@type {syntax error}`) emits a single parse warning, then continues.

      Conventional commit: `feat(agent-script): JSDoc type lint rule`.
    status:
      implement: done
      test: done
      commit: done

  - id: lint-shadow-global
    title: AS-SHADOW-GLOBAL lint rule
    prompt: |
      New rule `AS-SHADOW-GLOBAL` (warning) under
      `packages/agent-script/src/lint/rules/AS-shadow-global.ts`. A
      local `const`/`let` that shadows a known runtime global
      (`String`, `Math`, `Object`, etc. — share the allowlist with
      `lint-known-globals`) is usually a bug. Imports of the same
      name are exempt (module names can match globals).

      Tests:
        1. `const String = "x";` — warning.
        2. `let Math = 0;` — warning.
        3. `import { Math } from "custom";` — clean (import scope).
        4. `const customString = "x";` — clean.
        5. Nested scope: `if (true) { const String = 1; }` — warning on the inner declaration.
        6. Function parameter `(String) => String` — warning on the param.

      Conventional commit: `feat(agent-script): AS-SHADOW-GLOBAL lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-floating-promise
    title: AS-FLOATING-PROMISE lint rule
    prompt: |
      New rule `AS-FLOATING-PROMISE` (warning) under
      `packages/agent-script/src/lint/rules/AS-floating-promise.ts`.
      Flags expression statements whose value is a likely-promise
      (call to a known-async host function, call to a local `async`
      arrow, or `await`-less Promise factory call) without
      `await`, `return`, `Promise.all`/`race`/etc. consumption, or
      `.then` chain.

      The async-ness of host functions comes from the lint module
      registry — extend `LintModuleExports` if needed to declare
      `async: true` per export.

      Tests:
        1. `myAsyncHost();` as a statement — warning.
        2. `await myAsyncHost();` — clean.
        3. `return myAsyncHost();` inside an async arrow — clean.
        4. `Promise.all([myAsyncHost(), other()]);` — clean.
        5. `const p = myAsyncHost();` — clean (held in a binding).
        6. `if (cond) myAsyncHost();` — warning (statement-position call).
        7. Local async arrow called without await — warning.
        8. Sync host function called without await — clean.

      Conventional commit: `feat(agent-script): AS-FLOATING-PROMISE lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-import-cycle
    title: AS-IMPORT-CYCLE lint rule
    prompt: |
      New rule `AS-IMPORT-CYCLE` (error) under
      `packages/agent-script/src/lint/rules/AS-import-cycle.ts`. When
      the lint is given source-backed modules (the richer shape with
      `filename` and `source` per module), build the import graph and
      flag cycles.

      The rule is a no-op when modules are only declared with export
      lists (no source). Document this so external tooling knows what
      shape to pass.

      Tests:
        1. A → B → A — error on both A and B's import statement.
        2. A → B → C — clean.
        3. A → A (self-import) — error.
        4. A → B, A → C, B → C — clean.
        5. Bare module registry (no source) — rule emits no diagnostics.
        6. Cycle through three modules A → B → C → A — error.

      Conventional commit: `feat(agent-script): AS-IMPORT-CYCLE lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-destructure-null-default
    title: AS-DESTRUCTURE-NULL-DEFAULT lint rule
    prompt: |
      New rule `AS-DESTRUCTURE-NULL-DEFAULT` (warning) under
      `packages/agent-script/src/lint/rules/AS-destructure-null-default.ts`.
      Flags `const { a = 1 } = obj` patterns when `obj.a` is
      statically known to be `null` — defaults only apply to
      `undefined`, not `null`, which is a common confusion.

      Coverage: only obvious cases. `const { a = 1 } = { a: null }` is
      flagged; dynamic objects are not (no false positives).

      Tests:
        1. `const { a = 1 } = { a: null };` — warning.
        2. `const { a = 1 } = { a: undefined };` — clean (default fires).
        3. `const { a = 1 } = {};` — clean (default fires).
        4. `const { a = 1 } = obj;` — clean (dynamic).
        5. Array form: `const [a = 1] = [null];` — warning.
        6. Nested: `const { x: { a = 1 } } = { x: { a: null } };` — warning on the inner.

      Conventional commit: `feat(agent-script): AS-DESTRUCTURE-NULL-DEFAULT lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-unbounded-loop
    title: AS-UNBOUNDED-LOOP lint rule
    prompt: |
      New rule `AS-UNBOUNDED-LOOP` (warning) under
      `packages/agent-script/src/lint/rules/AS-unbounded-loop.ts`.
      Flags `while(true)`, `for(;;)`, `do { ... } while(true)` whose
      bodies contain no `break`, `return`, `throw`, or labeled break
      to an enclosing label. The check is static — analyze the body
      AST for any exit construct.

      Tests:
        1. `while (true) { x = x + 1; }` — warning.
        2. `while (true) { if (cond) break; }` — clean.
        3. `for (;;) { return; }` — clean.
        4. `while (true) { throw new Error("x"); }` — clean.
        5. `outer: while (true) { while (true) { break outer; } }` — clean on both.
        6. `outer: while (true) { while (true) { break; } }` — warning on outer (inner break doesn't exit outer).
        7. Bounded test (`while (i < n)`) — clean regardless of body.

      Conventional commit: `feat(agent-script): AS-UNBOUNDED-LOOP lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-mutating-frozen
    title: AS-MUTATING-FROZEN lint rule
    prompt: |
      New rule `AS-MUTATING-FROZEN` (warning) under
      `packages/agent-script/src/lint/rules/AS-mutating-frozen.ts`.
      Flags calls to mutating array methods (`push`, `pop`, `shift`,
      `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`)
      on a receiver originating from `Object.freeze(...)` or
      `Array.of(...)` (which the sandbox treats as immutable).

      Static analysis: only flag when the receiver is the literal
      result of one of those calls or a binding that points to one.

      Tests:
        1. `Object.freeze([1, 2]).push(3);` — warning.
        2. `const a = Object.freeze([1]); a.push(2);` — warning on the call.
        3. `Array.of(1, 2).pop();` — warning.
        4. `const a = [1, 2]; a.push(3);` — clean (plain literal).
        5. `const a = someHostFn(); a.push(3);` — clean (unknown receiver).
        6. Non-mutating call (`a.concat`) on a frozen receiver — clean.

      Conventional commit: `feat(agent-script): AS-MUTATING-FROZEN lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-large-literal
    title: AS-LARGE-LITERAL lint rule
    prompt: |
      New rule `AS-LARGE-LITERAL` (warning) under
      `packages/agent-script/src/lint/rules/AS-large-literal.ts`.
      Flags array literals with > N elements or object literals with
      > N keys. Default N is 1000; configurable via a lint option
      (`largeLiteralThreshold`).

      Tests:
        1. Array literal with 1000 elements — clean (boundary).
        2. Array literal with 1001 elements — warning.
        3. Object literal with 1001 keys — warning.
        4. Threshold override to 10: array of 11 elements — warning; array of 10 — clean.
        5. Nested: `{ a: [<1001 elements>] }` — warning on the array span.
        6. Spread does not count toward static element count.

      Conventional commit: `feat(agent-script): AS-LARGE-LITERAL lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-disabled-rule-comment
    title: Recognize //@as-disable comments
    prompt: |
      Extend lint to recognize per-line and per-file disable
      directives via line comments:

      - `// @as-disable AS003` — disable AS003 for the next statement.
      - `// @as-disable-line AS003` — disable AS003 on the same line.
      - `/* @as-disable-file AS003 */` at the top of the file —
        disable AS003 for the entire file.

      Disabled rules with unknown codes emit `AS-UNKNOWN-DIRECTIVE`
      warnings to catch typos.

      Implementation: pre-pass over comments before rules run, build
      a suppression map keyed by (line, ruleCode). Every rule's
      diagnostic emitter consults the map.

      Tests:
        1. `// @as-disable AS003` then a line with an unknown identifier — no error.
        2. `// @as-disable-line AS003` on the same line as the offending statement — no error.
        3. `// @as-disable AS003` then two lines later the offending statement — error (only next statement is suppressed).
        4. `/* @as-disable-file AS003 */` at top — all AS003 suppressed.
        5. Unknown rule code: `// @as-disable ASXXX` — `AS-UNKNOWN-DIRECTIVE` warning.
        6. Multiple codes: `// @as-disable AS003 AS012` — suppresses both.
        7. Disable for a rule that doesn't fire on the next line — no-op (no warning for unused suppression in this pass).

      Conventional commit: `feat(agent-script): @as-disable comments`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-frontmatter-field-unused
    title: AS-FRONTMATTER-FIELD-UNUSED lint rule
    prompt: |
      New rule `AS-FRONTMATTER-FIELD-UNUSED` (info) under
      `packages/agent-script/src/lint/rules/AS-frontmatter-field-unused.ts`.
      When linting a harness `.ajs` whose paired `.md` declares
      frontmatter fields (validated by the exported `schema`), warn
      about top-level frontmatter fields that are never referenced
      via `frontmatter.<field>` in the script body.

      The rule needs access to:
      - The schema's top-level field names (from the `schema` export).
      - The script body's references to `frontmatter.<field>`.

      Add a new `LintOptions.frontmatterFields?: string[]` so the
      harness loader can pass them. The rule does nothing when the
      option is absent.

      Tests:
        1. Schema declares `{a, b}`; script references both — clean.
        2. Schema declares `{a, b}`; script references only `a` — info on `b`.
        3. Schema declares `{a, b}`; script references `frontmatter` via destructuring (`const { a } = frontmatter`) — `a` counts, `b` flagged.
        4. Reference via computed access (`frontmatter[name]` with dynamic name) — info suppressed (we can't statically tell).
        5. Nested field never referenced — only top-level fields are checked (out of scope).

      Conventional commit: `feat(agent-script): AS-FRONTMATTER-FIELD-UNUSED lint rule`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-fix-flag
    title: --fix flag wired through lint API and CLI
    prompt: |
      Add a `fix?: boolean` option to the top-level `lint(source,
      options)` API. When true, rules that support fixes provide a
      `fix` field on their diagnostics (a `{ range, replacement }`
      tuple). The lint entry collects all non-overlapping fixes and
      returns a `fixed: string` alongside `diagnostics`.

      Rules that ship with `--fix` support in this plan:
      - AS-UNUSED-IMPORT (delete specifier; delete whole import if last)
      - AS-MISSING-ASYNC (insert `async ` before arrow params)
      - AS-ASYNC-NOT-NEEDED (remove `async ` from arrow)
      - AS-NEEDLESS-TEMPLATE (replace `` `${x}` `` with `String(x)`)

      Wire `--fix` into the CLI surfaces that call lint:
      `npx poe-agent-script` (the dry-runner) accepts `--fix` and
      writes back to disk; same for `poe-code harness run` (gate
      `--fix` behind explicit flag so we never silently rewrite the
      source under the user).

      Conflict policy: when two fixes overlap, apply the first
      lexically and re-lint; surface the rest as still-open
      diagnostics.

      Tests:
        1. Fix is idempotent — running --fix twice produces no further changes.
        2. Two fixes on disjoint ranges both apply.
        3. Overlapping fixes apply only the first; the second is reported as still-open.
        4. Whole-file delete-after-fix (e.g. last import line) preserves trailing newline.
        5. CLI flag passes through (`--fix` propagates from CLI to lint to disk write).
        6. Without `--fix`, lint reports diagnostics with `fix` field present but does not write disk.

      Conventional commit: `feat(agent-script): --fix flag`.
    status:
      implement: open
      test: open
      commit: open

  - id: spawn-retry
    title: spawn.retry in the agent-spawn SDK
    prompt: |
      Add `retry` as a wrapping helper on the top-level `spawn`
      function in `@poe-code/agent-spawn` (and re-export from
      `poe-code` SDK so users can call `spawn.retry(...)`).

      Signature:
        `spawn.retry(service, options, { maxAttempts, backoffMs, isRetryable? })`
        returning the same `{ events, result }` shape as `spawn`.

      Behavior:
      - On `result.exitCode !== 0`, decide whether to retry. Default
        `isRetryable`: codes 1, 124, 125, 137 are retryable (general
        failure, timeout, killed). Codes 130 (SIGINT), 143 (SIGTERM)
        are NOT retryable.
      - Backoff: linear or exponential — choose exponential with
        cap at 30s.
      - `maxAttempts` includes the first try (so `maxAttempts: 1` is
        no-retry).
      - Stream events from each attempt prefixed with `attempt: N`
        into the consolidated `events` stream so callers see the
        retry happen live.
      - The final `result` is from the last attempt.

      Expose via the agent-script `agent` module as
      `agent.spawn.retry(def, options, retryOptions)`. The arity is
      `(def, options, retryOptions)` to mirror existing
      `agent.spawn(def, options)`.

      Tests:
        1. First attempt succeeds — no retry.
        2. First attempt fails with retryable code; second succeeds — final exitCode 0; events stream shows both attempts.
        3. All attempts fail — final result is from the last attempt; total attempts == `maxAttempts`.
        4. Non-retryable code — no retry, returns immediately.
        5. Custom `isRetryable: () => false` — never retries.
        6. Backoff observable: events stream includes wait markers; total elapsed >= sum of backoffs.
        7. Abort signal: aborts mid-backoff, no further attempts, signal-rejected error.

      Conventional commit: `feat(agent-spawn): spawn.retry helper`.
    status:
      implement: open
      test: open
      commit: open

  - id: spawn-parallel
    title: spawn.parallel in the agent-spawn SDK
    prompt: |
      Add `parallel` as a wrapping helper on the top-level `spawn`
      function in `@poe-code/agent-spawn` (re-exported from
      `poe-code`).

      Signature:
        `spawn.parallel(calls, { maxConcurrent, failFast? }):
          Promise<SpawnResult[]>`
        where `calls` is an array of `(service, options)` tuples or
        an array of thunks returning `{ events, result }`.

      Behavior:
      - Honor `maxConcurrent` strictly. Default 4.
      - `failFast: true` (default): on the first non-zero exit, abort
        in-flight spawns via their abort signal and reject.
      - `failFast: false`: aggregate all results regardless. Return
        every `SpawnResult` in input order.
      - Aggregate token usage in the returned array so callers can
        sum.

      Investigate the existing `spawn.autonomous` path (`src/sdk/spawn.ts`
      imports `spawnAutonomous`). If it already covers this case,
      compose on top rather than duplicate. If not, build new.

      Expose via the agent-script `agent` module as
      `agent.spawn.parallel(calls, options)`.

      Tests:
        1. 5 spawns with `maxConcurrent: 2` — at most 2 in flight at any time (assert via concurrency-counting fake).
        2. All succeed — array length matches input, order preserved.
        3. failFast: one fails — others abort; rejection includes the failure.
        4. failFast false: one fails — others complete; returned array contains all results including the failure.
        5. Empty input — returns empty array; no spawns.
        6. `maxConcurrent: 1` is equivalent to sequential.
        7. Abort signal cancels all in-flight on parent abort.

      Conventional commit: `feat(agent-spawn): spawn.parallel helper`.
    status:
      implement: open
      test: open
      commit: open

  - id: time-sleep
    title: time.sleep(ms) host primitive
    prompt: |
      Extend the `time` host module
      (`packages/agent-script/src/modules/time.ts`) with a `sleep(ms)`
      async function. Resolves after `ms` milliseconds. Respects an
      injected abort signal — when aborted, rejects immediately with
      a clear error.

      Implementation: use `setTimeout` wrapped in a `Promise` plus an
      `AbortSignal` listener. The `time` module factory already
      accepts `now`/`random` options; add `signal?: AbortSignal` to
      the factory so harness runs can pass theirs through.

      Tests:
        1. `await time.sleep(50)` resolves after at least 50ms (use a high-resolution timer; allow slack).
        2. `time.sleep(0)` resolves on the next microtask.
        3. Negative input throws a clear `RangeError`-shaped sandbox error.
        4. Aborted before call: rejects immediately.
        5. Aborted during wait: rejects within tolerance of the abort.
        6. Multiple concurrent sleeps each resolve independently.
        7. Lint module declaration includes `sleep`; calling without await is flagged by AS-FLOATING-PROMISE when that rule lands.

      Conventional commit: `feat(agent-script): time.sleep with abort`.
    status:
      implement: open
      test: open
      commit: open

  - id: time-now-deterministic
    title: time.now() with deterministic injection
    prompt: |
      Add `time.now(): number` to the `time` host module that returns
      epoch milliseconds. Default to `Date.now()`; allow the factory
      caller to inject a custom `now()` for deterministic replay.

      Update `runHarnessPair` / `harness run` to thread an optional
      `clock` option through to `makeTimeModule({ now })`. Snapshots
      already cover RNG state — extend with monotonic clock state so
      replays see the same `now()` sequence.

      Tests:
        1. Default `time.now()` returns a number within 5ms of `Date.now()` at call time.
        2. Injected `now: () => 1000` returns exactly 1000 on every call (deterministic).
        3. Two calls to `time.now()` in sequence return non-decreasing values with the default clock.
        4. Snapshotted clock state restores correctly: replay of a script produces the same `now()` sequence.
        5. `time.uuid()` (existing) remains seedable; combined with `time.now()` produces stable IDs across replays.

      Conventional commit: `feat(agent-script): deterministic time.now`.
    status:
      implement: open
      test: open
      commit: open

  - id: git-worktree
    title: git.worktreeCreate / worktreeRemove primitives
    prompt: |
      Extend the `git` host module
      (`packages/agent-script/src/modules/git.ts`) with worktree
      operations:

      - `git.worktreeCreate(branch, { base?, path? }): Promise<{ path, branch }>` —
        create a worktree at `path` (default: a tmp dir under
        `.poe-code/worktrees/<safe-branch-name>/`) on a new branch
        from `base` (default: HEAD). The new worktree path is
        returned and is suitable to pass as `cwd` to a subsequent
        `spawn`.
      - `git.worktreeRemove(path)` — `git worktree remove --force`
        and delete the directory. Idempotent.
      - `git.worktreeList(): Promise<{ path, branch }[]>` — returns
        the current set.

      Implementation: shell out to `git worktree` via the existing
      child-process plumbing in `git.ts`. Validate paths to prevent
      escape.

      Tests:
        1. `worktreeCreate("feature/x")` creates a directory; `git worktree list` shows it.
        2. Default base is HEAD; explicit base creates from that ref.
        3. `worktreeRemove(path)` cleans up; second call is a no-op (idempotent).
        4. `worktreeList` reflects current state across multiple creates/removes.
        5. Creating with a branch name that already exists throws a clear error.
        6. Creating with a path outside the repo throws.
        7. A `spawn` invoked with `cwd` pointing at a worktree edits files in the worktree, not the main checkout.

      Conventional commit: `feat(agent-script): git worktree primitives`.
    status:
      implement: open
      test: open
      commit: open

  - id: mcp-tool-batch
    title: mcp client toolBatch primitive
    prompt: |
      Extend the `mcp` host module
      (`packages/agent-script/src/modules/mcp.ts`) with a
      `toolBatch(calls)` method on the client:

      - `client.toolBatch([{ name, args }, ...]): Promise<({ ok: true, value } | { ok: false, error })[]>`

      Behavior: execute each tool call against the same MCP
      connection. If the MCP protocol supports batched requests,
      bundle them; otherwise fire concurrently with a small
      concurrency cap (default 4). Always return a `Result[]` of the
      same length and order as input; never reject the outer
      promise on a single call failure.

      Tests:
        1. Empty batch returns empty array; no protocol calls made.
        2. Two successful calls — both `ok: true`, values in order.
        3. One failure, one success — failure shows in the result envelope; outer promise resolves.
        4. Order preserved across concurrent execution.
        5. MCP disconnect mid-batch — remaining calls return `ok: false` with a clear error.
        6. Budget: per-call enforced by existing client tool budget.

      Conventional commit: `feat(agent-script): mcp toolBatch`.
    status:
      implement: open
      test: open
      commit: open

  - id: snapshot-pluggable-backend
    title: Pluggable snapshot backend interface (no built-in backends)
    prompt: |
      The snapshot persistence in
      `packages/agent-script/src/snapshot/` (and downstream usage in
      `agent-harness/src/loader/run.ts`) currently writes to a file
      path. Refactor the write/read calls behind an interface so
      callers can plug in alternative backends.

      New interface (declare in
      `packages/agent-script/src/snapshot/backend.ts`):

        ```ts
        export interface SnapshotBackend {
          read(): Promise<Snapshot | undefined>;
          write(snapshot: Snapshot): Promise<void>;
          remove(): Promise<void>;
        }
        ```

      Provide one built-in: `FileSnapshotBackend(path)` that mirrors
      today's behavior. Do NOT add other backends (R2/KV/etc.) to this
      package — the user has banned built-in non-fs dependencies. The
      interface is the deliverable; external packages can implement.

      `runHarnessPair` accepts `snapshotBackend?: SnapshotBackend`
      (in addition to existing `snapshotPath?: string` which becomes
      sugar for `new FileSnapshotBackend(path)`).

      Tests:
        1. FileSnapshotBackend write/read round-trip preserves the snapshot value.
        2. read() on a nonexistent path returns undefined.
        3. remove() is idempotent.
        4. Custom in-memory mock backend used by tests — runHarnessPair drives it.
        5. write() failure surfaces with the underlying error.
        6. Concurrent writes serialize via existing lock (no torn snapshots).
        7. Source hash mismatch on read still surfaces clearly through the new backend path.

      Conventional commit: `feat(agent-script): pluggable snapshot backend`.
    status:
      implement: open
      test: open
      commit: open

  - id: snapshot-replay-equivalence
    title: Replay-equivalence test harness
    prompt: |
      Add a test utility (and CI gate) that, given a deterministic
      harness pair, runs it once normally, captures every yielded
      snapshot, and then for each snapshot restarts from that point
      and asserts the script's return value matches the original.

      Location:
      `packages/agent-harness/src/testing/replay-equivalence.ts`
      (create the directory). Export a `assertReplayEquivalent(path,
      modulesFor)` function.

      Implementation: drive `runHarnessPair` with `snapshotIntervalMs`
      set very low (e.g. 1ms) so most awaits produce snapshots; the
      built-in agent stub used in tests must be deterministic (no
      wall clock, no random).

      Use the coverage-demo harness from plan 25 as the canonical
      input.

      Tests:
        1. Coverage-demo harness: replay from each snapshot matches the original return value.
        2. A harness with non-deterministic side effects (Math.random without seed) — replay fails with a clear "non-deterministic" message.
        3. Snapshot taken before any await: replay produces identical run.
        4. Snapshot taken after the last await: replay returns the cached return value without re-executing.
        5. Tampered snapshot (sourceHash mismatch) surfaces the existing error.

      Conventional commit: `test(agent-harness): replay-equivalence assertion`.
    status:
      implement: open
      test: open
      commit: open

  - id: otel-interface
    title: OpenTelemetry exporter interface (no built-in deps)
    prompt: |
      Add an interface for exporting harness events as OpenTelemetry
      spans/events, without depending on the `@opentelemetry/*`
      packages (banned by user policy). Consumers wire their own
      OTel SDK to the interface.

      New file `packages/agent-script/src/observability/otel.ts`
      declaring:

        ```ts
        export interface OtelSink {
          startSpan(name: string, attrs: Record<string, unknown>):
            { setAttribute(k, v): void; addEvent(name, attrs): void;
              end(): void };
          recordException(span: ReturnType<typeof startSpan>,
            error: unknown): void;
        }
        ```

      Add `otelSink?: OtelSink` to harness run options and to
      `agent-spawn` spawn options. Internally, on each agent spawn,
      open a span tagged with `{ agent, mode, cwd }`, attach events
      for prompt/summary/exit, and close on result. Each yielded
      snapshot becomes an event.

      Ship a no-op default so existing code is unaffected when no
      sink is provided.

      Tests:
        1. No sink: behavior identical to before this change (no panics, no spans).
        2. Stub sink records expected span lifecycle per spawn: open → event(prompt) → event(summary) → close.
        3. Failing spawn calls `recordException` once with the error.
        4. Snapshot yields emit `snapshot.saved` events with the iteration count attribute.
        5. Sink-throwing methods don't crash the harness — wrap with try/catch and log a warning.

      Conventional commit: `feat(agent-script): otel sink interface`.
    status:
      implement: open
      test: open
      commit: open

  - id: cost-aggregation
    title: Internal cost aggregation across spawns
    prompt: |
      Aggregate `SpawnUsage` (input/output/cached tokens, costUsd)
      across every spawn produced by a harness run, and expose the
      total via:
      - the harness run summary printed at the end (already shows
        token totals; extend with `Total cost: $X.YY` when any spawn
        reports `costUsd`).
      - a programmatic field on the returned `RunResult` from
        `runHarnessPair`: `usage: { inputTokens, outputTokens,
        cachedTokens, costUsd, spawnCount }`.
      - an event in the lint/journal stream (`harness.usage.totalled`).

      Internals: accumulator on the spawn agent module; reset per run;
      threaded through the runtime context. Do not add a new file
      format or persistence — this is in-memory only for now (the
      user wants this surfaced internally first).

      Tests:
        1. Zero spawns: usage zeros.
        2. Three spawns with known usage values: totals match the sum.
        3. A spawn that reports no `costUsd` (older providers) does not poison the total; `costUsd` is undefined when no spawn reported it, otherwise the sum.
        4. Aggregation resets between runs (same process, two `runHarnessPair` calls).
        5. The final printed summary includes the cost line when any spawn reported one.

      Conventional commit: `feat(harness): aggregate cost across spawns`.
    status:
      implement: open
      test: open
      commit: open
---

# Harness improvements — interpreter polish, lint rigor, SDK retries, observability hooks

Second-wave improvements to `@poe-code/agent-script` and adjacent packages, after the runtime-gap fixes in [25-agent-script-runtime-gaps.md](25-agent-script-runtime-gaps.md). Scope: language polish, a lint upgrade (the biggest single area), retry/parallel at the spawn SDK layer, time/git/mcp primitives, an interface for pluggable snapshot backends and OTel sinks (no built-in deps), and internal cost aggregation.

## Strategy

Each task lands as one commit with focused edge-case tests. Most are independent. Where there's a natural dependency (lint `--fix` needs rules to land first; replay-equivalence reuses the coverage-demo harness), the task notes it but still ships standalone.

Lint is the single biggest investment in this plan — seventeen rules and a `--fix` plumbing. The goal is that lint catches authoring bugs before any spawn cost is paid.

No `--no-verify`, no hook bypass. Conventional commits.

## Out of scope (rejected during triage)

- `Object.hasOwn` — not worth the complexity.
- Sandboxed `fs` module — we're keeping the sandbox closed.
- `env.set` — explicitly out.
- Snapshot compression, history, and signing — not now.
- Per-task duration histograms, structured `--no-tui` stdout, golden prompt tests, mock-codex E2E, `.ajs` coverage, sub-harnesses, REPL, `harness run --dry-run`/`--max-cost`/`--max-spawns`, `harness journal`/`diff`/`watch`/`validate`/`logs`, sourcehash migration prompt, `metric.observe` — deferred for a later wave.

## Redirects

- Retry semantics live in `@poe-code/agent-spawn` (`spawn.retry`), not as a host module helper.
- Parallel fan-out lives in `@poe-code/agent-spawn` (`spawn.parallel`), composing on top of the existing autonomous path where possible.
- The `agent-script` host `agent` module re-exports both helpers so harnesses can call `agent.spawn.retry(...)` and `agent.spawn.parallel(...)` directly.
