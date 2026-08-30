# Five primary references and claim limits

Access date: **2026-08-27**. Live `web.run` searches located the original papers;
`web.run` opened the papers and standards interpretations. Direct Issue 8 web
opens yielded no text; an HTTPS fetch from the exact publisher URL succeeded.
All five original response bodies were independently fetched into memory and
fingerprinted in SOURCES.json. No full copyrighted document was vendored.
PDF references use physical PDF page numbers, starting with page 1.
The summaries below are intentionally bounded; the REPORT's models/witnesses
are original design proposals, not claims that these sources prove them.

## N8 — modern normative text

The Open Group / IEEE, POSIX.1-2024 Issue 8, XBD Chapter 9, sections 9.1,
9.3.6 and 9.3.7.

URL: `https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap09.html`

Brief quote, 9.1: “each subpattern, from left to right, shall match the longest
possible string.”

The text distinguishes whole leftmost-longest selection, subpatterns and empty
participation. Section 9.3.6 binds repeated references to the last matched
string, constrains contained subexpressions, and limits empty repetitions with
an exception for exact/minimum counts. Its explicit `abab` example conflicts
with TEMP retention. Section 9.3.7 supplies BRE operator precedence. These
requirements are not synonymous with longest final capture or first DFS.
This chapter is current normative evidence for this task; historical proposed
solutions and paper algorithms are different authority classes.

## H43 — historical interpretation, not replacement Issue 8 language

WG15 interpretation 9945-2-43, concerning 9945-2:1993; finalized September 12,
1995. Read questions/proposed solutions separately from the WG15 response,
especially Q12 and Parts 14/15.

URL: `https://www.open-std.org/jtc1/sc22/wg15/docs/rr/9945-2/9945-2-43.html`

Brief quote, response Part 15: “The standard does not speak to this issue”.

The request discusses null iterations, priority of begun versus finished
subpatterns, and repeated backreferences. The response identifies ambiguity or
conflicting text and refers issues to the sponsor. A proposed solution printed
in the request is not thereby adopted. Its historical non-distinction finding
cannot silently erase modern explicit restrictions.

## H135 — competing repeated-subexpression interpretations

WG15 interpretation 9945-2-135, concerning 9945-2:1993; finalized November 20,
1995. Read Dave Prosser's models and the final interpretation response separately.

URL: `https://www.open-std.org/JTC1/SC22/WG15/docs/rr/9945-2/9945-2-135.html`

Brief quote, interpretation response: “Interpretations can not amend the standard.”

The request explores subexpression and fencepost models whose repeated-group
choices can differ. The response points back to #43's lack of clarity and
refers the issue onward; it does not select a complete comparator. This is
evidence against presenting a historically disputed interpretation as an
unqualified theorem, not a current blanket unspecified-behavior waiver.

## T17 — original tagged-history/TDFA model

Ulya Trofimovich, *Tagged Deterministic Finite Automata with Lookahead*, August
2017, author-hosted PDF. Relevant: definition 24 p7; section 5 pp10-15,
especially histories pp11-13 and fictive tags p15; definitions 1/9 pp2-3.

URL: `https://re2c.org/2017_trofimovich_tagged_deterministic_finite_automata_with_lookahead.pdf`

Brief quote, p15: “including fictive tags that don’t correspond to any submatch”.

The formalism includes uncaptured hierarchy, tag-event order and subhistories
separated by higher-priority tags. Definition 24's extension property quantifies
over ambiguous paths with a common suffix, not arbitrary lists. Lemmas 2-4 use
specific construction/comparability conditions; start-tag incremental ordering
has an explicit exception. The expression grammar has no backreferences. The
paper's negative-submatch model also cannot simply implement TEMP retention.
Its reconstruction and pruning arguments require an explicit translation proof
before use here; a final-register implementation does not inherit them.

## BT19 — original indexed-tree/tagged-NFA ordering research

Angelo Borsotti and Ulya Trofimovich, *Efficient POSIX submatch extraction on
NFA*, author-hosted 2019 manuscript. Relevant: indexed expressions definition 5
p6; tree comparison section 3; section 4 lemmas 2-4 p13 and appendix proofs
pp32-33; path-tree representation section 5 p13.

URL: `https://re2c.org/2019_borsotti_trofimovich_efficient_posix_submatch_extraction_on_nfa.pdf`

Brief quote, p6: “the disambiguation rules apply to all subexpressions regardless
of parentheses.”

Implicit structural indices are distinct from explicit capture indices and
include relevant sibling/containing structure. The model relates tree and
tagged-path comparisons. Lemma 4's right-distributivity statement is for its
ambiguous TNFA paths with a common epsilon suffix and no tagged epsilon loops
in either extension. Those restrictions matter to a proposed cycle rule. The
grammar and proof do not model runtime backreference-dependent transitions.
This supports structural-history research, not porting a state-only pruning
theorem to TEMP backreference execution.

## Deliberate exclusions

No secondary summary, benchmark page, current product manual, uninspected
upstream implementation or search-result allegation is used as authority.
Laurikari and Sulzmann/Lu are discussed by the selected authors, but their
separate papers were not added to this bounded five-source investigation;
no independent claim about their proofs is made. No standards source or
paper confirms an upstream GNU bug in the old narrow case.
