# Case-sensitive NumberFormat unit validation

Built Node 18 accepts nanoSecond while Node 24 throws RangeError. A getter-order
probe also confirms Node 18 reads unitDisplay after this invalid unit, whereas
Node 24 throws before reading it. ECMA-402 IsWellFormedUnitIdentifier compares
original identifiers to the sanctioned list without case conversion.

Six direct private-engine regressions for mixed-case simple and compound units
failed before the correction. The parsed generator now removes only the first
unit = toLowerCase(unit) statement from IsWellFormedUnitIdentifier and checks its
exact source shape. Tests require RangeError before unitDisplay is read.

All 178 tests in five focused files pass after regeneration. Validate targeted
lint, the maintained build and built Node 18/24 behavior before delivery. Keep
this separate from the preceding subsecond-unit and exact-plural prerequisite.

Targeted lint and the maintained 23-workspace build passed, including four
fresh-import checks. Built Node 18.18 and 24.14 each pass all six rejection and
guest getter-order comparisons. The prerequisite is commit 1f3d5680e.
