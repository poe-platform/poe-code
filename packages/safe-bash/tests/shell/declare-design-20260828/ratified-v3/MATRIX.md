# Finite semantic and proof matrix — ratified-v3

All **64 rows are REQUIRED FUTURE PROOF / NOT EXECUTED**. There are no passes,
test results or native goldens here. R/I/A labels refer to DESIGN §1; E01–E18
refer to ROOT-ratified policy-v2 examples, not new executions. H/M references
are traceability to unchanged earlier review/author rows, never rescoring.
`d` means either genuine builtin, with both names required in V01; `Q n` means
`declare -p n`. Examples assume ordinary writable/unexported absent names unless
stated, adequate admission, working sinks and no cancellation. Each status is
the operation's status, not a later printf/script status. Record examples omit
only the final LF; output equality includes it. Refusal diagnostics require
the admitted invoked-name/name/category framing, not invented GNU byte goldens.

Future proof routes: **S** actual public Shell.exec; **P** public parseShell;
**V** VFS scriptFile; **I** actual Shell/registry context.invoke/middleware;
**L** private admission/lifecycle evidence tied to the loaded accepted source;
**K** built/installed/physically moved consumer identity. Neither L-only stubs
nor native outcomes substitute for S/I/V/K. All load/candidate hashes must be
recorded by a separately authorized verifier.

