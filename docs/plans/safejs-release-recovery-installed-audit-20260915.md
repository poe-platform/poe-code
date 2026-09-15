# Release recovery — fresh installed-artifact audit, 2026-09-15

Source HEAD: `22b6c2ff631d8d27c0add7a1d503035c9d9aa3c4`, main plus preserved dirty inputs. Fetched origin/main: `ff1923235ea1e0fa0a40bdeb06468fda13cc8d8b`. Node22.23.2 / ICU78.2 / Unicode17.0. ECMA-262 edition16 and ECMA-402 edition12 (June2025), Test262 and separately tracked newer API pins in the canonical ledger remain unchanged. This is release QA, not runtime compatibility certification. Host authority: repository/helper execution, injected memfs registry reads, isolated temporary consumer and read-only GitHub/npm access. No publish authority invoked.

## Executed results

Executed both fenced Node heredocs in [the committed independent record](safejs-release-recovery-independent-20260915.md), from repository root via Python subprocess/zsh: exit0 each. Invalid explicit version rejected; partial cohort607/606/606 chose608; concurrent equal views chose608 twice; refreshed608 cohort chose609; configured docs analyzer returned null and fix returned patch. Maintained registry helper eventual visibility and exhaustion each made three reads/two injected delays; exhaustion left manifest unchanged. Production retry budgets unchanged.

`npm run lint:workflows`: exit0. No workflow edits or workflow unit tests. No code repair established; no TDD repair claimed. Full runtime/build/conformance and screenshots skipped for this documentation-only change, not counted as passes. Seven scenario procedures and fresh/stale digest reproduction remain in [the QA record](prepare-release-failure-recovery-20260915/qa-record.md); its failure/cancellation conclusions are not rewritten.

Fresh read-only `gh run view 34931319430 --json jobs,headSha,conclusion,url` confirms failed fresh unit validation and skipped root release. Run34929329559 remains cancelled. `git merge-base --is-ancestor <SHA> origin/main` returned0 separately for failed source55c7d8b1186be5e272595dc6499ec349fa86d833 and cancelled sourced7af44927f6badab9504647da63f7748b86015b2. This verifies successor containment, not repair of either historical failure. For local task source22b6c2ff631d8d27c0add7a1d503035c9d9aa3c4 it returned1.

## Independent package verification

Fresh exact scoped versions installed in an isolated temporary consumer with `npm install --ignore-scripts --no-audit --no-fund @poe-platform/safe-fs@0.1.607 @poe-platform/safe-js@0.1.607 @poe-platform/safe-bash@0.1.607`: exit0,19 packages. Extracted only `scripts/fixtures` using `git archive origin/main scripts/fixtures`, then `node scripts/fixtures/safe-packages-smoke.mjs`: exit0, all maintained smoke assertions passed. `npm audit signatures`: exit0,19 verified registry signatures and12 verified attestations. No locally built artifact substituted for installed packages. This qualifies the observed published cohort, not the dirty local candidate or every runtime cell. Separate per-package integrity/provenance receipts remain in the QA record; fresh npm metadata agreed with its shasums:

| Exact package | Registry SHA1 | Release receipt |
| --- | --- | --- |
| @poe-platform/safe-fs@0.1.607 | 4e3229b1287da9d1d09341213cd8ccb4963e19ff | [scoped34974245983](https://github.com/poe-platform/poe-code/actions/runs/34974245983), success |
| @poe-platform/safe-js@0.1.607 | b145b7fc7b10a24119819069a2bbfa117de2ea7a | same run, independently installed |
| @poe-platform/safe-bash@0.1.607 | 14a922c504173cd868e0213517ace59cfd501dcd | same run, independently installed |
| poe-code@15.0.41 | 443840314e87ee1cb4049ed48900a6dfb9cee221 | metadata gitHead a03cf4f986dcbb7de309cbe4c1f5587551d81d04; predecessor only |

Fresh root [34974246493](https://github.com/poe-platform/poe-code/actions/runs/34974246493) log says analysis of1 commit: no release, and no relevant changes. Its successful workflow produced no new root version. Scoped publication and root no-release remain separate. npm metadata has no scoped gitHead; use retained SLSA source/subject correlation plus fresh attestation verification, never invent a gitHead.

## Delivery disposition and recovery

`git rev-list --left-right --count HEAD...origin/main`:66 local-only /1029 remote-only. The task commit is not on remote main. No push attempted: pushing this divergent tip would not deliver only this task; reconciling the whole dirty checkout risks unrelated work. Do not mark delivery complete. Required next step is a clean main checkout at freshly fetched remote, apply only the task-owned documentation delta (including this receipt), resolve evidence-file conflicts by preserving concurrent content, re-execute maintained nonpublishing checks and workflow lint, commit normally and push through normal hooks. Fetch/reconcile/revalidate again on non-fast-forward rejection; never force-push, bypass hooks or revert others. Monitor every triggered required workflow; docs-only root success must be recorded as no-release if analyzer so reports. If a successor is used, verify task commit ancestry explicitly. No associated issue was specified, so none closed.

Resume with `gh run view ID` including all attempts/jobs/logs before `gh run watch ID --exit-status`; retain exact source,run,attempt,artifact checksum, package/version and registry/provenance rows. Accepted-but-invisible publication stays pending and is retried read-only. Partial cohorts retain missing predecessor versions and use the documented forward-cohort procedure; exact-old-version selective resume remains unavailable. Destructive rollback requires separate explicit authorization. Never unpublish, duplicate publication or confuse built, validated, delivered, published and no-release states.

Recovery procedures and nonpublishing scenarios are evidenced; **overall task remains incomplete pending remote-main delivery and its workflow receipt**. Local predecessor task commit22b6c2ff… exists; this audit adds evidence only. Remote task delivery:none. Publication attributable to this task:none. Pre-existing staged diff SHA256 remained839e9e04f0f5e07fae2138a1c64a573e924875d6ccbb339c87774d51eaf251a8 through verification. No unrelated files edited.
