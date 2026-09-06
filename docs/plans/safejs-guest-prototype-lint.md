---
title: Guest prototype access
---

# Align prototype lint with guest runtime support

## Validated mismatch

The real toStringTag harness was rejected by AS011 on Object.prototype.
Three focused lint controls reproduce rejection of already-supported guest
prototype and constructor properties. Existing runtime controls pass independently:
guest constructor/prototype access works, while native host function metadata
remains hidden for literal and computed keys. Named host-object controls also
confirm that reserved names do not invoke host getters.

## Change

Retire the obsolete blanket AS011 scanner from default lint. Remove its internal
implementation and matching tests; replace the public lint expectation with
guest-model acceptance and boundary checks. Keep AS011 in the known-code list
so existing suppression comments remain recognized, as with other retired codes.
No host admission or runtime capability guards are weakened. The removed files
remain recoverable from Git history.

## Verification and delivery

The initial run had three lint failures and 43 passing runtime/boundary cases.
After retiring the scanner, all 624 focused lint, public API and named/indexed
host-object controls passed; TypeScript explicitly exited zero.
The maintained package suite also passed 13,926 tests with 41 skips, and focused
ESLint exited zero (/tmp/poe-safejs-prototype-lint-package.log and
/tmp/poe-safejs-prototype-lint-eslint.log).

The selected SafeJS closure build passed (23 builds and four import checks).
The real prototype-access harness screenshot was inspected and shows Harness
passed with zero spawns. Evidence: /tmp/poe-safejs-large-spread-build.log and
/tmp/poe-safejs-prototype-lint-screenshot.log. The earlier spread improvement is
verified on remote main as 367464de31ce88ae8c4fc788427b76354d62a75a; its release
runs 34025002234 and 34025002131 were in progress while this work continued.

Run the maintained package suite (including its adversarial tests), focused lint,
the selected workspace build, and an actual prototype-access harness screenshot.
Deliver this lint alignment in its own commit, separate from the pending
toStringTag runtime change. Verify remote main and continue monitoring releases.

Evidence: /tmp/poe-safejs-prototype-lint-boundary-red.log,
/tmp/poe-safejs-prototype-lint-focused.log and
/tmp/poe-safejs-prototype-lint-types.log.

The package README still contains historical unsupported-feature claims. It is
left unchanged under the instruction not to add README content without permission;
this plan records the current behavior and does not rewrite historical baselines.
