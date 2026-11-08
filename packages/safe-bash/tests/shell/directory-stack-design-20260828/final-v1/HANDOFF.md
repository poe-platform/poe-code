# Final stack design: root decisions before different freeze

**Design only.** No production patch, feature acceptance, virtual stack replay,
new parser/public API or default-command count change. `PACKET.md` is the final
author-facing proposed contract; earlier PROPOSAL/native observations remain
historical and unchanged. Its R1-R4 recommendations need root ratification before
Locke freezes implementation controls. A separate GO is still necessary.

## Decisions requested

1. **State architecture:** only runtime.ts plus shell.ts. Optional internal
   tail/accounting and immutable publication-stamp fields; fresh tail for each
   exec and new interpreted process, shared within functions/source/groups, copied
   across every clone and redirect-state spread. Stack-originated actual cwd
   publication changes the stamp. The existing conditional middleware restore
   checks it, handling nested same-path push/pop without exempting -n/no-op calls.
2. **Complete grammar:** accept the packet's source/observation-backed parsing
   table, including ignored operands, signed64 ASCII magnitude parsing and marked
   dash's OLDPWD behavior. Extreme signed-overflow handling remains a safe declared
   profile; --help reproduction is deferred, not silently claimed as native parity.
3. **Capacity/work composition:** validate/preconstruct the new remembered tail
   before publication/lookup, including inserted cwd during rotation. Ratify exact
   reached-token/HOME scans, step units and final-flush policy. Keep the stack's8Mi
   counter and accepted CdLookup8Mi counter separate without resetting either or
   claiming one global8Mi limit. One8Mi stdout counter covers both the cd-selected
   path print and automatic stack display;16KiB chunks preserve awaited writes.
4. **Failure boundary:** retain the native pre-cd swap/rotation tail effects and
   stronger readonly writes. For ordinary push/top-pop, publish the after-cd tail
   only after the shared method's required CDPATH/dash print has succeeded. Thus
   print failures can leave changed cwd but no insertion/removal; automatic display
   failures retain committed tail. Ratify65,792-byte owned diagnostic payload and
   the exact private messages, without a global formatter/public-limit change.

The packet gives the private `changeDirectory(...): Promise<number>` seam so
implementation reuses accepted lookup, X_OK, checked publication and output rather
than dispatching a second command or reimplementing cd. `cd` retains the no-hook
path and all accepted behavior; no other Runtime state/lifecycle changes are
implicitly approved. The planned stack constructor/reset/clone paths are explicit.

## New bounded evidence, not an original-cohort rescore

Additional native-only grammar freeze:
`23fca35fc5d7c749a7273015b802aef6376096a2`, committed **before** execution.
Exactly eight direct children; no timeout/signal/error, one owned root removed.
Each script prints individual subcommand statuses; final script status0 is not
an assertion that every command succeeded.

| Row | Newly observed decisive outputs |
| --- | --- |
| G01 | -n extra path ignored0; ordinary extra path1; late -n1 |
| G02 | empty initial -- swap1; -n -- silent0; -- swaps existing tail0 |
| G03 | rotation ignores trailing word0; last valid selector wins0; earlier invalid range fails1 before later +0 |
| G04 | popd last selector0; -- ignores later +99; dirs retains -p before --; clear before -- succeeds0 |
| G05 | signed64 max is valid-but-out-of-range1; max+1 invalid-number2; inner plus and leading space accepted0; negative magnitude out-of-range1 |
| G06 | pushd - and pushd -- - both resolve OLDPWD and print; -n -- - stores raw dash |
| G07 | raw empty -n entry retained; HOME=/ does not abbreviate; exact component-boundary HOME behavior preserved |
| G08 | clear plus valid out-of-range succeeds0; malformed number prevents clear2; empty pop argument stops/ignores following selector0 |

Original34 native/34 virtual observations, original0/34 comparison result and
the four separately presealed native-only topology cases are unchanged. New8
is not a corrected34 score, another virtual attempt, or an unqualified native
feature-win count. The additional questions were required to distinguish real
parser behavior from plausible generic-option assumptions.

Native identity is the same GNU Bash5.3.0(1)-release, aarch64-apple-darwin25.4.0,
SHA-256 `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
No new download/build/version probe. The new children used --noprofile/--norc,
closed stdin, an exact startup-disabled environment with empty PATH, and solely
task-owned fixture data. Original/raw and normalized outputs are retained.
The local primary manual remains SHA-256
`f3d37d57a1061e24d266051de9bd47ffa43dc86584afea11576c535ad2be32d5`.
Implementation-source inspection is separately recorded by filename/hash; no
GPL source was copied and those deductions are not native executions. An online
GNU manual search found its canonical page; full-page retrieval returned no text,
so the pinned local sources remained the detailed authority.

## Accepted cd binding and review qualification

Use exactly accepted5137 + ca1d3342's two WebDAV blobs + runtime4641075d,
package06ea635b, not current HEAD. `BINDING.json` supplies full hashes/commits.
All three prospective production paths still match their accepted blobs.

Locke2585f78d/final192ab78b accepted cd with the routed qualification: L24 executed
the actual candidate Runtime with a scripted provider in all three layouts; it
was not a model-only calculation. Its original surrogate string,65536 accounting
bytes, stat/access1, status and state were observed. The historical Memory batch
stopped at L07 fixture setup after61 passes; L24 was blocked, not a failed executed
assertion. Source-only private work/yield/state proof roles remain as frozen,
including I07; no fabricated dynamic private-counter measurements are required.

```
node tests/shell/directory-stack-design-20260828/final-v1/verify.mjs
```

This verifies the packet, protected production/history bytes, preseal binding and
recorded native cleanup without executing a product or native child. No running
author children/services remain. Root can now decide R1-R4 and relay the packet
to Locke; author implementation remains held.
