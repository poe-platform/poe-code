# Authorized test-only constructor refresh

This delta changes exactly eight previously stale characterization cases:

- Five constructor cases in `tests/commands/safejs-stress/upstream-limitations.test.ts`:
  Error, TypeError, Map, Set and RegExp.
- Two Array static cases in the same file: isArray and from.
- One thrown-Error message case in `tests/commands/safejs/local-safejs.test.ts`.

The accepted current-engine review at `b4cde0b` already demonstrated these changes
against actual engine `bb23ec2`: seven unchanged positive desired cases passed;
eight old negative characterizations failed because construction/static behavior
was no longer broken. Upstream scope changes are attributed in that review, not
claimed as a product fix. Original files remain available at `fa6c095`, and
unchanged observations/logs remain in the committed review evidence.

The refreshed assertions require exact successful guest values/stdout/status,
or the actual constructed Error message for an intentional throw. Both signalled
and unsignalled raw controls remain. No runtime is mocked to make these pass,
no signal is removed and no case is skipped. Raw ordinary-record __proto__, raw
pre-abort, action-abort, wrapper invariant and proposed reason cases are not
rebaselined by this test-only change. Different-reviewer verification is pending.

The separate preceding production commit `866a6a5` addresses the demonstrated
public environment-dictionary defect, not these upstream constructor changes.
Its own test changes add one dictionary regression, update two fixtures to assert
the new exact null-prototype representation, and update only the plugin half of
the mixed raw-record characterization to require preserved literal data. The raw
engine loss assertion stays unchanged. This is distinct from the eight stale
constructor assertions corrected here.
