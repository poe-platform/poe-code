# Guarded default rename: obsolete refusal, not new backend support

Frozen base: b2d202a7a2c8831df9c2d143bc43c74d1a099b14. The original default-refusal test fails in 00-original-fixed-runner; its raw output remains immutable. Existing source defaults allowNonAtomicRename to true, requires conditional publication and deletion, and advertises atomicRename:false. The shared rename interface does not require this obsolete opt-in policy. The S3 README documents the explicit false opt-out.

Correction: retain the original no-host-call ENOTSUP assertion for explicit allowNonAtomicRename:false. Separately require default creation and replacement using guarded copy, buffered PUT, and streamed PUT, exact binary namespace effects, source/destination conditions, and atomicRename:false. Missing guard profiles reject before any request. Deterministic destination/source races assert typed S3RenameError, phase, paths, exact acknowledged keys, and surviving winner bytes. Existing partial directory failures now assert the entire raw key set and every object's bytes, not only array lengths.

Results: selected rename stress 16/16 (including 12 new controls); existing owned backend rename guards 34/34. Zero skips, cancellations, TODOs. No product source changes. Input hashes before/after are equal; exact argv, exit codes, raw output and all hashes accompany this report.

This remains non-atomic copy/delete, with acknowledged prior effects and no rollback. ETags are not incarnation identity (ABA remains), listings are not snapshots, and no tree-wide transaction or external-writer exclusion is claimed. No adapter-tools matrix, S3 policy tests, remote-cancellation tests, or immutable ebe36d2 evidence changed.
