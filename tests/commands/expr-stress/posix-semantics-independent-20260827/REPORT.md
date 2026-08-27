# Independent POSIX nullable-capture design judgment

2026-08-27. **Native semantics/design evidence only. No product acceptance.**
Inputs froze in `3cbcdc1aefb4007f819e36610bbabdc41c913be4` before this review's
native execution. Neither the virtual expr implementation, its worker/prototype,
nor GNU's implementation was opened or executed by this reviewer. The assigned
author report was read, including its descriptions of implementation behavior;
those descriptions are not independently reproduced implementation findings here.
No old fixture, source, root export, configuration, or private checkout changed.

## Decision for root and author

1. **Do not transmit or normalize `[0,-1]` as a successful capture.** A completed
   participating capture has ordered in-range endpoints; an empty one has equal
   endpoints. A nonparticipating subexpression is distinct. The public POSIX
   `regexec` contract uses `[-1,-1]` for nonparticipation, not a half-open sentinel
   with one negative endpoint. This does not require our protocol to use that
   exact sentinel representation. [N2]
2. **The narrow P/`aaa` case has a stronger answer than arbitrary repeated-group
   tie-breaking.** Under the current no-gratuitous-empty-repetition rule, the
   longest match forces the completed last capture `a`. The derivation below
   does not select between competing longest repeated-capture histories. The
   pinned GNU command instead returns empty, even without its `+` extension.
   This is a reproducible public behavior discrepancy, not merely a trace-format
   artifact. It supports a narrow inconsistency diagnosis against that reading
   of Issue 8, **not an upstream-confirmed GNU bug or a formal conformance ruling**.
3. **Do not generalize this to a universal final-register comparator.** P/`aaaa`
   and nonempty Q have competing histories; mandatory empties are different from
   optional trailing empties. This sidecar does not resolve all subpattern/history
   priority questions. Historical interpretations identify real specification
   ambiguities; they are not blanket permission to ignore today's explicit
   repetition/backreference rules. [H43, H135, N1]
4. Support may honestly target bounded, coherent completed-capture semantics
   derived here, retaining the exact GNU mismatch as a separate compatibility
   row. Do not change the old GNU expectation, claim five-of-five GNU parity,
   match an input-specific anomaly, or promote the worker prototype from this
   design review. A different verifier must test any implementation.

## Normative sources, without edition substitution

Issue 8 / POSIX.1-2024 normative pages were retrieved directly from the primary
publisher. `SOURCES.json` records response-body hashes, byte counts and retrieval
times. `web.run` searches and historical/rationale retrieval worked, but direct
Issue 8 normative opens returned no text; HTTPS retrieval from the same primary
publisher succeeded. No Issue 6 excerpt is presented as current text.

- XBD 9.1 gives whole leftmost-longest priority, then left-to-right subpattern
  preference; participating empty outranks nonparticipation. XBD 9.3.6 permits
  grouped repetition and backreferences, including empty captured strings, and
  binds a repeated group's reference to its last match. Its final paragraph
  restricts repeated empty matches to an all-empty repetition or those needed
  to meet an exact/minimum count. Adjacent repetition operators are undefined;
  the inner and outer operators in P are separated by group syntax, not adjacent.
  Neither P nor Q is an empty-pattern group or an invalid forward reference. [N1]
- `regexec` reports the last top-level repeated submatch, equal offsets for a
  participating empty, and paired negative offsets for unused/nonparticipating
  entries. Successful match data must not be confused with offsets left behind
  after `REG_NOMATCH`; this probe deliberately initializes those to `-99`. [N2]
- `expr :` anchors at the beginning and returns the first capture when present;
  no matching capture yields empty. The utility prints a newline and returns 1
  for empty/zero, 0 for other successfully written values. Therefore its bytes
  alone cannot distinguish successful empty capture from no match. [N3]
- GNU's unary `+ token` quoting operator is an extension, not POSIX expr syntax.
  We preserve the original argv, but also run the plain three-operand invocation
  on the same GNU binary and Apple expr. All subjects are ordinary empty/letter
  strings, avoiding operator/negative-integer ambiguity. [G1]
