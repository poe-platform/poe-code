# AWK short-string retention QA

Run this check from the repository root with the normal Node stack. It inspects
the actual scalar returned by the source runtime; it does not write a fixture.

```sh
node --allow-natives-syntax --import tsx --conditions=poe-code-source --input-type=module -e 'import {string} from "./packages/safe-bash/src/commands/text-programs/awk-values.ts"; const parent="q".repeat(1000000)+"abcdefghijklmnop"+"q".repeat(1000000); const value=string(parent.slice(1000000,1000016)); %DebugPrint(value.text);'
```

Verify that the returned text is `abcdefghijklmnop` and its V8 type is
`SEQ_ONE_BYTE_STRING_TYPE`, rather than `SLICED_ONE_BYTE_STRING_TYPE`. The latter
retains the two-million-character parent through the module-level scalar cache.
The maintained AWK scheduling tests also check UTF-16 preservation, including
non-ASCII characters, a surrogate pair, and unpaired surrogates.

This exact check reproduced the sliced-string retention before the repair and
confirmed an independent sequential string after the repair on 27 September 2026.
