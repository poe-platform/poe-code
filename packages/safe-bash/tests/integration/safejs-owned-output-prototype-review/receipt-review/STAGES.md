# Exact assembly stages and file deltas

All hashes below are SHA-256 of actual independently read bytes unless explicitly
identified as source-manifest or Git identities. `ABSENT` is an added file, not an
unknown. Full inventories and original expected receipts are in `attempts/r2/proof.json`.

## Prefixes

- R = `tests/shell-stress/first-read-contract-review`
- V1 = R/`owned-output-prototype`
- S = R/`owned-output-streaming-prototype`
- Q = R/`owned-output-qualified-prototype`

## Ordered artifact inputs

| Order | Actual artifact | Role | SHA-256 |
| --- | --- | --- | --- |
| 1 | `V1/baseline.tar.gz.data` | Extract B0 | `0066bc48069f116b549ea895e4972c02ed6958be641fd23ea3b6db26cc181f05` |
| 2 | `V1/source-r1.patch-data` | Whole nine-path patch | `d73bb2637d54b97f62fd6e1baa57100cf0018a763679c31386349e30a19cc4e2` |
| 2F | `V1/owned-output-author.test.ts.data` | Copy author fixture | `04914584fc2195f3a99006ab6fb7c18fd57d87ae6f8ba6dd4a847aa2ef1f8ce1` |
| 2F | `V1/adapted-first-read-probe.ts.data` | Copy adapted probe | `743f93c910422eb4ad64ac77caacb9aacf71837f28b92a51a1993e8651c6b771` |
| 2F | `V1/adapted-remote-close.test.ts.data` | Copy adapted test | `913548f801bad996dc1d95767380bf48075129d3eeaaff096f13a99983b95cae` |
| 3 | `S/baseline-current-retention.patch-data` | Four-path retention delta | `063751093b7cf887d35b33498b65e1ef49a2f35f9dfb28e368ab6e409fda05b5` |
| 4 | `S/source-S1-r0.patch-data` | Two-path S1 delta, once | `80c523e21610d90c67c8ab0084532ab465f645a0d57442dcd952795de01f2f3f` |
| 4 duplicate | `S/source-S1-r1.patch-data` | Same bytes, NOT applied | `80c523e21610d90c67c8ab0084532ab465f645a0d57442dcd952795de01f2f3f` |
| 4F | `S/author-r1.test.ts.data` | Copy final author fixture | `46291ac212a145924e477cb1d2767ec776b4ec9b53ae036c184699c7d220e03b` |
| alternative | `Q/candidate.tar.gz.data` | Complete final candidate, NOT overlay | `a3b9aa6fcb4596e8281de2c30943b98baa01449941c8368401d1172bce95d420` |

## Source-manifest identities

Serialization is sorted compact `[{path,bytes,sha256},...]`, including the original
property order. This is neither the archive SHA-256 nor a Git tree/blob ID.

| Stage | Source files | Manifest SHA-256 |
| --- | ---: | --- |
| B0 | 212 | `6d8589043618e623e35a63e92cbecc160b7f587335a69bba3e0b0f57e34dca8b` |
| V1 | 213 | `c13d21a4205f75a846363e7e2c13db103ed841ee61397553105745c940f31c44` |
| retention | 213 | `42e7a2f5cb127f017ee2e3f99a852ae769244a15b524c9572b64955d1cad29c3` |
| final-S1 | 213 | `6de9b96c7286cc320379d8f7f720f3d1a5ecffdc24b7268b198859550362feea` |

## V1 production delta

Patch: `tests/shell-stress/first-read-contract-review/owned-output-prototype/source-r1.patch-data`. Exactly 9 changed production paths;
219 other preexisting files unchanged (including fixtures/config).