- A.9.1's conceptual submatch description is informative. Interpretations 43 and
  135 concern the 1993 standard, with unresolved repeated/nested ordering and
  null-iteration questions. Their proposed solutions are not adopted normative
  algorithms. Current 9.3.6 explicitly contains constraints missing in that old
  discussion. Neither the historical response nor modern rationale alone proves
  one general history comparator correct. [R1, H43, H135]

## Exact five cases: deduction versus observation

Literal JSON patterns: P = `"\\(a*\\)*\\1"`, Q = `"\\(a*\\)\\{2\\}\\1"`.
The reported capture excludes the utility's terminating newline.

| Pattern / subject | Completed-capture deduction | Pinned GNU 9.7 capture/status | Apple expr capture/status | Darwin public libc whole / capture |
| --- | --- | --- | --- | --- |
| P / empty | empty, participating | empty / 1 | empty / 1 | `[0,0]` / `[0,0]` |
| P / `a` | empty whole and capture | empty / 1 | empty / 1 | `[0,0]` / `[0,0]` |
| P / `aa` | whole `aa`, capture `a` | `a` / 0 | `a` / 0 | `[0,2]` / `[0,1]` |
| P / `aaa` | whole `aaa`, capture `a` | **empty / 1** | `a` / 0 | `[0,3]` / `[1,2]` |
| Q / empty | two mandatory empties; empty capture | empty / 1 | empty / 1 | `[0,0]` / `[0,0]` |

**Finite derivation, not a new regex matcher:** in a nonempty P match without
gratuitous empty iterations, let the last captured length be `k >= 1`, and the
sum of earlier iteration lengths be `s >= 0`. The whole length is `s + 2k`,
because the backreference consumes another copy of the last capture. At length
3 the only solution is `k=1,s=1`; `[a][a]` followed by reference `a` witnesses
that length. Length 2 forces `k=1,s=0`. Length 1 admits no positive solution;
the successful participating-empty match remains at length zero. At length zero,
an empty occurrence supplies the reference; a zero-occurrence absent group does
not. Q on empty requires precisely two empty occurrences, expressly permitted
by its minimum/exact count. Thus no last-capture length tie is needed for these
five deductions. [Application of N1; not a standards-body interpretation.]

This reasoning reads "only match for the repetition" as the quantified
repetition's empty-only case, not permission to append an optional empty after
every productive iteration merely because the remaining suffix is empty. The
latter interpretation would undo the paragraph's restriction. If a different
normative reading is proposed, it must address that paragraph explicitly; a
native result or the 1993 ambiguity statement alone does not establish it.

The author's `[0,-1]` GNU helper observation is **not independently replayed**.
It is not a valid POSIX public `regmatch_t` capture if published as such, but an
internal helper's register representation is not automatically that API. This
review proves the external GNU tuple separately; it does not claim to locate the
GNU reconstruction bug. P/`a` is particularly important: GNU's reported helper
whole-length difference is invisible in the expr tuple and must not be counted
as an additional public-output defect.

## Bounded native controls and their limits

Eighteen independently frozen cases generated **77 semantic observations**:
18 GNU `+`, 18 GNU plain, 18 Apple plain, 18 public libc probes, and the five
original cases again with plain GNU plus `POSIXLY_CORRECT=1`. All children closed;
no timeouts, signals, stderr or execution errors. This is not 77 product passes.

- All 18 GNU `+` and plain tuples agree. All five POSIX-environment controls
  agree too. All five original GNU tuples reproduce unchanged.
- GNU and Apple tuples agree on 14/18, disagree on P/`aaa`, P/`aaaa`, Q/`aa`,
  Q/`aaa`. For P/`aaaa`, GNU returns `aa`, Apple `a`: both have productive
  whole-length-four witnesses. For Q/`aaa`, GNU empty can use `[aaa][]` plus an
  empty reference, while Apple's `a` can use `[a][a]` plus `a`. The former empty
  is needed for the exact count, unlike an optional P tail. No blanket "GNU empty
  is wrong" rule follows.
