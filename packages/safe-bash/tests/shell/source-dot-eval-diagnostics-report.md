# Current-shell diagnostic fixes — author handoff

August27,2026. Starting HEAD `013c1afdbda1d017beacb2c61771ef8a32cad41b`.
Only the two root-routed findings from independent0934888/replay42baad36 are
addressed. Only independent `REPORT.md` and `pre-ready-validation.json` were
read for these findings; no frozen fixture definitions or independent43/expanded7
cohort was executed. Initial source9172632 and evaldd2505b commits stay untouched.

## Two production changes

Only `src/shell/runtime.ts` changes (two inserted/two deleted lines):

1. Failed command lookup uses the existing diagnostic helper. A root invocation
   without an explicit script name now receives the established `shell: line N:`
   default instead of omitting the entire prefix. Existing child/bash/sh/file
   names and line offsets are preserved. Status remains127; no command-specific
   name, registry or resolution special case is introduced. The isolation finding
   was a parent diagnostic after a child completed, not leaked child state.
2. Source/dot classifies a followed directory before the generic non-regular-file
   branch, reporting the actual invoking builtin and `is a directory`. Other
   file kinds, errors, statuses and effects retain the previous path.

No syntax, state, budget, descriptor, lifecycle, JSON/BOM or public API expansion.
Contracts, exports, manifests, runtime dependencies, core commands and FS source
are unchanged by this author.

## Native controls and red evidence

16 independently authored sources × root/bash/sh frames = **48 rows/profile**.
Both actual profiles ran the entire cohort before the fix, not selected per row:

- GNU5.3.0(1)-release,
  `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical GNU3.2.57(1)-release, `/bin/bash`, SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

Native bash/sh child commands resolve through case-local symlinks to that same
profile's binary; no historical child is mislabeled primary. File controls use
explicit profile bash/sh interpreters, not native shebang selection. Parent argv
is `--noprofile --norc -c SOURCE shell`, argv0 bash/sh; root models Shell.exec's
default name. Environment is scrubbed to C locale, HOME=isolated cwd, TZ=UTC,
empty initial PATH, then a script assignment to the profile-only bin directory.
Native calls use the existing author helper's 2.5s group deadline and256KiB cap.

Coverage includes multiline root lookup, command prefix, child function isolation,
default/explicit child names, eval/source locations, bash/sh file locations,
source versus dot directory errors, symlink-to-directory and file-nested source.
The VFS reproduces captured cwd coordinates. Exact stdout/stderr bytes, status
and fixture-file bytes are compared without output normalization or stderr masks.

| Cohort | Before | After |
| --- | --- | --- |
| Primary diagnostic rows | 31/48 | **48/48** |
| Historical diagnostic rows | 9/48 | **12/48** |
| Previous source/dot/eval author | not rerun red | **86/86** |
| Frozen72 +132 +211 | not rerun red | **415/415 assertions**, guard invalid |

All17 primary mismatches were diagnostics from the two routed causes. The
remaining36 historical raw differences are `-c` diagnostic-line conventions;
file/source-file positions match. These remain failing comparisons, separate
from the previous13 source/eval historical differences, original9 historical
findings, and custom5 first-read failures. No skip, xfail, normalization or
expectation change. None of the requested old tests became stale; broader suites
were not run and no blanket compatibility claim follows.

GNU's command-search manual specifies diagnostic/nonzero127 behavior:
`https://www.gnu.org/software/bash/manual/html_node/Command-Search-and-Execution.html`.
Pinned GNU5.3 `builtins/evalfile.c` selects builtin_error for sourced files and
checks S_ISDIR before generic regular-file classification; inspected SHA256
`f7a500b1523fa5f9a1ed07371d832ba084c2639aa3138309702f2101c2947c0f`.
Exact formatting is backed by both full live native captures, not inferred from
the manual or copied from the independent expectations.

## Source provenance and qualifications

Runtime before: `1d303091932cfca31e1c1b0de7e35609173db7bcd71cc2fb14fd5740faeb9491`.
Runtime after: `e886b64536c7496769fdbe856aafb0e73ee88ace47c2a3ca9cb3cc71f11f8c4a`.
Unchanged Shell/BOM: `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.

Node22.22.2, actual product TS imports via tsx. The load hook records34 distinct
product `.ts` dependencies for each test cohort; runtime.ts loaded the after hash
throughout. Author48 and previous86 have stable endpoint/import guards.
During legacy415, foreign `src/fs/s3/authority.ts` and `filesystem.ts` changed;
four authority import observations differ from the ending hash. Thus **legacy's
guard is invalid despite415 passing assertions**, not product-wide acceptance.
Both before/after values and actual imported hashes remain in validation JSON.
No foreign source was edited, reverted or retried for green.

Global/build/benchmark `tsc --noEmit` all exit0, with **963/296/411** prelisted
actual compiler inputs, zero changed/unguarded inputs during their respective
snapshots. No emitting compiler. These separately named snapshots do not certify
a clean final worktree, transient writes/reverts or subsequent foreign revisions.

Captures, red/full comparisons and validation contain case/source hashes, actual
versions, bytes/status/effects, TAP, commands, source/import guards and compiler
inputs. Final audit records unchanged owned source/frozen files and cleanup.
Native parents await close and kill their group; captured temp directories are
removed. Validation/test children finish under hard deadlines, no watchers or
SIGSTOP. Public export names/API/dependency changes: none.

## Reproduction and remaining scope

Use NEW output files; existing evidence is immutable:

```sh
node --import tsx tests/shell/source-dot-eval-diagnostics-native.ts capture /tmp/diagnostic-native-new.json
node --import tsx tests/shell/source-dot-eval-diagnostics-native.ts compare /tmp/diagnostic-compare-new.json
node tests/shell/source-dot-eval-diagnostics-verify.mjs /tmp/diagnostic-validation-new.json
```

Comparison exits1 for the historical losses; validation writers retain each
child status rather than treating their own exit as acceptance. No independent43,
expanded7, old9/custom5, NUL, lifecycle, jq/BOM or full-suite rerun. BOM16 and bytes22
acceptance stays unchanged; the separately reviewed old jq diagnostic is not
reclassified. Root must run independent acceptance after the new READY; this
author checkpoint is not full source/dot/eval closure, universal Bash or superiority.

Final audit02:27:11Z:16 recorded validation/test PIDs and groups absent, all96
native case directories absent,11 frozen regression/finding files byte-identical
to starting HEAD. Seven actual runtime import observations all match the final
runtime hash. After the last compiler snapshot, three foreign structured-command
files changed (interpreter.ts, parser.ts, values.ts); exact paths are retained
in `source-dot-eval-diagnostics-audit.json`. They were not edited or rerun here.
