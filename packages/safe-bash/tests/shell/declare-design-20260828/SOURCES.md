# Source register — accessed/read 2026-08-28

## O: official primary documentation

Actual `web.run` searches were used. Direct opens returned no usable text; the
GNU-only search results supplied the section text below. No native version/help
or downloaded source execution supplied these facts. The live web manual is
identified by its own edition statement, not by an invented content hash.
Short paraphrases only; no GNU implementation or long quotation is reproduced.

| ID | Official URL and precise anchor | Fact/paraphrase used |
| --- | --- | --- |
| O1 | https://www.gnu.org/software/bash/manual/bash.html#Top | Edition5.3, updated18May2025, for Bash5.3. Access2026-08-28. |
| O2 | https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-declare | a/r/x assign indexed/readonly/export attributes. Named p ignores most other options; unnamed p filters. Plus removes attributes except array destruction/readonly removal. Function declarations are local unless g. Compound initialization precedes additional attributes. |
| O3 | https://www.gnu.org/software/bash/manual/html_node/Bash-Builtins.html#index-typeset | typeset is Bash's declaration synonym, not evidence of a product alias implementation. |
| O4 | https://www.gnu.org/software/bash/manual/html_node/Arrays.html#Arrays | Sparse indexed arrays, explicit/implicit indices, compound assignments and append; bare reference uses zero. GNU permits arithmetic/negative indices and ignores subscript in bare declare-a operands. Whole-array attributes and reusable listing are documented. |
| O5 | https://www.gnu.org/software/bash/manual/html_node/Shell-Parameters.html#Shell-Parameters | Assignment RHS expands without word splitting/filename expansion; declaration-command arguments can be assignments. Empty value differs from unset. Append is defined. |
| O6 | https://www.gnu.org/software/bash/manual/html_node/Shell-Functions.html#Shell-Functions | Local/declare shadow dynamically; caller binding returns after function completion. Functions execute in current shell context. |
| O7 | https://www.gnu.org/software/bash/manual/html_node/ANSI_002dC-Quoting.html#ANSI_002dC-Quoting | ANSI-C quoting supports byte and Unicode escapes; its expanded result is quoted. This does not specify the product's UTF-8/UTF-16 behavior. |
| O8 | https://www.gnu.org/software/bash/manual/bash.pdf | Printed manual p65, section4.2 declare: nonzero categories include options, readonly assignment/removal, identifier and array-kind removal errors. Printed p65 plus section is the locator, not a guessed viewer-page index. Exact numeric status/diagnostic bytes are not established by that prose. |

Version statement is O1; split pages are references within that manual, not
individually content-hashed snapshots. Exact signed/repeated flag interactions,
named-p edge statuses, and declaration effect ordering remain optional native
questions. P's strict signed flags/filters/timing are not attributed to GNU.

## C: exact candidate static source, not product execution

All line numbers below refer to source/tests commit
`50117fc54fdfd650e8f57e84b82ba21297ab8a0f`, read using `git show`; not the live
checkout. shell.ts was additionally read by its exact selected-base blob.

