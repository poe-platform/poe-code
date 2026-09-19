# csvkit byte-boundary user QA

1. Run the maintained csvkit workspace unit route uncached and retain skipped
   and TODO cases as blockers.
2. Exercise real csvformat, csvjson, csvstat and in2csv operations with exact
   original expected bytes through CLI argv and SDK settings. Split input at
   every byte boundary, including UTF-8 BOM, astral characters and quoted LF.
   Also use a producer that overwrites its buffer after every yield.
3. Use memfs for named inputs; compare unchanged input bytes and namespace,
   exact stdout/stderr/status, and single cooperative source finalization.
4. Have an independent agent exercise safe-bash command composition and register
   its maintained tests in guarded discovery. Fix only concrete reproduced bugs.
5. Run focused maintained build/test/lint routes, inspect relevant CLI output,
   and record measured outcomes and remaining limits in docs/csvkit. Preserve
   existing edits/staging; do not commit, push, publish or add README content.
