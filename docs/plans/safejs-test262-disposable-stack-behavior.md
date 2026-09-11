# DisposableStack: pinned source qualification

## Procedure

Use Test262 commit `72faf8ec1445c55149615e8b35187830783aba1a`, under
`test/built-ins/DisposableStack/prototype`. Load source, sta.js, assert.js and
declared harness includes in memory. Run strict source first in a fresh native
Node 26.8.1 VM context and then in a fresh SafeJS run. Record native failures
separately; exclude/report negative, noStrict, async, module and raw metadata.

This is not the official runner or exhaustive resource-management conformance.
It does not qualify AsyncDisposableStack, async disposal, checkpoint replay,
all supported Node versions or resource-budget behavior.

## Results

| Method | Guest passes | Native passes | Metadata exclusions |
| --- | ---: | ---: | ---: |
| use | 19 | 19 | 0 |
| dispose | 13 | 13 | 0 |
| adopt | 12 | 12 | 0 |
| defer | 11 | 11 | 0 |
| move | 13 | 13 | 0 |

All 68 cases pass unchanged (b48085 and d1f244). No runtime defect or repair is inferred
from this evidence. The separate full-package gate remains authoritative for its
own eventual result. No push or release was performed.
