---
title: Object rest assignment targets
---

# Object rest member targets

Four native-valid member rest assignments failed to parse, while five invalid
forms were correctly rejected. Evidence: /tmp/poe-safejs-object-rest-parser-red.log.

Allow identifier or non-optional member targets in assignment-object rest parsing
and expression-to-assignment-pattern conversion. Keep declaration rest bindings
identifier-only and reject call expressions, optional chains, nested patterns,
and trailing commas. This syntax change is delivered separately from the pending
runtime assignment-reference ordering correction.

The focused parser and ordering checks passed 716 tests (one skipped).
Evidence: /tmp/poe-safejs-object-rest-parser-focused.log. Run the maintained
package tests, scoped lint/types, workspace build, and the accompanying real
harness screenshot before committing/pushing the syntax change to main.

The final maintained SafeJS suite passed 13,960 tests with 41 skips. Scoped ESLint
and TypeScript exited zero. Evidence:
/tmp/poe-safejs-destructuring-order-package-final.log,
/tmp/poe-safejs-destructuring-order-eslint.log and
/tmp/poe-safejs-destructuring-order-types-final.log.

Additional native controls exposed optional chains hidden below a final ordinary
member (`target?.value.x`). Track parenthesized expression boundaries during
parsing and reject an optional chain along the rest target's member/call base,
without rejecting optional expressions inside computed keys or parenthesized
bases. Three new negative controls failed before this guard; all 25 focused
parser/order controls then passed. Final package verification passed 13,965 tests
(41 skipped), with lint/types also passing. Evidence:
/tmp/poe-safejs-object-rest-chain-red.log,
/tmp/poe-safejs-object-rest-chain-focused.log,
/tmp/poe-safejs-destructuring-order-package-verified.log and
/tmp/poe-safejs-destructuring-order-eslint-final.log.

Remote main advanced independently to Safe Bash fix 72d29b57f. It was integrated
by fast-forward after tests; no SafeJS paths overlap and the protected staged
patch stayed unchanged. Build and harness checks run on that integrated base.

Final build passed: 23 selected workspace builds and four fresh-import checks
(/tmp/poe-safejs-destructuring-order-build-final.log). The real syntax fixture
screenshot was inspected and shows Harness passed, zero spawns, and readable
results (/tmp/poe-safejs-object-rest-targets-screenshot.log).
