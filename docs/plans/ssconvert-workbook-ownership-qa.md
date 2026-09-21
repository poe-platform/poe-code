# Workbook ownership follow-up QA

Preserve the existing bounded workbook implementation and unrelated edits. No
README changes, commits, pushes or publication. Scratch belongs exclusively in
`out/ssconvert-workbook-followup` and is removed after findings are reduced.

1. Download and authenticate the official Gnumeric 1.12.61 archive against
   `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
   Extract only in the owned out directory. Inspect sheet dimensions, stored-cell
   extent and name lookup against the preserved dependency/plugin/locale profile.
2. Run the original hidden-own-property tests before repair. Check hidden accessor
   denial without execution, hidden data retention, array custom-field denial and
   the null-prototype/ordinary-array positive control. Use only in-memory fixtures.
3. Have a different agent independently stress and fix model/engine boundaries,
   with failing tests before changes. Root owns exports, integration and Git.
4. Run uncached maintained ssconvert tests, lint and selected safe-bash build
   closure. Run the selected command integration tests and integration-inputs
   runner checks. Run the maintained safe-bash typecheck; record prerequisite
   failures without turning focused success into a completed gate.
5. Through built public imports, execute the actual virtual command with a codec
   returning a hidden accessor. Compare SDK denial, status/diagnostic channels
   and untouched destination with the memfs integration negative control. Capture
   and inspect this response with the maintained screenshot tool. The temporary
   capture harness is a host entry point, not an automated QA procedure.
   Independently supply a foreign-realm Uint8Array containing bytes 0 and 255 to
   the built SDK and inspect exact codec input. Read a workbook with engine A,
   attempt to write it with engine B, and check denial before sink effects.
   Supply a foreign-realm plain workbook and check prototype denial. Pre-abort
   with a null reason, provide an import-options getter and verify exact reason
   identity with zero getter calls. These controls do not establish VM isolation.
6. Bind final source/test content with SHA-256 hashes and record verified checks,
   failures and unavailable native/format/profile/checkpoint/replay cells in a
   separate follow-up verification record. No performance claim follows from
   test duration. Delete only the owned scratch after reduction.
