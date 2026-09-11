# For-of let lookahead

Native comparisons reproduced three mismatches: SafeJS accepted a raw
let.x assignment head in both for-of and for-await-of, and rejected an escaped
let identifier assignment head. Six controls passed before the repair.

Reject a raw let-starting for-of head unless it starts a lexical declaration;
parentheses and escaped identifiers remain distinct. In iteration-operator
lookahead, do not mistake escaped declaration spellings for actual declaration
keywords. Keep for-in member heads and valid destructuring declarations intact.

All nine native parse/runtime comparisons passed; broader parser/runtime and
snapshot checks passed 1,495 tests with one skip. TypeScript and focused lint
passed. This local followup is outside the frozen integration
run and has not been committed, pushed or released.
