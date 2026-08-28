# Preparation Outcomes

Date: 2026-08-28. These are reviewer preparation outcomes, not authored executor
or product failures. They are retained, not rescored into passing controls.

1. Initial instruction/status command exited127. Live AGENTS and ../AGENTS were
   read first. A zsh loop used the special `path` variable, changing that shell's
   PATH; its final handoff read emitted `zsh:1: command not found: cat`. A new
   shell used `scope_dir`. No persistent environment or foreign file changed.
2. Initial metadata enumeration authenticated FINAL-SEAL, ASSEMBLY-SEAL, RECIPE
   and TOOL-DATA-COPY, then Git exited128 and the reviewer script exited1 for
   guessed `LOAD-TOOL-CLOSURE.json`. Exact diagnostic:
   `fatal: path 'tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/composition-v2/LOAD-TOOL-CLOSURE.json' does not exist in 'b1b8566686769e5e53433048f2058ab09d8c00c3'`.
   The actual final-sealed filename is `LOAD-AND-TOOL-SEAL.json`; its raw hash
   matches the unchanged root-supplied closure hash. Frozen INPUTS is preserved;
   COMPOSITION-AUTHENTICATION records the explicit filename resolution.
3. A later data-summary command read ledger/runtime samples, then Git exited128
   and the reviewer script exited1 for another guessed metadata path. Exact
   diagnostic:
   `fatal: path 'tests/commands/yq-independent-20260828/executor-b8f5d60d-v1/composition-v2/assembly/core/data/sourceManifest.json' does not exist in 'b1b8566686769e5e53433048f2058ab09d8c00c3'`.
   The successful data audit instead follows RECIPE.data's exact authenticated
   paths, including the build source/package manifests. No filename fallback is
   added to authored code and no expected hash is changed.

The corresponding tool records retain the command output and Python
CalledProcessError traces. This note summarizes them; it is not a fabricated raw
stdout capture. All three preparation failures remain failures of those commands.
No authored helper, copied tool or target was executed. The prior74fc review's
separate preparation outcomes remain immutable as well.
