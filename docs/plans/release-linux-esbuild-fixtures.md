# Linux esbuild fixture portability

The release Bash shards exposed two assumptions hidden by macOS installations:
npm can hardlink the esbuild launcher to its native binary, and that launcher
therefore cannot be interpreted as JavaScript by Node.

- Admit only the native package's bin/esbuild pair when copying the locked build
  tool into the committed-export fixture. All other inputs remain single-link;
  byte limits and identity checks before and after reads remain enforced.
- Copy to independent destination files. Memfs regressions cover separation,
  rejection of other hardlinks, and mutation during an admitted read.
- Launch the copied native executable directly in the public cleanup fixture.

Validation: the new hardlink regression failed before the fix, then all three
focused hardlink tests passed. The archive control suite passed 199 tests and
the affected public cleanup suite passed all 20 tests. The Linux CI failures
provide the failing case for native executable dispatch; rerun release gates
after pushing these fixture-only corrections.
