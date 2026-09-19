# Independent csvgrep regex review QA

Use the actual registered `csvgrep` Shell command with injected UTF-8, frozen C
locale/UTC and a memory filesystem. Do not invoke native programs, create files,
query services or modify historical evidence. Root owns product repairs, exports,
test inventory registration and Git operations.

1. Replay each supported primitive in
   `docs/csvkit/python-regex-reference.json` through a single-column CSV, including
   quoted empty strings, final newlines, multiline subjects and astral text.
2. Compare exact stdout, stderr and status for ordinary and inverted matching.
   These transport comparisons reuse frozen primitive evidence; they are not
   independently captured command-oracle observations or full parity evidence.
3. Check named groups, backreferences, conditionals, scoped flags and reversed
   ranges remain explicit status-78 blockers with no stdout; verify their borrowed
   input generators retire exactly once. Refusal is not a compatibility pass.
4. Check anchored omitted-minimum repetition accepts zero through two `a`
   characters and rejects longer values and other literals.
5. Run the focused `node --import tsx --test
   packages/safe-bash/tests/commands/csvgrep-regex-review.test.ts` route and focused
   ESLint after root refreshes the maintained csvkit build.

Initial replay found no silent mismatch across the original 29 supported
patterns. Two newly supported reference cases, consecutive global flags and
omitted-minimum repetition, were initially red through the compiled package;
root had already reproduced and repaired these cases in source and was rebuilding
the maintained output. These failures must be retained as actual pre-refresh
results, not dismissed as successful measurements.

After root completed the maintained build closure, focused replay passed 33/33
tests, with zero skips or TODOs. This includes 31 frozen patterns replayed in both
directions, five explicit blocker/retirement checks in one test, and the anchored
omitted-minimum edge case. Focused ESLint also passed. The blocker checks establish
honest refusal and cleanup, not Python compatibility; full Python dialect parity
remains unfinished.
