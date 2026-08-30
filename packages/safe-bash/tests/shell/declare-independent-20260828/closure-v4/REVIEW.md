# Independent declaration design closure v4

Date: 2026-08-28. Status: **ONE REMAINING DOCUMENTARY CONFLICT**, not runtime rejection.
Implemented Through: Not applicable; source/data-only design review.
Author candidate: `f27ee6ea385e6fe6e2c975981fdd34f4755334cf`.
Authority/bindings: `BINDINGS.md`; post-author/preinspection criteria: `CRITERIA.md`.

## C1 — V63 incorrectly makes runtime proof a design-closure prerequisite

At the author commit, `tests/shell/declare-design-20260828/ratified-v3/MATRIX.md:85`
says: “Design closure requires accepted successor plus actual source/installed/moved
reader/printer/runtime identity”. This places post-implementation evidence before
design closure. Its own proof cell instead separates independent closure from
**later** authorized K evidence.

ROOT `7719f39e416a401588c83d355888f6b82202c109`,
`tests/shell/declare-independent-20260828/ratification-v3/RATIFIED.md:54` requires
complete reader/printer before **roundtrip/public acceptance**, and `:64` orders
design revision then independent closure while withholding implementation GO.
The author's `tests/shell/declare-design-20260828/ratified-v3/DESIGN.md:158` uses
that correct acceptance boundary; `:348` expressly permits closing the design
against R/I/A and the matrix without implementation/foundation acceptance.

**Smallest author-doc repair:** in V63's behavior cell only, replace
“Design closure requires” with “Roundtrip/public acceptance requires”. Retain
the accepted-successor and actual reader/printer/runtime identity requirements,
the future-proof cell, and the unaccepted/no-GO qualification. Any replacement
sealed packet must bind its changed matrix bytes; do not rewrite this frozen one.
No new ROOT policy, implementation work, R3 work, or execution is needed to
resolve C1. I do not issue unconditional ACCEPT DESIGN for the exact conflicting
packet. Apart from C1, the reviewed finite behavioral design is consistent;
deferred implementation proof itself is **not** a design-level defect.

## Concrete consistency review

References below are to author `ratified-v3/DESIGN.md` (D) and `MATRIX.md` (M)
at the bound author commit. They describe requirements, never executed passes.

