# Iterator consumer output array budget

## Validated gap

On September 9, 2026, a source-runtime probe (38331, output c23b31) ran:

```js
let index = 0;
return Iterator.from({
  next() { return { value: ++index, done: index > 2 }; }
}).toArray();
```

With `new Budget({arrayLength:1})`, the run succeeded and returned `[1,2]`.
The input is a direct iterator, so no oversized input array explains the
result. The consumer accumulates an output array without explicitly checking
the array-length budget. This is separate from the new zip row check.

## Required work

- Establish a failing unit regression before editing the consumer.
- Enforce the output allocation limit without changing iterator advancement,
  guest error precedence, realm selection or fatal-budget cleanup policy.
- Cover direct SDK invocation, exact-limit success and limit-exceeded failure.
- Run focused iterator tests and the maintained selected-workspace build.
- Commit this separately from joint iteration. No push or release while the
  release hold remains active.

No runtime fix or completed validation gate is claimed by this plan.

## Implementation progress

Regression 80454 failed the public and direct SDK overflow cases. Its empty
case also hit the independent one-argument call-array limit of `Iterator.from`
at a zero allocation limit; switched that fixture to a zero-argument empty
generator. Run 55976 then had exactly the two intended failures and three
exact-limit successes. Added `budget.allocateArrayLength(values.length + 1)`
immediately before appending each collected value. This uses the existing
fatal-budget exception path and does not execute guest iterator cleanup.

Run 91787 passed ten budget and originating-realm tests in two files. The
third supplied path was nonexistent, so this is not a three-file consumer
gate. The actual consumer suite is
`packages/safe-js/src/interp/iterator-consumers.test.ts` and remains to be run
with maintained build and lint checks before a separate atomic commit.
The joint-only candidate deliberately excludes this consumer change.

Run 14944 then passed all 68 tests across the actual consumer suite, budget
regressions, originating-realm tests and SDK Proxy-consumer tests. Joint
iteration is now independently committed as `1f8b80b7b`; prepare the consumer's
four-path isolated candidate on that base. Build and lint qualification remain
pending. User-staged SafeBash changes retain their original patch identity.

## Isolated qualification

Candidate `/tmp/safejs-consumer-budget.JUon5B/candidate` contains only this
four-path improvement on `1f8b80b7b`. Export 93033 completed before validation;
fingerprint 4d8796 verified all 1,338 source/test/script/package blobs.

- Maintained build 97332 passed all 23 build tasks and four fresh-process
  native ESM import checks.
- Scoped ESLint 81281 completed successfully.
- Related iterator, accounting and iterator-snapshot tests (36080) passed all
  731 cases across 35 files in 19.66 seconds.
- Built SDK on Node 18.18.2 (4e73c4) passed exact-limit success and overflow
  rejection with the expected arrayLength/current/limit error fields.
- Screenshot 16197 was inspected and shows normal CLI iterator collection:
  `screenshots/node-tmp-safejs-consumer-budget.JUon5B-candidate-packages-safe-js-dist-cli.js-tmp-safejs-joint-smoke.7HKEWg-joint.ajs.png`.
  The CLI does not expose an arrayLength flag; overflow behavior was checked
  through the built SDK, not claimed from this screenshot.
- The post-build/test fingerprint matched all 1,338 tracked blobs and eight
  generated Intl copies, with no unexpected source/test/script files.

This is a focused package fix, not a green full-package gate or complete
JavaScript conformance. Commit locally as a separate improvement. No push,
release or issue closure is authorized while the release hold remains active.
