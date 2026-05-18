---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: tokenizer-unicode-escapes
    title: Tokenizer — unicode escapes in identifiers and strings
    prompt: "Harden the agent-script tokenizer

      (`packages/agent-script/src/parse/tokenizer.ts`) against unicode

      escape edge cases. Land tests first in

      `parse/tokenizer.test.ts`; fix the tokenizer for any case that

      doesn't already match V8 behavior.


      Tests:

      \  1. `ABC` parses as identifier `ABC` (escape at start).

      \  2. `foo` parses as identifier `foo` (escape mid-id).

      \  3. `\\u{1F600}` in identifier position — error (not an IdentifierStart
      per spec for emoji).

      \  4. `\\u{61}` (extended form) parses as `a`.

      \  5. `\\u00` in a string — clear \"invalid unicode escape\" error
      pointing at the escape, not EOF.

      \  6. `\"\0\"` produces a single-char string with code point 0.

      \  7. `\"😀\"` — surrogate pair → \"😀\" (one code point in string value).

      \  8. `\"\\uD83D\"` lone high surrogate — preserved as-is (no error;
      matches V8 lenient mode).

      \  9. `\\u{110000}` (above max code point) — error span covers the brace
      contents.

      \ 10. `\\u{}` empty braces — clear error.


      Conventional commit: `fix(agent-script): tokenizer unicode escape
      edges`.\n"
    status:
      implement: done
      test: done
      commit: done

  - id: tokenizer-numeric-literals
    title: Tokenizer — numeric literal edges
    prompt: |
      Numeric literal coverage in
      `packages/agent-script/src/parse/tokenizer.ts`. Tests in
      `parse/tokenizer.test.ts`; fix any divergence from JS spec.

      Tests:
        1. `1_000_000` — numeric separators, value 1000000.
        2. `1__000` (double underscore) — error.
        3. `1_` (trailing underscore) — error.
        4. `_1` — parses as identifier, not numeric.
        5. `0x1F` / `0X1F` — hex, value 31.
        6. `0o17` / `0O17` — octal, value 15.
        7. `0b1010` / `0B1010` — binary, value 10.
        8. Legacy octal `017` — error (strict mode only; document choice).
        9. `1e3`, `1E3`, `1e+3`, `1e-3` — exponent forms.
       10. `1e` (missing exponent digits) — error.
       11. `.5`, `5.`, `5.5e2` — decimal forms.
       12. `1n` BigInt literal — explicit error "BigInt not supported".
       13. `0xFFFFFFFFFFFFFFFF` — number outside safe-int range, parses to closest IEEE double; no silent BigInt promotion.
       14. Number immediately followed by identifier `1abc` — error "invalid number".

      Conventional commit: `fix(agent-script): tokenizer numeric edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: tokenizer-strings-templates
    title: Tokenizer — strings, templates, escape edges
    prompt: |
      String and template literal edges in
      `packages/agent-script/src/parse/tokenizer.ts` and
      `parse/tokenizer.test.ts`.

      Tests:
        1. `'\n'` → newline; `"\n"` → newline; `` `\n` `` → newline (cooked).
        2. Raw quasi of `` `\n` `` is the two characters `\` and `n`.
        3. `'\x4A'` → "J"; `'\x'` → error; `'\x4'` → error (incomplete hex).
        4. `'\0'` → NUL; `'\0a'` (non-digit after) → NUL+"a"; `'\01'` (legacy octal) → error.
        5. `"a\` (line continuation via backslash-newline) → "a" (continuation eats LF).
        6. Unterminated string at EOF — error with span at the opening quote.
        7. Template `` `${1 + `nested`}` `` — nested template tokenizes correctly.
        8. Template with unclosed `${` at EOF — error with span at the `${`.
        9. Template raw contains `\$` and `\` `` ` `` — preserved literally in raw, cooked drops backslashes.
       10. CRLF inside a template literal — quasi value normalizes to LF (spec behavior); raw preserves CRLF.
       11. String with U+2028/U+2029 inside — allowed (since ES2019).

      Conventional commit: `fix(agent-script): tokenizer string/template edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: tokenizer-comments-line-endings
    title: Tokenizer — comments and mixed line endings
    prompt: |
      Comment and line-ending handling in
      `packages/agent-script/src/parse/tokenizer.ts`.

      Tests:
        1. `// comment\nx` — line comment ends at LF; next token is `x` on line 2.
        2. `// comment\r\nx` — CRLF; `x` on line 2; column 0.
        3. `// comment` at EOF (no trailing newline) — terminates comment.
        4. `/* a /* b */ c */` — block comments do NOT nest in JS; outer ends at first `*/`; `c */` is a syntax error.
        5. `/* unterminated` at EOF — clear error with span at opening `/*`.
        6. Mixed CRLF and LF in the same source — both advance line by 1.
        7. `<!--` and `-->` HTML-style comments — error (we're not Browser-ES; document choice).
        8. Comment containing `*/` inside a string literal inside a comment — no, comments don't tokenize strings; the next `*/` ends the comment.
        9. Comment span line/column reported correctly in error formatting.

      Conventional commit: `fix(agent-script): tokenizer comment & line ending edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parser-destructuring-edges
    title: Parser — destructuring pattern edges
    prompt: |
      Destructuring edge cases in
      `packages/agent-script/src/parse/parser.ts` and matching tests in
      `parse/parser.test.ts`. Some patterns are invalid; the parser
      must emit a clear error with the offending span — not silently
      accept.

      Tests:
        1. `const {} = obj;` — valid (empty object pattern).
        2. `const [] = arr;` — valid (empty array pattern).
        3. `const { a, ...rest, b } = obj;` — error: rest must be last.
        4. `const { ...a, ...b } = obj;` — error: only one rest.
        5. `const [...rest, last] = arr;` — error: rest must be last in array pattern too.
        6. `const [a, , c] = arr;` — array holes valid; middle element is elided.
        7. `const [, , c] = arr;` — leading holes valid.
        8. `const { a: { b: { c } } } = x;` — deep nested object pattern.
        9. `const { [key]: value } = obj;` — computed property in pattern.
       10. `const { [a + b]: value } = obj;` — computed with expression.
       11. `const { a = 1, b = a } = obj;` — default referencing prior binding (right-to-left eval order).
       12. `const { a: { b } = {} } = obj;` — default for nested pattern.
       13. `const [a = 1, b = 2] = arr;` — array with defaults.
       14. `const { 0: first, 1: second } = arr;` — numeric keys in object pattern over array.
       15. `({ a } = obj);` — top-level expression-statement object pattern requires parens.

      Conventional commit: `fix(agent-script): parser destructuring edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parser-arrow-function-edges
    title: Parser — arrow function syntactic edges
    prompt: |
      Arrow function parsing in
      `packages/agent-script/src/parse/parser.ts`.

      Tests:
        1. `() => 1` — zero-arg, concise body.
        2. `x => x` — single param, no parens.
        3. `(x) => x` — single param, parens.
        4. `(x,) => x` — trailing comma in params.
        5. `(x = 1) => x` — default param.
        6. `(...rest) => rest` — rest param.
        7. `(a, b, ...rest) => rest` — mixed.
        8. `({ a, b }) => a + b` — destructuring param.
        9. `([a, b]) => a + b` — array destructuring param.
       10. `async (x) => x` — async marker.
       11. `async x => x` — async with single bare param.
       12. `async => x` — should parse as arrow with single param named `async`; verify and document.
       13. `() => {}` — empty block body returns undefined.
       14. `() => ({ a: 1 })` — parenthesized object body.
       15. `() => { return; }` — return with no value.
       16. Async arrow body containing `await` outside async — error.
       17. Newline between params and `=>` — error (no-line-terminator restriction).

      Conventional commit: `fix(agent-script): parser arrow function edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parser-statement-edges
    title: Parser — statement and recovery edges
    prompt: |
      Statement-level parsing edges in
      `packages/agent-script/src/parse/parser.ts`.

      Tests:
        1. `;;;` — three empty statements.
        2. `for (;;) {}` — empty init/test/update.
        3. `for (const x of arr) {}` — for-of.
        4. `for (const x in obj) {}` — for-in (decide whether supported; if not, clear error).
        5. `if (a) b; else c;` — single-statement bodies.
        6. `if (a) if (b) c; else d;` — dangling else binds to nearest if.
        7. `try { a; } catch { b; }` — optional catch binding.
        8. `try { a; } catch (e) { b; }` — named catch binding.
        9. `try { a; } finally { b; }` — finally only.
       10. `try { a; }` — error: try must have catch or finally.
       11. `break;` outside any loop — parse error (or interpreter error; pick one and document).
       12. `continue;` outside any loop — same as above.
       13. `return;` at top level of module — error.
       14. `return 1;` inside an arrow body — valid.
       15. Stray `}` — error at the brace, not at EOF.
       16. Two declarations colliding (`const a = 1; const a = 2;`) — error at second.
       17. Unterminated block `{ a;` — error span at the opening brace.

      Conventional commit: `fix(agent-script): parser statement edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parser-expression-precedence
    title: Parser — expression precedence and associativity
    prompt: |
      Precedence and associativity in
      `packages/agent-script/src/parse/parser.ts`.

      Tests:
        1. `2 + 3 * 4` parses as `2 + (3 * 4)`.
        2. `2 ** 3 ** 2` is right-associative → 2 ** 9.
        3. `-2 ** 2` — error: ambiguous; spec requires parens. Either `(-2) ** 2` or `-(2 ** 2)` must be written.
        4. `a ?? b || c` — error: mixing ?? with || requires parens.
        5. `a ?? b ?? c` — left-associative, valid.
        6. `a || b && c` parses as `a || (b && c)`.
        7. `a ? b : c ? d : e` parses as `a ? b : (c ? d : e)`.
        8. `a = b = c` parses right-associative.
        9. `++a++` — error (post-increment of pre-increment).
       10. `!a++` parses as `!(a++)`.
       11. `typeof a + b` parses as `(typeof a) + b`.
       12. `void 0` returns undefined.
       13. `delete a.b` — supported on sandbox objects (verify behavior or error if not supported).
       14. `a, b, c` — sequence expression in expression-statement.
       15. `for (let i = 0, j = 0; i < n; i++, j++)` — comma in for-update.

      Conventional commit: `fix(agent-script): parser precedence edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parse-error-format-edges
    title: parse/format-error — context formatting edges
    prompt: |
      Error formatting in
      `packages/agent-script/src/parse/format-error.ts` and tests in
      `parse/format-error.test.ts`. Goal: the rendered excerpt is
      readable for every source shape.

      Tests:
        1. Error at line 1 column 1 — context window starts at the file.
        2. Error at last line, no trailing newline — excerpt includes the line; caret aligns.
        3. Error on line 100 — gutter padding handles 3-digit numbers.
        4. Error on line 9999 — 4-digit padding works.
        5. Source has tab characters before the error column — caret aligns under the actual visual column, not the byte column.
        6. Source has full-width unicode (CJK) before the error — caret position uses character index, document any visual misalignment.
        7. Source is empty — error renders without panicking.
        8. Source is one very long line (10k chars) — excerpt truncates with ellipsis around the error column.
        9. Error span covers multiple lines — render shows all spanned lines with a contiguous caret rule.
       10. CRLF source — caret column matches LF-normalized column.

      Conventional commit: `fix(agent-script): parse/format-error excerpt edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parse-hash-semantic-equivalence
    title: parse/hash — semantic-equivalence edges
    prompt: |
      The hash in `packages/agent-script/src/parse/hash.ts` is used to
      detect whether a snapshot's source is compatible. It must hash
      semantic equivalence, ignoring formatting. Tests in
      `parse/hash.test.ts`.

      Tests:
        1. Whitespace difference → same hash.
        2. Comment added/removed → same hash.
        3. `0x10` vs `16` vs `0o20` vs `0b10000` → same hash (numeric value).
        4. `1_000` vs `1000` → same hash.
        5. `1e3` vs `1000` → same hash.
        6. `1.0` vs `1` → same hash.
        7. `0` vs `-0` → DIFFERENT hash (semantic difference).
        8. `'a' + 'b'` vs `"a" + "b"` → same hash (quote style ignored).
        9. Identifier renamed (`a` → `b`) → DIFFERENT hash.
       10. Reordered object keys `{a: 1, b: 2}` vs `{b: 2, a: 1}` → DIFFERENT hash (order matters in JS for enumeration).
       11. Trailing comma added → same hash.
       12. Semicolon added at ASI boundary → same hash.
       13. Template `` `${a}` `` vs `String(a)` → DIFFERENT hash (different AST).

      Conventional commit: `fix(agent-script): parse/hash semantic edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parse-assign-ids-determinism
    title: parse/assign-ids — determinism and stability
    prompt: |
      Node IDs from
      `packages/agent-script/src/parse/assign-ids.ts` are persisted in
      snapshots; they must be deterministic and stable.

      Tests:
        1. Two parses of the same source produce identical ID sequences.
        2. Adding a comment does NOT shift IDs of unrelated nodes (comments are not in the AST).
        3. Reformatting whitespace does NOT shift IDs.
        4. Adding a statement at the end appends new IDs without renumbering prior nodes.
        5. Inserting a statement at the beginning renumbers everything after — document this as expected.
        6. Source larger than 10k AST nodes still completes in <100ms.
        7. Pre-existing `nodeId` on input nodes is overwritten (no resilience to stale IDs).
        8. Span/loc fields are preserved untouched.

      Conventional commit: `fix(agent-script): assign-ids determinism`.
    status:
      implement: done
      test: done
      commit: done

  - id: parse-export-edges
    title: parse/parse-export — top-level export edges
    prompt: |
      Top-level export extraction in
      `packages/agent-script/src/parse/parse-export.ts` and
      `parse-export.test.ts`.

      Tests:
        1. `export const handler = () => {}` — handler is found.
        2. `export const schema = {...}` — schema found.
        3. `export default () => {}` — default exported arrow found.
        4. `export const a = 1, b = 2;` — multiple declarators on one export; both surfaced (or clear error if not supported).
        5. `export const { a } = obj;` — destructured export; clear error or supported (document).
        6. `export let x = 1;` — let export; document policy.
        7. `export var x = 1;` — var export; document policy.
        8. `const handler = () => {}; export { handler };` — re-export specifier list; document policy.
        9. Two `export default` statements — error at second.
       10. No exports at all — empty result, no error.
       11. Export inside a nested block — error (top-level only).

      Conventional commit: `fix(agent-script): parse-export edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: parse-import-meta-tests
    title: parse/parse-import-meta — add test coverage
    prompt: |
      `packages/agent-script/src/parse/parse-import-meta.ts` exists
      with NO test file. Add `parse-import-meta.test.ts` with full
      coverage; fix anything that doesn't behave.

      Tests:
        1. `import.meta` evaluates to the configured meta object.
        2. `import.meta.url` accesses the url field.
        3. `import.meta.foo` on an absent field returns undefined.
        4. `import.meta = x` — error (read-only).
        5. `import.meta.x = y` — error or silent (document policy).
        6. Spacing variants (`import . meta`) — error per spec.
        7. `import.meta` inside an arrow body, await body, conditional — works.
        8. Multiple uses of `import.meta` in one file — all evaluate to the same object identity.
        9. `typeof import.meta` returns "object".

      Conventional commit: `test(agent-script): parse-import-meta coverage`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-coercion-comparison
    title: Interpreter — coercion, equality, comparison edges
    prompt: |
      Coercion and comparison edges in
      `packages/agent-script/src/interp/interpreter.ts` with tests in
      `interp/interpreter.test.ts`.

      Tests:
        1. `1 == "1"` → true; `1 === "1"` → false.
        2. `null == undefined` → true; `null === undefined` → false.
        3. `NaN == NaN` → false; `NaN === NaN` → false.
        4. `0 == -0` → true; `0 === -0` → true; `Object.is(0, -0)` → false (if Object.is supported).
        5. `[] == false` → true (deep coercion); `[] === false` → false.
        6. `{} == {}` → false (reference).
        7. `"10" < "9"` → true (lexicographic); `10 < 9` → false.
        8. `null > 0` → false; `null >= 0` → true (coerces to 0).
        9. `undefined < 0` → false; `undefined > 0` → false; `undefined == 0` → false.
       10. `+"abc"` → NaN; `-"abc"` → NaN; `+""` → 0; `+"  "` → 0.
       11. `+null` → 0; `+undefined` → NaN; `+true` → 1; `+false` → 0; `+[]` → 0; `+[1]` → 1; `+[1,2]` → NaN.
       12. `[] + []` → "" (string concat after coercion).
       13. `[] + {}` → "[object Object]".
       14. `"5" - 2` → 3 (numeric coercion); `"5" + 2` → "52" (string concat).
       15. `1 / 0` → Infinity; `-1 / 0` → -Infinity; `0 / 0` → NaN.
       16. `Infinity - Infinity` → NaN.
       17. Bitwise on >2^32 truncates to 32-bit (`0xFFFFFFFF | 0` → -1).

      Conventional commit: `fix(agent-script): interpreter coercion edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-destructuring-runtime
    title: Interpreter — destructuring runtime edges
    prompt: |
      Runtime destructuring in
      `packages/agent-script/src/interp/interpreter.ts`.

      Tests:
        1. `const { a } = null;` — TypeError.
        2. `const { a } = undefined;` — TypeError.
        3. `const [a] = null;` — TypeError.
        4. `const [a] = "ab";` — works; `a === "a"` (strings are iterable).
        5. `const [a, b] = new Set([1, 2]);` — works only if Set supported; otherwise clear error.
        6. `const { a = 1 } = { a: null };` — `a === null` (null does NOT trigger default).
        7. `const { a = 1 } = { a: undefined };` — `a === 1`.
        8. `const { a = 1 } = {};` — `a === 1`.
        9. `const { a: { b } } = { a: null };` — TypeError at inner.
       10. `const [a, b = 2] = [1];` — `b === 2`.
       11. `const [a, b = 2] = [1, undefined];` — `b === 2`.
       12. `const [a, b = 2] = [1, null];` — `b === null`.
       13. `const { a, ...rest } = { a: 1, b: 2, c: 3 };` — rest is `{ b: 2, c: 3 }`.
       14. `const { a, ...rest } = { a: 1 };` — rest is `{}`.
       15. `const [a, ...rest] = [1];` — rest is `[]`.
       16. Iteration of the RHS happens once even with multiple element bindings (only relevant if rest mid-pattern allowed).
       17. Default expression with side effects fires only when binding is undefined.
       18. Default expression can reference prior bindings: `const { a, b = a + 1 } = { a: 1 };` → `b === 2`.

      Conventional commit: `fix(agent-script): destructuring runtime edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-control-flow
    title: Interpreter — control flow edges
    prompt: |
      Control flow in
      `packages/agent-script/src/interp/interpreter.ts`. Builds on the
      existing `try/finally` and `do/while` and `labeled break/continue`
      work in plan 26; this task closes runtime gaps not covered there.

      Tests:
        1. `for (const x of [1,2,3]) { if (x === 2) break; }` — loop exits at 2.
        2. `for (const x of [1,2,3]) { if (x === 2) continue; result.push(x); }` — result is [1, 3].
        3. `while (cond) { try { return 1; } finally { cleanup(); } }` — finally runs, return wins.
        4. `try { for (const x of arr) { if (x) throw new Error(); } } catch (e) {}` — catch catches loop throws.
        5. Re-throwing in catch propagates to outer try.
        6. `try { } catch { } catch { }` — error: only one catch.
        7. Finally that throws replaces the original throw value.
        8. Finally that returns replaces the original return value.
        9. `if (cond) return 1; return 2;` — both branches reachable depending on cond.
       10. Nested `for-of` with iterator that throws on second `.next()` — error propagates after first element.
       11. Break inside switch (if supported) — exits switch only, not the enclosing loop. Document if switch is unsupported.
       12. Return inside a `for-of` does NOT call the iterator's `.return()` method (document this divergence from spec or implement).
       13. Loop body that mutates the array being iterated — behavior matches V8 (new elements visible if pushed before iterator advances).

      Conventional commit: `fix(agent-script): interpreter control flow edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-spread-rest-runtime
    title: Interpreter — spread/rest runtime edges
    prompt: |
      Spread and rest in
      `packages/agent-script/src/interp/interpreter.ts`.

      Tests:
        1. `[...arr]` clones an array; mutating the clone doesn't mutate the source.
        2. `[1, ...[2, 3], 4]` → [1, 2, 3, 4].
        3. `[...null]` — TypeError.
        4. `[..."ab"]` → ["a", "b"].
        5. `{ ...obj }` clones an object's own enumerable keys; prototype keys are NOT copied.
        6. `{ a: 1, ...{ a: 2 } }` → { a: 2 } (later wins).
        7. `{ ...{ a: 2 }, a: 1 }` → { a: 1 } (later wins).
        8. `{ ...null }` → {} (silent skip, not TypeError — matches spec).
        9. `{ ...undefined }` → {}.
       10. `{ ...primitive }` (number, string) → {} or string-indexed keys; verify and document.
       11. `fn(...arr)` with arr having a getter property — getter is not invoked; only iteration is.
       12. Spread of huge iterable triggers budget (`arrayLength`).
       13. Rest param collects remaining args: `(a, ...rest) => rest` called with `(1,2,3)` → rest is [2, 3].
       14. Rest param with 0 remaining args → [].

      Conventional commit: `fix(agent-script): spread/rest runtime edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-call-edges
    title: Interpreter — function call edges
    prompt: |
      Call expression edges in
      `packages/agent-script/src/interp/interpreter.ts`.

      Tests:
        1. Recursive arrow: `const fact = n => n <= 1 ? 1 : n * fact(n - 1)` — fact(5) === 120.
        2. Mutually recursive arrows with hoisting via `let` declarations.
        3. Self-recursive arrow exceeding `maxCallDepth` → `budgetExceeded` with clear cause.
        4. Calling a non-function value (`(1)()`, `null()`, `undefined()`) — TypeError.
        5. `fn?.()` with fn === null → undefined.
        6. `fn?.()` with fn === defined function → result.
        7. `fn(undefined)` with parameter default → default fires.
        8. `fn(null)` with parameter default → null (default does NOT fire).
        9. Passing more args than declared — extras are ignored.
       10. Passing fewer args than declared — missing are undefined; defaults fire for missing.
       11. Calling an arrow that returns the same arrow (Y-combinator shape) — works.
       12. `this` inside an arrow is the enclosing scope's `this` (or undefined for module top-level).
       13. Calling a host function with sandbox-only objects works (deepCopy on arg path).

      Conventional commit: `fix(agent-script): call expression edges`.
    status:
      implement: done
      test: done
      commit: done

  - id: interp-async-microtask
    title: Interpreter async/await — microtask ordering
    prompt: |
      Async/await microtask ordering in
      `packages/agent-script/src/interp/async.ts` and `interp/promise.ts`.
      Currently `async.ts` has minimal test coverage; add a dedicated
      `interp/async.test.ts`.

      Tests:
        1. `await 1` returns 1 (non-promise awaited).
        2. `await Promise.resolve(1)` returns 1.
        3. `await (async () => 1)()` returns 1.
        4. Two parallel awaits resolve in the order their promises settle, not declaration order.
        5. Microtask FIFO: `Promise.resolve().then(a); Promise.resolve().then(b);` — a runs before b.
        6. `await` inside `try` catches a rejected promise via outer catch.
        7. `await Promise.reject(e)` throws e at the await point.
        8. Multiple awaits in a chain each yield to the scheduler.
        9. Async arrow that throws synchronously before its first await — produces a rejected promise.
       10. Async arrow that returns a promise — caller awaits unwrap one level (no double-promise).
       11. Await on a thenable (object with `.then`) — works.
       12. Await on a self-resolving promise (`new Promise(r => r(p))` where p resolves later) — properly chains.

      Conventional commit: `test(agent-script): async/await microtask edges`.
    status:
      implement: done
      test: done
      commit: open

  - id: interp-promise-combinator-edges
    title: Promise combinators — exhaustive edges
    prompt: |
      `packages/agent-script/src/interp/promise.ts` and its test file.

      Tests:
        1. `Promise.all([])` resolves to `[]` synchronously (post-microtask).
        2. `Promise.all([1, 2, Promise.resolve(3)])` → [1, 2, 3].
        3. `Promise.all` with one reject — overall rejects with that reason; other promises still run but their results ignored.
        4. `Promise.all` preserves input order.
        5. `Promise.race([])` returns a forever-pending promise (matches spec).
        6. `Promise.race([Promise.reject(1), Promise.resolve(2)])` — depends on microtask order; matches V8.
        7. `Promise.race` with one synchronous reject — rejects first.
        8. `Promise.allSettled([])` → `[]`.
        9. `Promise.allSettled` returns `{status: "fulfilled", value}` or `{status: "rejected", reason}` per input.
       10. `Promise.any([])` rejects with empty AggregateError.
       11. `Promise.any([reject, reject])` rejects with AggregateError aggregating both reasons.
       12. `Promise.any([reject, resolve])` resolves with the resolved value.
       13. Combinator with non-iterable arg — TypeError.
       14. Combinator with iterator that throws on `.next()` — propagates that throw.
       15. Combinator with a thenable in the array — works.
       16. Same promise instance appearing twice in input — both contribute results.

      Conventional commit: `fix(agent-script): promise combinator edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-cancel-paths
    title: Cancellation — abort signal propagation
    prompt: |
      `packages/agent-script/src/interp/cancel.ts` and its tests.

      Tests:
        1. Pre-aborted signal — first await rejects immediately with the abort reason.
        2. Abort during a long microtask chain — next await yields to abort within one tick.
        3. Abort while a host call is in flight — the host call's promise rejects with the abort reason.
        4. Abort after a promise has already settled — no double-throw; resolved value still returned.
        5. Two awaits in sequence; abort between them — second never starts.
        6. `try { await x; } catch (e) { /* abort error */ }` — caught and inspectable; message identifies abort.
        7. Finally block runs even on abort.
        8. Repeated abort on the same signal is a no-op (no double-listener cleanup issue).
        9. Abort listener cleanup verified by triggering then re-using the runner.
       10. Abort signal AbortError shape matches DOMException conventions where reasonable.

      Conventional commit: `fix(agent-script): cancellation edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-budget-boundaries
    title: Budget — exact-boundary exhaustion
    prompt: |
      `packages/agent-script/src/interp/budget.ts` boundary conditions.

      Tests:
        1. `maxSteps` set to N; a script that visits exactly N nodes succeeds; N+1 throws `budgetExceeded`.
        2. `stringLength` boundary: concatenation producing length == limit succeeds; length+1 throws.
        3. `arrayLength` boundary: array literal of length == limit succeeds; length+1 throws.
        4. `maxCallDepth`: recursion to depth N succeeds; depth N+1 throws.
        5. Deadline already past at start — first step throws with a deadline message.
        6. Deadline reached mid-execution — throws with a deadline message; finally blocks still run.
        7. Two limits crossed in the same step — error message identifies which limit fired (deterministic priority).
        8. Budget reset between runs: same Interpreter instance, two runs; second run starts fresh.
        9. `stringLength` counts character count, not byte count (UTF-16 code units).
       10. `arrayLength` of array literal with spread elements counts post-flattening.
       11. Budget check skipped in error-rendering path — even at budget exhaustion, the rendered error excerpt still produces.

      Conventional commit: `fix(agent-script): budget boundary edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-scope-edges
    title: Scope — chain edges and binding semantics
    prompt: |
      `packages/agent-script/src/interp/scope.ts` and `scope.test.ts`.

      Tests:
        1. Assign to undeclared identifier — ReferenceError (strict mode).
        2. Re-declare `const` in same scope — error at parse time.
        3. Re-declare `let` in same scope — error at parse time.
        4. `let` in child scope shadows outer `let` — child changes don't affect outer.
        5. TDZ: access `let x` before its declaration in the same scope — ReferenceError.
        6. TDZ for `const` likewise.
        7. Closure captures by reference, not value: arrow returned from a loop sees the loop's `let i` per iteration.
        8. 200-deep scope chain lookup completes in <10ms.
        9. Scope with binding named `__proto__` does not leak to Object prototype.
       10. Scope with binding named `constructor` is just a normal binding.
       11. Catch binding is scoped to the catch block, not the try.

      Conventional commit: `fix(agent-script): scope chain edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-values-deepcopy
    title: values/deepCopy — circular and exotic value edges
    prompt: |
      `packages/agent-script/src/interp/values.ts` and `values.test.ts`.

      Tests:
        1. Circular reference: `const a = {}; a.self = a;` — deepCopy returns a structure where the copy's self points to the copy (cycle preserved).
        2. Sibling-shared reference: `const x = {}; const a = { l: x, r: x };` — copy preserves shared identity (l === r).
        3. Array referencing itself: `const a = []; a.push(a);` — copy is self-referencing.
        4. Very deep object (1000 levels) — deepCopy completes without stack overflow OR throws a clear "too deep" error.
        5. Object with non-enumerable property — skipped.
        6. Object with symbol-keyed property — skipped.
        7. Object with getter that throws — throws at copy time with a clear cause.
        8. `Object.create(null)` — copy preserves null prototype.
        9. Array with custom string keys (`const a = []; a.foo = 1;`) — copy includes `foo` (matches Array enumeration).
       10. BigInt value — clear error or pass-through; document.
       11. Date instance — copies as `Date` with same time, or clear error; document.
       12. RegExp instance — copies as `RegExp` with same source/flags, or clear error.
       13. typed array (Uint8Array etc.) — clear error.
       14. Map/Set — clear error.

      Conventional commit: `fix(agent-script): deepCopy edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-exceptions-tests
    title: interp/exceptions — add test coverage
    prompt: |
      `packages/agent-script/src/interp/exceptions.ts` exists with no
      dedicated test file. Create `interp/exceptions.test.ts` and
      cover throw/catch internals end-to-end.

      Tests:
        1. `throw "string"` — caught value === "string" (no auto-wrap to Error).
        2. `throw null` — caught value === null.
        3. `throw undefined` — caught value === undefined.
        4. `throw new Error("msg")` — caught is Error with `.message === "msg"`.
        5. `throw { code: 42 }` — caught is the plain object.
        6. `throw 0` — caught value === 0.
        7. Thrown value with circular self-reference passes through catch unchanged.
        8. Re-throw preserves identity (same object reference).
        9. Throw inside a default-param expression — propagates as if at the call site.
       10. Throw inside an interpolation expression — propagates; tag/template not constructed.
       11. Catch without binding (`catch { ... }`) — block runs, no binding visible.
       12. Nested try: inner throws, outer catches.
       13. Throw across an await boundary — caught at the next await's surrounding try.

      Conventional commit: `test(agent-script): exceptions coverage`.
    status:
      implement: open
      test: open
      commit: open

  - id: interp-host-bridge-edges
    title: host-bridge — argument and result edges
    prompt: |
      `packages/agent-script/src/interp/host-bridge.ts` and its tests.

      Tests:
        1. Host function called with sandbox object — host sees a deep copy.
        2. Host function mutates the deep copy — sandbox value unchanged.
        3. Host function returns an object — sandbox sees a deep copy.
        4. Host function returns the same input object — copy on both sides; identity NOT preserved (document).
        5. Host function returns `undefined` — sandbox sees `undefined`.
        6. Host function returns `null` — sandbox sees `null`.
        7. Host function returns a function — clear error or wraps; document.
        8. Host function throws synchronously — sandbox catches it at the call site.
        9. Host function returns a rejected promise — sandbox sees rejection at the await.
       10. Host call during cancellation — abort signal propagates to host promise.
       11. Host call return triggers `stringLength`/`arrayLength` budget on the returned value.
       12. Host error with no `.message` field — wrapped into a sandbox error with a readable message.
       13. Host error stack is replaced with a sandbox-only stack (no host frames leak).

      Conventional commit: `fix(agent-script): host-bridge edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: globals-json-edges
    title: globals — JSON.parse / JSON.stringify edges
    prompt: |
      `packages/agent-script/src/interp/globals/console-json.ts`.

      Tests:
        1. `JSON.parse('null')` → null.
        2. `JSON.parse('1e308')` → 1e308 (huge number).
        3. `JSON.parse('1e500')` → Infinity (matches V8) or error; document.
        4. `JSON.parse('NaN')` → SyntaxError (NaN not valid JSON).
        5. `JSON.parse('Infinity')` → SyntaxError.
        6. `JSON.parse('{"a":1,}')` — trailing comma → SyntaxError.
        7. `JSON.parse('{a:1}')` — unquoted key → SyntaxError.
        8. `JSON.parse('')` → SyntaxError.
        9. `JSON.parse(0)` → coerces to "0" → SyntaxError (or 0 if coerced). Document.
       10. `JSON.parse('{"__proto__": {"polluted": true}}')` — `__proto__` is set as own property; does not pollute Object.prototype.
       11. `JSON.stringify(undefined)` → undefined (literal undefined return).
       12. `JSON.stringify({a: undefined})` → `'{}'` (key dropped).
       13. `JSON.stringify([undefined])` → `'[null]'`.
       14. `JSON.stringify({a: 1n})` — BigInt → TypeError or skipped; document.
       15. `JSON.stringify(circular)` → TypeError "circular".
       16. `JSON.stringify({a: 1}, null, 2)` — 2-space indent.
       17. `JSON.stringify({a: 1}, null, 100)` — clamps to 10.
       18. `JSON.stringify({a: 1}, replacerFn)` — replacer function support (or clear error if not supported).
       19. `JSON.stringify({toJSON: () => "x"})` → `'"x"'` if toJSON is honored (document policy).
       20. `console.log(undefined, null, NaN, Infinity)` — sink receives them as separate args, formatted readably.

      Conventional commit: `fix(agent-script): JSON edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: globals-error-edges
    title: globals — Error constructor edges
    prompt: |
      `packages/agent-script/src/interp/globals/error.ts`.

      Tests:
        1. `new Error()` — message is "".
        2. `new Error("msg")` — message === "msg".
        3. `new Error(123)` — message === "123" (coerced).
        4. `new Error({a: 1})` — message === "[object Object]" (coerced).
        5. `new Error(null)` — message === "null".
        6. `new TypeError("x")` — `.name === "TypeError"`, instanceof TypeError, instanceof Error.
        7. `Error("msg")` (no `new`) — equivalent to `new Error("msg")`.
        8. Error subclasses (TypeError, RangeError, ReferenceError, SyntaxError) all instanceof Error.
        9. `err instanceof Error` — true.
       10. Error stack is sandbox-only (no host frames).
       11. Error with a property set after construction — preserved.
       12. Error.cause: `new Error("x", { cause: y })` — `.cause === y` (ES2022).
       13. AggregateError (if supported) with errors array.

      Conventional commit: `fix(agent-script): Error edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: globals-math-edges
    title: globals — Math edges
    prompt: |
      `packages/agent-script/src/interp/globals/math.ts`.

      Tests:
        1. `Math.min()` → Infinity; `Math.max()` → -Infinity.
        2. `Math.min(1, NaN, 2)` → NaN.
        3. `Math.max(1, NaN, 2)` → NaN.
        4. `Math.abs(-0)` → 0 (not -0).
        5. `Math.sign(-0)` → -0; `Math.sign(0)` → 0; `Math.sign(NaN)` → NaN.
        6. `Math.floor(-0.5)` → -1; `Math.ceil(-0.5)` → -0.
        7. `Math.round(0.5)` → 1; `Math.round(-0.5)` → -0 (note: not 0).
        8. `Math.round(2.5)` → 3 (banker's rounding NOT used).
        9. `Math.trunc(-1.9)` → -1.
       10. `Math.pow(0, -1)` → Infinity.
       11. `Math.pow(0, 0)` → 1.
       12. `Math.sqrt(-1)` → NaN.
       13. `Math.log(0)` → -Infinity; `Math.log(-1)` → NaN.
       14. `Math.random()` is in [0, 1). 10000 samples are within [0, 1).
       15. Seeded random: same seed yields same sequence; restoring snapshot resumes the sequence.
       16. `Math.PI` and `Math.E` match Number's IEEE 754 values exactly.
       17. `Math.hypot(3, 4)` → 5 (if supported).
       18. `Math.cbrt(-8)` → -2 (if supported).
       19. `Math.log2(8)` → 3; `Math.log10(1000)` → 3.

      Conventional commit: `fix(agent-script): Math edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: globals-object-array-edges
    title: globals — Object / Array static edges
    prompt: |
      `packages/agent-script/src/interp/globals/object-array.ts`.

      Tests:
        1. `Object.keys(null)` → TypeError.
        2. `Object.keys(undefined)` → TypeError.
        3. `Object.keys("ab")` → ["0", "1"] (string indices).
        4. `Object.values({})` → [].
        5. `Object.entries({a:1})` → [["a", 1]].
        6. `Object.fromEntries([["a", 1]])` → `{a: 1}`.
        7. `Object.fromEntries([])` → {}.
        8. `Object.fromEntries(null)` → TypeError.
        9. `Object.fromEntries([["__proto__", 1]])` — sets own property, no prototype pollution.
       10. `Object.freeze({a:1})` then mutate — silent fail (sloppy) or TypeError (strict); document.
       11. `Object.freeze(Object.freeze(x))` — idempotent.
       12. `Object.isFrozen(frozen)` → true; `Object.isFrozen({})` → false.
       13. `Object.assign({}, {a: 1}, {a: 2})` → `{a: 2}`.
       14. `Object.assign({a: 1}, undefined, null, {b: 2})` → `{a: 1, b: 2}` (nullish sources skipped).
       15. `Object.assign` with a getter source — getter invoked; value copied.
       16. `Array.isArray([])` → true; `Array.isArray("a")` → false; `Array.isArray({length: 1})` → false.
       17. `Array.from("ab")` → ["a", "b"].
       18. `Array.from({length: 3})` → [undefined, undefined, undefined].
       19. `Array.from({length: 3}, (_, i) => i)` → [0, 1, 2].
       20. `Array.of(7)` → [7] (not new Array(7)).
       21. `Array.of()` → [].
       22. Number("0x10") → 16; Number(" ") → 0; Number("") → 0; Number("abc") → NaN.
       23. Boolean("") → false; Boolean("false") → true; Boolean(0) → false; Boolean(NaN) → false.

      Conventional commit: `fix(agent-script): Object/Array static edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: methods-array-edges
    title: methods — Array.prototype edges
    prompt: |
      `packages/agent-script/src/interp/methods/array.ts` and its
      tests.

      Tests:
        1. `[].reduce(fn)` — TypeError (empty without initial value).
        2. `[].reduce(fn, 0)` — 0 (initial value alone).
        3. `[1,2,3].reduce((a,b) => a + b)` — 6 (no initial; first element is initial).
        4. `[1,2,3].reduceRight((a,b) => a + "-" + b)` — "3-2-1" — verify right-to-left.
        5. `[1,2,3].map(x => x * 2)` — [2, 4, 6].
        6. `[1,2,3].filter(x => x > 1)` — [2, 3].
        7. `[1,2,3].find(x => x === 2)` → 2; not-found → undefined.
        8. `[1,2,3].findIndex(x => x === 2)` → 1; not-found → -1.
        9. `[1,2,3].some(x => x > 5)` → false; `.some(x => x > 1)` → true.
       10. `[1,2,3].every(x => x > 0)` → true; `.every(x => x > 1)` → false.
       11. `[1,2,3].forEach` returns undefined.
       12. `[1,2,3].includes(2)` → true; `.includes(NaN)` → false unless NaN in array (then true via SameValueZero).
       13. `[1, NaN].includes(NaN)` → true (NaN-equality via SameValueZero).
       14. `[1, NaN].indexOf(NaN)` → -1 (strict equality).
       15. `[1,2,3].slice(-2)` → [2, 3].
       16. `[1,2,3].slice(1, -1)` → [2].
       17. `[1,2,3,4].splice(1, 2)` → [2, 3]; array becomes [1, 4].
       18. `[1,2,3].concat([4, 5], 6)` → [1,2,3,4,5,6] (spreads arrays one level).
       19. `[1,2,3].join("-")` → "1-2-3".
       20. `[null, undefined].join(",")` → ",".
       21. `[1,2,3].reverse()` mutates and returns; original is now [3,2,1].
       22. `[3,1,2].sort()` → [1,2,3] (lex sort by default); `[10,2,1].sort()` → [1, 10, 2].
       23. `[3,1,2].sort((a,b) => a - b)` → [1,2,3].
       24. Sort with comparator that throws — propagates.
       25. Mutation during iteration: pushing into the array inside `.forEach` callback adds entries visible to subsequent ticks.
       26. Callback `this` is undefined (sandbox).
       27. `[1,2,3].at(-1)` → 3; `.at(0)` → 1; `.at(10)` → undefined.

      Conventional commit: `fix(agent-script): Array.prototype edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: methods-string-tests
    title: methods/string — add full test coverage
    prompt: |
      `packages/agent-script/src/interp/methods/string.ts` has NO test
      file. Create `methods/string.test.ts` covering all implemented
      methods.

      Tests:
        1. `"abc".charAt(0)` → "a"; `.charAt(10)` → "".
        2. `"abc".charCodeAt(0)` → 97; `.charCodeAt(10)` → NaN.
        3. `"😀".codePointAt(0)` → 128512; `.charCodeAt(0)` → 55357 (surrogate half).
        4. `"abc".at(-1)` → "c".
        5. `"abc".concat("d", "e")` → "abcde".
        6. `"abcd".startsWith("ab")` → true; `.startsWith("bc", 1)` → true.
        7. `"abcd".endsWith("cd")` → true; `.endsWith("ab", 2)` → true.
        8. `"abc".indexOf("b")` → 1; `.indexOf("z")` → -1; `.indexOf("a", 1)` → -1.
        9. `"aba".lastIndexOf("a")` → 2.
       10. `"abc".includes("b")` → true; `.includes("z")` → false.
       11. `"a,b,c".split(",")` → ["a", "b", "c"]; `"abc".split("")` → ["a", "b", "c"]; `"".split(",")` → [""].
       12. `"abc".split(/[,]/)` — regex separator if supported, else clear error.
       13. `"abc".replace("b", "X")` → "aXc" (first only); `.replaceAll("a", "X")` → … (all).
       14. `"abc".repeat(3)` → "abcabcabc"; `.repeat(0)` → ""; `.repeat(-1)` → RangeError; `.repeat(Infinity)` → RangeError.
       15. `"  abc  ".trim()` → "abc"; `.trimStart()` → "abc  "; `.trimEnd()` → "  abc".
       16. `"abc".padStart(5, "0")` → "00abc"; `.padStart(2)` → "abc" (no truncation).
       17. `"abc".padEnd(5)` → "abc  ".
       18. `"ABC".toLowerCase()` → "abc"; `"abc".toUpperCase()` → "ABC".
       19. `"İ".toLowerCase()` — Turkish dotted I; verify Unicode-aware lowercase.
       20. `"abc".slice(1, 2)` → "b"; `.slice(-2)` → "bc"; `.slice(1, -1)` → "b".
       21. `"abc".substring(2, 0)` → "ab" (swaps reversed indices).
       22. `"abc".substr(1, 2)` — deprecated; document support.
       23. `"abc".normalize("NFC")` — Unicode normalization; if not supported, clear error.
       24. `"abc".repeat(1e6)` — exceeds `stringLength` budget → budgetExceeded.

      Conventional commit: `test(agent-script): string methods coverage`.
    status:
      implement: open
      test: open
      commit: open

  - id: methods-number-edges
    title: methods — Number.prototype edges
    prompt: |
      `packages/agent-script/src/interp/methods/number.ts`.

      Tests:
        1. `(1).toString()` → "1".
        2. `(255).toString(16)` → "ff".
        3. `(8).toString(2)` → "1000".
        4. `(0.1).toString()` → "0.1" (matches V8).
        5. `(1).toString(0)` → RangeError; `.toString(1)` → RangeError; `.toString(37)` → RangeError.
        6. `(1).toString(36)` → "1" (max radix).
        7. `(-0).toString()` → "0" (not "-0").
        8. `Infinity.toString()` → "Infinity"; `(-Infinity).toString()` → "-Infinity"; `NaN.toString()` → "NaN".
        9. `(1.005).toFixed(2)` → "1.00" or "1.01" (matches V8).
       10. `(1).toFixed(100)` — implementation limit; matches V8 (typically up to 100).
       11. `(1).toPrecision()` → "1" (no arg).
       12. `(1234.5).toPrecision(3)` → "1.23e+3".
       13. `(1e21).toString()` → "1e+21" (exponential threshold).
       14. `(0.0000001).toString()` → "1e-7".
       15. `(1).toExponential(2)` → "1.00e+0".

      Conventional commit: `fix(agent-script): Number method edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: error-format-edges
    title: error/format — top-level error rendering
    prompt: |
      `packages/agent-script/src/error/format.ts` and `format.test.ts`.

      Tests:
        1. Render a syntax error from the parser with source excerpt — caret aligns.
        2. Render a runtime error with stack — frames show the sandbox-only stack, no host frames.
        3. Render a budget-exceeded error — message identifies which limit fired.
        4. Render a thrown-from-sandbox non-error value — message includes a JSON-ish representation.
        5. Render an error whose `.cause` chain is 3 deep — output shows each cause.
        6. Render an error from a host call — wraps with the host call's name.
        7. Source not provided (no file context) — falls back to plain message only.
        8. Very long error message (>10k chars) — truncated with explicit suffix.

      Conventional commit: `fix(agent-script): top-level error rendering`.
    status:
      implement: open
      test: open
      commit: open

  - id: loader-frontmatter-edges
    title: loader/frontmatter — YAML edges
    prompt: |
      `packages/agent-script/src/loader/frontmatter.ts` and its tests.

      Tests:
        1. Frontmatter with no closing fence → error.
        2. Frontmatter that's only blank lines → empty object.
        3. Frontmatter with `---` as a value (escaped via quotes) does not close early.
        4. Frontmatter values containing colons and dashes parsed correctly.
        5. CRLF-only line endings → handled (no spurious "missing closing fence").
        6. UTF-8 BOM at start of file → stripped before parsing.
        7. Mixed tab/space indentation in YAML → js-yaml error surfaced with original line.
        8. Frontmatter exceeds 1MB → soft limit warning (or no limit; document).
        9. Frontmatter with nested arrays of objects → preserved structurally.
       10. Closing fence with trailing whitespace `--- ` → valid.
       11. Closing fence with leading whitespace ` ---` → invalid.
       12. No frontmatter at all → returns null/empty marker; body is the whole file.

      Conventional commit: `fix(agent-script): frontmatter edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: loader-extract-block-edges
    title: loader/extract-block — fenced-block edges
    prompt: |
      `packages/agent-script/src/loader/extract-block.ts`.

      Tests:
        1. First `js` or `ajs` block extracted; subsequent blocks ignored.
        2. Block with no language tag → ignored.
        3. Block with `javascript` tag → matches `js` (or document if it doesn't).
        4. Block opened with `````` (4 backticks) — close must be exactly 4 backticks; nested triple-backtick allowed inside.
        5. Block containing the close-fence pattern inside a string — not falsely matched.
        6. Block indented under a list item (4-space indent) — handled.
        7. Block at the very start of the file (no preceding content).
        8. Block at the very end of the file (no closing newline).
        9. Unclosed block at EOF → clear error.
       10. Mixed CRLF/LF inside a block → preserved into the extracted source.
       11. Line offset reported matches the source line of the first code line (so parse errors map back to .md line numbers).

      Conventional commit: `fix(agent-script): extract-block edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: loader-find-exported-edges
    title: loader/find-exported — edge cases
    prompt: |
      `packages/agent-script/src/loader/find-exported.ts`.

      Tests:
        1. `export const handler = () => {}` → returns the arrow.
        2. `export const handler = async () => {}` → returns the async arrow.
        3. `export const handler` (no initializer) → clear error.
        4. `export let handler = () => {}` → clear error (must be const).
        5. `export var handler = () => {}` → clear error.
        6. `export default () => {}` → returns the default arrow.
        7. `export default async () => {}` → returns the async default.
        8. `export const { a } = obj;` → clear error (destructured exports unsupported).
        9. `export const a = 1, b = 2;` → clear error (single declarator).
       10. `export const handler = 1;` → returns the literal; downstream parse-export decides whether 1 is callable.

      Conventional commit: `fix(agent-script): find-exported edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: runner-run-harness-edges
    title: runner/run-harness — top-level run failures
    prompt: |
      `packages/agent-script/src/runner/run-harness.ts`.

      Tests:
        1. Path that doesn't exist → ENOENT surfaces with the path in the message.
        2. Path points at a directory → clear error.
        3. File is empty → "no code block" error.
        4. Code block has a syntax error → parse error surfaces with source-mapped line.
        5. Harness throws on first await → run result has the error; finally ran.
        6. Harness completes with no awaits at all → run result has the return value.
        7. `modulesFor` callback throws → surfaces before code runs.
        8. `modulesFor` returns an object missing required modules → error names the missing module.
        9. Snapshot interval is 0 → no snapshots taken.
       10. Run is aborted before first step → result indicates aborted.
       11. Concurrent runHarnessPair calls on the same file each get independent state.

      Conventional commit: `fix(agent-script): run-harness top-level edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: runner-signal-dump-edges
    title: runner/signal-dump — handler edges
    prompt: |
      `packages/agent-script/src/runner/signal-dump.ts` and its tests.

      Tests:
        1. SIGUSR1 mid-run produces a dump file at the configured path.
        2. Two consecutive signals each produce a dump (no debouncing).
        3. Dump fires while the runner is paused on an await — captures current scope and pending awaits.
        4. Dump path is unwritable — error logs to stderr; runner continues.
        5. Dump JSON is parseable.
        6. Dump includes sourceHash so it can be diffed against the source later.
        7. Signal handler is removed when the runner finishes; subsequent signals fall through.
        8. Multiple runners in one process register independent handlers without interfering.

      Conventional commit: `fix(agent-script): signal-dump edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: snapshot-serialize-restore-roundtrip
    title: snapshot — serialize/restore round-trip
    prompt: |
      `packages/agent-script/src/snapshot/serialize.ts` and
      `restore.ts`.

      Tests:
        1. Serialize then restore a snapshot taken before any await → run produces the original return.
        2. Snapshot taken after a let-mutation in a loop → restored scope reflects the mutation.
        3. Snapshot mid-try, before a thrown error → restore proceeds to the throw and the same catch handles.
        4. Snapshot inside a finally clause → restore completes the finally and propagates the pending signal.
        5. Snapshot with a circular sandbox object → round-trip preserves the cycle.
        6. Snapshot with a shared object reference (l === r) → restore preserves identity.
        7. Snapshot's `sourceHash` mismatched at restore → clear error before any user code runs.
        8. Snapshot of a script that called Math.random with a seed → restored stream matches the original sequence.
        9. Snapshot of a script with a pending host call → after restore, decision matches `snapshot/policy.ts` (re-issue vs read).
       10. Snapshot serialized while two unawaited promises are pending → restored run resolves them in the same order.
       11. Snapshot file truncated → clear parse error, not a runtime crash.

      Conventional commit: `fix(agent-script): snapshot round-trip edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: snapshot-policy-edges
    title: snapshot/policy — host-call replay decisions
    prompt: |
      `packages/agent-script/src/snapshot/policy.ts`.

      Tests:
        1. Known read module/operation pair → read decision.
        2. Known side-effect module/operation pair → re-issue decision.
        3. Unknown module → safe default (document: re-issue or read?).
        4. Unknown operation under known module → safe default.
        5. Whitespace-only moduleId or operation → treated as unknown.
        6. Case-sensitive: `git.Commit` vs `git.commit` are different.
        7. Adding a new (module, op) pair via the public API works at runtime.

      Conventional commit: `fix(agent-script): snapshot policy edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: snapshot-scheduler-edges
    title: snapshot/scheduler — write semantics
    prompt: |
      `packages/agent-script/src/snapshot/scheduler.ts`.

      Tests:
        1. Interval triggers an atomic rename-based write (temp + rename), not a partial overwrite.
        2. Two scheduled writes overlap → second waits for first; no torn file.
        3. Write while file is locked by another process → retries N times, then errors clearly.
        4. Disk full → error surfaces; runner continues without crashing.
        5. Path's parent directory doesn't exist → clear error (no auto-mkdir unless documented).
        6. Cleanup on early exit removes any orphan temp file.
        7. Pause + resume scheduler: pause halts writes; resume continues from next interval.

      Conventional commit: `fix(agent-script): snapshot scheduler edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: cli-edges
    title: agent-script CLI — argument and IO edges
    prompt: |
      `packages/agent-script/src/cli.ts` and `cli.test.ts`.

      Tests:
        1. `--help` prints help and exits 0.
        2. No args → prints usage to stderr, exits non-zero.
        3. Unknown flag → exits non-zero with the unknown flag named.
        4. Path that doesn't exist → "file not found" with the path; exit non-zero.
        5. Path is a directory → clear error.
        6. `--snapshot <path>` writes a snapshot at that path on completion or signal.
        7. `--restore <path>` restores from snapshot; failing restore exits non-zero.
        8. `--max-steps <n>` enforces step budget; exceeded → non-zero exit with the budget message.
        9. SIGINT during run → graceful shutdown (finally blocks run), non-zero exit.
       10. Output formatting: console.log from the harness reaches stdout; errors reach stderr.
       11. Exit code on uncaught throw matches the documented mapping (parse error vs runtime vs budget).

      Conventional commit: `fix(agent-script): cli edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: dump-edges
    title: dump.ts — snapshot dump format
    prompt: |
      `packages/agent-script/src/dump.ts`.

      Tests:
        1. Dump file is valid JSON.
        2. Dump file is human-readable (pretty-printed with 2-space indent).
        3. Dump file roundtrips through restore.ts.
        4. Dump file includes a version field; restore checks it.
        5. Dump file from an older version → restore emits a clear "incompatible version" error.
        6. Dump file with corrupted sourceHash → restore emits a clear error.
        7. Dump file size is bounded relative to the harness state (no exponential blowup on circular refs).
        8. Dump excludes host references (functions, closures over host state).

      Conventional commit: `fix(agent-script): dump format edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-rules-edge-pass
    title: lint — sweep AS001-AS015 for edge gaps
    prompt: |
      Walk each rule under
      `packages/agent-script/src/lint/rules/AS001.ts` … `AS015.ts` and
      its `.test.ts`. For each, add 3-5 edge-case tests that the
      current tests don't cover. Patterns to look for per rule:

      - Nested expression inside the rule's target shape.
      - Boundary at start/end of file.
      - Inside template-literal interpolation.
      - Inside default param expression.
      - Inside catch binding pattern.
      - Inside object/array destructuring pattern.
      - Inside an inner arrow function that's the value of an export.

      For `AS-export-import-meta.ts`, add tests for:
        - `import.meta` used inside a nested arrow that's the exported handler.
        - `import.meta` referenced via a binding (`const m = import.meta; m.url`) — rule's static reach.
        - Aliased `import.meta` in a destructured const.

      Add the edge tests; do not change the rules unless a test reveals a real false positive or false negative.

      Conventional commit: `test(agent-script): lint rule edge sweep`.
    status:
      implement: open
      test: open
      commit: open

  - id: lint-disable-comments-edges
    title: lint — disable-comment edges (depends on plan 26's
      lint-disabled-rule-comment)
    prompt: |
      After plan 26's `// @as-disable` work lands, add coverage for
      the corner cases that a naive implementation misses.

      Tests:
        1. `// @as-disable AS003` followed by a blank line then the statement — does the directive still cover the next statement, or is the blank line a separator? Document and test.
        2. Two directives on adjacent lines target the same statement — both apply.
        3. Disable-line on a multi-line expression statement — applies to the whole statement, not just the first line.
        4. Directive inside a block comment is ignored (only line comments are recognized).
        5. Directive with trailing junk: `// @as-disable AS003 because of X` — codes parsed, message ignored.
        6. Directive containing a known-good code and an unknown code — known one applies; unknown emits AS-UNKNOWN-DIRECTIVE.
        7. File-level directive `/* @as-disable-file AS003 */` not at the very top (e.g. after a comment) — document policy and test.
        8. Conflicting directives (`disable` then `enable` if `enable` exists) — document.

      Conventional commit: `test(agent-script): @as-disable directive edges`.
    status:
      implement: open
      test: open
      commit: open

  - id: harness-recovery-end-to-end
    title: End-to-end — harness recovery from abnormal exits
    prompt: |
      End-to-end coverage for the recovery path through
      `runner/run-harness.ts`, `snapshot/scheduler.ts`, and
      `snapshot/restore.ts`. New test file under
      `packages/agent-harness/src/testing/recovery-e2e.test.ts` (or
      colocate with existing harness tests if the layout differs).

      Each test runs a small harness pair, takes a snapshot mid-flight,
      kills the run abruptly, then restores and continues.

      Tests:
        1. Crash after first await; restore continues; full result matches a single-run baseline.
        2. Crash inside a `for-of` loop after N iterations; restore continues from N+1.
        3. Crash inside a try block before the throw; restore reaches the throw and catch.
        4. Crash inside a finally clause; restore re-enters the finally only once (no double-execute of side effects via `policy.ts`).
        5. Crash during a host call; restore makes the decision per policy (re-issue or read-cached-result).
        6. Crash after the final return; restore is a no-op and returns the cached value.
        7. Crash with two pending Promises in flight; restore resolves them in deterministic order.
        8. Source file modified between crash and restore → sourceHash mismatch error, no partial run.

      Conventional commit: `test(agent-harness): recovery e2e`.
    status:
      implement: open
      test: open
      commit: open

  - id: fuzz-tokenizer-parser
    title: Fuzz tokenizer/parser for crash-resistance
    prompt: |
      Add a small fuzz harness (vitest-driven; no external fuzzer) at
      `packages/agent-script/src/parse/fuzz.test.ts`. Generate 1000
      random byte sequences (seeded for determinism) and feed each
      through tokenize + parse. The assertion is only that neither
      step crashes — every input must either return a clean AST or a
      well-formed error.

      Seed strategy: seed from a constant so the run is reproducible.

      Tests:
        1. 1000 random ASCII byte sequences — no uncaught throws.
        2. 1000 random UTF-8 byte sequences (including invalid UTF-8) — no uncaught throws; invalid UTF-8 produces an error with a span.
        3. 1000 minimally-valid source skeletons (random binary ops over random identifiers) — parse succeeds; nodeIds assigned.
        4. 100 sources truncated at random offsets — parse fails cleanly with a span pointing into the file.
        5. Run completes in under 5 seconds total on the CI machine.

      Skip rule: this is a single test file gated by an env var so CI can run it but local `npm run test` is unaffected. Document the env var in the test file header.

      Conventional commit: `test(agent-script): parse fuzz harness`.
    status:
      implement: open
      test: open
      commit: open

  - id: cross-cutting-error-shape-consistency
    title: Cross-cutting — error shape consistency
    prompt: |
      Audit error shapes thrown by the harness. Every error surfaced
      to a user (parse, runtime, budget, snapshot, host) must have:
      - `.name` matching a known class.
      - `.message` non-empty and not [object Object].
      - `.stack` containing only sandbox frames (no /node_modules/, no
        /packages/agent-script/internal paths).
      - `.span` (when source-bound) pointing to a valid source range.
      - `.cause` if wrapping a host error.

      New test file
      `packages/agent-script/src/error/shape-audit.test.ts` exercises
      one representative case per error class:

      Tests:
        1. Parse error (unterminated string) — shape audit passes.
        2. Runtime TypeError (call non-function) — shape audit passes.
        3. Runtime ReferenceError (undeclared identifier) — shape audit passes.
        4. Budget error — shape audit passes; message identifies which budget.
        5. Snapshot mismatch error — shape audit passes; mentions the expected vs actual hash.
        6. Host call error — shape audit passes; `.cause` wraps the host error.
        7. Cancellation error — shape audit passes; recognizable as an abort error.
        8. Unhandled-rejection error — shape audit passes; mentions the unhandled rejection value.

      Conventional commit: `test(agent-script): error shape audit`.
    status:
      implement: open
      test: open
      commit: open
---

# Harness edge cases — exhaustive coverage of agent-script corners

Companion to [26-harness-improvements.md](26-harness-improvements.md). That plan adds capability (new language features, lint rules, SDK helpers); this plan adds **coverage** — concrete edge-case tests for every corner of `@poe-code/agent-script` that today is under-tested, and fixes for any divergence the tests surface.

## Scope

- Every file under `packages/agent-script/src/` with thin or absent test coverage.
- Files with NO test file at all: `methods/string.ts`, `parse/parse-import-meta.ts`, `interp/exceptions.ts`. Each gets a dedicated coverage task.
- Cross-cutting: error shape consistency, fuzzing, end-to-end recovery.

## Strategy

Each task lands as one commit. Tests come first (TDD); fixes follow only when a test reveals a real divergence. No behavior change without a failing test that motivates it.

Where the plan says "document policy" — pick the behavior that matches V8 unless we have a deliberate reason to differ; record the choice in the test name and a one-line comment at the test site, NOT in a separate doc.

Tasks are independent. Run in any order; pick by which corner is most fragile in current incident triage.

## Not in scope

- New language features (covered by plan 26).
- New host modules (covered by plan 26).
- Lint rule additions beyond AS001-AS015 + the existing `AS-export-import-meta` (covered by plan 26).
- Performance benchmarking — coverage focuses on correctness; perf is a separate effort.

## Why this matters

`agent-script` is the substrate for every harness run, every snapshot, every recovery from crash. A single under-tested corner — a missing `try { ... } finally { ... }` case, a JSON.stringify quirk, a budget boundary off by one — propagates into incident pages from every harness consumer. The cheapest fix is the one that ships with a test asserting the behavior we want.
