---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: array-proto-write-guard
    title: Close the array __proto__ write asymmetry
    prompt: |
      In packages/agent-script, fix a sandbox write-path asymmetry. Object
      property writes go through defineSandboxProperty
      (src/interp/interpreter.ts:3036), which uses Object.defineProperty and
      therefore creates a harmless own data property even for "__proto__".
      Array property writes do NOT: setSandboxProperty
      (src/interp/interpreter.ts:2729) takes the array branch at line 2735 and
      does a raw `(target)[String(property)] = value`. Because a sandbox array
      still inherits from Array.prototype -> Object.prototype, assigning to
      "__proto__" invokes the inherited setter and mutates that array's
      prototype (`arr.__proto__ = {}` or `arr["__proto__"] = {}`).
      Fix: in the array branch, keep raw assignment ONLY for array indices and
      "length" (normal array semantics, length must stay live). For any other
      property name route through a data-property definition (the same
      Object.defineProperty shape defineSandboxProperty uses) so "__proto__",
      "constructor", and "prototype" become inert own data properties and never
      reach the prototype setter. Reads already go through the closed-world
      getArrayMemberValue (src/interp/interpreter.ts:2717), so nothing changes
      for index/length/method access.
      TDD in interpreter.test.ts: after evaluating `arr.__proto__ = { evil: 1 }`
      the produced host array's prototype is unchanged (Object.getPrototypeOf
      still Array.prototype) and Array.isArray still holds; index and length
      writes still work; a normal non-index property write still round-trips.
      Fast unit tests, no I/O, no LLM.
    status:
      implement: done
      test: done
      commit: done

  - id: flatten-scope-snapshot
    title: Flatten Scope.snapshot to a single root-to-leaf walk
    prompt: |
      In packages/agent-script, Scope.snapshot (src/interp/scope.ts:178) is
      O(depth^2): it calls `this.parent?.snapshot()` recursively and re-copies
      every ancestor binding at each level. It runs on every await
      (src/interp/async.ts:173 builds the yield point's snapshot from it), so
      deeply nested async code pays quadratically per suspension.
      Rewrite it as a single pass: walk parent pointers up into an array, then
      iterate root -> leaf copying each scope's initialized bindings into one
      accumulator so a child binding naturally shadows a same-named ancestor
      (later writes win). Keep the existing behavior exactly: skip bindings
      whose value is `uninitialized`, and define each entry through the existing
      defineSnapshotBinding helper (which must still neutralize dangerous names
      like __proto__/constructor as it does today). Total cost becomes
      O(total bindings across the chain), not O(depth^2).
      Refactor only — no format change to InterpreterSnapshot. Every existing
      scope.test.ts and snapshot test must stay green untouched. Add a
      deep-chain test asserting child-shadows-parent and that uninitialized
      bindings are omitted. Fast unit tests.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: sample-deadline-checks
    title: Sample the deadline clock instead of reading it every node
    prompt: |
      In packages/agent-script, Budget.visitNode (src/interp/budget.ts:69) calls
      checkDeadline() on every node, and checkDeadline (src/interp/budget.ts:164)
      reads Date.now() every time a deadline is configured. With hundreds of
      thousands of node visits this clock read dominates.
      Change visitNode so the deadline clock is sampled, not read per node: keep
      incrementing stepsUsed and keep the maxSteps comparison on every node
      (both cheap), but only invoke checkDeadline once every N visits (use a
      private counter; N around 1024). The deadline still trips, just within N
      nodes of slack — acceptable for a wall-clock guard. Preserve the existing
      suspend paths: suspendChecks / suspendDeadlineChecks must still disable the
      check, and a suspended-then-resumed counter must not skip a check window in
      a way that lets a run overrun unbounded. Do not change allocateString /
      allocateArrayLength / step accounting.
      TDD in budget.test.ts: a budget with an already-past deadline still throws
      the SandboxError({ budget: "deadline" }) within N visitNode calls; a
      generous deadline never throws across many visits; suspendDeadlineChecks
      still prevents the throw. Fast unit tests using the existing
      `deadline: Date.now() - 1` style fixtures.
    status:
      implement: done
      test: done
      commit: done

  - id: math-methods-and-constants
    title: Fill in the missing Math methods and constants
    prompt: |
      In packages/agent-script/src/interp/globals/math.ts, add the standard
      Math members that are absent. The numeric-method table `mathMethods`
      (currently abs, ceil, cbrt, cos, exp, floor, hypot, log, log10, log2, max,
      min, pow, round, sign, sin, sqrt, tan, trunc) is typed
      `Record<string, (...args: number[]) => number>` and each entry is wrapped
      as a sandbox closure in createMathGlobals, so adding entries is enough.
      Add: atan2, asin, acos, atan, sinh, cosh, tanh, asinh, acosh, atanh,
      clz32, expm1, log1p, fround, imul (atan2 and imul take two args; the rest
      one — all fit the existing signature, all are host Math pass-throughs like
      the current entries).
      Add the missing constants alongside E and PI in the mathObject literal
      (src/interp/globals/math.ts:42): LN2, LN10, LOG2E, LOG10E, SQRT2, SQRT1_2
      (host Math.LN2 etc). No new global name, so lint known-globals is
      unchanged.
      TDD in math.test.ts: each new method returns the host result (spot-check
      values incl. NaN/Infinity edges like Math.acos(2) -> NaN), each constant
      equals the host constant, and the closures are budget/snapshot-safe like
      the existing ones. Fast unit tests.
    status:
      implement: open
      test: open
      commit: open

  - id: object-is-static
    title: Add Object.is
    prompt: |
      In packages/agent-script/src/interp/globals/object-array.ts, add
      `Object.is(a, b)` to the Object static block (next to keys/values/entries/
      hasOwn/fromEntries/freeze/isFrozen/assign, around line 28). Use host
      Object.is via Reflect.apply (mirror the hasOwn entry at line 41) so it has
      SameValue semantics: Object.is(NaN, NaN) is true and Object.is(0, -0) is
      false — distinct from === and from SameValueZero. Returns a boolean; no
      budget allocation needed. `Object` is already a known global, so lint is
      unchanged.
      TDD in object-array's test file: NaN/NaN true, +0/-0 false, -0/-0 true,
      reference identity for objects/arrays, primitive equality. Fast unit tests.
    status:
      implement: open
      test: open
      commit: open

  - id: promise-catch-finally
    title: Add Promise#catch and Promise#finally
    prompt: |
      In packages/agent-script/src/interp/promise.ts, getPromiseMember
      (line 106) only resolves "then" (line 111 returns undefined for anything
      else). Add "catch" and "finally" to the closed-world promise member table:
      - catch(onRejected): equivalent to then(undefined, onRejected) — build the
        same async sandbox closure as "then" but with no fulfilled handler,
        reusing runPromiseReaction for the rejected path. Returns a new sandbox
        promise.
      - finally(onFinally): onFinally is called with no arguments on BOTH settle
        paths; the original fulfilment value or rejection reason passes through
        unchanged. If onFinally itself throws (or returns a promise that
        rejects), that error supersedes and the returned promise rejects with it;
        otherwise onFinally's return value is ignored. Async onFinally is awaited
        before the original outcome propagates. Budget the produced promise/value
        like the existing reactions.
      Both must work with sandbox closures (sync and async) and chain
      (`p.catch(f).finally(g)`). Builtin/closure precedence and existing
      `.then` behavior are unchanged.
      TDD in promise.test.ts (or a co-located test): catch intercepts a
      rejection and recovers; finally runs on fulfilment and on rejection and
      passes the value/reason through; async finally is awaited; finally that
      throws rejects the chain; chaining order. Fast unit tests, no real timers
      beyond immediate microtask resolution.
    status:
      implement: open
      test: open
      commit: open

  - id: generalize-resume-breakpoint
    title: Decouple resume-breakpoint emission from await
    prompt: |
      In packages/agent-script, the only place a resume snapshot is emitted is
      the await path: evaluateAwaitExpression (src/interp/async.ts:157) builds a
      yield point `{ kind: "await", nodeId, otelSpan?, snapshot:
      context.scope.snapshot(), span }` and calls context.onYield (around
      src/interp/async.ts:211). The yield point is already discriminated by
      `kind`. Extract a single reusable emitter — e.g.
      emitResumeBreakpoint(context, { kind, nodeId, span, otelSpan? }) — that
      builds the yield point and invokes context.onYield. Rewrite the await site
      to call it with kind "await". Widen the InterpreterYieldPoint kind union to
      "await" | "generator-yield" | "loop-iteration" without committing the
      non-await producers yet.
      Make the snapshot lazy so high-frequency breakpoints are cheap when no dump
      fires: change the yield point's `snapshot` field from an eager
      InterpreterSnapshot to a thunk `() => InterpreterSnapshot` that calls
      context.scope.snapshot() only when invoked. Consumers MUST invoke it
      synchronously inside onYield (the scope is correct only at the breakpoint,
      not after execution continues) and never store the thunk for later. The
      run.ts onYield consumers (src/run.ts:183 and src/run.ts:213) already wrap
      snapshot creation in a lazy `createSnapshot` that the scheduler/dump
      controller only calls when a dump actually fires, so move the
      `yieldPoint.snapshot` read inside that thunk. Treat the yield point by its
      shared fields, not by assuming kind === "await".
      Pure refactor: await snapshot/restore behavior is identical (the thunk is
      still invoked synchronously whenever a dump fires) and every existing
      snapshot/restore/scheduler test stays green. Add a unit test that
      emitResumeBreakpoint fires onYield with the right kind and that invoking
      the snapshot thunk returns the current scope bindings, for a non-await
      kind. Fast unit tests.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: loop-iteration-resume-breakpoint
    title: Make loop iterations resume breakpoints
    prompt: |
      In packages/agent-script, make each loop iteration a resume breakpoint so
      a long synchronous loop (no await in its body) is crash-resumable. Runtime
      only — no new syntax, globals, or language surface; existing scripts are
      unaffected. Depends on generalize-resume-breakpoint.
      In the loop evaluators in src/interp/interpreter.ts (for, for...of,
      for...in, while, do...while), call emitResumeBreakpoint with kind
      "loop-iteration" at the top of each iteration, before the body runs. Use
      the lazy snapshot thunk from generalize-resume-breakpoint so iterations
      that do not trigger a dump cost nothing beyond the existing node visit.
      Snapshot/restore must round-trip loop position with no duplicated or
      skipped iterations:
      - C-style for, while, do...while: iteration state is already the loop
        variables in scope (e.g. `i` in `for (let i ...)`), captured by the scope
        snapshot — verify restore resumes at the next iteration and re-evaluates
        the test/update correctly.
      - for...of / for...in: the cursor must be serializable. Capture the current
        position into the precomputed element/key list (for...in already
        captures its key list once per the reducer plan; for...of over arrays and
        strings is an index) in the loop's call/scope frame so restore resumes at
        the next element. For iterable sources whose cursor is itself a value
        (a SandboxGenerator, Map, or Set), drive iteration through the
        snapshotable iterator state rather than a host iterator object so the
        position survives a dump.
      Background dumps only: emitting a breakpoint must not change observable
      execution (no actual suspension when there is no await), and an early exit
      (break / return / throw / for...of triggering generator return) behaves
      exactly as today.
      TDD: a counter loop interrupted by a background dump mid-run restores and
      completes with byte-identical output (no repeated or skipped iterations);
      for...of over an array restores at the correct element; a while loop
      restores; nested loops restore the inner cursor; an infinite loop still
      halts fast under a small node-visit budget. Fast unit tests, no timers
      beyond immediate resolution, no file I/O outside memfs, no LLM.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: generator-yield-resume-breakpoint
    title: Make a suspended generator a resume breakpoint
    prompt: |
      In packages/agent-script, make a generator suspended mid-iteration a real
      snapshot/restore point. This supersedes the earlier decision (the
      generator-snapshot-guards task in
      docs/plans/agent-script-reducer-language.md) that a "suspended" or
      "running" SandboxGenerator throws UnsnapshotableValueError — depends on
      those three generator tasks (generator-syntax-and-channel,
      generator-runtime-integration, generator-snapshot-guards) having landed,
      and on generalize-resume-breakpoint.
      Today the generator continuation lives only in the host promise handshake
      (the resume Deferred in src/interp/generator.ts:28-89), which is why it
      could not be serialized. Capture the suspension in serializable form
      instead: the yield node id, the generator's scope chain (through the
      existing astNodeId + capturedScopeId machinery used for closures), and the
      iterator-protocol state needed to resume — how many times next/return/
      throw have been delivered and the value last sent in. On serialize
      (src/snapshot/serialize.ts) write
      { kind: "generator", state: "suspended", astNodeId, capturedScopeId,
      yieldNodeId, sent } (keep the existing "start" and "done" forms); on
      restore (src/snapshot/restore.ts) rebuild a coroutine resumed at that yield
      with the captured scope, so the next next()/return()/throw() behaves as if
      the original run continued — finally blocks still run on a later
      return()/throw().
      Emit a resume breakpoint at each YieldExpression via emitResumeBreakpoint
      (kind "generator-yield") so periodic background dumps capture generator
      progress. The snapshot scheduler must NOT special-case generators anymore;
      remove the UnsnapshotableValueError throw for suspended/running generators
      (a genuinely unrepresentable continuation, if any remains, should still
      surface a typed error, but mid-yield suspension is now representable).
      TDD: round-trip a generator paused at its first yield then resume and pull
      the rest; round-trip after several next() calls with sent values; a
      for...of over a restored generator runs the body's finally on early break;
      yield* delegation round-trips; a background dump taken while a generator is
      suspended succeeds and the restored run produces identical output to an
      uninterrupted run. Fast unit tests, no timers beyond immediate resolution,
      no file I/O outside memfs, no LLM.
    status:
      implement: open
      refactor: open
      test: open
      commit: open

  - id: resume-policy-required-for-host-modules
    title: Require an explicit resume policy for every host operation
    prompt: |
      In packages/agent-script, the pending-host-call resume policy
      (src/snapshot/policy.ts) defaults to "re-issue" for any module/operation
      not in MODULE_PENDING_HOST_CALL_POLICIES (src/snapshot/policy.ts:37-50).
      That is a silent correctness footgun: an effectful host operation (one
      that is not idempotent) added without a "read-side-effect" entry will be
      replayed on a crash-resume and double-apply its effect.
      Make the policy explicit per operation instead of falling back silently.
      When a host module is registered/wired into the runtime (the host-call
      surface in src/run.ts and src/interp/host-bridge.ts), every callable
      operation it exposes must have a declared resume policy ("re-issue" or
      "read-side-effect"); resolving a pending host call whose operation has no
      registered policy throws a clear, typed error naming the module and
      operation ("Host operation <module>.<op> has no resume policy; declare
      're-issue' (idempotent) or 'read-side-effect' (effectful)."). Keep the
      existing agent.spawn and git.* registrations. Do NOT remove the
      DEFAULT_PENDING_HOST_CALL_POLICY constant's behavior for already-registered
      paths; the change is that an UNregistered operation is an error at resolve
      time, not a silent re-issue. Provide the registration hook so a provider
      declares its policy declaratively (no per-module branching in the resolver,
      consistent with the repo's no-branch-per-provider rule).
      TDD in policy.test.ts and a run-level test: an unregistered effectful op
      throws the typed error on resume-policy resolution; a registered
      "re-issue" op resolves to re-issue; a registered "read-side-effect" op
      resolves with the side-effect tag; agent.spawn and git.commit still resolve
      to read-side-effect. Fast unit tests.
    status:
      implement: open
      test: open
      commit: open

  - id: crash-time-final-snapshot
    title: Write a last-gasp snapshot when a run fails
    prompt: |
      In packages/agent-script, a run that fails currently writes no snapshot:
      dumpController.fail(error) (src/run.ts:250, src/snapshot/dump.ts:50) only
      records the error, and the clean final dump (src/run.ts:235) runs only on
      success. So after a crash/throw, resume falls back to the last interval
      snapshot and replays all work since.
      On failure, attempt one last durable snapshot from the current scope before
      surfacing the error, so a resume loses minimal work. In the run.ts catch
      block (src/run.ts:248-251), build a RunSnapshot from the live scope
      (scope.snapshot().bindings, same shape as the success path at
      src/run.ts:235) and write it through the dump controller / snapshot backend
      BEFORE rethrowing. If that snapshot is itself unrepresentable (catch
      UnsnapshotableValueError, mirroring the scheduler skip at
      src/snapshot/scheduler.ts:83-89) log and skip — a failed last-gasp dump
      must never mask the original error. The original error must still propagate
      unchanged (do not swallow it, do not replace it with a snapshot-write
      error; a snapshot-write failure is logged, not thrown over the real cause).
      This is best-effort and only narrows the replay window; the interval
      snapshots remain the primary resume source.
      TDD in a run-level test (memfs/in-memory backend): a run that throws after
      mutating bindings leaves a final snapshot whose bindings reflect the
      pre-throw state and the original error still propagates; a throw whose
      live state is unsnapshotable still propagates the original error with the
      snapshot skipped (no secondary error). Fast unit tests, no real I/O.
    status:
      implement: open
      test: open
      commit: open

  - id: sandbox-escape-red-team-suite
    title: Adversarial sandbox-integrity test suite
    prompt: |
      In packages/agent-script, add an adversarial test suite that treats the
      sandbox as hostile input and probes for host-environment escape and
      prototype pollution across EVERY mutation path (depends on
      array-proto-write-guard). These are regression tests for the closed-world
      guarantee; they must assert behavior at the run boundary (evaluate a
      script, inspect the produced host value / thrown error), no internals
      mocking. Cover at least:
      - __proto__/constructor/prototype WRITES via every path: plain-object
        member assign (obj.__proto__ = x, obj["constructor"] = x), array member
        assign (arr.__proto__ = x, arr["constructor"] = x), computed keys, and
        (once Map/Set land) map.set("__proto__", x) / set.add — none mutate the
        host prototype chain; Object.getPrototypeOf on the produced host value is
        unchanged; no cross-instance pollution (a second fresh object/array is
        unaffected).
      - __proto__/constructor/prototype READS resolve to undefined under
        closed-world access on objects, arrays, strings, numbers, closures
        (no host method leak: typeof ([1].toSorted) etc. consistent with calling
        it), and the directed error message shape for an unsupported member call.
      - No reachable Function constructor: (function(){}).constructor,
        ({}).constructor("return process")() style gadgets all fail closed.
      - Spread / destructuring / JSON / structuredClone of a hostile object do
        not carry a host prototype or accessor through into the sandbox.
      Fast unit tests in a dedicated *.test.ts; no I/O, no LLM. If any probe
      reveals a real leak, fix it at the correct layer (do not weaken the test).
    status:
      test: open
      commit: open

  - id: resume-crash-integration-suite
    title: Crash/resume integration tests across breakpoint kinds
    prompt: |
      In packages/agent-script, add an end-to-end crash/resume test suite
      exercising the full snapshot -> kill -> restore -> continue cycle across
      every breakpoint kind and resume policy (depends on
      generalize-resume-breakpoint, loop-iteration-resume-breakpoint,
      generator-yield-resume-breakpoint, resume-policy-required-for-host-modules,
      crash-time-final-snapshot). Use an in-memory snapshot backend and stub host
      modules with controllable results; simulate a crash by abandoning the run
      after a chosen snapshot and restoring from it. Cover at least:
      - Resume from each breakpoint kind: await boundary, loop iteration,
        generator yield — restored run produces byte-identical output to an
        uninterrupted run (no duplicated or skipped work).
      - Pending host call on crash: a "re-issue" op is re-invoked on resume; a
        "read-side-effect" op (agent.spawn-like, git.commit-like) is NOT
        re-invoked, its recorded effect is read back; assert the stub's call
        count.
      - Interleavings: a loop whose body awaits and snapshots mid-iteration; a
        generator pulled inside a loop that itself awaits; nested loops with an
        inner generator; an await inside a try/finally where the crash lands
        between the await and the finally — finally still runs exactly once on
        resume.
      - Crash-time final snapshot: a run that throws mid-iteration resumes from
        the last-gasp snapshot, not from a stale interval snapshot.
      - Non-determinism note: a re-issued op returning a different value on
        retry diverges the resumed run (document the expected behavior in a
        test, not a hidden assumption).
      Fast unit tests, no real timers (immediate resolution / mocked clock), no
      file I/O outside memfs, no LLM.
    status:
      test: open
      commit: open

  - id: language-interaction-stress-suite
    title: Complex language-feature interaction and snapshot round-trip tests
    prompt: |
      In packages/agent-script, add a test suite for complex interactions among
      the language features (this plan's builtins plus the reducer plan's
      closures, destructuring, this, new, Map/Set, generators). Focus on
      cross-feature edge cases that single-feature tests miss, and on
      snapshot/restore round-tripping of rich state. Cover at least:
      - Closures capturing loop variables across let/var/const inside generators
        and across an await; mutual recursion through function declarations;
        a named function expression recursing after snapshot/restore.
      - `this` + new + method shorthand + arrow lexical capture interacting:
        an arrow inside a constructed object's method sees the right receiver
        before and after a snapshot round-trip.
      - Map/Set with object-identity keys shared across two collections restore
        as one object; a Map containing itself (cycle) round-trips; insertion
        order preserved; structuredClone of nested Map/Set/array.
      - New builtins under edge inputs: Math.acos(2)->NaN, Math.atan2 signs,
        Math.imul overflow, Object.is(NaN,NaN)/Object.is(0,-0)/-0/-0,
        Promise.finally that throws (rejects the chain), async Promise.finally
        awaited, catch recovering then finally running, chaining order.
      - Destructuring everywhere (params, for-of heads, assignment, defaults
        referencing earlier bindings) combined with generators and Map/Set
        iteration: `for (const [k, v] of map)` with a default pattern.
      - Deep recursion and tight loops halt fast under a small node-visit/step
        budget; deep scope chains snapshot correctly after the flatten fix.
      Fast unit tests, no timers beyond immediate resolution, no file I/O outside
      memfs, no LLM. If a probe reveals a real bug, fix it at the correct layer.
    status:
      test: open
      commit: open

  - id: js-edge-case-conformance-matrix
    title: 50+ notorious JavaScript edge-case conformance tests
    prompt: |
      In packages/agent-script, add a large conformance test matrix covering
      JavaScript's genuinely nasty corners — the cases that surprise people and
      that a tree-walking interpreter most easily gets subtly wrong. Oracle is
      host JS: assert the EXACT host result for each case (compute the expected
      value by hand or note it inline). Where agent-script deliberately deviates
      (documented: Map/Set keys()/values()/entries() return eager arrays; no
      prototype chains; no Function#bind; for...in destructuring heads rejected;
      generators cannot await; host RegExp banned) assert the deviation
      explicitly instead. Every case must stay inside the supported subset (no
      Symbol/BigInt/Date/Proxy/class/eval/with). At least the following ~55,
      grouped; add more where a category invites it:
      Equality & coercion: (1) NaN !== NaN and Object.is(NaN,NaN) true;
      (2) 0 === -0 true, Object.is(0,-0) false, 1/-0 === -Infinity; (3) [] == ![]
      true; (4) "" == 0, " " == 0, "\t\n" == 0 all true; (5) null == undefined
      true but null == 0 false; (6) [0] == false true, [null] == 0 true;
      (7) typeof null === "object", typeof NaN === "number"; (8) true + true === 2,
      null + 1 === 1, undefined + 1 is NaN; (9) "b"+"a"+ +"a"+"a" === "baNaNa";
      (10) 1 < 2 < 3 true but 3 > 2 > 1 false; (11) "10" < "9" true, 10 < 9 false;
      (12) [1,2,3] + [4,5,6] === "1,2,34,5,6".
      Numbers: (13) 0.1 + 0.2 === 0.30000000000000004 and !== 0.3;
      (14) (1.005).toFixed(2) === "1.00"; (15) 9999999999999999 === 1e16 true;
      (16) Infinity - Infinity is NaN, Infinity * 0 is NaN; (17) -5 % 3 === -2,
      5 % -3 === 2, 5.5 % 2 === 1.5; (18) 2 ** 3 ** 2 === 512 (right assoc) and
      `-2 ** 2` is a parse error; (19) ~5 === -6, -1 >>> 0 === 4294967295,
      1 << 32 === 1; (20) (255).toString(16) === "ff", (0.5).toString(2) === "0.1";
      (21) Number("0b101") === 5 but parseInt("0b101") === 0; Number("") === 0,
      Number([5]) === 5, Number([1,2]) is NaN, Number(null) === 0,
      Number(undefined) is NaN; (22) parseInt("10px") === 10, parseInt("0.5") === 0,
      parseFloat("1e3") === 1000.
      Arrays & holes: (23) [10,1,2].sort() === [1,10,2] (lexicographic default);
      (24) [1,,3].map(x=>x*2) keeps the hole and length 3, forEach skips it;
      (25) [,,].length === 2; (26) [].reduce((a,b)=>a+b) throws TypeError but
      [7].reduce(...) === 7; (27) [1,2,3].indexOf(NaN) === -1 but
      [NaN].includes(NaN) true; (28) "a".at(-1), [1,2,3].at(-1) === 3, .slice/.splice
      negative indices; (29) arr.length = 1 truncates, delete arr[0] makes a hole;
      (30) [1,[2,[3]]].flat(Infinity) === [1,2,3]; (31) [1,2,3].join() with a
      null/undefined element renders empty; (32) sort comparator returning
      non-±1 floats still orders correctly.
      Strings & Unicode: (33) "😀".length === 2, [..."😀"].length === 1,
      "😀".codePointAt(0) === 128512; (34) for...of over "😀" yields one code point;
      (35) "abc".charAt(5) === "", .charCodeAt(5) is NaN; (36) replace special
      tokens: "abc".replace("b","$&$&") === "abbc", "$$" → literal "$", "$\`" and
      "$'" prefix/suffix; (37) "x".repeat(0) === "" and .repeat(-1) throws
      RangeError; (38) "a-b-c".split("-",2) === ["a","b"].
      Scope/hoisting/TDZ/closures: (39) accessing a let/const before its
      declaration throws ReferenceError, and `typeof x` in the TDZ throws too
      (unlike `typeof undeclared` → "undefined"); (40) var hoists to undefined
      (read before the line is undefined, not an error) and escapes its block;
      (41) for(var i) closures all see the final i, for(let i) capture per
      iteration; (42) a function declaration is callable before its source line;
      (43) const reassignment throws TypeError; (44) default param TDZ:
      function f(a = b, b = 1) called f() throws ReferenceError.
      this/new: (45) arrow this is lexical; a method extracted to a bare variable
      then called has this === undefined (strict); (46) new F() returning an
      object overrides this, returning a primitive is ignored; (47) constructing
      an arrow throws TypeError; (48) this in a plain nested function called
      inside a method is undefined.
      Control flow: (49) try{return 1}finally{return 2} returns 2;
      try{return 1}finally{...} still returns 1 but runs finally; a throw in
      finally supersedes; (50) switch fallthrough until break, default matched
      last even when written first; (51) labeled continue targets the outer loop.
      Async: (52) microtask ordering — a Promise.resolve().then callback runs
      after synchronous code but before a later-scheduled task; await of a
      non-promise and of a thenable both work; Promise.all preserves input order,
      Promise.race/any/allSettled outcomes; .finally passes the value/reason
      through and a throwing .finally rejects.
      Generators: (53) const x = yield 1 receives the sent value; yield*
      delegates to an array/string/generator and evaluates to the delegate's
      return; gen.return() runs the body finally; throw into a generator is
      catchable by its try.
      Map/Set/JSON: (54) new Map([[NaN,1]]).get(NaN) === 1, new Set([-0]).has(0)
      true and iteration yields +0, object-identity keys distinct;
      (55) JSON.stringify(undefined) is undefined, {a:undefined,b:()=>1,c:1} →
      '{"c":1}', [undefined,()=>1] → "[null,null]", NaN/Infinity → "null",
      JSON.stringify(-0) === "0", a circular object throws TypeError, toJSON is
      honored.
      Destructuring: (56) const {a=1}={a:null} → a is null (default only on
      undefined); const {a=1,b=a+1}={} → a=1,b=2; [a,b]=[b,a] swaps.
      Fast unit tests in a dedicated *.test.ts (split across files if it helps
      readability); no I/O, no LLM, no timers beyond immediate resolution. If a
      case reveals a real interpreter bug, fix it at the correct layer and keep
      the assertion — do not weaken it to match a wrong result.
    status:
      test: open
      commit: open
---

# Context

Follow-up work on `packages/agent-script` after the reducer-language plan
(`docs/plans/agent-script-reducer-language.md`). Sourced from a gaps / sandbox /
performance audit of the interpreter probed against the current tree. Each task
is an independent, landable unit; this plan straight to main, TDD, fast unit
tests only (no file I/O outside memfs, no LLM), monitor the release build after
push.

Three audit threads plus a fourth design ask from the user:

1. **Sandbox integrity** — reads are airtight (sandbox objects are
   `Object.create(null)` / plain `{}` and member reads go through
   `Object.hasOwn` at `src/interp/interpreter.ts:2714`, with arrays/strings on a
   closed-world method table), but the array _write_ path
   (`src/interp/interpreter.ts:2735`) raw-assigns, so `arr.__proto__ = {}`
   mutates that array's prototype while the object write path
   (`Object.defineProperty`) is inert. Low severity — closed-world reads ignore
   the polluted prototype and there is no cross-instance `Array.prototype`
   pollution — but the asymmetry should not exist. (`array-proto-write-guard`).

2. **Performance** — `Scope.snapshot()` is O(depth^2) and runs on every await
   (`flatten-scope-snapshot`); `Date.now()` is read per node visit whenever a
   deadline is set (`sample-deadline-checks`). These two dominate the hot path
   for deep async code.

3. **Missing JS builtins** beyond the reducer plan: ~15 `Math` methods and 6
   constants (`math-methods-and-constants`), `Object.is`
   (`object-is-static`), and `Promise#catch` / `Promise#finally`
   (`promise-catch-finally`) — `.finally` has no workaround today since
   sandbox promises expose only `.then` (`src/interp/promise.ts:111`).

4. **More resume breakpoints** — today the only durable resume point is an
   `await` boundary, where the live state is just the scope snapshot plus the
   in-flight host call. All three breakpoint tasks are runtime-only: no new
   syntax, globals, or language surface — agent-script stays a pure JavaScript
   subset (no `checkpoint()`-style host extras).
   `generalize-resume-breakpoint` extracts the emission so it is not
   await-coupled (the yield point is already discriminated by `kind`) and makes
   the snapshot lazy so high-frequency breakpoints are nearly free when no dump
   fires. `loop-iteration-resume-breakpoint` makes each loop iteration a
   breakpoint so long synchronous (await-free) loops are crash-resumable.
   `generator-yield-resume-breakpoint` makes a generator suspended at a `yield`
   snapshot/restore through the same mechanism, reversing the reducer plan's
   "suspended generators are unsnapshotable" decision.

5. **Crash recovery hardening** — the resume machinery already survives a
   process crash (periodic durable snapshots taken with host calls recorded as
   pending; on restore each pending call is re-driven by
   `src/snapshot/policy.ts` — `re-issue` for idempotent ops, `read-side-effect`
   for effectful ones like `agent.spawn` / `git.*`). Two gaps:
   `resume-policy-required-for-host-modules` removes the silent `re-issue`
   default so an effectful op can never replay-and-double-apply by omission, and
   `crash-time-final-snapshot` writes a best-effort last-gasp dump on failure so
   resume loses minimal work instead of replaying back to the last interval.
   Network failures split cleanly: a call that _rejects_ while the process lives
   is an ordinary sandbox exception (the script retries if it wants); a process
   that _dies_ mid-call resumes from the pending-call snapshot under policy.

6. **Edge-case / complex-situation test suites** — four cross-cutting suites
   that no single feature task covers: `sandbox-escape-red-team-suite`
   (adversarial integrity across every mutation path),
   `resume-crash-integration-suite` (full snapshot -> kill -> restore cycle
   across breakpoint kinds and resume policies),
   `language-interaction-stress-suite` (cross-feature interactions and rich
   snapshot round-trips), and `js-edge-case-conformance-matrix` (50+ of
   JavaScript's notorious corners with host JS as the oracle, asserting the
   documented deviations explicitly). These depend on the feature/hardening
   tasks they exercise and land after them.

Build order: sandbox fix and the two performance fixes are independent of
everything and ship first; the three builtin additions are independent quick
wins; the resume-breakpoint tasks come next (`generalize-resume-breakpoint` is
the shared prerequisite; `loop-iteration-resume-breakpoint` then needs only
that, while `generator-yield-resume-breakpoint` additionally needs the reducer
plan's generator runtime); the two hardening tasks follow; the three test
suites land last, each after the tasks it exercises.
