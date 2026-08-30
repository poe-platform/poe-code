# Initial inspection errors and command qualifications

Two read-only shell inspection attempts encountered shell mistakes before capture. Neither wrote product or evidence files, nor ran tests. They were corrected before the source and diagnostic inspection completed.

1. The initial command used this loop variable in zsh:

   `for path in /Users/AGENTS.md /Users/kjopek/AGENTS.md /Users/kjopek/Workspace/AGENTS.md; do if [ -f "$path" ]; then printf '\n--- %s ---\n' "$path"; cat "$path"; fi; done`

   zsh's special `path` array changed command lookup within that one shell invocation. The commands preceding the loop (`pwd`, `git rev-parse --show-toplevel`, `git status --short`, `git diff --cached --name-only`) succeeded. Subsequent diagnostics were exactly:

   ```text
   zsh:1: command not found: cat
   zsh:1: command not found: find
   zsh:1: command not found: nl
   zsh:1: command not found: cat
   ```

   Exit 127. A fresh shell restored command lookup. `cat ../AGENTS.md`, `rg --files -g AGENTS.md -g '!node_modules' -g '!.git'`, `cat AGENTS.md`, `nl -ba tests/commands/regex-execution/continuation/glob.test.ts` and `cat tests/integration/owned-output-production-rebase/author-public/results-v1/FOREIGN-TYPECHECK.txt` then succeeded. Applicable rules were read; no descendant AGENTS applies to either authorized write scope.

2. A subsequent grouped inspection's last command was:

   `rg --files tests/commands/regex-execution/continuation src/regex* src/commands/expr*`

   zsh rejected the unmatched `src/regex*` before executing that final command:

   ```text
   zsh:1: no matches found: src/regex*
   ```

   Exit 1 for that grouped inspection. Earlier source/protocol/config reads in that invocation succeeded. Explicit existing paths were used afterward.

Some combined inspection tool output was truncated by display limits; smaller follow-up reads inspected the exact fixture, diagnostics, protocol discriminants, overloads, worker loading and applicable rules. The capture files retain the untruncated original diagnostics and source snapshots independently of those display limits.

All validation/capture commands themselves completed as recorded. Exit 2 in the original focused typecheck and exit 1 in the three assertion-mutation runs are intentional negative evidence, not hidden passing results. No broad test gate, native oracle, recapture script or existing evidence-writing driver was invoked.
