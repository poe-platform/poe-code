# Independent primary-source register

Access/review date: **2026-08-28, America/Chicago**. GNU edition identity is
**Bash Reference Manual 5.3, updated May 18, 2025**, not a “latest Bash” claim.
No native binary/manual file was opened or refreshed. No external text is vendored;
all claims below are short paraphrases, with no direct quotations.

`INDEXED` means web.run search returned relevant text from the official URL;
it does **not** mean direct HTTP body retrieval or an authenticated edition hash.
The six requested GNU direct opens returned no usable result/text in this review.
Root separately reported timeouts: this review cannot infer its own HTTP status
from an empty tool result. Search text remained available. No HTTP status/content
hash is invented. `OPEN` means web.run returned page text; web extraction is not
a raw-byte hash receipt. Node HTTP fallback was unnecessary and not used.

| ID | Official primary URL | Retrieval and narrowly supported claim |
| --- | --- | --- |
| O1 | https://www.gnu.org/software/bash/manual/html_node/ | INDEXED: edition5.3, update2025-05-18, for Bash5.3. Split GNU pages below belong to this manual family; they are not frozen-byte copies. |
| O2 | https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html | INDEXED: declare a/r/x attributes; named p ignores other options except f/F, unnamed p filters attributes; plus removes attributes subject to a/A/r restrictions; function declaration is local unless g; typeset is synonymous. Error categories are nonzero, not exact numeric statuses/bytes. Compound creation delays additional attributes until subsequent assignments; this alone does not settle every readonly publication sequence. |
| O3 | https://www.gnu.org/s/bash/manual/html_node/Arrays.html | INDEXED: declare-a creates indexed arrays; element assignment determines setness; empty string is a value; bare reference means zero; attributes apply across members. GNU accepts index arithmetic and negative-relative indexing, unlike the proposed finite project subset. |
| O4 | https://www.gnu.org/software/bash/manual/html_node/Shell-Parameters.html | INDEXED: variable value and attributes are distinct; assigned empty string is set; string/compound array append exists. This is not a JS string or allocation contract. |
| O5 | https://www.gnu.org/s/bash/manual/html_node/Shell-Functions.html | INDEXED: dynamic local shadowing/restoration; current-local unset stays unset until reassignment/return; caller-scope unset has a separately described visibility consequence. No abort/host cleanup guarantee. |
| O6 | https://www.gnu.org/s/bash/manual/html_node/Environment.html | INDEXED: environment uses name/value pairs, export changes inherited variables, assignment prefixes affect command environment. Project invoke/replaceEnv is its own contract, not specified by this page. |
| O7 | https://www.gnu.org/software/bash/manual/html_node/ANSI_002dC-Quoting.html | INDEXED: ANSI-C quoting decodes escapes including one/two hexadecimal byte digits; result stays quoted. No native NUL-storage or lone-surrogate roundtrip is established. |
| O8 | https://tc39.es/ecma262/2022/multipage/ecmascript-data-types-and-values.html#sec-ecmascript-language-types-string-type | OPEN plus INDEXED, pinned ECMAScript2022 section6.1.4: strings contain 16-bit units; ill-formed surrogate sequences are possible. Not a claim that the project executes that historical edition exclusively. |
| O9 | https://encoding.spec.whatwg.org/#interface-textencoder | OPEN plus INDEXED, living standard: TextEncoder accepts USVString and UTF-8 encodes scalar values. Encoding is not preservation of arbitrary UTF-16 units. No fetched revision hash claimed. |
| O10 | https://infra.spec.whatwg.org/#strings | INDEXED, living standard: scalar-value conversion replaces unpaired surrogates with U+FFFD, preserving valid pairs as scalar values. This explains why sink encoding cannot authenticate original ill-formed strings. |
| O11 | https://webidl.spec.whatwg.org/#dfn-obtain-unicode | OPEN: Web IDL page retrieved; targeted follow-up search/find returned no usable result. Not used alone as proof of the replacement algorithm; O10 supplies the independently retrieved text. |

GNU `/software/bash/` direct-open variants for O2/O3/O5/O6 were attempted as
provided by root; successful indexed results often used `/s/bash/` instead.
No blog, forum, mirror, package manual, downloaded binary, or repository source
was used as authority for GNU semantics. GNU source inspection was unnecessary.
Exact statuses, export-array refusals, control exclusions, local-kind inheritance,
format order, output quotas and declaration rollback phases in REVIEW/HOLDOUTS
are **P** or **C**, not conclusions licensed by manual prose. The author’s older
Darwin native observations remain attributed historical reports, not reproduced
or reauthenticated here. This review has **no native observations of its own**.

## Local contract/source authority

See PROVENANCE for immutable Git blob bindings and source equality checks.
Important paths: runtime.ts:47/188/302/343/998/1772/2050/2257/2344/2385/2554/3203;
parser.ts:8/351/685/717; shell.ts:163/233/244; arrays/state.ts:18/36/161;
arrays/ledger.ts:71/102/113; contracts/command.md:85/103;
contracts/io.ts:136/153/178; contracts/output.ts:13/68.
All shell paths here are under `src/shell/`; contract paths under `src/`.
The distinct registered printf q spelling was read at `src/commands/basic.ts:94`;
no other command implementation was investigated for this review.

The ratified exclusion is recorded in
`tests/shell/indexed-arrays-author-20260828/CONTINUATION-G4A.md:8`, commit
`492e65baf30df9f21a8224477ba0784f2ed7df35`: existing registered-command
formatting after admitted transfer belongs to E and its Budget/IO contracts;
new shell bridges before transfer are private. It does not itself ratify all
new declaration formatting after builtin dispatch. Author correction bd5a3d34,
SOURCES.md:49, properly labels that additional accounting a project proposal.
Use the existing qualified sum, not a claim of total derived memory or RSS.
