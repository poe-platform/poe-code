# csvkit bulk decoder and compressed-source user QA

1. Read root/scoped instructions and preserve unrelated worktree/index changes.
2. Reproduce bulk-only input codec retention after producer advancement with a
   failing in-memory test. Admit every retained chunk before copying it, and
   separately admit the joined allocation. Check reused buffers and cancellation.
3. Assign independent actual-Shell compression/cleanup stress to another agent.
   Check malformed members, pending producer cancellation, permission failures
   and reused compressed buffers. Refusals are not native diagnostic parity.
4. Run uncached csvkit workspace tests/lint, selected csvkit and safe-bash build
   closures, focused Shell tests and maintained test-discovery checks. Record
   exact results and limitations in docs/csvkit. No README/Git delivery changes.