| File; Git blob | Inspected anchors and inference |
| --- | --- |
| src/shell/runtime.ts; `83df58832d537d2a4b1833af2c368665d9877567` | :47 discovery omits declare/typeset; :188 State; :302 cloneState; :343 save/:347 restore; :997 diagnostic; :1001 scalar write/:1022 unset; :1039 zero view; :1049 typed save; :1090 invoke env; :1165 zero staging; :1219 array assignment; :1554 failure mapping; :1772 simple; :1918 middleware/dispatch; :2030 function entry/:2051 restoration; :2256 process state; :2344 source decoder; :2554 scriptFile/:2589 all-units preflight; :2670 source; :2782 invoke; :3199 declaration family; :3404 declaration word expansion; :3651 word accounting. |
| src/shell/parser.ts; `998a1471af0649ffb400adcfcc7ac8105bf4ef5b` | :7 WordPart/:15 Word/:63 Command public shapes; :352 ansiWord; :685 simple words/:717 mixed array-command refusal; :747 parseShell/:758 parseShellUnit. |
| src/shell/shell.ts; `220d6c28a6e50f459a48aaee2030f24a841f4ab7` | :233 first parse/:244 State construction/:267 unit execution/:277 next parse. Fresh execution state and unit-wise top-level behavior; not scriptFile whole-source preflight. |
| src/shell/arrays/syntax.ts; `8faad2d7757c68156d24f7aa5a07ab77c411a14d` | :21 private WeakMaps; :24 literalIndex/:34 numericIndex; :45–65 selector/assignment metadata; :84 element/:98 compound head/:104 entry. |
| src/shell/arrays/bindings.ts; `c686048897bbd7fa797ba6982a255a543afbe6a3` | :4 thirteen control names; :24 owned text; :47 IndexedBinding/:54 create/:77 insert/:90 copy; sparse identity/pinned immutable text, not a dense JS array. |
| src/shell/arrays/ledger.ts; `c0c1a4ba292e26696b792b024019a79ce241cb89` | :54 ledger/:71 reserve/:102 derive/:113 release/:120 checkpoint; :143 owner. Seven formulas, atomic tentative tickets, nonrefund and cleanup ownership. |
| src/shell/arrays/state.ts; `021459790e7aa5d03b6cac2d786a77643fa2f2aa` | :18 root cleanup registration/:36 activate/:78 restoration/:161 collection monitoring/:256 snapshot. A new membership set requires named mutation and snapshot/save integration. |
| src/shell/types.ts; `763d2ee0ad2b15c7ed7af31e7c6171f739c98486` | :3 invoke options/:18 public limits; no declaration type/budget option. |
| src/shell/index.ts; `0110bd9d5c0388dc6fe15abc27f27a18dd7a6b38` | :1–4 Shell/parseShell/types exports; parser shape is observable despite internal metadata. |

These inspected blobs do not authenticate all 269 selected build inputs or the
author package. Author documentation binding is 38b2318d's FOUNDATION-HANDOFF.md
and FOUNDATION-AUDIT.md, and d8ac8c2e's PRIVATE-REVIEW-BINDINGS.md, under
tests/shell/indexed-arrays-author-20260828. Their reported checks were not rerun.
CONTINUATION-G4A.md is the explicit existing registered-command transfer boundary;
new SHELL-owned declaration-formatting private charges are a **PROJECT DESIGN
PROPOSAL** inferred from that existing G4A boundary, pending root ratification.
The latest user request asks for design/assessment, not a separate explicit
declaration-formatting mandate. No formula changes or automatic E exemption.

## H: historical observations only

Relevant receipt: tests/shell/indexed-arrays-native-review-20260828/REPORT.md and
BINDINGS.json, last report commit `d4f3d9f91a8549ebdd3a222fbac04d379c6ce770`.
Source receipt chain: native observations `4e8f8a13590d489df5b5e7c70fe684de4abd2b5d`,
review `2142c48314ed252879cd78589870435617358f64`, response/stop
`573f229c5bc60ca92dbcc6ca87e3da3bf9b64634`. Read only relevant prose/metadata,
not native tools, live supervisors or the forbidden unrelated modules.

N01–N16 are **16 observations, 14 top-level exit0 and2 exit127; not passes**.
N01/N02 show GNU exported-array attributes/listing, not native child env bytes.
N05 shows scalar local shadow of an outer array; N06 does not inspect initial
local kind. N13 shows assignment0 with only index1=`rhs-write`; it contradicts
the historical predicted stale1/retained0+2 result. It is not a current product
rescore or direct trace of intermediate versions. N14 is substitution-local
readonly, not async parent mutation. N15 preserves a RHS effect despite error;
no transaction/cancellation guarantee follows. Host was Darwin arm64, not Linux.

Keep **STOPPED_FINAL_INTEGRITY**: later added observation-review-v1 changed the
protected census; later final checks were not reached. Five supervisor defects
remain qualified: no terminal absent-close/group deadline; incomplete final
control authentication; ownership registration after mkdir; postspawn write
failure undercount; synthesized close on synchronous spawn throw. Natural small
exits did not exercise those paths. PRESEAL proposes stronger controls without
retroactively certifying or rerunning that supervisor.

Known historical manual pin (not read/rehashed/requalified now):
`/private/tmp/safe-bash-gnu-bash-5.3.Ua5t02/bash-5.3/doc/bashref.texi`,
415804 bytes, SHA256
`f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`.
Binary pin is in PRESEAL.md. Web edition identity and this local historical hash
are different evidence; do not claim the live HTML has that hash.

## P: project proposal

All exact new status choices, no-op refusals, local continuity, formatting,
membership, staging, quotas/role charges and future paths are DESIGN proposals.
No native answer is assumed for PRESEAL rows; no implementation validation was
run. No external tool/package/manual file was touched to refresh its identity.
