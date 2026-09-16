# Bounded lint subject growth allowance

The maintained guarded lint run admitted 12,000 subjects without lint errors,
then rejected subject 12,001 at
`packages/agent-spawn/src/acp/middlewares/usage-capture.ts`. The run was
incomplete; this was a resource admission failure, not a successful lint result.

Raise only the subject-count maximum from 12,000 to 16,000, providing a bounded
repository growth allowance. Retain every byte, metadata, directory, receipt,
path-authentication and filesystem constraint. Overrides still only lower limits.

Original memfs regressions in `scripts/lint-subject-budget.test.ts` first
reproduced rejection of an explicitly requested 12,001-subject budget. After the
configuration change, that budget admits a real subject read; a 16,001-subject
request remains invalid. A small injected two-subject budget independently
checks that the third read fails before opening its descriptor, counters retain
two admitted subjects, and the failed guard cannot resume. This exercises the
same admission branch without generating thousands of files or using host I/O.

Verification: the new two cases and all 279 existing guard cases pass (281 total).
The coordinating agent must rerun the maintained guarded lint command through
completion before committing this separate infrastructure improvement. No
broader pipeline, release, network operation or README edit belongs to this task.

Final maintained `npm run lint:eslint` completed all 12,285 configured inputs with
zero errors and warnings. The new bounded ceiling therefore covers the complete
observed selection; no exclusion or shorter successful selection was substituted.
