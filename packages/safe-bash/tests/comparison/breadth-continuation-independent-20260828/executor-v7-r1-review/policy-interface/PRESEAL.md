# Independent policy/interface DATA preseal — 2026-08-28

Owner: different delegated SOURCE/DATA reviewer; only this new directory.
Candidate: `230ed3c6e15617b312760367adf9ede4e5c7ff6a`.
Evidence: `fedfca3c445696a19aaf84ac85bc74cff229d5c2`.
Recipe SHA256: `05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
Interface SHA256: `913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4`.

The accompanying checker imports Node builtins and the existing TypeScript
parser only. Reviewed modules are bytes/AST/JSON, never executable imports.
No engine, child harness, grant, staging, native oracle, network, installation,
C11, cohort, timing or XAN work. Git plumbing below is read-only authority
metadata transport, not an executor child. No instruction member is requested.
No prior original-source checker is rerun. Existing source-policy conclusions
are read as historical evidence, not inherited runtime proof.

Presealed procedure (run from repository root; P denotes this directory):

1. `node "$P/check.mjs" requests > "$P/REQUESTS.txt"`
2. `git ls-tree -r 230ed3c6e15617b312760367adf9ede4e5c7ff6a > "$P/CANDIDATE-TREE.txt"`
3. `git cat-file --batch < "$P/REQUESTS.txt" | node "$P/check.mjs" before`
4. Finish bounded source/interface reading, without execution.
5. `git cat-file --batch < "$P/REQUESTS.txt" | node "$P/check.mjs" after`

One before and one after capture; exceptions/failures remain recorded, not
silently retried or upgraded. The requests/tree files contain metadata only.
The checker emits exclusive JSON captures (each <=262144 bytes), SHA256/mode
metadata only, and a short terminal summary. Repository bound bodies must match
the exact committed blobs, seal size/hash and current filesystem mode. External
tool files receive metadata/hash checks, not execution or Git provenance claims.
Seal namespace enumeration checks new entries except declared excluded runs.
Static relative-import closure is checked without resolving dynamic engines;
dynamic expressions are reported, not falsely certified. AST parsing is syntax
data, not runtime acceptance. The final report must distinguish static findings,
author evidence, and missing composed runtime evidence. No GO is issued here.
