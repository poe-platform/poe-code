# First frozen author attempt

Candidate `e192662d2fda90104ab5a7e59c9b5c88bf5838c3` was committed before any
test execution. Its full original outputs remain unchanged in `execution/`.

- GNU5.3: 89 passed, zero failures/skips/cancellations, identity included.
- Historical GNU3.2: 75 passed, 14 failed, zero skips/cancellations, identity passed.
- Six new binding controls: three passed, three failed. Both mutated drivers and
  the mutated unchanged fixture were correctly rejected, but the author's
  `assert.throws({ message: STRING })` expected only the diagnostic first line.
  Node22 includes its actual/expected SHA diff in `AssertionError.message`.
- Consequently the runner stopped before either full89 mutated-driver replay or
  guard-only historical replay. Do not count those unexecuted steps as passes.
- Runner process groups closed; its regular temporary tree was removed.

The next candidate changes only the new negative-control error matcher and the
runner's optional append-only evidence leaf. The replacement requires the exact
diagnostic first line, `ERR_ASSERTION`, `strictEqual`, the fixed literal expected
SHA, and the changed copy's actual SHA. This is not a relaxation of a native
diagnostic assertion. No migration guard, original behavioral assertion, source,
fixture, native result, or historical observation changes between these attempts.
The next candidate must be committed before rerunning all prescribed checks.
