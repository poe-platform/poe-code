# Sniffer Unicode word classification

CPython 3.14.2 uses Unicode 16.0.0 for its regular-expression word class. Python word characters comprise Unicode Letter and Number categories plus ASCII underscore. Host JavaScript Unicode properties are not used.

Source: https://www.unicode.org/Public/16.0.0/ucd/UnicodeData.txt

SHA-256: `ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f`

The source's First/Last records are expanded as inclusive ranges, Letter/Number categories are selected, underscore is added, and adjacent ranges are merged into 771 ranges (142940 code points). The resulting character class is checked into `packages/csvkit/src/csv/sniffer-unicode.ts`. It is used for both delimiter exclusion and the frozen doublequote heuristic's nonword matches.
