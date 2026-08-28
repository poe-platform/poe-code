# Pre-execution repair-control phase correction

August28,2026. Source b1ed93fa first replay produced original37/37 predicates and
27/27 author repair families. Both raw captures are preserved. This is not the
independent32 replay: independent075fbe24 remains26/32 historical.

Reviewing the peer's exact injection placement after that replay found an author
control mismatch: author `final-mode-only` mutated lifecycle.mjs during fixture
removal, before final persistence; peer changes storage.mjs **after final.json is
written**. Retain the earlier author case/result as pre-publication coverage.
The versioned author case now mutates storage.mjs during final.json write and
additionally requires `post-persistence-integrity` failure. All other26 repair
families retain their predicates. This is a stricter/different phase, not a claim
that all original inputs were unchanged. No native/child execution was involved.

One static lifecycle refinement shares the final clock sample between the deadline
comparison and admittedAt, removing an unnecessary second clock read before start.
No cap or outcome policy changes; no new historical failure is claimed for this
refinement. The entire revised module/control seal will be committed before rerun.

Preserved first captures on b1ed93fa:
- `captures/synthetic-1787925811648-68206.json.gz.base64`, SHA256
  `2ea9c3426b677dfcf0672d26ce4d6a9fb65c264f14215606d35832f8eb1a045f`.
- `captures/repair-v3-1787925811822-68140.json.gz.base64`, SHA256
  `aaa0141d5d1c419a3cb2b16be660e9dbbcac0f8b329bfe1939ad6f3d34a2f7f5`.

Old b1 module seal: `2829de1f75bd7522a12d1399d387838f132d397bce4700180d1640cb2ade6198`.
Original32+addon11 Bash script/input bytes remain unchanged and unexecuted.
