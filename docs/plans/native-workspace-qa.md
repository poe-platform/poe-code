# Native workspace QA

Run these native checks as agent-executed QA; unit tests cover literal shell selectors, Git hook environment isolation without native fixture setup.

1. In a disposable directory under `out`, initialize a Git repository named `decoy`, set a synthetic user, make an empty commit, and detach HEAD. Save its config and HEAD bytes.
2. Run the maintained workspace runner with `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` pointing at that decoy, intercepting its child spawn options. Use only synthetic private/global configuration, and preserve the parent environment.
3. With the captured unit-child environment, initialize a separate `foreign` repository, configure a different synthetic user, and set its branch to main. Verify those changes affect only `foreign`, the decoy config/HEAD bytes stay identical, and the parent hook variables remain unchanged.
4. Execute the declared workspace test selectors through `/bin/sh` with an intercepted `vitest` command and an empty PATH. Verify directory selectors and coverage flags arrive literally, including quoted coverage wildcards; neither missing nor empty `rg` changes selectors.
5. Delete only the disposable evidence after inspection. Record successful native results separately from unit checks.
