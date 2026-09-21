# SpreadsheetML current candidate QA

Preserve existing edits, keep primary source and temporary output in `out`, and
do not edit README files, push or publish. Root owns integration and Git.

1. Authenticate `out/ssconvert-lifecycle/gnumeric-1.12.61.tar.xz` against the
   requested SHA-256. Inspect the importer event handlers and existing captured
   dependency/plugin/locale profile. Attempt a fresh separate native oracle;
   if unavailable, explicitly distinguish capture replay from new differential QA.
2. Have a different agent independently stress the importer. Reproduce findings
   with failing original in-memory cases before repair; retain negative controls.
3. Run the maintained uncached build closure for `@poe-platform/safe-bash`, which
   includes the ssconvert engine. Run the full ssconvert workspace test and lint
   routes. Run all four maintained ssconvert virtual-command test files and lint
   the command adapter and changed integration test. Do not count these as a
   repository-wide gate.
4. Replay each authenticated original reference input/argv through the built
   public SDK command engine using memfs I/O. Compare exit statuses with the
   recorded native results. Output hashes alone cannot prove semantic equality;
   do not present status replay as a new semantic differential pass.
5. Through the built public safe-bash API, manually list importers, import a
   sparse R1C1 workbook, checkpoint to native Gnumeric XML and replay/recalculate
   to CSV. Run malformed forced import and inspect its diagnostics and unchanged
   destination. Capture and inspect the actual virtual-command output with the
   maintained screenshot renderer. The root poe-code CLI has no ssconvert
   subcommand; screenshot the public virtual command instead.
6. Record source hashes for the exact candidate, completed gates, failures,
   skips, unsupported and unmeasured cells separately. Keep prior measured gaps
   visible; only remove a gap supported by a current regression and evidence.
   Remove only this task's temporary logs/images after inspection.