| Path | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `src/commands/network/curl.ts` | `4859cc27a94d4ffe74ecadf20280d5d519d85babc50d24f55b9c51357c2dca42` | `bfbdb77e185e4aa206efc768c89f6f02ee2e833d64856a93320e6ea47f494eb3` |
| `src/commands/network/transport.ts` | `b6246ceacc90c0451028755fdf9cbb795790968676f48c8e3f9258128286f844` | `c9f3302aac3bba8fc1cd9c72571adb062dbc2e336da1a403c5c2d6207c2c0e05` |
| `src/commands/network/types.ts` | `806dd2132dd4004404dbb5c21a421e84c53c161f750f6acc1aedd0f8054b5fe9` | `be7a2770efdf42e90ca9eb41e37115b28607aeaf99ce95865d44b3625d20aa19` |
| `src/commands/streams.ts` | `8966dd770c11731e5256a1e42aaec4b07ae7f0508a3e89a3efc956d27109098d` | `792bc1af0f2c9d5fbd7b947956873f3dfbb5fd34fcbdadcb15b1ef8fb423c169` |
| `src/contracts/index.ts` | `fb9a434deb34dbad631166a689b02641c0e1acdbac691f6956a7c76e20729f50` | `21b09d18564ec4f586542af67a1e26f0198cc20938563f8b572cb5c4b38f676c` |
| `src/contracts/io.ts` | `e925ab08a5ad41862d3f5c031164cc7310bc28397455b11b37b75b55a9dbacdb` | `52970acab76d8a7482d2867bf023acb18db26393c281b2fc388a63feb98fcce4` |
| `src/contracts/output.ts` | `ABSENT` | `709af26d3a8cca80fa31c9acce54c59f332c920f566556b30e7ac6b14b4d1009` |
| `src/shell/runtime.ts` | `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b` | `d352c421177b82bd0a6f77ebc8cc9ab4b490e54cb39b685bb72871388a9fcb03` |
| `src/shell/shell.ts` | `538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c` | `136bbf577a0b12c4998e942cc07c1ace52c1db328d093919a10b885b7041cb7a` |

## retention production delta

Patch: `tests/shell-stress/first-read-contract-review/owned-output-streaming-prototype/baseline-current-retention.patch-data`. Exactly 4 changed production paths;
227 other preexisting files unchanged (including fixtures/config).

| Path | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `src/commands/internal.ts` | `28d83d91d5086b39b50494ea1130d34c3b48b22a15dc04c2912ee2503a7536d5` | `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654` |
| `src/commands/network/body.ts` | `29a8a744b043447eacc09d09ca651f2b0a34bdf08e08ddf3065729dbc486edbf` | `93d8a8463ac7df91c8ef88368f2ee8524a0abd7e7970badf4d1312587a34c880` |
| `src/commands/streams.ts` | `792bc1af0f2c9d5fbd7b947956873f3dfbb5fd34fcbdadcb15b1ef8fb423c169` | `40de51068674277e636e45d11cdc7cbd39fe3f1036aeda321802d8809a53af93` |
| `src/commands/structured/jq.ts` | `feca27d38a096931faabe5a5449ecc65c39c8b0abbcf69d3ea73a31f729fdbac` | `096897bfa9d875ba524cebd6b3959c551a26fa5e56d3b0d2fb42f9fabdf80da3` |

## final-S1 production delta

Patch: `tests/shell-stress/first-read-contract-review/owned-output-streaming-prototype/source-S1-r0.patch-data`. Exactly 2 changed production paths;
229 other preexisting files unchanged (including fixtures/config).

| Path | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `src/commands/network/curl.ts` | `bfbdb77e185e4aa206efc768c89f6f02ee2e833d64856a93320e6ea47f494eb3` | `db06650b1b55b994fe5fa83f7489062e91ac83b7d2d9c44bbb7606d57d9df057` |
| `src/contracts/output.ts` | `709af26d3a8cca80fa31c9acce54c59f332c920f566556b30e7ac6b14b4d1009` | `483fb9c7be06ff45de0120f60f5b5ebfe977c2323236353485f2adca5b6e28d0` |

## V1 to final S1

Exactly six production paths change; 207 production paths remain unchanged.

| Path | Before V1 SHA-256 | Final S1 SHA-256 |
| --- | --- | --- |
| `src/commands/internal.ts` | `28d83d91d5086b39b50494ea1130d34c3b48b22a15dc04c2912ee2503a7536d5` | `ade20c95a7d3dac5250a214d112ab25d710ce7909a4c6605f18ee21781949654` |
| `src/commands/network/body.ts` | `29a8a744b043447eacc09d09ca651f2b0a34bdf08e08ddf3065729dbc486edbf` | `93d8a8463ac7df91c8ef88368f2ee8524a0abd7e7970badf4d1312587a34c880` |
| `src/commands/network/curl.ts` | `bfbdb77e185e4aa206efc768c89f6f02ee2e833d64856a93320e6ea47f494eb3` | `db06650b1b55b994fe5fa83f7489062e91ac83b7d2d9c44bbb7606d57d9df057` |
| `src/commands/streams.ts` | `792bc1af0f2c9d5fbd7b947956873f3dfbb5fd34fcbdadcb15b1ef8fb423c169` | `40de51068674277e636e45d11cdc7cbd39fe3f1036aeda321802d8809a53af93` |
| `src/commands/structured/jq.ts` | `feca27d38a096931faabe5a5449ecc65c39c8b0abbcf69d3ea73a31f729fdbac` | `096897bfa9d875ba524cebd6b3959c551a26fa5e56d3b0d2fb42f9fabdf80da3` |
| `src/contracts/output.ts` | `709af26d3a8cca80fa31c9acce54c59f332c920f566556b30e7ac6b14b4d1009` | `483fb9c7be06ff45de0120f60f5b5ebfe977c2323236353485f2adca5b6e28d0` |