- Apple expr agrees with its host libc's projected capture on 18/18. These are
  not two proven independent regex-engine implementations: the C helper links
  libSystem, and no Apple expr implementation was inspected. The GNU binary is
  an independently identified utility, not evidence for every GNU/Linux libc.
- Public libc reports 15 matches and 3 `REG_NOMATCH` results; all successful
  offsets are valid. Absent/nonnullable controls distinguish nonparticipation
  from mandatory empty; literal standard examples check last capture and whole
  match priority. Four validator negatives reject half-open negative spans,
  out-of-range spans, silently replacing the GNU result, and conflating empty
  success with no match. These are evidence-validator controls, not source mutants.
- **Do not promote Apple/libc to the normative oracle either.** Q/`a` reports
  whole length zero despite the apparent mandatory-empty witness `[a][]` plus
  empty reference for length one. This is a separate disclosed longest-match
  concern under the same interpretation, not investigated as a new engine bug.
  No other libc, GNU grep, Linux, or locale was tested; grep's match-only output
  would not establish which capture was returned.

## Reproduction, identity, and cleanup

Run the read-only sealed checks:

```sh
node tests/commands/expr-stress/posix-semantics-independent-20260827/verify.mjs
```

An explicit fresh native recapture writes only to unique OS-temp output and
removes its separate compiled-helper temp directory:

```sh
node tests/commands/expr-stress/posix-semantics-independent-20260827/capture.mjs
```

`capture.json` retains literal argv, byte-hex streams, statuses, runtime/binary
identities, platform, compiler invocation, linkage, historical input hashes and
pre/post input/native hashes. GNU expr9.7 SHA256 is
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`;
Apple `/bin/expr` is
`584ea6af503bdb3cc647c128a16a1aa9d22d3eeab136671f746a209bfef7db9f`.
Host macOS26.4.1 build25E253, Darwin arm64, C locale; Node22.22.2. The helper
compiles with Apple clang21, `-std=c11 -Wall -Wextra -Werror`, and links
libSystem1356.0.0. The dylib is not independently hashed from the shared cache;
this is host-qualified evidence, not a hermetic SDK/library attestation.

Each native invocation has a 2-second SIGKILL deadline and 64KiB output cap;
the compiler shares that bounded deadline. The successful run retained its
unique capture directory and removed the helper directory. `spawnSync` awaits
child exit. No workers, servers or active owned children remain. Selected
inputs/native files are unchanged; this is not a whole-repository write audit.
No TypeScript/product build is relevant to this C/native design-only sidecar.

Historical author `53f2a468` and frozen CASES `6580859f` are authenticated in
the capture and untouched. No product results are subtracted, replaced or added
to their denominators. The source implementation still requires its own review.

## Primary references

URLs are exact retrieval locations; full response hashes are in `SOURCES.json`.

- [N1] POSIX.1-2024 Issue 8, XBD9.1 and9.3.6:
  `https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap09.html`
- [N2] POSIX.1-2024 Issue 8, regcomp/regexec DESCRIPTION:
  `https://pubs.opengroup.org/onlinepubs/9799919799/functions/regcomp.html`
- [N3] POSIX.1-2024 Issue 8, expr Matching Expression/EXIT STATUS:
  `https://pubs.opengroup.org/onlinepubs/9799919799/utilities/expr.html`
- [R1] Informative rationale A.9.1/A.9.3.6:
  `https://pubs.opengroup.org/onlinepubs/9799919799/xrat/V4_xbd_chap01.html`
- [H43] Approved interpretation of the 1993 standard, finalized1995-09-12:
  `https://www.open-std.org/jtc1/sc22/wg15/docs/rr/9945-2/9945-2-43.html`
- [H135] Approved interpretation of the 1993 standard, finalized1995-11-20:
  `https://www.open-std.org/JTC1/SC22/WG15/docs/rr/9945-2/9945-2-135.html`
- [G1] GNU manual, expr and String expressions; consulted page labels9.11,
  **not** the executed9.7 profile and not a latest-release assertion:
  `https://www.gnu.org/software/coreutils/manual/coreutils.html`
