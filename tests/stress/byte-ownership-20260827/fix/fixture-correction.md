# Author regression fixture correction (before production edits)

The first author-only canonical run (`evidence/canonical-initial.txt`) is preserved:
24 tests, 15 passed, 9 failed. Six failures expose borrowed storage; three are
new test diagnostic mistakes, not product defects. The author incorrectly omitted
the `EFBIG: ` prefix from the exact FsError messages and command diagnostic.
Inspection of `src/contracts/errors.ts` confirms this prefix is existing behavior.
The three new expectations were corrected to the exact existing messages, not
weakened to substring assertions. No original audit fixture or assertion changed.

The original audit remains 20 tests, 17 passed, 3 failed. It is a different cohort.
The new author tests additionally cover custom line delimiters, empty views,
unterminated records, limits, and a public head byte-omission sink handshake.
`tests/commands/helpers.ts` is unchanged: its sink uses `.slice()`, which may retain
Buffer aliases. Therefore the new helper-based head failure is not independent
proof of a product-only sink defect; the public Shell handshake exercises the
real capture boundary separately. The original three failures remain the decisive
historical baseline.

After those diagnostic corrections and the three public sink-handshake additions,
the final pre-fix author cohort is 27 tests: 20 passed, 7 failed. All seven are
borrowed-Buffer assertions. The post-fix cohort uses these same final assertions.
