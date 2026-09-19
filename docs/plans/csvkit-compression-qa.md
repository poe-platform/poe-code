# Common input compression QA

Read root and safe-bash instructions. Preserve unrelated edits and staging; do
not commit, push, publish or add README content.

1. Run the maintained csvkit and office-package unit tasks, selected workspace
   build closures and each package's lint/typechecks, uncached.
2. Reproduce exact extension selection through the actual Shell, including
   lowercase/uppercase suffixes, optional zstandard absence, arbitrary injected
   extension metadata, explicit/default stdin and outer `in2csv` guessing.
3. Independently stress the injected office gzip provider with in-memory
   concatenated/padded members, inflation budgets and cooperative cleanup.
4. For native qualification, separately authenticate the released source hash
   and reference runtime/dependency profile. Capture stdout/stderr/status and
   file effects for empty, concatenated, truncated and corrupt members at chunk
   boundaries. Do not run native programs in canonical unit tests.
5. Check aggregate member admission before first/subsequent gzip members. Keep
   codec diagnostics, bzip2/xz/zstandard implementations, third-party member counting,
   injected-provider memory/work guarantees and unmeasured buffering profiles
   as explicit blockers until measured. A status-78 refusal is not parity.
6. Run integration discovery checks and normal repository build after cross-
   workspace changes. Report focused checks separately from full repository
   gates. Store temporary evidence in `out` and purge only owned evidence after
   reduction. If CLI rendering changes, capture and inspect screenshots.
