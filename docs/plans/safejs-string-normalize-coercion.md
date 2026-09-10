# String normalization form conversion

## Validation

The unchanged runtime failed 11 of 13 regressions (09deb7). Guest form string
conversion was bypassed, callable form objects and ignored extra arguments were
rejected, and Symbol forms produced the wrong error. The tests compare native
receiver/form conversion order, thrown values and all four normalization forms.

## Repair

Normalize now converts object form arguments through sandboxString after receiver
conversion. Primitive arguments preserve the synchronous native path, including
the undefined NFC default and Symbol rejection. Receiver/arguments remain
retained during asynchronous conversion; native normalization still validates
the resulting form and computes Unicode output. Output allocation stays budgeted.

## Verification

The regression includes direct context-free calls and pending/completed
checkpoint replay. No Unicode normalization algorithm was replaced. This is
argument-protocol coverage, not an exhaustive Unicode conformance claim.
The four-file normalize/string/coercion/retention selection passed 50 tests
(e33bcc), including all 13 new regressions. Targeted ESLint and the maintained
package TypeScript configuration passed (274260).
No CLI visual behavior changes, push or release. The prior full-package result
predates this repair and its 14 remaining failures are unresolved.