| ID | Binding / earlier trace | Behavior and finite counterexample | Required future proof (not a pass) |
| --- | --- | --- | --- |
| V01 | A; R:RP; M01–02 | declare/typeset mutation agree, print uses declare; diagnostics use invoked name; function shadow remains, command bypass reaches builtin, no default plugin dependency. | S/I/K both names, shadow and command/type discovery; registry inventory unchanged. |
| V02 | R:P1 E01 | `-rx +xx n=v` gives readonly/unexported v; sticky a/r/p, last x sign; repeats `-aa -rr -pp` legal in valid query context. | S/I exact option scan and unchanged named-query state; not order-insensitive export collapse. |
| V03 | R:P1 E02 | n=v: `-ap +x n` prints scalar0/no mutation; `-p +a n` refuses2. | S/I compare full before/after state, not only stdout. |
| V04 | R:P1 E03 | No operands: default/-p all listing; -ar intersects; -p -x +x is2, not an unexported filter. Empty intersection0. | S/I exact ordered all/filtered records and no local creation. |
| V05 | R:P1/P4 E04 | `declare -- n=v; declare n=w -x` gives0,1; n=w unexported, late -x is operand1. Later `--` likewise operand1. | S/I target state and per-command status; no retroactive option scan. |
| V06 | R:P1/P4; A | Lone +/- before boundary2, after boundary1. Each -A/-n/-i/-l/-u/-f/-F/-g/-G/-I/-t/-z/+a/+r/+p/+xz and --help/--version refuses2. | S/I exact finite option table; no stub or help/native route. |
| V07 | R:P1/P4 E05 | `declare -A n=${seen:=rhs}` returns2/no n, but seen=rhs; valid earlier target operand cannot publish when a globally unsupported argv subscript follows. | S/I pre-expansion effects versus global pre-publication usage; no rollback claim. |
| V08 | R:P1/P4 E06 | `n=one n+=two bad-name=x later=three` latches1, n=onetwo and later=three. readonly duplicate writes fail after first freeze. | S/I sequential own-publication watch refresh, sticky1, independent later success. |
| V09 | R:P1/P4; A | Any element/compound operand plus duplicate target names is global2 before compound RHS; scalar duplicates alone legal. | S/P/I cases `n=x n[0]=y`, `n=(x) n=(y)`, scalar control; zero declaration publications. |
| V10 | R:P1/P4; A | Named-p repeats requested names; missing gives1/no record, later names print; `n=x` and `n[0]` are identifier1, never mutation. | S/I ordered duplicate/missing/assignment/subscript queries. |
| V11 | R:P2 E07/E09 | Exported value or exported-unset n: same-command `+x -a n` refuses1 with original scalar/export/presence intact. | S/I entry guard before toggle/local publication; compound own RHS suppressed. |
| V12 | R:P2 E08/E09 | Separate scalar +x succeeds then -a conversion succeeds; value maps to zero, unset maps to empty array. | S/I exact0,0 and record; no history taint or whole-unset-only restriction. |
| V13 | R:P2 E10/E11 | Existing empty array `-x +x n` and absent `-a -x +x n` each1, not final-bit loopholes; absent remains absent. +a remains2. | S/I any-x provenance and requested-result kind; named-p exception separately V03. |
| V14 | R:P2; I:G7; A | Whole unset clears writable exported scalar; later conversion eligible. Exactly 13 controls refuse indexed1; DIRSTACK succeeds. | S finite DESIGN §3 control set; no extra control/array export. |
| V15 | R:P3 E12 | Absent Q1; declare n then Q0/unset record; unset then Q1; redeclare Q0; n= then Q0/empty record. | S/I exact presence transitions and output; no empty surrogate. |
| V16 | R:P3 E13 | `declare -rx n` prints unset-rx, env omits n; value/unset1; scalar +x0 leaves readonly-unset. | S/I real child-env observer, contrast exported empty key `n=""`. |
| V17 | R:P2/P3; A | Idempotent readonly no-value/no-kind declaration0; write/append/conversion1. -r freezes only after successful value stage. | S/I scalar, empty array, sparse array; L failure between preparation and publication leaves no half attributes. |
| V18 | R:P3; A | Own-key __proto__/constructor/toString store/query/unset normally; imported bad-name listing refuses record1. | S/I null-prototype/own-key checks and ordered later record; no property pollution or silent skip. |
| V19 | I:G1/G7; A | -a absent/unset -> empty; set scalar -> zero; -a existing sparse preserves. `a=value`/`+=` touches zero only. | S/I exact kind/missing-zero/member state and literal argv data. |
| V20 | I:G1; A | Element =/+=; sparse compound =/+=; duplicate explicit indices last wins; implicit cursor follows explicit index/max. | S/P/V indices0,2,9,2147483647; no dense scan or stringification. |
| V21 | I:G1; R:P4 | Empty append validates without value publication; certain maximum overflow precedes own RHS, uncertain zero/nonzero field expansion checked once afterward. | S/L observer/watch identities, RHS counts, absent/empty/existing operands; no retry. |
| V22 | R:P3; I:G7; A; H22 | Outer indexed [7]=outer; function declare a=inner gets fresh indexed [0]=inner; return7 restores exact [7], status7. | S/V typed local state/attributes, distinguish historical GNU scalar-shadow result. |
| V23 | R:P3 E14 | Exported outer: F declare inner, unset, Q1, declare n, Q0 unset/unexported; F exit restores exported outer. | S/L save-once and no saved-parent exposure; exact output/order. |
| V24 | R:P3 E15 | F local; G unset n, returns without local declaration: F Q1; only F exit restores outer. | S dynamic caller ownership; do not implicitly save in G on unset. |
| V25 | R:P3 E15 | G unsets F local then declares n: G Q0 unset; G return restores F absence; F exit outer. | S/L absence saved instead of concealed grandparent; repeated G declarations save once. |
| V26 | R:P3; I:G7 | Whole unset local array then bare declare -> scalar-unset; ordinary assignment -> scalar value; member unset retains indexed kind. | S/L exact membership/barrier/kind; readonly parent shadow refuses1. |
| V27 | R:P3; I; A | Source at top level persists this exec; source inside F uses F frame; source return does not restore F locals; F exit does. | S/V return/control/cancellation exit paths, positional/source-depth/getopts restoration. |
| V28 | R:P3; I:G3/G6 | Subshell/substitution/pipeline clone declared-unset/hidden absence/typed saves; child mutations isolated, cumulative ledger shared. | S/L clone during active/inactive ledger; exact parent state and prepaid cleanup. |
| V29 | I:invoke; R:P3 | Actual invoke clone clears local/depth/source frames but preserves definitions/nonexports; env scalar shadows typed child only, readonly collision refuses. | I real Shell/registry route, parent proof; no stub-only verdict. |
| V30 | I:invoke | replaceEnv true exact map/omitted empty, no PWD/local promotion; false/omitted merge. undefined signal creates no local cancellation resources. | I env entries, provenance, child state and signal resource accounting. |
| V31 | I; R:P3 | Process/interpreter/scriptFile receives exported values plus existing initialization, not arrays/readonly/unset membership; fresh exec not persistent store. | S/V/I unset versus empty env, controls and nonexported child distinction. |
| V32 | R:AST; A; H25–27 | Literal unquoted declare/typeset and command -- chain admit compounds; quoted/expanded names and builtin declare do not. Quoted `a=(x)` is scalar. | P/S/V exact contexts; ordinary scalar computed dispatch retains existing behavior. |
| V33 | R:P4/AST E16 | VFS `: > /early` then `declare -a n[-1]=x`: syntax2 prevents /early. Replace last line by -A n: runtime2 allows /early. | V/P full-file preflight versus S/source unit-wise effects; no universal syntax rollback. |
| V34 | R:P4; A | Indices `0`,`2`,`'2'`,`"2"` admitted; -1/01/1+1/substitution/nested/associative/bare-subscript refuse2; canonical2147483648 is1. | P/S/I inactive branch/function parse, literal argv whole usage and overflow semantic loop. |
| V35 | R:P1/P4; A | Compound source options/names literal; known incompatibility prevents own RHS; ordinary earlier eager scalar expansion remains. | S/P RHS counters/files; no computed argv acquiring private metadata. |
| V36 | R:P4; A | Scalar readonly `n=${seen:=rhs}` retains seen then1; known readonly compound suppresses own RHS and stops preparation. | S two routes, later RHS stopped, prior host effects retained. |
| V37 | R:P4; I:G1/G8; M32/N13 | RHS supported bare default assignment mutates target; stale stage cannot overwrite it; readonly+stale selects readonly, cancellation first. | S/L staged-value/attribute identity and reached failures; preserve native N13 unchanged. |
| V38 | R:P4; A | Function-local compound RHS reads pre-local parent; publication installs local only after all preparation; later preparation refusal publishes none. | S/L two-operand mixed scalar/compound, redirect failures and no target partials. |
| V39 | R:P4; A | Authenticated evaluated operand binds AST/argv index/content/name/options/cwd/env; transparent forwarding works; changed dispatch or handler kind refuses2. | I middleware clone, argument reorder/change, command/env/cwd change, shadowing function/registry; no eval/reparse. |
| V40 | I:G7/G4A; A | Scalar middleware A/B/write-B restores A; successful same-name typed publication supersedes overlay; scalar-only path not repaired. | I/L actual existing forwarding route before/after declaration activation. |
| V41 | R:AST/RP; I:G8 | Same-input public AST keys/descriptors unchanged; zero aggregates versus literal-empty prefixes may share public shapes yet differ privately. | P/S/K actual successor parser/reader/runtime, not public structural equality alone; root holds acceptance. |
| V42 | R:AST; I:G8 | Preserve private quote marker across lazy-alternate copy, text merge, quote close, prefix removal, lowering; no public marker/symbol. | P/S/L copied/merged paths, mutable metadata/content validation; JSON clone is not executable compatibility proof. |
| V43 | I:G8 | Repeated aggregate splice left-to-right; zero @, quoted empty member, empty scalar, empty *, real empty prefix remain distinct. | S/K finite S06/S08-style cases and bare-name lazy operators; explicit indexed operators stay refused. |
| V44 | R:RP/AR; A | Printer exact --/-a/-r/-x/-rx/-ar headers, unset versus empty, ascending names/indices; named duplicates retain order. | S/P/V/K reader AND printer loaded, sparse holes and empty arrays; no stage-one completion. |
| V45 | R:AR; A | Replay ordinary valid absent names only; controls OPTIND/PWD inspection-only; existing-name replay not promised. | S/P/V exact presence/kind/value/attributes compared, including readonly-unset and sparse arrays; no control-state claim. |
| V46 | R:RC; A | Exact encoder empty/apostrophe/LF/TAB/CR/DEL/Unicode astral/U+FFFD, dollar/backtick/backslash as data. | S/P/V exact fragments in DESIGN §5, one physical line and no injected execution. |
| V47 | R:RC/P4 E17 | a=ok,b=NUL,c=later: b1/no record bytes, a/c retained in order; repeat with lone high and lone low surrogate. | S/I host-string setup and awaited output; later record proves continuation, no partial b. |
| V48 | R:RC/P4; A | Invalid host name ordinary1/continue; malformed script bytes and ansiWord NUL behavior not globally tightened; literal U+FFFD replay valid. | S/V separate ingestion/printing/replay fixtures, no arbitrary-byte-string promise. |
| V49 | R:SL/P4; I:G4A; E18 | Already-admitted scalar -p must pay private formatting even with public output capacity; existing registered command E_command stays excluded. | S/I/L reached-dispatch fixture and transfer counters, not F=0 shortcut or global stderr contract. |
| V50 | R:P4; I:G6 | Cap derivation F,F,B,128F,8B+512F,8F,32B+256F and unrepresentable first-cap refusal order. | L each of seven checked boundaries and unchanged public limits; no widened caps. |
| V51 | R:P4; I:G2/G6 | Requested generation/version/epoch first, then seven demands; failed reserve changes neither counters nor tickets. Only live refunds. | L exact before/after snapshots, failed repeated reservations, overlapping holders and cumulative no-reset. |
| V52 | R:SL; A | Membership/name/watch/dedup/descriptor/pinned-stage/save/snapshot roles charged before access/allocation; readonly failure cannot leave partial target. | L source-bound admission events plus S state; includes dormant ledger activation migration. |
| V53 | R:SL; A | Two sort vectors overlap; per-scanned-unit comparison/count/encode work; fragments/source/destination coexist, <=1024-byte chunks preserve surrogate pair. | L/S cancellation points and logical charges, no Object.keys-before-reserve or native-sort hidden work. |
| V54 | R:P4/DC E18 | No capacity for diagnostic:1/STOP/no diagnostic; admitted or checked reservation otherwise; no reset/exemption/continuation. | L/S three capacity states (preadmitted, reserve succeeds, reserve refuses), following-record nonexecution. |
| V55 | R:P4/DC | Earlier scan/resource refusal wins over undiscovered invalid record/usage; diagnostic public-budget or sink failure is not suppressed by no-capacity rule. | S/L exact reached phases, attempted diagnostic write and route-specific settlement. |
| V56 | R:P4 | Public ShellLimitError rejects, not125/126; source/argv limits may prevent dispatch; no numeric ShellResult on rejection. | S/V/L source, expansion and output-budget fixtures with exact error identity and retained effects. |
| V57 | R:P4 | Escaping ParameterExpansionFailure retains127 normal/1 isolated; other expansion1; EPIPE reached mapping141; ordinary sink versus escaping diagnostic distinct. | S/I actual runtime catches/isolated route; no blanket result normalization. |
| V58 | R:P4; I:command | Caller reason wins by identity, then actual escaping failure, then ranked local cancellation; mapped status not unmapped; optional undefined signal borrowed. | I controlled simultaneous routes/errno-shaped or shared-equal reasons; preserve existing provenance. |
| V59 | R:P4; I:cleanup | Synchronous cleanup before admission; repeated close shares completion; final outcome drains cooperative work and root barriers; single failure exact/multiple aggregate. | S/I/L cancellation during preparation/output/restoration; no opaque-host preemption claim. |
| V60 | R:SL/P4; I:IO | Await backpressure; retain owned fragments; stdout close cannot cancel sibling stderr/file/header scopes; partial valid output remains after I/O failure. | I/L destination-specific enrollment and producer-reuse evidence, not new global output guarantee. |
| V61 | R:P3/P4; I:G3 | State epoch detects membership/kind/attrs/locals/getopts/dotglob/STACK ownership mutation; snapshot refuses without retry; saves restore with prepaid identities. | L/S concurrent cooperative mutation at snapshot/copy/publication, no mixed-generation copy. |
| V62 | I; A | Existing set/export/readonly/local listing behavior stays unchanged; no JSON-listing roundtrip or default registry count bump. | S/K unchanged scalar consumers, exact separately declared registry inventory and public negative surface checks. |
| V63 | R:RP/AST; user scope | Roundtrip/public acceptance requires accepted successor plus actual source/installed/moved reader/printer/runtime identity; author source read alone is insufficient. | Independent closure and later authorized K evidence; current c0ada remains frozen/unaccepted, no source GO. |
| V64 | H/N; user scope | Preserve original40/8/2455, 48 holdouts, E01–18 and N13/history; new four scripts are observation questions only, not a repeated cohort. | Static file/hash/census seal only now; separately frozen supervisor/GO before any native launch. |

Coverage is explicit rather than a declaration that earlier rows passed. V01–V43
cover command/state/parser/order integration, V44–V48 reader/printer fidelity,
V49–V61 resources/settlement, V62–V64 compatibility/evidence boundaries. Counter-
examples are project vectors, not GNU expected stdout. Native V301–V304 in
NATIVE-RECIPE.md have null semantic expectations and zero executions. No old
holdout is substituted, weakened, or converted into a passing denominator.
