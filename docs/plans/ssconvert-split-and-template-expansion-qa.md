# Split and native template QA

1. Authenticate the released 1.12.61 archive in `out/ssconvert-lifecycle`.
   Read `src/ssconvert.c:691–736,1110–1236` there; keep primary sources in out.
   Use the captured dependency/plugin/locale profile in
   `docs/ssconvert/sheet-selection-and-range-profile.json`. Native remains a
   separate QA oracle. Attempt a fresh oracle connection and record availability.
2. Before implementation, reproduce template and graph naming discrepancies
   with original in-memory fixtures. Use memfs for namespace effects and injected
   byte I/O. No native processes, host files or LLMs in unit tests.
3. Check whole-filename suffix numbering, all substitutions, literal percent,
   unknown substitutions, trailing percent, nonrecursive Unicode/path names,
   collisions, repeated selected sheets, selection order, saver eligibility,
   temporary focus, unchanged caller ownership, cancellation and first failure.
4. Build the selected workspace closure uncached. Assign a different agent to
   stress and repair with failing regressions before any code repair. Root owns
   exports, integration and Git. Preserve existing unrelated changes.
5. Run package tests/lint and the maintained Safe Bash ssconvert command tests.
   Inspect a screenshot if CLI presentation changes. Record exact coverage and
   remaining renderer/native-oracle limitations. Unsupported cases are not passes.
6. Do not edit README files, push or publish. Purge only owned scratch output.