## Captured dirty baseline files

Clean-byte SHA-256s below were freshly computed from the original Git objects;
the retrieval handoff did not supply them. Captured bytes have preserved-data
precedence and remain unchanged throughout all four source stages.

| Path | Clean Git blob (SHA-1) | Fresh clean-byte SHA-256 | Captured B0 SHA-256 |
| --- | --- | --- | --- |
| `src/commands/tree/arguments.ts` | `3e645e4832031fbbacfe39b51ed02e6da07439b9` | `572db370cad20fff449ed6ce43c0a358390a8f9cfb15ea447d4ac7aaec4b8c9a` | `848b3e07aafefc67de77efccaa446904d9a1920cb158e094217c18e24a6a2762` |
| `src/commands/tree/io.ts` | `d1f63b698918062e2c3b05167289f2cbf96e6811` | `ab76f076d122d27d6bfb04d623551c88f28fdd3f9408c06ae2dc3769462ba153` | `163f2412e5fcca1dc0cd0ac7264beb29b8180efdd65c34fdff08f84a670471e1` |
| `src/commands/tree/tree.ts` | `7450265c5d929eb8540a675b78ece31da787f277` | `449536d5ef259a44308d253c1f5af4bf7af7bed128deff688f9fb8df8bb4c44a` | `2ebcf54d9804e7000bf3de4780d598b8b6bc157ee411c134dea5c62717738ef1` |

## Fixture and config identities

Each fixture is an addition (`ABSENT` before), never a production overlay.

| Added fixture destination | After SHA-256 |
| --- | --- |
| `tests/shell/owned-output-author.test.ts` | `04914584fc2195f3a99006ab6fb7c18fd57d87ae6f8ba6dd4a847aa2ef1f8ce1` |
| `tests/shell/adapted-first-read-probe.ts` | `743f93c910422eb4ad64ac77caacb9aacf71837f28b92a51a1993e8651c6b771` |
| `tests/shell/adapted-remote-close.test.ts` | `913548f801bad996dc1d95767380bf48075129d3eeaaff096f13a99983b95cae` |
| `tests/shell/owned-output-streaming-author.test.ts` | `46291ac212a145924e477cb1d2767ec776b4ec9b53ae036c184699c7d220e03b` |

| Config path | Bytes | Unchanged B0/final SHA-256 |
| --- | ---: | --- |
| `package-lock.json` | 16734 | `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b` |
| `package.json` | 3526 | `2d98aad926c0a877ed4c3e5ac088cb498526e4769d30f9ab092cfd2bbeb7f9c7` |
| `tsconfig.build.json` | 260 | `b57d3e5aab1f1f7ab7a70f275183ea6de255e65a2c40a0047c08d97769a1a16e` |
| `tsconfig.json` | 608 | `f473dbe2230f833bbd374f6d211e843da377973fa96ad0eb38b6b5740dd18027` |

Final 15-fixture manifest: `dd1814102e91c030d9cb1723bbaf69c3bf467ecd404e89dcb07cc315e5f5e35c`.
Final 708-compiled-file manifest: `2578b6ea39cfdeb5b942b9aff20ec9bfff1fcf907cd2af751d8e73f5c24e632f`.
Final sorted 940-file manifest: `a2632992e84344c1a6a92fcee181a1e6d535d6cb87ef1a9a7841e48af9c02e28`.

## Original preparer failures, preserved

These originals are immutable and were not repaired or relabeled as security findings.

| Original artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `tests/integration/safejs-owned-output-prototype-review/provenance/preparation-first-failure.json` | 31400 | `3bf5bd92097590953dc2c42308dd0d89d68163939d012135f25e4c306c578679` |
| `tests/integration/safejs-owned-output-prototype-review/provenance/preparation-subsequent-failure.json` | 32389 | `f76f3947079dd0c552f4103c5613515a186d542c73d45b9ba6c3464e51b68de0` |
| `tests/integration/safejs-owned-output-prototype-review/provenance/prepare-r0.mjs.data` | 10619 | `c537beb5dba18a98aea6a8e544ad6dc207ec05e7ccefba3f2ca87c435ca23744` |
| `tests/integration/safejs-owned-output-prototype-review/provenance/prepare-r1.mjs.data` | 11941 | `f23064cd38bf9022a2a6d4900175489a1a7b24f665b3a96b8e7f132b184d67a9` |
