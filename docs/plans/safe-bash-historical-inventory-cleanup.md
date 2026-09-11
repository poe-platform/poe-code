# Safe-bash historical inventory cleanup

The user requested continued reduction after the first 1.60 GB cleanup, followed
by committing and releasing the changes.

## Scope and evidence

The first pass conservatively retained files mentioned in historical manifests.
This pass distinguishes paths that maintained validators actually read from
paths merely printed in an authenticated historical inventory. Hashing a JSON
owner does not imply reading every file listed inside it.

Examples include two identical 15.65 MB source inventories listing roughly
27,000 files each, and a 21.6 MB report embedding 195 historical test phases.
These generated records are unrelated to the size of the runtime implementation.

Preserve exact validator inputs, current test/module dependencies, fixtures,
source, test code, configuration, manifest owners, and unrelated local changes.
Delete only unchanged committed generated data outside that preservation set.
Do not weaken validation rules or rewrite Git history.

## Verification and delivery

1. Verify every candidate against its committed Git blob before deletion.
2. Keep an exact second-batch deletion inventory separate from the first commit.
3. Verify unchanged discovery and authenticated lint/type inputs after deletion.
4. Run focused retained-evidence tests and maintained build/test-runner tests.
5. Commit only the second batch and this plan, push to main, and monitor GitHub
   publication. Report commit, remote delivery, and publication separately.

Referenced historical replay tools may require recovering removed output from
Git. Current source and validation behavior must remain unchanged.

## Results

Removed 14,365 generated data files totaling 1,627,005,396 bytes. Combined with
the first cleanup, this removes 22,801 files and 3,227,477,432 bytes, reducing
tracked package contents from 4.37 GB to approximately 1.15 GB (73.8%).

Retained-evidence testing detected a manifest whose members are resolved through
a directory URL base. All of its deleted members and analogous directory-base
fixtures were restored unchanged before finalizing the batch. No validation
rules or tests were changed to accept missing inputs.

Final retained-evidence tests pass: 97 tests, zero failures or skips. The 282
maintained build/test-runner tests also pass. Broader runtime validation uses
GitHub's committed checkout because unrelated local safe-js builds replace the
shared generated filesystem bundle.
