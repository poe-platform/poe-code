# Kamilio integration issues

Resolve the open integration issues reported by kamilio, deliver atomic fixes
directly to `origin/main`, and verify the GitHub releases. Keep unrelated changes
and existing commit identities intact. Issue closure requires verified delivery,
not merely a local passing test.

## Acceptance

- #552: portable `cut` field selection accepts its byte delimiter without a host
  Buffer shim. Cover stdin and files, default tabs, explicit delimiters, multiple
  fields, and empty fields through the portable implementation. Add the reported
  reproduction to the installed browser-package release smoke fixture.
- #555: shell `>` and `>>` use filesystem streaming writes when available; split
  UTF-8 and binary chunks retain exact bytes. Preflight unsupported modes before
  destructive mutation; complete, fail, and cancel output explicitly.
- #556: share the filesystem output lifecycle between redirection, `tee`, and
  network file output, building on `createOutputOperation`. Preserve bounded
  backpressure, shared budgets, no replay after consumption, cancellation and
  writer settlement, and adapter-specific commit-on-success guarantees. Exercise
  `>`, `>>`, `tee`, `tee -a`, and `curl -o`, including empty input, unsupported
  targets, pre/post-consumption failures, quota/output budgets, aborts, multiple
  destinations, and early downstream close.
- #554: expose filesystem capability requirements and supported/partial/
  unsupported command evaluation. Execution and help use the same metadata.
  Distinguish write, append, exclusive creation, implicit/explicit directories,
  rename, timestamp mutation, links, and recursive operations, including the
  existing/missing `touch` and overwrite/append `tee` modes. Reject unsupported
  requirements before mutation without emulation or assuming mandatory methods
  prove support.
- #551: expose a browser/Worker bounded regex provider or command pack for
  `grep`, `rg`, and `sed`. Preserve regex/input/output budgets, cancellation,
  disposal, and adversarial-pattern isolation. Verify the public packaged entry
  in real workerd as well as browser bundling; event-loop RegExp execution is not
  an isolation substitute.

## Verification and delivery

1. Reproduce failures with focused tests before implementation; register added
   SafeBash tests by literal path in its integration discovery controls.
2. Run focused tests, maintained builds, strict package type/consumer checks,
   and package smoke tests relevant to each change. No snapshot or test failure
   waiver, environment weakening, or skipped hook substitutes for validation.
3. Use explicit owned file lists and Conventional Commits. Run normal commit
   and push hooks (`npm test` remains the maintained full unit route).
4. Verify remote-main commit identity after each push and monitor both root and
   scoped-safe-package GitHub release workflows to successful completion.
5. Report local commits, remote delivery, package publication, and acceptance
   evidence separately. Re-query open issues before claiming the goal complete.
