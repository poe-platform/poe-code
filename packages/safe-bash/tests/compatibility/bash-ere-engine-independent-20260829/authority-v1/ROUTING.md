# Capture-reporting authority: HOLD for profile adjudication

Status: Independent SOURCE/DATA clarification, not a new normative specification.
Inspected implementation: `f97fd06024cb63edfd01873d81d84576a22189db`.
Original independent results: `cbf196073eb17b078355a1d7cb2e051a422413e1`.
Date:2026-08-29. No engine/native/compiler execution in this follow-up.

## Authority and correction of claim strength

**R01 proves conflict with the review's documented last-parent-match model;
it does not prove a difference from actual GNU Bash, glibc or Darwin regexec.**
The earlier phrase “confirmed defect” must be read with that qualification, not
as an independently established native-Bash compatibility defect. Original
17PASS/7FAIL per layout and author66/66 remain unchanged, not rescored.

The exact directly verified publisher wording is GNU libc's *Subexpression
Complications*, also available in the version-specific GNU glibc2.2.3 manual:

> the results reported for the inner subexpression reflect whatever happened on the last match of the outer subexpression.

Applying that documented rule to `(a(b)?)+` / `aba`: outer iterations are `ab`
at[0,2) and `a` at[2,3); `(b)?` does not participate in the second. The model's
reported group2 is therefore absent/null, not[1,2). This is a deduction from
documentation, not an observed libc execution. The manual's bananas/bas example
independently describes the same nested omission as I04.

The retrieved official POSIX.1-2017 XBD9.1 text establishes leftmost-longest and
empty-match versus nonmatch priorities, but **that passage alone does not establish
this nested reset rule**. This follow-up did not obtain usable official HTML for
the regcomp/regexec reporting rules despite direct Issue7/Issue8/older-page reads.
I therefore cannot supply a freshly authenticated exact POSIX System Interfaces
reset quotation, and do not substitute a secondary manpage or remembered wording.
The exact *normative POSIX* attribution remains a documentation-admission gap;
the directly verified authority here is GNU's described reporting model.

The frozen project design at `a2249d466436f1f94ba2976265f4e1cc9d93137b`, README
lines101–105 (captured SHA256
`7fb1f7348ba43c9e036ed71806061206d8be45ec77f3853fb89425bc0719b615`), requires
correct last-iteration/nested participation and says `(a(b)?)+` cannot reuse stale
inner state *by assumption*. That is a proof obligation, **not an independently
ratified literal null tuple**. Author E12 explicitly expects `b`, so the evidence
currently exposes a design/model/fixture authority conflict requiring adjudication.

**Yes, observed Bash/libc behavior could differ from a normative/documented ideal.**
Bash's official manual says `=~` uses regcomp/regexec; a Bash version label does
not by itself establish the linked library's reporting behavior. No GNU/Linux,
Darwin, libc or Bash output for these cases is established here. Native parity
remains UNRUN. Do not repair toward null solely to make these review assertions
green if ROOT instead selects an independently observed Bash compatibility profile.

## Exact seven identities: one root cause, not seven defects

| Failed group ID | Distinguishing scenario |
|---|---|
| I01-parent-optional-reset | later parent skips optional inner group |
| I02-parent-alternative-reset | later parent selects the other alternative |
| I03-nested-parent-reset | omitted grandchild after nested parent re-entry |
| I04-manual-example | documented bananas/bas shape with inner zero repetitions |
| I05-finite-parent-reset | same omission under exactly two parent repetitions |
| I06-parent-zero-iteration | skipped optional child in last `b` parent |
| I23-finite-reset-property |52 counterexamples among62 bounded a/b inputs; same omission|

All seven assert last-parent-local reporting and fail for retained earlier inner
participation. I23 is one group, not52 new independent root causes. These are not
separate whole-match, priority, byte, limit or cancellation failures. Actual source,
installed and physically moved captures agree; source binding is unchanged.

## Separate R02: exact SOURCE-only checkpoint path

Frozen matcher.ts SHA256
`d9eb7ec7b18648ddcbd853085aef6972cd5938d3817df458796b0a7354b0abeb`:
`preferred` lines53–61 calls `historyOrder` lines29–50. Its inner linked-list
traversals checkpoint only at lines39/44 when `remaining % 256 === 0`.
For two equal255-entry histories, every remaining value is255..2, never256;
the ordinal loop also charges but has no checkpoint. Exact charges:
255 + 2×(254+253+...+1) =65,025, checkpoint calls0.

Source-derived witness: `(a){255}(|)` against255 `a` characters. The fixed repeat
accumulates255 group1 history entries; the two empty alternatives produce tied
complete states; comparing group1 follows that path. The operand repeated255
times is nonnullable, so the nullable-captured-repeat refusal does not exclude it.
The finite arithmetic was recomputed as DATA only. The witness was NOT executed;
no observed scheduling delay, cancel failure, allocation timing or native claim.
R02 is distinct from R01 and from its seven failed groups.

## Smallest conditional author proposals

1. **First settle R01's output authority.** If ROOT adopts last-parent-local
   reporting, clear descendant participation on parent group entry using a
   separately owned capture-vector copy, with allocation/work admission before
   copying/resetting. Keep capture-history ordering separate; do not blindly
   discard ranking histories or merely mask strings at publication. A matcher-only
   bounded descendant walk can avoid public API changes. Preserve E12's original
   tuple; any revised canonical fixture needs explicit profile justification.
2. If ROOT prioritizes actual Bash reporting and approved native evidence later
   confirms retained `b`, treat these seven assertions as model-profile mismatches,
   preserve their old failures, and revise the declared profile in a separate
   decision—not a covert product “fix” or manufactured native pass.
3. R02's narrow source proposal is ledger-work-based awaited checkpoints inside
   history traversal/ordinal loops instead of count-divisibility scheduling. No
   cap raise, new ledger, counter refund, priority rewrite or global API required.

No implementation is authorized by this packet. HOLD remains; suggested native
follow-up would record exact libc/platform/Bash identities and raw captures under
a separate presealed grant, not resume any existing held oracle or build.

## Primary documentation inspected

- GNU historical version-specific manual:
  https://ftp.gnu.org/old-gnu/Manuals/glibc-2.2.3/html_node/libc_148.html
- GNU current manual, previously read in the original review:
  https://www.gnu.org/software/libc/manual/html_node/Subexpression-Complications.html
- Official POSIX.1-2017 XBD9.1 (general priorities, insufficient alone for reset):
  https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap09.html
- GNU Bash Conditional Constructs (interface delegation, not this native tuple):
  https://www.gnu.org/s/bash/manual/html_node/Conditional-Constructs.html

Sources above are publisher documentation, not executed binaries. This packet
does not claim the historical manual describes every current implementation.
