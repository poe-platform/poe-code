# Git pull reconciliation

The September 15, 2026 pull failed before rebase because the locally untracked
`docs/plans/pyodide-cloudflare-safe-bash.md` is tracked on remote main.
Local main at `cf70ed3a4` and remote main at `d189aac49` diverged by
471 and 1,285 commits respectively.

Merge the two histories without discarding or replaying local commits. Preserve
pending tracked and untracked work in a named stash and retain the original
untracked plan plus a file-hash inventory in `.git/pull-reconciliation-backup`.
The remote plan contains the original plan and additional acceptance records.

Retain the newer local extension-based shell and combine independent remote
op support with local document/Python command exports, build inputs and archive
prerequisites. Preserve all remote background-job cases with explicit extension
enrollment and the local numeric child-identity contract. Use those failing
cases to correct asynchronous input, return, descriptor-lifetime and function
display regressions without replacing the extension architecture.

The merged lint budget must preserve its tested 16,000-subject bound. The full
shared unit run reproduced the inconsistent 20,000-subject merge choice; the
focused budget tests pass after retaining the local bound.

Finalize a local merge commit, restore pending edits, compare their file hashes
with the inventory, and verify both original histories are ancestors of main.
No push or release is requested.

## Empty dependency maps in the packed-revision gate

After the merge commit, the packed-revision test reproduced another comparison
of omitted lockfile dependencies against the manifest's empty object. npm
omits that empty map. Normalize only the dependency-map comparison; preserve
strict checks of every populated dependency and all other workspace fields.
The same packed-revision test passes after this correction.