| Contract | Concrete mechanics checked |
| --- | --- |
| Options / named print | D:54–70; M:24–32. Lexical token/letter scan; negative a/r/p sticky, scalar last signed x plus separate any-x provenance; positive clusters x-only. Named -p ignores supported attributes without filtering/shadow/publication; unsupported flags remain2. Unnamed +x is2 even if later -x. Operand boundary, scalar sequential duplicates versus compound/element global duplicate2, and eager effects are distinct. Matches ratified P1/E01–06, not the old named-p refusal. |
| Entry export / indexed guards | D:90–112, :163–193; M:33–43. Export membership, including exported-unset, is checked before conversion toggles/local publication and compound/element RHS. Same-command +x cannot cure it; a separate scalar +x then later conversion is authorized. Any x request on existing/requested indexed kind is1 even after cancellation by its opposite sign; named print is the exception. Exactly 13 inherited controls, not DIRSTACK. P2 closes both entry and final-bit loopholes. |
| Membership / owning frames | D:74–141; M:37–53. Absent/hidden absence query1, declared-unset query0 without assignment, empty has a value. Unset removes observable membership but retains owning save/barrier. Nested unset changes caller F; G's redeclaration saves F's absence, G return restores absence, F alone restores its original parent once. Exported unset omits the child-env key. Full attributes/getopts, clones/source/invoke, and scalar overlay compatibility are explicit rather than inferred from current value storage. |
| Finite reader / identity / replay | D:145–161, :203–243, :333–341; M:54–70. Only literal unquoted declaration/command contexts acquire compound grammar; literal argv is data, not reparsed. Canonical-decimal grammar and domain overflow differ. scriptFile preflights all units, unlike runtime flags/unit-wise execution. Complete reader AND printer precede public/roundtrip acceptance. Private quote/selector identity must survive merges/copies/lowering; unchanged public shape alone is insufficient. Replay is ordinary valid names ABSENT initially; controls remain inspection-only. |
| Record handling | D:213–242, :290–307; M:68–79. Entire record representability checked before its first byte; NUL/lone surrogate ordinary1 refuses that record and continues later records. U+FFFD/astral text are valid. No partial invalid record, but no atomic sink promise. Earlier resource discovery, cancel, sink or cleanup stops; admitted diagnostic failure is not concealed as no-capacity refusal. |
| Finite private resources | D:247–288, :311–318; M:71–83. Existing seven caps/ticket order, overhead64/15, live-only refunds and shared cumulative ownership remain. New membership/watch/save/format roles are preadmitted; two sort vectors and source/fragments/destination coexist, both UTF-16/encoding passes charged, chunks at most1024 bytes preserve pairs. Epoch checks, prepaid restoration, cleanup-before-acquisition and idempotent close are required. Existing E_command exclusion stays; declaration-shell formatting does not enter it. No RSS or opaque-host preemption claim. |
| Status / effects | D:163–193, :290–309; M:55–59, :76–81. Global usage2 precedes all target publication, not earlier expansion/redirect effects. Ordinary1 is sticky/continues; preparation/private-quota1 stops. No diagnostic capacity means1/stop/no diagnostic, no free bytes/reset. Public ShellLimitError rejects. Final checks are cancellation, readonly, stale after charged preparation. Existing expansion/EPIPE/caller/invoke/cleanup routes retain their distinct mappings and rejection precedence. |

## Authority and source qualification

R is ROOT's P1–P4/DC and earlier RP/AR/RC/SL/AST decisions, including the
incorporated policy phase table. I:G4/G8 is traced to PRECODE:23–41,
CONTINUATION-G4A:8–23 and closure-v1/DECISION-TABLE:15–20, :74–81 at the exact
commits in the author's authenticated references. G7's historical ROOT wording
remains attributed, not a newly found transcript; current P2 expressly authorizes
separate scalar +x. G8's bare-name element-zero/lazy operators and left-to-right
aggregate splice remain; explicit indexed operators remain refused. G4's external
formatting exclusion is not widened or removed by the ratified shell-format rule.

The finite grammar, deterministic encoder, bridge authentication and detailed
private role charges are **carried AUTHOR mechanics**, not separately ratified
user mandates. D:22–28 and ROOT-RESPONSE's coordination-only label say so. Original
author DESIGN:169–205, :272–278, :318–337 supplies their concrete antecedents.

Source inspection at c0ada confirms the identified integration boundaries:
runtime:47 lacks declaration builtins; :343/:1022/:3231/:3281 use value/export and
frame saves, requiring new membership tracking; :1222/:1289 expose entry/final
array guards; :1922 omits unset env values; :2590 preflights all file units;
parser:284/:702 and arrays/syntax:21/:63/:78 expose identity-sensitive copying.
arrays/state:18/:153/:170/:256 and ledger:71/:103/:116/:227 expose shared ownership,
atomic reservation, mutation and close paths. These are inspected source roles,
**not certification that the foundation or future declaration implementation
obeys every obligation**. No source/installed/moved runtime evidence was generated.

## Process disposition

Only three new closure-v4 Markdown files are owned. No old review, proposal,
author, source, root/config or AGENTS file is changed. The 64 rows and four scripts
are future requirements/prepared data, not passes; historical 40/8/2455 and N13
remain untouched. c7dae6e8 and the successor are not accepted here. No prohibited
execution, native qualification, implementation GO or R3 work occurred. This
independent source-only review is complete with C1 returned to the author; no
child process/session or execution obligation is left open.
