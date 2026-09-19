# csvgrep QA

1. Run the package unit route uncached. Check the frozen csvgrep observations
   and source-driven regression cases; count skipped/todo cases as blockers.
2. Run package lint and the maintained selected workspace build closure.
3. Build safe-bash's selected closure, then have a separate agent run the actual
   Shell/VFS stress suite and focused integration lint. Check stream cleanup,
   eager file opening, original numbering and exact output/status.
4. Review the executable's action inventory for collisions and absent common
   type/locale flags. Verify SDK file-path settings use the injected capability.
5. Treat unsupported regex dialect cases as blockers. Do not infer full Python
   regex parity or full suite parity from focused passing cases.

No commit, push, release or README update is authorized by this procedure.
