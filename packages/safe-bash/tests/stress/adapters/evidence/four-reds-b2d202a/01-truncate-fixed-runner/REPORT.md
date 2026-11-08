# S3 truncate expectation correction

Base pin: b2d202a7a2c8831df9c2d143bc43c74d1a099b14. The unchanged four original rows reproduce 0/4; the unchanged adapter-stress suite reproduces 66/70, exactly the original four failures. Those fresh results are in the sibling 00-original-fixed-runner evidence. Original ebe36d2 evidence is untouched.

The shared FileSystem exposes optional truncate but no truncate capability. This fixture supplies MockS3Client with conditionalPut; src/fs/s3/filesystem.ts implements guarded bounded truncate. The backend-name rejection was obsolete. Only S3 is removed from the old unsupported branch; WebDAV ENOTSUP/no mutation remains required. The existing shrink/grow path now exercises S3's exact bytes, padding and size, including preservation after EINVAL.

New independent controls require typed ENOTSUP without mutations for a transport lacking conditionalPut, typed EAGAIN with the competing writer's exact bytes/metadata preserved, EFBIG/no writes at the limit, and zero-length truncation with exactly one ETag-conditional PUT and no GET. No provider capability is invented, no errno alternatives or skips are introduced, and no product source changed.

Fresh isolated results: truncate core 4/4; new profile 3/3; existing S3 mutation regressions 14/14. All exits 0, zero skipped/TODO/cancelled. Raw commands/results, source hashes and before/after stability accompany this report. These gates overlap later backend validation and must not be summed as unique product cases.

The first two setup attempts (00-original and 01-truncate) did not execute product cases: a copied dependency directory named tooling broke Node package resolution for esbuild. Their raw failures are retained separately; corrected fresh runs use a directory actually named node_modules. Those loader failures are not classified as product failures or counted as acceptance.

S3 creation-mode/X_OK remains unresolved: current shared Markdown only specifies rmdir. Local S3 docs describe advisory modes, but do not settle a shared security requirement. The listed Curie agent ID was unavailable; root must obtain the precise ruling recorded in the final coordination question. The three other original rows are not waived by this commit.
