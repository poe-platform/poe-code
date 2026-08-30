# Future native validation — UNRUN, fresh authorization required

No command in this file has been executed for M1B. Development Git commits do
not authorize these native oracles. No actual repository/user/private paths may
be used. The version/path/hash/dependency closure must be admitted separately;
this file does not select an unverified installed version or an ambient PATH.

## Small pack/index validator

In a fresh bounded disposable DATA-only root, materialize one already-hashed pair
from NEUTRAL-PACKS.json as `objects/pack/pack-<packSHA1>.pack/.idx`. Verify hashes
before and after. Proposed exact argv to an admitted absolute Git executable:

```text
git --no-pager verify-pack -v <absolute-scratch>/objects/pack/pack-<sha1>.idx
```

Compare parsed OID/type/size/offset/depth/base metadata with witnesses; timing and
compression statistics are not stable oracles. Test P01–P13 separately: depth33
can be valid native input but is outside our fixed profile. Version3 behavior and
small64-bit-indirect offsets need qualified native observations, not assumed parity.
No pack-objects/gc/index-pack/repack, native object generation or repo mutation.

## Six unchanged useful workflows

Materialize the sealed neutral VFS DATA into an isolated scratch directory only
under a fresh ROOT grant. Drop ONLY its11 loose object files and add P01 or P02
matched pack+idx. Preserve original config/index/HEAD/refs/worktree bytes/modes.
No Git init/checkout/hooks/filter/network. Proposed explicit fixed flags before
the original arguments: `--no-pager --no-optional-locks -C <scratch>`.

| ID | Exact original remaining argv | Expected bytes source |
| --- | --- | --- |
| N01 | status --porcelain=v1 --no-renames -uall | original proposedOutputs[0] |
| N02 | diff --name-only | original proposedOutputs[1] |
| N03 | diff --cached --name-only | original proposedOutputs[2] |
| N04 | show HEAD:src/app.txt | original proposedOutputs[3] |
| N05 | log --first-parent --format=%H\ %s -n 2 | original proposedOutputs[4], format is ONE argv item |
| N06 | ls-files -z | original proposedOutputs[5] |

Future tool envelope: finite environment with LC_ALL=C, TZ=UTC, isolated HOME,
GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null and GIT_OPTIONAL_LOCKS=0;
explicit known Git exec route, no ambient aliases/config/external helpers.
The grant must cover any native configuration/read/runtime route; this recipe
does not relax an OS fence or infer /dev/null access. At most13 verify-pack and
12 workflow invocations,10s each,1MiB capture each, supervised teardown and
pre/post tree inventories; immutable originals outside scratch. Unknown routes,
unexpected writes, cleanup failures or hash drift stop dependent work, no retry.

Object-only native validation is not pack VFS/provider/stream/cancellation proof.
All native results, profile differences and unavailable controls stay separate
from later product results. Defaults78/root APIs are unchanged by this proposal.
