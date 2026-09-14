# Remote-main scan qualification continuation

Target unchanged: ECMA-262 edition 16 / ECMA-402 edition 12 (June 2025), Test262 419d3e0a2273ba01a3bfcbec423f2801425b8e93 and existing tracked newer APIs. Host grants remain explicit and unchanged.

Fetched base 775253e664c8c14502178cf9dcb74e6a656aacb0, independent detached delivery checkout. Node 22.23.2 / ICU 78.2, Darwin arm64. source.json pins commands and exact candidate hashes. Shared staged diff remains 839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8. npm ci installed independent dependencies.

First red attempt fails importing absent generated Intl files: zero executed tests, retained in red.log. Maintained numberformat-data.mjs generates them; red-ready.log then records 18 failures / two passes. Minimal repair propagates caller Budget to all existing executeRegex calls and charges every existing engine visit. Per-attempt guard remains; sequence evaluation is unchanged. No budget/assertion/timeout/runtime/authority relaxation. Failed work retains consumed steps; call depth and roots unwind.

Green command in source.json passes 1,031 tests / zero failures/skips in 16 files, 16.01 seconds, one sample. Scoped ESLint and normal npm run build pass. First maintained concurrency=4 attempt exits 2 in terminal-pilot pretest build: missing toolcraft generated declarations. Partial task results are not acceptance. Normal build prepares an unchanged-command retry; failure remains recorded. A separately copied Promise-symbol witness reproduces both failures on remote base: 29 versus expected 42, over-budget property admitted (promise-red.log).

Overall acceptance incomplete: prior commits must reconcile, Promise-symbol accounting needs delivery, repeated representative timing/accounting matrix and installed-artifact releases remain unverified. Historical dirty-tree profiles remain evidence of that candidate only. Prior camera 6,224/8,312 ms, harness 5,225 ms and cleanup EPERM failures remain variability. Virtual-bash and unavailable platforms are not counted as passes. No issue number supplied. No push/publication claimed. Recovery: verified normal-hook main delivery, follow required successor workflows with ancestry checks, independently integrity-check/smoke actual registry packages. No local publishing or destructive rollback.

A report launcher used the wrong working directory and failed before writing/staging evidence or creating a commit; corrected paths below preserve that tooling failure, not a test pass.

Descriptor continuation: before the known local f9c51fc21 guard was applied to remote-base delivery source, the five-case regression reproduced two failures / three passes. Applying its exact runtime guard makes all five pass; no callback authority or accounting charge is omitted. Exact adopted patch and red/green logs are retained. This revalidates the existing local fix against the reconciled source rather than claiming a newly discovered defect.
