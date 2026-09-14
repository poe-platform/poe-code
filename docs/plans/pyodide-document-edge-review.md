# Pyodide document edge review

Review the pinned 314.0.6 browser-worker experiment as a user. Keep production
`python FILE` support open until actual shell dispatch and canonical filesystem
preservation are qualified. Preserve preceding captures and unrelated changes.

1. Rerun the existing document script in MEMFS, immediate canonical `/work`,
   delayed canonical `/work`, and canonical-root profiles with fresh captures.
2. Exercise retained binary file handles, spooled temporary-file rollover,
   openpyxl write-only/read-only mode, XlsxWriter constant-memory mode, empty and
   corrupt inputs, recovery after parse failures, timestamps, and package resources.
3. Reproduce experimental bridge/shutdown defects before fixes. Keep real Pyodide
   tests explicitly separate from unit discovery; unit checks neither download
   assets nor write host files.
4. Diagnose root relocation using actual runtime observations. Qualify any
   experimental adjustment in a real browser; do not hide canonical `/lib`, copy
   user workspaces into MEMFS, or present private loader adaptation as production
   architecture admission.
5. Inspect final result screenshot and rendered PDF page, compare artifacts to
   the canonical parent filesystem, and check worker handle cleanup.
6. Record exact results, input hashes, commands, fixes and unresolved limitations
   in `packages/safe-bash/docs/pyodide.md`. No README edits, commit, push, or release
   is part of this review.
