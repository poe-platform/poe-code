# Iterator limit range

The current ECMAScript 2027 draft requires both `Iterator.prototype.take` and
`drop` to reject finite number limits above 2 ** 53 - 1 with RangeError and
close the iterator before acquiring its next method. Positive Infinity remains
valid. This is a current-draft requirement, not a claim about the published
2026 edition or older native engine behavior.

Sources inspected:
- https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype.take
- https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.prototype.drop

Current source only rejected NaN and negative truncated limits. Regression
session 62526 reproduced four failures and two passes: unsafe limits were
accepted and the next getter ran instead of return; a converting limit also
observed next instead of close. The implementation adds the finite upper bound
inside the existing conversion/IteratorClose error path, before truncation.

After the change, session 71362 passed 95 tests across the new range tests,
lazy helper tests, direct SDK Proxy tests and iterator-close tests. Additional
direct SDK and public replay coverage has been added and awaits qualification.
Preserve boundary, positive Infinity, negative fractional zero, conversion
ordering and original error precedence. Do not iterate an enormous fixture
to validate a constructor-time constraint.

## Isolated qualification

Candidate `/tmp/safejs-limit-range.Cyfb1b/candidate` was exported from a private
index based on `6ef11daa2`, containing only the implementation, new tests,
README and this plan. Export session 62865 completed before the build started.
Build session 18700 passed all 23 selected workspace tasks and four fresh
native ESM import checks. Fingerprint 82f1dc verified 1,339 tracked blobs,
eight generated Intl copies, and no unexpected source/test/script files.

All ten dedicated tests passed in session 29271, including direct SDK calls
after cleanup and public replay; that session's scoped lint also passed.
Isolated session 54145 passed 736 tests across 35 iterator, accounting and
snapshot files in 27.36 seconds. This is scoped qualification, not a claim of
a passing full package gate or resolution of its known timing failures.

Built CLI smoke on Node 18.18.2 returned RangeError and `closed: true` for both
methods (ea0d13). Screenshot session 34453 passed; its image was inspected and
showed the same complete JSON results without rendering defects:
`screenshots/node-tmp-safejs-limit-range.Cyfb1b-candidate-packages-safe-js-dist-cli.js-tmp-safejs-limit-range.Cyfb1b-limit.ajs.png`.
Final isolated lint session 92956 passed (terminal fd5c02). During its quiet
run, a one-second native sample confirmed active filesystem-stat callbacks,
directory enumeration and JavaScript execution, not a stopped task. Sample:
`/tmp/safejs-limit-range.Cyfb1b/eslint.sample.txt`. No lint guard was bypassed.
Keep other pending prototype and weak-reference changes out of this commit.
Publication remains on hold.
