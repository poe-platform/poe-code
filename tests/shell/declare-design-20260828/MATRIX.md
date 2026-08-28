# Finite semantic matrix — 40 design rows, zero executions

All expected behavior below is **P**, against the frozen **C** source described
in DESIGN/SOURCES. These are obligations/questions, **not passes**. No row
rescores N01–N16. Inputs are recipes for future separately authorized tests;
host callbacks/FS/sinks are descriptions, not supplied executable harnesses.
`d` means either genuine builtin (exercise both in the eventual suite).

| ID | Finite input / situation | Required observation or decision |
| --- | --- | --- |
| M01 | `type declare typeset; command -v declare typeset` with an empty registry | Both genuine builtin discoveries; no aggregate command count change. Functions may shadow; command bypasses. |
| M02 | `d -aa -rr a=(one); d -p a` | Whole-array readonly; deterministic `-ar` output. Repeated supported flags are idempotent. |
| M03 | `d -x +x n=v; d -p n; d +x -x n` | Last x sign wins; export removed then set, no value change from flags alone. |
| M04 | `d +a n`, `d +r n`, `d +p n`, `d -Q n`, `d -aQ n` | Each usage2 with first offending option; no target declaration. Scalar argument effects already expanded are not undone. |
| M05 | `d -A/-n/-i/-l/-u/-f/-F/-g/-G/-I/-t n` as separate literal option cases | Explicit unsupported2, never successful no-op attributes or function listing. |
| M06 | `d -- n=v`; `d n=v -x`; `d -`; `d -- -` | Terminator accepted; after n, -x invalid name1 while n remains; lone leading sign2, after -- identifier1. |
| M07 | `d -p`; `d`; `d -arp`; `d -axp`; `d +x` | Deterministic all/intersection listing; empty impossible ax match0; positive listing sign2. No functions. |
| M08 | `d -p n missing n`; `d -ap n`; `d -p n=v` | Request order/repeated output, missing1 but continue; named filters usage2; assignment-shaped query identifier1/no write. |
| M09 | missing n; `d n`; `d -p n`; `d n=`; `d -p n`; `unset n` | Absent -> declared-unset -> empty -> absent; exact membership distinguished, never undefined string env entry. |
| M10 | `n=old; d -a n; d n=new; d n+=tail` | Zero becomes old/new/newtail; retain indexed kind. |
| M11 | `a=([7]=tail); d a=zero; d -a a=next` | Bare scalar writes affect only zero, leave7; missing zero differs from empty. |
| M12 | `d -a a; d -p a; d -a a=(); unset 'a[@]'` | Empty indexed binding survives member clear; output `declare -a a=()`. |
| M13 | `d -a a=([2]=x [9]=''); d a+=(y [1]=z w)` | Sparse numeric order; append starts10, explicit1 resets next2; last target slot2 becomes w. |
| M14 | `d -a 'a[2]'`; source `d a[-1]=v`; literal invoke `a[01]=v` | No ignored bare subscript; unsupported/syntax2 per route, no arithmetic/negative indices. |
| M15 | `d a=([2147483648]=${seen:=bad})` | Domain1 before this target's RHS; seen stays absent; no new target. |
| M16 | `d a=([2147483647]=last next)` vs uncertain next expansion | Certain overflow prechecks all own RHS; uncertain arity expands once then refuses if fields demand overflow. Empty expansion needs no cursor slot. |
| M17 | `d -r n=v; d -r n; d n=w; unset n` | Initial freeze0, idempotent attribute0, write/unset1; value unchanged. |
| M18 | `d -ar a=(v); d a=w; d -p a` | Freeze after successful initialization; whole binding readonly, zero write1. |
| M19 | scalar export conversion; `d +x -a n`; separate `d +x n; d -a n` | Existing exported conversion1 even combined +x; separately cleared scalar may convert. H N01 differs. |
| M20 | existing array with `d -x a`, `d +x a`, `d -ax a=(v)` | Array-export policy1; no invented serialization; compound static refusal prevents its RHS. H N02 differs. |
| M21 | each of13 exact controls with `d -a NAME` | Refusal1 before compound RHS; ordinary scalar control writes retain inspected behavior. DIRSTACK is not added to controls. |
| M22 | outer sparse a; function `d a=inner; ...; return 7` | Candidate-compatible fresh indexed local zero, exact sparse outer restored; function7 retained. H N05 GNU scalar kind is a deliberate gap. |
| M23 | exported scalar outer; function `d n; d -r n=inner; d n; return` | Save once; local missing/readonly/value state; outer export/value/readonly restored exactly. |
| M24 | readonly outer; nested function declaration; local unset/rewrite | Readonly parent refuses shadow1; nonreadonly local unset stays missing until return; no premature parent reveal. |
| M25 | source at top level / within a function, early return | Same state/frame; source return does not pop function locals; depth/positionals restore by existing rules. No native source execution in PRESEAL. |
| M26 | subshell, substitution, pipeline, cloned saved local | Isolated writes; copied kind/membership/attributes/sparse slots, shared cumulative ledger, no lost restoration. |
| M27 | actual registry handler invokes d with `a=(x)` literal and replaceEnv modes | No parse/eval: scalar `(x)`/zero value; explicit env replaces only exported map, typed collision shadows child only; parent preserved. |
| M28 | new process/interpreter/scriptFile vs invoke clone | Process gets existing exported scalar values only; invoke keeps nonexported clone. No implicit array export/attribute inheritance claim. |
| M29 | source compound declaration in dead branch/function; malformed later scriptFile unit | Private metadata parses before runtime; whole-file syntax preflight prevents earlier file effects. Shell.exec/source unit timing is not silently changed. |
| M30 | computed declaration command / shadowing function / middleware rewrite on compound plan | No dynamic acquisition of compound syntax; non-builtin or modified compound dispatch refuses2. Transparent forwarding retains binding. |
| M31 | scalar readonly `d n=${seen:=rhs}` vs readonly compound target RHS | Eager scalar effect stays before diagnostic1; compound known readonly precheck suppresses own RHS. Distinct phases, not blanket rollback. |
| M32 | compound RHS writes TARGET through bare supported default assignment | Retain RHS write; staged publication fails stale1 unless readonly wins. H N13 is contradictory GNU observation, not rerun/pass. |
| M33 | RHS/await makes target readonly and stale; unknown parameter error; abort | Readonly-before-stale, original escaping expansion status/control, caller cancellation precedence; observed external effects retained. |
| M34 | multiple operands, later bad identifier; mixed compound; duplicate targets | Builtin-loop failures retain earlier successes; preparation failure prevents all declaration publication; compound-bearing duplicates usage2. |
| M35 | scalar/sparse/empty/missing + apostrophe/backslash/$/backticks/Unicode/C0/DEL | Exact deterministic lossless text, numeric sorting, one physical line/name; fresh-state public and VFS roundtrip obligations, no eval. |
| M36 | host NUL/lone surrogate/invalid host env name; literal U+FFFD; invalid source bytes | Unrepresentable record1 before record output; real replacement character roundtrips; no raw-byte promise or illegal-name output. |
| M37 | scalar-only/array listing at zero/tiny B,F and existing public output limit | Declaration formatting activates private ledger; seven formulas/refusal order and public output budget preserved, no E exemption. |
| M38 | sort/escape/join with overlapping vectors/source/destination; repeated failed listings | Preadmit storage/work, charge comparisons/encoding/diagnostics; cumulative counters never reset/refund; no dense scan or all-list join. |
| M39 | cancellation/backpressure during preparation/snapshot/output/restore; overlapping close | Synchronous cleanup enrollment, admitted work drained, prepaid restoration, same completion, original abort reason, no sibling-sink cancellation. |
| M40 | snapshot epoch changes; teardown after terminal failure; existing listings | No retry; no fake live-counter/RSS proof; preserve existing set/export/readonly/local listing gaps unless separately authorized. |

Native PRESEAL D01–D08 is a separate eight-row observation set. Matrix status
remains **40 proposed rows / 0 executed / no pass denominator**. Dynamic host
reentrancy, public capacity boundaries and lifecycle obligations need later
product/independent work; native success could not substitute for those checks.
