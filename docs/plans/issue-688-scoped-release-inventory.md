# Scoped compression release inventory repair

The September 10, 2026 scoped release run `34480158520` for remote main
`52a76cc880cbcc6088ccd5dc65b70e0a86c24b90` failed its maintained smoke inventory
assertion. Compression added nine commands, but the independently declared
`expectedAgentCommandNames` fixture omitted them. All three publish steps were
skipped; version 0.1.540 was not published by that run. An unchanged rerun cannot
correct this deterministic failure.

Add the nine explicit command names to the shared expected list. Preserve its
sorting, freezing, original names, and all runtime verification helpers. On the
merged hexdump candidate this changes the fixture from 98 to 107 unique names.
The test expectations remain independent of the registry implementation.

Five identical source-mapped inventory checks fail before the correction and pass
after it. These replay existing default, Node, aggregate and browser-source
assertions and check the independently declared names. All 14 helper bodies,
25 other statements, and the full smoke/browser fixture files remain unchanged.
Evidence: `/tmp/issue684-release-fixture.oTMb3A/REPORT.md`.

This is a source fixture correction, not successful package publication or full
installed/browser qualification. Root must run the final merged gates and fresh
packed consumers, push, and verify successful scoped publication separately.
