# Pinned Test262 reference data

These seven byte-for-byte copies are archived reference inputs, not standalone Node programs. Their harness globals are supplied by the pinned Test262 runner. The `.js.txt` extension distinguishes evidence data from repository JavaScript; no lint rule, runtime assertion, upstream fixture or test selection is disabled.

The recorded conformance commands still execute the pinned external corpus at revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, not these archival copies. Historical logs retain their original paths. To reproduce an archival input, copy its bytes under the original name into a temporary harness/corpus directory. Preserve the neighboring LICENSE.

| Original filename | Archive | SHA-256 (unchanged bytes) |
| --- | --- | --- |
| assert.js | assert.js.txt | `206e274ca325eb8a652e3911c3fbd090e2480d11ed7579dc17a5d17a2360ed48` |
| object-contains-symbol-property-with-description.js | object-contains-symbol-property-with-description.js.txt | `d6bd3354061fa806c6175f0f175ef5bbd4814d3f1a2a22f2bf78b8c2825c93d2` |
| promise.js | promise.js.txt | `d4222c66cca33422a9d51587dd3abd271b0e4483e27658137cba25c6c63e1058` |
| property-order.js | property-order.js.txt | `9e784fd070bf100a894ea3abd9a34dcc845f8600251d2c1962449ceae31a4938` |
| propertyHelper.js | propertyHelper.js.txt | `08bc29114d804c4f24f906bac950ee4dc9c93c659d93258e7b44a54283ba9bb8` |
| return-on-corresponding-order.js | return-on-corresponding-order.js.txt | `a012e60d1625ccd8e5f3136b58d7d6f151dc1c0eb6f3debd367e88d4ea471c7c` |
| sta.js | sta.js.txt | `1930c54af79455c484799f43e9a28e2b2f15c40d0917c9941ca54e26db243f35` |
