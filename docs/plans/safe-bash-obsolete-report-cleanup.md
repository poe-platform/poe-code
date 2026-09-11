# Safe-bash obsolete report cleanup

Continue the user-requested reduction with generated textual output and benchmark
reports that are outside current input dependencies.

## Scope

- Remove obsolete `.txt`, `.tap`, encoded captures, and large JSON reports whose
  generic filenames occur only as output writers or unrelated local fixtures in
  current modules.
- Remove generated benchmark results, measurements, logs and inventory reports.
  The maintained benchmark runner creates fresh reports and excludes them from
  source fingerprints.
- Preserve current fixture/configuration/workload data, executable sources,
  tests, authenticated owners, actual guard reads, module dependencies, directory
  URL-base descendants, and unrelated local changes.
- Recheck each candidate's committed blob and file identity before deletion.

## Results and verification

The test-data subset removes 1,570 files and 222,250,033 bytes. The benchmark
subset removes 1,414 files and 203,785,772 bytes. Combined: 2,984 files and
426,035,805 bytes.

All three cleanup commits together remove 25,785 artifacts and 3,653,513,237
bytes. Tracked package contents fall from 4.37 GB to approximately 720 MB (83.5%).
Runtime source remains approximately 3.24 MB. Remaining data includes required
fixtures and historical material that has not been proven safe to remove.

After both subsets were deleted, the 97 retained-evidence tests passed without
failures or skips, the exact 642-test discovery list was unchanged, all 1,804
lint inputs authenticated, and full typecheck-input verification passed.

Commit only the verified deletion manifests and this plan. Push the atomic change
to main and monitor GitHub publication. Preserve Git history; historical replay
tools may recover removed captures from earlier commits.
