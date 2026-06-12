---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: aggregate-sandbox-memory-budget
    title: Enforce an aggregate sandbox memory budget
    prompt: |
      In `packages/agent-script`, add an aggregate sandbox data budget so an
      adversarial script cannot bypass the existing per-string and per-array
      limits by retaining many individually small values. Extend `BudgetOptions`
      and `BudgetName` in `src/interp/budget.ts` with one explicit aggregate
      limit and expose current/peak usage in runtime stats. Charge sandbox-owned
      strings, arrays, plain objects, Map/Set entries, closure environments,
      promise records, generator state, and snapshot state using deterministic
      logical units rather than V8 heap measurements. Do not charge the same
      retained value twice when aliases reference it, and release charges when
      interpreter-owned values become unreachable or a transient clone is
      discarded. Host values must be deep-copied and charged before becoming
      visible in the sandbox. Budget exhaustion must throw the existing typed
      `SandboxError` with the new budget name, preserve the original error while
      formatting diagnostics, and leave the last durable snapshot restorable.
      Keep the core lightweight and do not add a runtime dependency.

      TDD first with fast in-memory tests covering: many small strings exceeding
      the aggregate limit while each stays below `stringLength`; many small
      arrays/objects/Map entries; aliases not double-charged; failed host-result
      import rolling back its provisional charge; caught budget errors not
      corrupting a later dump; and restore rejecting a snapshot whose decoded
      graph exceeds the configured aggregate budget. Update public config/schema
      and CLI/SDK budget option parity if budget options are exposed there. Do
      not edit a README without explicit user permission.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: bounded-snapshot-decoder
    title: Validate hostile snapshots before restore
    prompt: >
      Harden snapshot restore in `packages/agent-script/src/snapshot` and the

      public restore entrypoints against a snapshot file that is malformed,

      attacker-controlled, truncated, or internally inconsistent. Introduce one

      structural validation pass before constructing runtime objects. Validate

      the dump version and source hash plus every tagged union discriminator,

      numeric count, AST node id, scope id, parent reference, closure capture,

      promise/host-call reference, generator state, collection entry, and resume

      cursor. Reject duplicate ids, dangling references, cycles where the schema

      requires a tree, impossible pending/settled combinations, non-finite or

      negative counts, unsafe integers, excessive nesting, and values exceeding

      configured string, collection, call-depth, or aggregate-memory budgets.

      Never allocate from an unvalidated attacker-provided count. Return stable,

      typed snapshot-validation errors with a JSON-path-like location; do not

      leak host stacks or partially mutate the interpreter. Preserve backward

      compatibility only for the current declared dump format version; do not

      guess or repair corrupt state.


      TDD first with table-driven mutation tests derived from valid snapshots:

      missing and duplicate scope ids, dangling parent/capture/node ids, cyclic

      scope parents, oversized counts, unsafe integers, unknown tags, invalid

      promise and generator states, deep object graphs, prototype-shaped keys,

      truncated JSON, and a valid maximum-size snapshot. Tests must use memfs or

      in-memory snapshots, remain fast, and prove no host module call runs
      before

      validation succeeds.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: iterative-snapshot-graph-walk
    title: Make snapshot graph walks stack-safe
    prompt: >
      In `packages/agent-script`, make all untrusted or script-shaped graph
      walks

      used by `structuredClone`, snapshot serialization, snapshot validation,

      restore, and final-result export iterative or explicitly depth-budgeted so

      deeply nested arrays/objects cannot overflow the host JavaScript stack.

      Reuse the sandbox call-depth or a dedicated data-depth limit consistently;

      do not rely on host `JSON.stringify` recursion for safety. Preserve object

      identity, aliases, cycles supported by the snapshot format, dangerous-key

      neutralization, deterministic ordering, and existing serialized output for

      normal inputs. A depth failure must be a typed sandbox/snapshot budget

      error, not `RangeError`, process termination, or a partially written dump.

      File snapshot writes must remain atomic and retain the previous valid

      snapshot when serialization fails.


      TDD first with fast tests for thousands of nested arrays and objects,

      mixed cycles and aliases, deep closure/scope graphs, deep host-return
      values,

      and failure during an atomic file-backend write using memfs. Verify a
      value

      just below the limit round-trips byte-identically, a value above the limit

      fails deterministically, and the prior snapshot can still resume.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: exactly-once-host-call-resume
    title: Make pending host calls resume exactly once
    prompt: >
      Audit and harden pending host-call persistence across dump/restore in

      `packages/agent-script/src/interp`, `src/snapshot/policy.ts`, and the
      runner

      entrypoints. Give every host call a stable run-scoped id and explicit

      lifecycle (`created`, `running`, `settled`, `consumed`, `cancelled`). A

      restored interpreter must never silently re-issue a non-idempotent host

      call, consume one result twice, attach a stale result from another run, or

      report an unhandled rejection twice. Require the resume policy/provider to

      prove the call id, source hash, module/export identity, and argument
      digest

      match before accepting an external result. Define deterministic behavior

      for snapshots taken before dispatch, during execution, after settlement

      but before await consumption, after cancellation, and after process death.

      If safe continuation is impossible, fail closed with a typed resumability

      error that tells the caller whether reset or external reconciliation is

      required. Do not add provider-specific branching.


      TDD first using a fake non-idempotent host module with an invocation
      counter

      and deferred results. Cover dump/restore at every lifecycle boundary,

      repeated restore of the same snapshot, stale/wrong call ids, mismatched

      arguments, rejection, abort races, process-death simulation, Promise.all

      with multiple pending calls, and caught versus unhandled rejection. Assert

      exactly-once invocation and consumption, deterministic event ordering, and

      a restorable last-good snapshot after every rejected resume attempt.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: reentrant-interpreter-state-guards
    title: Guard re-entrant callbacks and iterators
    prompt: >
      In `packages/agent-script`, add explicit running-state guards around every

      interpreter object whose invariants span a host or sandbox callback:

      generator `next/return/throw`, iterator adapters, array sort/comparator
      and

      collection callbacks, promise resolution hooks, subset callbacks passed to

      host modules, and dump/restore scheduling. A callback may invoke another

      independent interpreter, but it must not recursively drive the same

      generator/iterator continuation, restore the same run while it is active,

      settle the same promise twice, or mutate a collection in a way that leaves

      a stale cursor or stale length in use. Revalidate lengths, cursor bounds,

      ownership, cancellation, and lifecycle state after each callback boundary.

      Throw a stable sandbox error for forbidden same-object re-entry and always

      clear guards in `finally`, including throw, abort, budget exhaustion, and

      early iterator return paths. Preserve legitimate nested agent-script calls

      that use separate run state.


      TDD first with adversarial callbacks that recursively call generator

      methods, invoke iterator `return()` while `next()` is active, mutate
      sparse

      arrays during iteration/sort, settle a promise from inside its own
      handler,

      call dump during a host callback, and attempt restore while the original

      run is active. Verify no duplicate/skipped iterations after resume, all

      finally blocks run exactly once, guards recover after exceptions, and an

      unrelated nested interpreter remains supported.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: adversarial-interpreter-corpus
    title: Add a permanent adversarial runtime corpus
    prompt: >
      Add a fast, deterministic adversarial corpus for `packages/agent-script`

      based on transferable failure classes recorded in

      `docs/research/quickjs-issue-edge-case-audit.md`: parser/runtime crashes,

      deep recursion, pathological regular expressions, malformed serialized

      state, promise lifecycle races, iterator re-entry, circular module graphs,

      resource exhaustion, and failures while formatting another failure. This

      is not a request to run QuickJS or copy its C-specific tests. Create small

      agent-script reproducers and mutation/property tests that assert one of:

      successful deterministic completion, a documented lint error, or a typed

      sandbox/snapshot error. No input may crash the process, hang, leak a host

      stack, execute an unregistered module, or change output after
      dump/restore.


      Include a bounded grammar-based parser smoke fuzzer and a snapshot mutator

      seeded from valid dumps. Use fixed seeds, strict case/time caps, and print

      the seed plus minimized source/snapshot on failure. Add a targeted subset

      of relevant Test262-style semantic cases only when the syntax is
      supported;

      unsupported ECMAScript features must be skipped explicitly rather than

      widening the language. Wire the fast corpus into the package unit-test

      command, while any slower fuzz campaign gets a separate opt-in npm script.

      Tests must not create files except approved snapshots, query an LLM, or
      use

      wall-clock sleeps.
    status:
      implement: done
      test: done
      commit: done
name: quickjs-issue-edge-cases
state: archived
---

# Context

This plan follows a complete review of all 423 GitHub issues in
`quickjs-ng/quickjs` as of June 11, 2026: 65 open and 358 closed. The per-issue
ledger is `docs/research/quickjs-issue-edge-case-audit.md`.

The plan intentionally excludes QuickJS-native C ownership, ABI, compiler,
platform, packaging, and standards-feature work. It also does not duplicate
controls already present in agent-script: node-step and call-depth budgets,
per-value string/collection limits, registry-only modules, source-hash/version
checks, deterministic clock/random snapshot state, atomic snapshot replacement,
and a custom regular-expression step cap.
