# Reader correction, ordinary retained helper failure

The first reader retired exit1 after checking an absent `record.size`; the
authenticated source manifest actually declares `sources[].bytes`. Its raw
stdout/stderr and copied read.mjs remain unchanged. V2 selects only the exact
305 `sources` records, validates the real integer `.bytes` schema, and checks
both SHA256 and byte count independently. No expected source hash changes.
If actual content/size differs, STOP; no further reader correction authorizes
ignoring such drift. Same bounded SOURCE-only imports/read policy and phase
deadline. This is PURE helper2 of4, no product import or child launches.
