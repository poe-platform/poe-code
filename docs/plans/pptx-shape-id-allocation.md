# Drawing identity allocation

Owner: root. Scope: shared drawing ID allocation, original tests and this evidence.
Do not stage unrelated work. No README edits, push or release.

1. Reproduce sparse-ID insertion for shapes, pictures, tables, charts and connectors using original memfs package data.
2. Add a drawing-local allocator with unsigned ID admission, nested IDs, maximum-plus-one and exhaustion fallback.
3. Test turbo enable/disable, reservations, malformed/duplicate IDs and externally changed owner snapshots.
4. Run maintained pptx tests and lint after delegated model work stabilizes; commit owned files only.

Red evidence: four insertion cases returned 2 instead of 18 with an existing shape ID 17. Shape insertion already returned 18. Missing allocator module made the initial unit suite fail collection.
Green focused evidence: 28 tests passed (23 allocator cases, five package insertion cases).

Agent QA: inspect help/schema after command changes; inspect preserved XML/IDs after mixed model additions and save/reopen. Unit tests use original tiny XML and memfs, never downloaded decks. No disposable QA inputs were acquired for this change.

Final maintained validation: 6096 tests passed across 223 files; pptx lint and
the selected pptx build closure passed. No push or release.
