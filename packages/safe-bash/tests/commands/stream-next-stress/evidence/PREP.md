# Preparation checkpoint

- Native input/expected-outcome freeze: `bd4e57b`, captured at
  `2026-08-27T05:46:14.559Z`, before author-source exposure.
- Gated harness initial commit: `ea2d833`. This is preparation, not a passing
  product run. No source test dispatch, source build, or source typecheck has
  occurred at this checkpoint.
- JavaScript `node --check` passed for the corpus, native recorder, and source
  launcher. TypeScript parser-only inspection reported no syntax diagnostics;
  it resolved no imports and is not source typecheck evidence.
- A second native capture at the same pinned runtime reproduced all 153 raw
  controls and all three native workflows exactly for argv/env/status/bytes/
  namespace effects. Only metadata timestamps and private scratch paths changed.
  `native-repeat.json` records its hash and the original unchanged freeze hash.
  This repetition adds zero independent inputs or product passes.
- The secondary Apple/GNU comparison identifies 44 distinct profile differences
  in the frozen inputs. These are native-to-native observations, not 44 product
  defects; raw original outcomes remain authoritative for each profile.
- Native scratch directories are private, ignored, unique and retained. No
  binaries/dependencies were installed, built, or vendored. No long-running
  native process remains from these synchronous bounded captures.
- Existing root exports/default registry, historical cohorts and Plato's frozen
  full gate remain outside this independent source-phase scope.
