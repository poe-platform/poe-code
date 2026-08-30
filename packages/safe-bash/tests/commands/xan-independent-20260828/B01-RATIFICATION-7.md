# Normative B01 delta: seven resolved, one remaining

**PROJECT PROFILE; not final freeze or execution permission.** Latest routed
root ratification now resolves the seven rules below. This overrides only their
former proposal-only status at `1168432e12568e63ff307e92ed83d64d78a03a3c`.
Earlier preparation and final-freeze-v3 artifacts remain immutable history.

`B01-RATIFICATION-7.json` contains the normative fixed-input expectations and
three full pinned document hashes. JSON SHA256:
`b632cca2f185f3b222062fc4bdc091a6a95861a8743a209608d40dff947d54de`.
This Markdown receipt is bound by the exact additive Git commit reported to root;
no circular self-hash is claimed.

| Rule ID | Ratified disposition |
|---|---|
| B01-R1 | Repeated **singleton** flags reject with status 1 before I/O. |
| B01-R2 | NUL/CR/LF/quote delimiters reject beyond the existing one-ASCII restriction. |
| B01-R3 | Slice numbers use digits with optional leading `+` only; invalid spellings reject 1. Existing u64 domain applies; selector i64/name rules are not expanded. |
| B01-R4 | Checked start+len/index+1/header-start+column reject overflow beyond u64. Header-dependent validation may read the first record. |
| B01-R5 | Interior empty selector rejects 1; `select '0,'` yields exactly `a\n1\n3\n` on common input, status 0/empty stderr. Empty whole selector remains valid. |
| B01-R6 | L+I/range and I+range reject 1 before I/O. Range includes start/skip/end/len and single index (defined as start plus length one); common -n/-d/-o are not conflicts. |
| B01-R7 | Invalid plural-index diagnostic identifies **-I**, not singular -i/--index, in the offending-option reference; nonempty and bounded, without global wording freeze. |

Common input is exactly `a,b\n1,2\n3,4\n`. The JSON has fourteen targeted case
bindings, not fourteen executions or a new corpus. Rejection stdout is empty for
these pre-I/O/pre-output validation fixtures only; it is not a transactional
promise for later streaming or provider failures. Only R1/R6 assert before-I/O
rejection universally. The finite two-header overflow case permits reading its
header before rejecting, not a false no-read claim. Diagnostics are semantic and
bounded by existing budgets; no invented prefix or exact global stderr bytes.
For R7, contextual option identification avoids banning incidental `-i` substrings
in echoed paths or other text.

**Only remaining hold:** Faraday's exact cursor-skipping wildcard/range exclusion
enumeration and its final profile binding, routed by root. `select '0::1'` remains
UNRESOLVED/UNEXECUTED with no expected or recommended golden. The seven ratified
rules must no longer be reported as blockers. Approved CR/BOM/M/EOF, zero-tail/
ordinary-zero distinctions, quotas, publication/alias/fallback and lifecycles are
unchanged. Author clearance remains HOLD pending that one remaining disposition;
native parity is not the hold criterion.

Read/check chronology: applicable AGENTS, root/index and pinned proposal sections
checked at **2026-08-28T04:05:28Z** (August 27 Chicago). At **04:09:10.350Z**, JSON
consistency, three immutable document hashes and all nine original owned paths
at `a364a807b0f4ab1b062bcf3c9ddb714466f5ec30` matched. Their exact path/digest
algorithm and aggregate hash are in the JSON. These are artifact checks, **not
tests**; original-path checks do not establish append-proof integrity. No moving
author source/implementation absence claim is made. Zero product/native/oracle/
test/process-cohort executions; no dependencies, framework, foreign artifact
changes or owned background processes. Commit only these two new files.
