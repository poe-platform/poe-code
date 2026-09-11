---
title: Incremental regex splitting
---

Five native comparisons reproduced regex budget failures from scanning input
after the requested split result limit was already satisfied. A separate test
showed result allocation limits were checked only after unnecessary matching.

Replace eager match collection with incremental cursor execution. Check the
result limit before each match, advance empty matches, include captures only
until the limit, preserve source cursor isolation, and check each output array
allocation before further matching. Keep required matching under the existing
regex budget; an unmatched capture counts toward the result limit too.

Validate native results, captures, empty matches, trailing separators, cursor
isolation, and both regex and result allocation budget controls. Run the maintained
package unit suite, changed-file lint, types, selected workspace build, and this
zero-capability, zero-spawn harness with a screenshot.

Full RegExp species/exec dispatch, intrinsic prototype graphs, lookahead and
other unsupported regex syntax remain separate gaps, not completed by this fix.
