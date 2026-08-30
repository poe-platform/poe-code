# Infrastructure attempts

- Preparation attempt 1: the selected historical diagnostic evidence directories
  exceeded the 64 MiB `spawnSync` buffer during `git archive`. No archive or
  product files were written. The empty owned `.work` directory was removed.
- Preparation attempt 2 narrows the declared archive inventory to frozen inputs,
  scripts, candidate source/tests and configuration, not old multi-megabyte
  execution inventories. This changes archive selection only, never test inputs
  or assertions. The complete repository (over 2 GB) is not this scoped archive.
- Attempt 2 authenticated archive files, then stopped because a later candidate
  `sequencing-design-20260827/DESIGN.md` was not present at the prefreeze commit.
  Attempt 3 authenticates every entry actually present at the named prefreeze
  commits and reports later candidate entries separately. No frozen bytes change.
- Shared regression first attempt: 105/110, five infrastructure failures because
  the declared archive omitted search/grep helper modules and public-child.mjs.
  The qualified rerun uses a separate committed-candidate archive with those
  three prerequisites authenticated; the original archive remains untouched.
- First postcandidate supplement: 17/23. Six preabort identity assertions passed,
  then verifier code incorrectly assumed cleanup registration occurs even before
  any acquisition/admission on an already-aborted invocation. Reading the absent
  trace entry threw TypeError. These erroneous supplemental assumptions are
  preserved, not counted as product failures or silently fixed. Positive worker
  cleanup-registration checks and unchanged frozen cancellation controls remain
  separate evidence.
- Shared rerun with prerequisites: 275/276. Its native scratch was incorrectly
  under the repository; rg discovered the ancestor `.git`, changing the
  `gitignore requires git by default` oracle fixture behavior. No product bug or
  expectation change is inferred from this profile contamination.
- Outside-Git shared rerun: 276/276, followed by a verifier empty-temp assertion
  failure because tsx created its `tsx-501` tooling cache. The whole scratch was
  nevertheless removed in `finally`. A final separate run retains every test
  and assertion, disables tsx cache only (`TSX_DISABLE_CACHE=1`, inspected in the
  installed development tool), and checks the empty scratch postcondition.
- Initial named runtime used the inherited host environment. It is retained as
  `named-initial-unqualified-ambient.json`, not mislabeled C. Separate explicitly
  bound C and en_US.UTF-8 host environments produce identical parsed results.
- Corrected preabort checks are NEW postcandidate moved-runtime supplements.
  They assert exact identity, zero output, and no worker acquisition, without
  requiring cleanup registration when no resource is ever admitted. The six
  original mistaken supplemental assertions remain red in their own evidence.
