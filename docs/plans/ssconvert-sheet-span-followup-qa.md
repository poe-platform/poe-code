# Sheet-span follow-up QA

Execute these steps as an agent; this document is the QA procedure.

1. Authenticate the retained official Gnumeric 1.12.61 source archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Extract only into task-owned `out/ssconvert-sheet-followup`. Inspect
   `rangeref_parse`, `gnm_rangeref_normalize_pp` and `apply_updates` independently.
2. Before implementation, fail an original regression for a qualified singleton
   spanning a 256-by-256 sheet and a 128-by-128 sheet. Include absolute endpoints
   and whole columns as controls. Preserve the existing selection/range evidence.
3. Use the real virtual command with injected original workbook data and memfs.
   Manually export `Large:Small!DY129`, `$DY$129`, and `DY:EZ`; check
   `0,0:128,128`, `128,128:128,128`, and `0,27:127,128` respectively.
   Check trailing text, unknown selections and duplicate selections fail with
   exact diagnostics while retaining the existing destination. Render the actual
   command transcript as a terminal screenshot in `out`, and inspect it.
4. Assign a different agent to stress SDK/CLI, qualified update semantics,
   reversed spans, realm boundaries, budgets, cancellation and negative controls.
   Require failing regressions before further fixes. Root owns exports and Git.
5. Run uncached ssconvert package tests/lint, the selected Safe Bash maintained
   build dependency closure, and the focused Safe Bash command tests/lint.
   Attempt the maintained Safe Bash typecheck, investigating any failure without
   weakening prerequisites or restoring unrelated workspace edits.
6. Record final source hashes, check outcomes and unavailable matrix cells in
   `docs/ssconvert`. Do not claim fresh native comparison from existing captures.
   No persistent workbook checkpoint/replay feature is added; record whether any
   affected execution route provides such a feature. Remove only owned scratch
   evidence after reduction. Do not edit README files, commit, push or publish.
