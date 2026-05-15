---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: add-binary-expression
    title: Add BinaryExpression interpreter handler
    prompt: |
      The interpreter dispatch table in
      `packages/agent-script/src/interp/interpreter.ts` (around line 137)
      has no handler for `BinaryExpression`. Every numeric/string/comparison
      operation (`a + b`, `i >= n`, `x === y`, etc.) crashes at runtime
      with `UNSUPPORTED_NODE` even though the parser and linter accept it.

      Add an `evaluateBinaryExpression` handler that evaluates `node.left`
      and `node.right` via the existing `evaluateNode`, then applies the
      operator. Support: `+`, `-`, `*`, `/`, `%`, `**`, `<`, `<=`, `>`,
      `>=`, `===`, `!==`, `==` (use `===` semantics), `!=` (use `!==`
      semantics — no implicit coercion), `&`, `|`, `^`, `<<`, `>>`,
      `>>>`. For `+` with at least one string operand, coerce to string
      concatenation per ECMAScript. Honor the `stringLength` budget for
      string concatenation, `arrayLength` budget where relevant.

      Register the handler in `dispatchTable`. Charge budget per node via
      `context.budget.visitNode()`.

      Edge-case tests (add to `interp/interpreter.test.ts`):
        1. `1 + 2` returns 3.
        2. `5 - 3` returns 2.
        3. `4 * 6` returns 24.
        4. `10 / 4` returns 2.5 (no integer truncation).
        5. `10 % 3` returns 1.
        6. `2 ** 10` returns 1024.
        7. `"a" + "b"` returns "ab".
        8. `"v" + 1` returns "v1" (number coerced to string).
        9. `1 + "v"` returns "1v".
       10. `2 < 3` true; `3 < 2` false; `3 < 3` false.
       11. `2 <= 2` true; `3 <= 2` false.
       12. `3 > 2` true; `2 > 3` false.
       13. `3 >= 3` true; `2 >= 3` false.
       14. `1 === 1` true; `1 === "1"` false (no coercion).
       15. `1 !== 2` true; `1 !== 1` false.
       16. `1 == 1` true; `1 == "1"` false (we use strict semantics).
       17. `1 != 2` true; `1 != 1` false.
       18. `5 & 3` returns 1; `5 | 3` returns 7; `5 ^ 3` returns 6.
       19. `1 << 3` returns 8; `16 >> 2` returns 4; `-1 >>> 28` returns 15.
       20. `null + 1` follows ECMAScript (0 + 1 = 1); `undefined + 1` is NaN.
       21. String concat that exceeds `stringLength` budget throws `SandboxError` with `code: "budgetExceeded"`.
       22. Replace the existing "reports unsupported nodes through the result envelope" test (interpreter.test.ts:75-90) that asserts `BinaryExpression` → `UNSUPPORTED_NODE`. Substitute a still-unsupported node type (e.g. `AssignmentExpression`) to preserve coverage of the unsupported path until that handler lands.

      Conventional commit: `feat(agent-script): evaluate BinaryExpression`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-if-statement
    title: Add IfStatement interpreter handler
    prompt: |
      The interpreter dispatch table at
      `packages/agent-script/src/interp/interpreter.ts` (around line 137)
      has no handler for `IfStatement`. Any `if (cond) { ... } else { ... }`
      crashes with `UNSUPPORTED_NODE`. Most real harness scripts hit this.

      Add `evaluateIfStatement`. Evaluate `node.test` via `evaluateNode`,
      coerce to boolean using the same truthiness the existing
      `UnaryExpression` `!` operator uses, then evaluate the consequent
      or (if present) the alternate. Propagate `kind`
      (`normal`/`throw`/`return`/`error`) from the chosen branch so
      returns surface for the enclosing function. Both branches can
      themselves be `BlockStatement` or another `IfStatement` (chained
      `else if`).

      Register in `dispatchTable`. Charge budget for the test and the
      chosen branch only.

      Edge-case tests (interp/interpreter.test.ts):
        1. `if (true) { return 1; } return 2;` returns 1.
        2. `if (false) { return 1; } return 2;` returns 2.
        3. `if (x === 1) { return "a"; } return "b";` with `x = 1` returns "a", with `x = 2` returns "b" (requires BinaryExpression — assume landed first; otherwise use a bound boolean).
        4. `if (false) { return 1; } else { return 2; }` returns 2.
        5. else-if chain: first branch wins.
        6. else-if chain: second branch wins when first is falsy.
        7. else-if chain: else wins when all if/else-if are falsy.
        8. Nested if inside if: inner result surfaces.
        9. `return` inside if exits the enclosing arrow with the value.
       10. `throw` inside if propagates as a `throw` kind.
       11. Missing alternate with falsy test evaluates to no value (no `hasValue`).
       12. Truthiness coercion: `if (0)`, `if ("")`, `if (null)`, `if (undefined)` are falsy.
       13. Truthiness coercion: `if (1)`, `if ("x")`, `if ({})`, `if ([])` are truthy.
       14. Budget: skipped branch's node visits do not count.

      Conventional commit: `feat(agent-script): evaluate IfStatement`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-logical-expression
    title: Add LogicalExpression handler with short-circuit
    prompt: |
      `packages/agent-script/src/interp/interpreter.ts` lacks a handler
      for `LogicalExpression`. `a && b`, `a || b`, `a ?? b` all crash
      with `UNSUPPORTED_NODE`.

      Add `evaluateLogicalExpression`. Evaluate `node.left`. For `&&`: if
      left is falsy, return left unchanged without evaluating right;
      else evaluate and return right. For `||`: if left is truthy,
      return left unchanged; else evaluate and return right. For `??`:
      if left is `null` or `undefined`, evaluate and return right; else
      return left. Short-circuit: the right side must not be evaluated
      when skipped — its budget visits must not be charged.

      Edge-case tests:
        1. `true && true` → true. `true && false` → false. `false && X` → false; X never evaluated (assert via side-effect: bind X to a throwing call).
        2. `false || true` → true. `true || X` → true; X never evaluated.
        3. `null ?? "fallback"` → "fallback". `undefined ?? "fallback"` → "fallback". `0 ?? "fallback"` → 0 (zero is not nullish). `"" ?? "fallback"` → "" (empty string is not nullish).
        4. `a && b` returns the actual left value when left is falsy (e.g. `0 && 1` returns 0, not false).
        5. `a || b` returns the actual left value when left is truthy (e.g. `"x" || 1` returns "x").
        6. Chained: `null ?? 0 ?? 1` returns 0.
        7. Chained short-circuit: `true || throwing() || throwing()` returns true with no calls.

      Conventional commit: `feat(agent-script): evaluate LogicalExpression`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-conditional-expression
    title: Add ConditionalExpression (ternary) handler
    prompt: |
      No handler for `ConditionalExpression` in
      `packages/agent-script/src/interp/interpreter.ts`. `a ? b : c`
      crashes with `UNSUPPORTED_NODE`.

      Add `evaluateConditionalExpression`. Evaluate `node.test`, coerce
      to boolean, then evaluate and return either `node.consequent` or
      `node.alternate`. Do not evaluate the branch not taken.

      Edge-case tests:
        1. `true ? 1 : 2` returns 1.
        2. `false ? 1 : 2` returns 2.
        3. Truthiness: `0 ? "a" : "b"` returns "b"; `"" ? "a" : "b"` returns "b"; `null ? "a" : "b"` returns "b"; `[] ? "a" : "b"` returns "a".
        4. Branch not taken is not evaluated (bind a throwing call on the unused side, confirm it does not throw).
        5. Nested: `a ? b ? 1 : 2 : 3` evaluates inner correctly.
        6. `throw` inside the chosen branch propagates as `throw` kind.

      Conventional commit: `feat(agent-script): evaluate ConditionalExpression`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-template-literal
    title: Add TemplateLiteral handler
    prompt: |
      `TemplateLiteral` has no interpreter handler in
      `packages/agent-script/src/interp/interpreter.ts`. Any `` `${x}` ``
      string crashes with `UNSUPPORTED_NODE`.

      The parser emits `TemplateLiteral` with `quasis` (static parts)
      and `expressions` (interpolated subexpressions). Invariant:
      `quasis.length === expressions.length + 1`.

      Add `evaluateTemplateLiteral`. Walk quasis and expressions in
      order; for each expression evaluate it, coerce its sandbox value
      to string using the same coercion as a `String(value)` factory
      call, and concatenate. Honor the `stringLength` budget at each
      concatenation; throw `SandboxError`/`budgetExceeded` on overflow.

      Edge-case tests:
        1. Literal-only `` `hello` `` returns "hello".
        2. One interpolation `` `n=${1}` `` returns "n=1".
        3. Multiple interpolations `` `a=${a} b=${b}` `` with bound a/b.
        4. Number coercion: `` `${42}` `` returns "42".
        5. Boolean coercion: `` `${true}` `` returns "true"; `` `${false}` `` returns "false".
        6. Null coercion: `` `${null}` `` returns "null"; `` `${undefined}` `` returns "undefined".
        7. String passthrough: `` `${"x"}` `` returns "x".
        8. Nested template: `` `${`x:${1}`}` `` returns "x:1".
        9. Empty interpolation `` `${""}` `` returns "".
       10. `throw` inside an interpolation propagates.
       11. Budget: a template exceeding `stringLength` throws `budgetExceeded`.

      Conventional commit: `feat(agent-script): evaluate TemplateLiteral`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-for-of-statement
    title: Add ForOfStatement handler over arrays
    prompt: |
      `packages/agent-script/src/interp/interpreter.ts` has no
      `ForOfStatement` handler. `for (const x of arr) { ... }` crashes
      with `UNSUPPORTED_NODE`.

      Add `evaluateForOfStatement`. Evaluate the iterable expression;
      require it to be a sandbox array (mirror what the existing array
      method machinery accepts). For each element, declare the loop
      variable in a fresh child scope (the parser's `node.left` is a
      `VariableDeclaration` with one declarator), then evaluate
      `node.body`. Wire `break`/`continue` signals: `BreakStatement`
      and `ContinueStatement` are already dispatched but currently
      have no enclosing loop to consume them — this is the first loop
      handler so it must wire that consumption.

      Iterables other than arrays (strings, maps, etc.) are not yet
      supported. Throw a `TypeError`-shaped sandbox error (`"<value>
      is not a supported iterable"`) rather than crashing.

      Edge-case tests:
        1. Iterate over `[1, 2, 3]`, accumulating into an array, returns `[1, 2, 3]`.
        2. Iterate over `[]`, body never runs.
        3. `break` after the second iteration stops; final length is 2.
        4. `continue` skips body work for one iteration.
        5. `throw` inside body propagates with the original message.
        6. `return` inside body exits the enclosing arrow with the value.
        7. Iterating a non-array (`for (const x of "abc")`) throws the documented TypeError-shape error.
        8. Iterating `null`/`undefined` throws the same error.
        9. Loop variable is `const`: assigning to it inside the body throws (depends on AssignmentExpression task; if not landed, skip this case with a TODO comment).
       10. Budget: a million-element array iteration is capped by `maxSteps`.

      Conventional commit: `feat(agent-script): evaluate ForOfStatement`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-while-statement
    title: Add WhileStatement handler
    prompt: |
      `WhileStatement` has no handler in
      `packages/agent-script/src/interp/interpreter.ts`.

      Add `evaluateWhileStatement`. Re-evaluate `node.test` each
      iteration, coerce to boolean, evaluate `node.body` on truthy.
      Wire `break` and `continue` signals (reuse the mechanism from
      `add-for-of-statement` if landed first; if not, build it here).
      Re-evaluate the test after each body execution. Charge budget
      per iteration so the existing `maxSteps` budget catches infinite
      loops.

      Edge-case tests:
        1. Counter loop terminating on `<` (requires BinaryExpression + AssignmentExpression — see notes).
        2. `while (false) { ... }` body never runs.
        3. `break` exits the loop after first iteration; observable state matches.
        4. `continue` jumps to the next test evaluation.
        5. `return` inside body exits the enclosing arrow.
        6. `throw` inside body propagates.
        7. Infinite loop (`while (true) {}`) caps at `maxSteps` with `SandboxError`/`budgetExceeded`.
        8. Truthiness: `while (1)` is truthy; `while (0)` exits immediately; `while ("")` exits immediately.

      Conventional commit: `feat(agent-script): evaluate WhileStatement`.
    status:
      implement: done
      test: done
      commit: done

  - id: add-for-statement
    title: Add C-style ForStatement handler
    prompt: |
      No handler for `ForStatement` in
      `packages/agent-script/src/interp/interpreter.ts`. The README
      already lists `for` in the allowed-syntax table.

      Add `evaluateForStatement`. Evaluate `init` (a
      `VariableDeclaration` or expression) in a child scope, then loop:
      evaluate `test` (truthy continues, falsy exits, missing test
      always continues), evaluate `body`, evaluate `update`. Honor
      `break`/`continue`. Charge budget per iteration.

      This handler depends on `AssignmentExpression` for the `update`
      slot in the common `i = i + 1` shape; the trailing `i++` is not
      part of the subset. If `AssignmentExpression` hasn't landed yet,
      mutate via a recursive-style alternative test (e.g. count down
      from an inlined literal range).

      Edge-case tests:
        1. `for (let i = 0; i < 3; i = i + 1) { ... }` runs body 3 times.
        2. `for (let i = 0; ; i = i + 1) { if (i >= 2) break; }` runs 2 iterations.
        3. Missing `init`: `for (; cond; update)` works.
        4. Missing `update`: `for (let i = 0; cond;)` works with body mutation.
        5. Missing all three: `for (;;) { break; }` runs once and exits.
        6. `break` exits.
        7. `continue` skips body code but evaluates `update` and re-tests.
        8. `throw` inside body propagates.
        9. Variables declared in `init` are scoped to the loop — accessing them outside throws unbound.

      Conventional commit: `feat(agent-script): evaluate ForStatement`.
    status:
      implement: done
      test: done
      commit: open

  - id: add-assignment-expression
    title: Add AssignmentExpression handler for `let` rebinds
    prompt: |
      `packages/agent-script/src/interp/interpreter.ts` has no
      `AssignmentExpression` handler. The subset already allows `let`
      declarations, but rebinding (`x = 5` after `let x = 1`) crashes
      with `UNSUPPORTED_NODE`. This forces every script into recursive
      style.

      Add `evaluateAssignmentExpression`. Support targets that resolve
      to a `let` binding in scope. Reject `const` targets with a clear
      sandbox error (`"Cannot assign to const 'x'"`). Reject computed
      and member-target assignments (`obj.x = 1`, `arr[0] = 1`) — the
      sandbox does not model mutable shared object state; throw a
      clear error.

      Operators: `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `**=`, `&=`, `|=`,
      `^=`, `<<=`, `>>=`, `>>>=`, `&&=`, `||=`, `??=`. Compound
      assigns: read current value, compute new, write back. Logical
      compound assigns must short-circuit (do not evaluate right side
      when not needed). `+=` with a string operand follows
      ECMAScript concat semantics.

      Edge-case tests:
        1. `let x = 1; x = 2; return x;` returns 2.
        2. `let x = 1; x += 5; return x;` returns 6.
        3. `let s = "a"; s += "b"; return s;` returns "ab".
        4. Every compound operator yields the correct value over a small input set.
        5. Attempted `const x = 1; x = 2;` throws with the documented message.
        6. Attempted `obj.x = 1;` throws "member-target assignment is not supported".
        7. Attempted `arr[0] = 1;` throws the same.
        8. Compound assign on undeclared identifier throws unbound.
        9. `let x = null; x ??= 5; return x;` returns 5; `let x = 0; x ??= 5; return x;` returns 0.
       10. `let x = 0; x ||= 5; return x;` returns 5; `let x = 1; x ||= throw();` returns 1 (right side never evaluated).
       11. `let x = 1; x &&= 5; return x;` returns 5; `let x = 0; x &&= throw();` returns 0.
       12. Assignment expression evaluates to the new value (`(x = 5) + 1` returns 6 — requires BinaryExpression).

      Conventional commit: `feat(agent-script): evaluate AssignmentExpression`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-known-globals
    title: Teach lint about runtime globals
    prompt: |
      `packages/agent-script/src/lint/rules/AS003.ts` flags every bare
      reference to `String`, `Number`, `Boolean`, `Math`, `Object`,
      `Array`, `JSON`, `console`, `Promise`, `Error`, `TypeError` as
      `Unknown identifier`, even though all of these are pre-bound at
      runtime (see `interp/globals/*.ts` and the snapshot bindings
      dump). README documents them as available globals. Result:
      `String(n).padStart(3, "0")` lints red, runs fine.

      Fix:
      1. Add an `allowedGlobals?: readonly string[]` option to
         `LintOptions` in `packages/agent-script/src/lint/index.ts`
         and the corresponding parameter in `AS003`.
      2. Hardcode a default set inside AS003 that mirrors the runtime
         globals (`String`, `Number`, `Boolean`, `Math`, `Object`,
         `Array`, `JSON`, `console`, `Promise`, `Error`, `TypeError`,
         `Symbol`-no-actually-not, confirm against `interp/globals/`).
         The `allowedGlobals` option augments (not replaces) the
         default.
      3. AS003 identifier resolution: before declaring `Unknown
         identifier`, check the merged set. Keep near-match suggestions
         working (suggest `Math` when the user typed `Maths`).
      4. Pass `allowedGlobals` through from
         `packages/agent-harness/src/loader/run.ts` so harness lint
         calls inherit any host-added globals.

      Edge-case tests (lint/rules/AS003.test.ts):
        1. Bare `String("x")` lints clean with the default set.
        2. Bare `Math.PI` lints clean.
        3. Bare `JSON.stringify({})` lints clean.
        4. `Maths.PI` errors and the near-match message suggests `Math`.
        5. `Unknown.thing` still errors with no suggestion.
        6. Passing `allowedGlobals: ["Custom"]` makes `Custom.x` lint clean.
        7. Local `const String = "foo"` shadows the global — `String("x")` then lints clean against the local binding (no error).
        8. Importing a module named `String` is not affected (modules use their own scope).

      Conventional commit: `feat(agent-script): lint recognizes runtime globals`.
    status:
      implement: open
      test: open
      commit: open

  - id: add-optional-chaining
    title: Support optional chaining (`a?.b`, `a?.()`)
    prompt: |
      The README lists optional chaining as supported but the
      interpreter does not implement it. First confirm the parser
      already emits an `optional` flag on `MemberExpression` and
      `CallExpression` (`packages/agent-script/src/parse/parser.ts`);
      if not, add parse-side support including the `?.` token.

      Interpreter changes in
      `packages/agent-script/src/interp/interpreter.ts`:
      - `evaluateMemberExpression`: if `node.optional === true` and
        the object resolves to `null` or `undefined`, short-circuit
        and return `undefined` rather than throwing.
      - `evaluateCallExpression`: same — `fn?.()` returns `undefined`
        when `fn` is `null`/`undefined`; do not invoke.

      Edge-case tests:
        1. `obj?.prop` with `obj = null` returns undefined.
        2. `obj?.prop` with `obj = undefined` returns undefined.
        3. `obj?.prop` with `obj = { prop: 1 }` returns 1.
        4. `fn?.()` with `fn = undefined` returns undefined.
        5. `fn?.()` with `fn = () => 7` returns 7.
        6. Chained `a?.b?.c` short-circuits at the first nullish (does not throw on `.c` of undefined).
        7. Non-nullish falsy values do not short-circuit: `0?.toString()` calls.
        8. Optional access on a property that exists but is undefined returns undefined (no error).

      Conventional commit: `feat(agent-script): support optional chaining`.
    status:
      implement: open
      test: open
      commit: open

  - id: add-spread-object-literal
    title: Support spread in object literals
    prompt: |
      Object spread (`{ ...obj, extra: 1 }`) is documented as allowed.
      Confirm whether `evaluateObjectExpression` in
      `packages/agent-script/src/interp/interpreter.ts` handles
      `SpreadElement` properties; if not, add it.

      For each spread property: evaluate the source; require a sandbox
      object (not array or primitive — throw a clear error
      otherwise); copy own enumerable string-keyed entries onto the
      target. Honor ECMAScript order: later writes (whether literal
      properties or later spreads) overwrite earlier ones.

      Charge `arrayLength` (used here as a property-count proxy) per
      copied property to bound huge-spread DoS.

      Edge-case tests:
        1. `{ ...{} }` returns `{}`.
        2. `{ ...{ a: 1 } }` returns `{ a: 1 }`.
        3. `{ ...{ a: 1 }, b: 2 }` returns `{ a: 1, b: 2 }`.
        4. `{ a: 1, ...{ a: 2 } }` returns `{ a: 2 }` (spread overrides earlier).
        5. `{ ...{ a: 1 }, a: 9 }` returns `{ a: 9 }` (literal after spread overrides).
        6. `{ ...{ a: 1 }, ...{ a: 2 } }` returns `{ a: 2 }` (later spread wins).
        7. Spread of array throws clear error ("cannot spread array into object literal" or similar).
        8. Spread of primitive (string/number/boolean) throws clear error.
        9. Budget: spreading a 10000-property object exceeds `arrayLength` and throws `budgetExceeded`.

      Conventional commit: `feat(agent-script): object spread in literals`.
    status:
      implement: open
      test: open
      commit: open

  - id: add-destructuring-const
    title: Support destructuring in const/let declarations
    prompt: |
      `const { a, b } = obj` and `const [x, y] = arr` are commonly used
      but the interpreter's `evaluateVariableDeclaration` may only
      handle `Identifier` declarator IDs. Confirm the current
      implementation in
      `packages/agent-script/src/interp/interpreter.ts`.

      Extend the declarator path to recognize:
      - `ObjectPattern` with `Property` entries (shorthand and full),
        rest element (`...rest`), and default values (`{ a = 1 } = obj`).
      - `ArrayPattern` with elements (some may be `null` for holes:
        `const [, b] = arr`) and a rest element.

      Evaluate the initializer once, then walk the pattern, declaring
      each leaf identifier in scope with `const`/`let` matching the
      enclosing declaration's kind.

      Reject the pattern when the initializer is not the expected
      shape (object pattern on non-object, array pattern on non-array)
      with a clear sandbox error.

      Edge-case tests:
        1. `const { a, b } = { a: 1, b: 2 }; return a + b;` returns 3.
        2. `const { a: x } = { a: 1 }; return x;` returns 1 (rename).
        3. `const { a = 9 } = {}; return a;` returns 9 (default).
        4. `const { a = 9 } = { a: undefined }; return a;` returns 9 (undefined triggers default).
        5. `const { a = 9 } = { a: null }; return a;` returns null (null does NOT trigger default — JS semantics).
        6. `const { a, ...rest } = { a: 1, b: 2, c: 3 }; return rest;` returns `{ b: 2, c: 3 }`.
        7. `const [x, y] = [1, 2]; return x + y;` returns 3.
        8. `const [, b] = [1, 2]; return b;` returns 2 (hole).
        9. `const [x, ...rest] = [1, 2, 3]; return rest;` returns `[2, 3]`.
       10. `const { a } = null;` throws clearly.
       11. `const [x] = null;` throws clearly.
       12. `let { a } = { a: 1 }; a = 2; return a;` returns 2 (let kind propagates; needs AssignmentExpression).
       13. Nested: `const { a: { b } } = { a: { b: 7 } }; return b;` returns 7.

      Conventional commit: `feat(agent-script): destructuring in declarations`.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-cli-runs-default
    title: Make `poe-agent-script` actually execute user scripts
    prompt: |
      `packages/agent-script/src/cli.ts` and `example-runner.ts`
      together provide `npx poe-agent-script <file>`. The README's
      quickstart example (`npx poe-agent-script examples/pipeline.md`)
      implies a general-purpose runner. It is not:
      `example-runner.ts` dispatches by frontmatter `kind:` to one of
      three hardcoded shapes (`runPipelineExample`,
      `runSuperintendentExample`, `runExperimentExample`). The user's
      exported default function in the markdown's `js` fenced block is
      ignored.

      Replace the dispatch-by-kind logic with execution of the user's
      script source:
      1. Read the markdown. Split frontmatter via `splitFrontmatter`.
         Extract the first `js` fenced block via `extractBlock`.
      2. Lint the extracted source with the example runtime's module
         registry (`agent`, `git`, `harness`, `log`, `metric`, `fail`)
         and `allowedExportNames: ["schema"]`. Error clearly on lint
         failure.
      3. Run via `run()` with the example runtime — `agent.spawn`
         continues to be the stub returning a canned summary, so the
         CLI remains zero-cost.
      4. Print the result envelope.

      Keep the three hardcoded demo shapes as fallbacks invoked only
      when the markdown has no `js` fenced block. Document this
      fallback in `--help`.

      Update README in the same commit: clarify what
      `npx poe-agent-script` does (lints + runs against stub agents)
      and how it differs from `poe-code harness run` (lints + runs
      against real agents).

      Edge-case tests (cli.test.ts):
        1. Markdown with a `js` block that returns `42` exits 0 and prints `{"ok":true,"returnValue":42}` on stdout.
        2. Markdown with a `js` block that throws prints the error and exits non-zero.
        3. Markdown with no `js` block but `kind: pipeline-demo` still runs the bundled pipeline shape (backwards-compat).
        4. Markdown with no `js` block and an unknown `kind:` exits non-zero with a clear error.
        5. Markdown with a `js` block that fails lint exits non-zero before any run.
        6. `--help` mentions both modes (user-script and demo).

      Conventional commit: `feat(agent-script): cli runs user script`.
    status:
      implement: open
      test: open
      commit: open

  - id: harness-run-resume
    title: Wire `--snapshot-path` and `--resume` into `harness run`
    prompt: |
      `runHarnessPair` in
      `packages/agent-harness/src/loader/run.ts` accepts `snapshotPath`
      and resumes from disk via `restore()` on sourceHash match, but
      `poe-code harness run` (`src/cli/commands/harness.ts:95-102`)
      never passes it through. The whole run is wrapped in one
      `withSpinner` call; a crash or Ctrl-C wipes hours of progress.

      Add two flags to `harness run` in `src/cli/commands/harness.ts`:
      - `--snapshot-path <path>` — file to write/read snapshots. Default:
        `.poe-code/harnesses/<basename>/snapshot.json` (computed from
        `mdPath`).
      - `--resume` — boolean. When set and the snapshot file exists,
        validate `sourceHash`; on match, resume; on mismatch, error
        with a clear message explaining the script was edited.

      Pass `snapshotPath` through to `runHarnessPair`. The existing
      lock acquisition handles concurrent invocations.

      Show progress in the spinner using a best-effort step counter
      read from yielded snapshots.

      Edge-case tests (harness-command.test.ts or harness.test.ts):
        1. Run a fake harness with `--snapshot-path <tmp>`; confirm a snapshot file appears mid-run.
        2. Interrupt the run; re-invoke with `--resume`; confirm continuation.
        3. Edit the .ajs between runs, re-invoke with `--resume` → fails with the "source changed" message.
        4. `--resume` without an existing snapshot starts fresh (no error).
        5. Default snapshot path (no flag passed) writes under `.poe-code/harnesses/<basename>/snapshot.json`.
        6. Two concurrent invocations with the same snapshot path: second errors with the existing lock message.

      Conventional commit: `feat(harness): resume from snapshot path`.
    status:
      implement: open
      test: open
      commit: open

  - id: schema-initializer-outer-consts
    title: Schema initializer error message names the constraint
    prompt: |
      `packages/agent-harness/src/loader/extract-schema.ts:43`
      evaluates the `schema` initializer in a fresh sandbox with only
      the `schema` import in scope. Any reference to an outer const
      declared earlier in the same `.ajs` file (e.g. a shared
      `AgentSchema = S.Object({...})`) fails with a generic
      "unbound identifier" error, leaving the user to guess.

      Fix the user-facing error. When `evaluateSchemaInitializer`
      fails with an `UNBOUND_IDENTIFIER` referencing a name declared
      earlier in the .ajs source (detect by scanning the AST for prior
      `const`/`let` declarators ahead of the schema export), wrap the
      thrown error with:

        "Failed to evaluate schema initializer in <path>: schema
         initializer is evaluated in isolation; outer const '<name>'
         is not in scope. Inline the value or move it into the schema
         literal."

      Other unbound identifiers retain their original message.

      Edge-case tests (loader/extract-schema.test.ts — create if missing):
        1. .ajs with `const Inner = S.String();` then
           `export const schema = S.Object({ a: Inner });` fails with the new explanatory message naming `Inner`.
        2. .ajs with a typo (`export const schema = S.Object({ a: Nopee });`) keeps the original UNBOUND message naming `Nopee`.
        3. .ajs without any outer const but with a referenced identifier in scope through imports still works.
        4. .ajs with multiple outer consts referenced from the schema lists the first one in the error.

      Conventional commit: `fix(agent-harness): clearer schema-init error`.
    status:
      implement: open
      test: open
      commit: open

  - id: principles-prompt-helper
    title: Helper to fold frontmatter principles into prompts
    prompt: |
      Harness frontmatter often declares cross-cutting constraints
      (e.g. `principles: ["Cloudflare only", "REST only", ...]`) that
      every spawned agent should honor. Today these are validated by
      schema, made available as `frontmatter.principles`, then almost
      always forgotten — `spawn(agent, { prompt })` has no automatic
      route to them.

      Add a helper to the `harness` host module
      (`packages/agent-script/src/modules/harness.ts`):

        `harness.applyConstraints(prompt: string): string`

      Behavior: if frontmatter has a `principles` (or `constraints`)
      array of strings, prepend:

        "CONSTRAINTS (hard rules, honor all):
         - <p1>
         - <p2>

         <original prompt>"

      Absent or empty → unchanged. `applyConstraints` closes over the
      validated frontmatter.

      Update `makeHarnessModule` and the lint module declaration so
      the helper is reachable. Document in the README's "Built-in
      host modules" → `harness` row.

      Edge-case tests (modules/harness.test.ts):
        1. With `principles: ["a", "b"]`, applyConstraints prepends both as bullets.
        2. With `principles: []`, returns prompt unchanged.
        3. With no principles field, returns prompt unchanged.
        4. With `constraints` instead of `principles`, same effect.
        5. With both `principles` and `constraints`, both are merged (principles first) and de-duplicated.
        6. With non-string array entries, throws "constraints/principles must be strings".
        7. Empty prompt + principles → preamble only (no trailing whitespace before EOF).

      Conventional commit: `feat(agent-script): harness.applyConstraints helper`.
    status:
      implement: open
      test: open
      commit: open

  - id: agent-script-skill-template
    title: Add a SKILL_agent-script.md template
    prompt: |
      The user has hit several authoring pitfalls writing harness
      pairs: which subset of JS is actually supported by the
      interpreter (separate from what lint allows), the .md/.ajs pair
      layout, the schema initializer isolation constraint, the
      difference between `npx poe-agent-script` (stub) and
      `poe-code harness run` (real), how to lint locally, and how to
      pass principles into agent prompts. We need a skill that
      teaches future Claude/codex sessions how to build a harness
      without re-discovering these.

      Add `packages/agent-script/src/templates/skill/SKILL_agent-script.md`
      (create the `templates/skill/` directory if absent). Frontmatter:

        ---
        name: poe-code-agent-script
        description: 'Author agent-script harness pairs (.md/.ajs) for poe-code harness run. Triggers on: agent-script, write a harness, .ajs, harness pair.'
        ---

      Body: ~120 lines, dense, no fluff. Cover, in order:
      1. What runs the script: `poe-code harness run <path>` reads a
         `.md` + `.ajs` pair, validates frontmatter against the .ajs
         schema, lints the .ajs source, then executes the default
         export with real agent spawns. `npx poe-agent-script` is a
         stub that uses canned agent responses for dry runs.
      2. Pair layout — what goes in the .md (frontmatter only, prose
         allowed) vs. the .ajs (imports, exported schema, exported
         default async function).
      3. The supported JS subset (post-fix): arrow functions,
         async/await, const/let, destructuring, spread, optional
         chaining, nullish coalescing, template literals, binary &
         logical & conditional operators, if/else, for/for-of/while,
         try/catch/finally, throw, return. Not supported: regex
         literals, classes, `new`, `this`, `var`, generators,
         do…while, switch, labels, mutable member-target assignment.
      4. Schema initializer constraint: evaluated in isolation, no
         outer-const references. Inline shared shapes.
      5. Common pitfalls: bare `String(x)` / `Math.PI` (now lint-clean
         after lint-known-globals; document the older behavior), no
         regex args to String#split/replace, async arrows can't close
         over outer `let` (still true), `for…of` only on arrays.
      6. Local validation workflow: `npx poe-agent-script
         <path>` to dry-run before paying for real spawns.
      7. Snapshot/resume: pass `--snapshot-path` and `--resume` to
         `poe-code harness run` for long runs.
      8. Constraint propagation: declare `principles: [...]` in
         frontmatter, then call
         `harness.applyConstraints(promptString)` inside the .ajs
         before each `spawn`.
      9. Template — the SKILL must include a complete copy-paste-ready
         pair example (~30 lines total) demonstrating: schema with
         one agent, a default function with an if/early-return and a
         for-of over a frontmatter array, principles propagation, and
         a final return value.

      Edge-case tests are not applicable to a docs skill, but:
        1. Confirm the file lints clean as Markdown (the repo's
           markdown linter, if any).
        2. Confirm the YAML frontmatter parses via the same loader
           used by sync-skills (run `npm run sync-skills --dry-run` if
           that flag exists; otherwise dry-run by reading the script
           in scripts/sync-skills.ts).

      Conventional commit: `docs(agent-script): author skill`.
    status:
      implement: open
      commit: open

  - id: skill-auto-install
    title: Auto-install skills on `npm install`
    prompt: |
      Skill templates under `**/SKILL_*.md` are synced into user
      skill directories via `npm run sync-skills` (see
      `scripts/sync-skills.ts`). Today this is manual — fresh clones
      don't get the skills until someone runs the script.

      Add a `postinstall` script in the root `package.json` that runs
      `npm run sync-skills`. Guard it so it does not run in CI when
      `CI=1` (or when `SKIP_SYNC_SKILLS=1` is set) to avoid surprising
      side effects in automated environments — sync-skills writes
      into `~/.claude/skills/` and similar, which is a user-scoped
      side effect, not a build artifact.

      Update the root README's "Getting started" / "Development"
      section (whatever the repo uses) to mention that skills install
      automatically on `npm install` and document `SKIP_SYNC_SKILLS=1`
      as the opt-out.

      Test: in a temp directory simulating a fresh clone, run
      `npm install` with a stub `~/.claude` HOME and confirm the
      skill files land in the expected paths. This may require a
      small integration test under `scripts/sync-skills.test.ts` or
      similar; use the existing test layout for sync-skills as a
      pattern.

      Edge-case tests:
        1. With `CI=1` set, postinstall is a no-op (no file writes).
        2. With `SKIP_SYNC_SKILLS=1` set, postinstall is a no-op.
        3. Without those env vars, postinstall writes the expected skill files.
        4. Re-running `npm install` is idempotent (no error on existing files; either skip or overwrite with same content).
        5. Postinstall failure (e.g. sync-skills script crashes) does not break `npm install` — log a warning and continue. (Verify the script's existing error handling supports this.)

      Conventional commit: `chore: install skills on npm install`.
    status:
      implement: open
      test: open
      commit: open

  - id: readme-sync
    title: Sync agent-script README with the actual implementation
    prompt: |
      Once the interpreter handlers (BinaryExpression, IfStatement,
      LogicalExpression, ConditionalExpression, TemplateLiteral,
      ForOfStatement, WhileStatement, ForStatement,
      AssignmentExpression, optional chaining, object spread,
      destructuring) and the lint globals fix have landed, audit
      `packages/agent-script/README.md` end-to-end:

      - Verify every entry in the "Allowed" syntax table actually
        works (write a tiny demo .ajs that uses each, run it via
        `npx poe-agent-script`).
      - Verify every "Built-in globals" entry lints clean AND runs.
      - Remove any "what's not here yet" entries that have since
        been implemented.
      - Add new "what's not here yet" entries for items still gated
        (regex, do…while, switch, generators, member-target
        assignment) so future readers don't get the same surprise
        the user did.
      - Update the "Quick start" example to use optional chaining,
        template literals, and destructuring — they're all valid
        after this plan.
      - Add a short "Lint vs. runtime" note: what lint options the
        harness CLI sets by default, and how to mirror them from
        external tooling.

      No new tests; docs-only commit. Run any markdown linter the
      repo enforces.

      Conventional commit: `docs(agent-script): sync README with runtime`.
    status:
      implement: open
      commit: open

  - id: example-coverage-harness
    title: Add an end-to-end harness exercising the fixed subset
    prompt: |
      Add a self-contained example harness pair under
      `packages/agent-harness/src/templates/coverage-demo/`:

      - `coverage-demo.md` with minimal frontmatter
        (`kind: coverage-demo`, `version: 1`, no agents).
      - `coverage-demo.ajs` exporting a `schema` validating the
        frontmatter and a `default` async function that exercises:
        if/else if/else, for-of, while, a C-style for, optional
        chaining, template literals, ternary, nullish coalescing,
        object spread, array and object destructuring, `let` rebind,
        logical short-circuit, and a binary-expression-driven
        comparison.
      - The function must return a deterministic JSON-able value
        without any agent spawns so CI runs cost nothing.

      Register the template alongside others via
      `packages/agent-harness/scripts/copy-templates.mjs` (or the
      actual sync mechanism — confirm in the package).

      Add a test that runs the coverage template via `runHarnessPair`
      with a stub agent module and asserts the deterministic return
      value. This becomes the regression net.

      Edge-case tests (just the deterministic assertion is enough,
      but also include):
        1. Running the template returns a stable, exact value (no
           wall-clock or random dependence).
        2. Editing the .ajs and re-running with a saved snapshot
           rejects the snapshot (sourceHash mismatch).
        3. Lint passes on the .ajs.

      Conventional commit: `test(agent-harness): coverage-demo template`.
    status:
      implement: open
      test: open
      commit: open
---

# Agent-script runtime gaps and language polish

Discovered while trying to drive a 285-spawn autonomous codex loop with `poe-code harness run` over a `.md`/`.ajs` pair: the interpreter's dispatch table is far thinner than the README claims, the linter does not know about runtime globals, the `poe-agent-script` CLI is misleadingly named for a stub that ignores user scripts, `harness run` cannot resume, and the schema initializer has a sharp edge that surfaces as a generic unbound-identifier error.

## Failure modes observed

- `IfStatement` → `UNSUPPORTED_NODE` at runtime even though lint accepts it.
- `i + 1`, `i >= n`, `${x}`, `a ? b : c`, `a && b`, `for (const x of arr)`, `while`, `for (...)`, `let x; x = …` — all the same: parser-accepted, lint-accepted, runtime-crashing.
- `String(i).padStart(3, "0")` lints red, runs fine.
- `npx poe-agent-script myscript.md` ignores the user's exported default and dispatches to one of three hardcoded shapes by `kind:`.
- A 285-spawn run via `poe-code harness run` is non-resumable; one Ctrl-C wipes hours.
- A schema initializer referencing a shared outer `const AgentSchema = S.Object(...)` fails with a generic unbound-identifier error instead of explaining the isolation constraint.

## Strategy

Land every interpreter handler as a single-purpose task with focused edge-case tests. Most are independent. Where there is a genuine dependency (`ForStatement` is hard to test without `AssignmentExpression`), the task notes it but is still independently committable. `readme-sync`, `example-coverage-harness`, and the skill tasks come last as integration steps.

No `--no-verify`, no skipping hooks. Each task lands its own commit with tests.

## Out of scope

- `do…while`, `switch`, labels, generators, regex literals — explicitly disallowed by the original design ([08-js-subset-sandbox.md](08-js-subset-sandbox.md)).
- Mutable object/array properties (`obj.x = 1`, `arr[0] = 1`) — sandbox does not model mutable shared state. AssignmentExpression rejects member-target assigns.
- Full iteration protocol (`Symbol.iterator`, generators) — `for…of` over arrays only.
