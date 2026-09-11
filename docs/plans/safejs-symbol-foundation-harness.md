---
title: Symbol and guest iterator foundation
---

# Manual validation

This harness fixture grants no capabilities and makes no agent calls.

1. Finish the maintained root tests, lint and normal build first.
2. Run `npm run dev -- harness run docs/plans/safejs-symbol-foundation-harness.md`.
3. Require successful completion and the fixture's Symbol, sync iterator,
   async iterator, conversion and collection assertions.
4. Run `npm run screenshot-poe-code -- harness run docs/plans/safejs-symbol-foundation-harness.md`
   and inspect the resulting image for readable output and successful completion.
5. Record the commands and observed results in the completeness worklog. This
   fixture does not establish full JavaScript conformance or snapshot coverage;
   use the maintained snapshot tests for the latter.
