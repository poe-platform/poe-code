# ISO month names: upstream initialization defect

## New primary-source evidence

[Node PR 64678](https://github.com/nodejs/node/pull/64678), merged August 12,
2026, identifies ICU-23262 as the cause: missing ISO era resources leave an
error status set during initialization, preventing subsequent month-name data
from loading. The patch clears that status in ICU's date-format-symbol loading
code. It does not replace ISO patterns with Gregorian patterns.

The PR also reports browser workarounds that supply missing era data. Therefore
the observed difference between Node runtimes must not be attributed solely to
their ICU version labels: a downstream code patch can change the result.
The API response and patch were inspected directly (829d24).

## Consequences for this repository

This explains the existing missing-month reproduction but is not a SafeJS fix.
Changing requested era options does not follow from the initialization patch.
Neither substituting Gregorian formatting nor requiring a newer Node version
satisfies the current portability requirement. Do not patch the user's Node
installation, global Intl or node_modules.

A package-owned fallback must still preserve ISO layouts, contextual names,
range partitioning and Temporal consumers. Any ICU data/engine alternative
must be exercised against the existing multi-locale regressions before adoption;
the upstream patch alone does not qualify such an alternative.
