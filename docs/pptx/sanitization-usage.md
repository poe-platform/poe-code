# Selected removal

`pptx sanitize` takes an explicit removal policy. A single category can be given
as a plain value; multiple categories use one quoted JSON array.

```sh
pptx sanitize deck.pptx --remove properties --dry-run --json
pptx sanitize deck.pptx --remove '["notes","comments","links"]' --output reviewed.pptx --json
```

Categories are `notes`, `comments`, `properties`, `links` and `objects`. The policy
applies to the presentation package. It does not mean remove every hidden item.
Unknown content and resources still referenced by retained content remain in the
package. The detailed removed/retained report is part of the result; inspect it
before describing the output to others. Sanitization does not certify a clean
file, validate signatures, execute actions, open embeddings or fetch URLs.

The byte SDK accepts the same category array and an explicit context:

```ts
import { sanitize } from "pptx";

const result = await sanitize(
  suppliedBytes,
  { remove: ["notes", "comments"] },
  context
);
// result.bytes is the edited package; publication belongs to the caller.
// result.removed and result.retained describe the bounded operation.
```

The context supplies byte, archive, XML and relationship limits. Input is supplied
bytes, a byte source or a path with an explicit filesystem capability. A bare host
path is not an input capability. No ambient time, identity or network is used.

An empty policy, duplicate categories or unknown categories is invalid. No matching
content is an error unless `--allow-empty` (SDK `allowEmpty: true`) is explicit.
Package output requires `--output` or `--in-place`, except for `--dry-run`.
Signed, protected or macro-bearing packages remain subject to mutation rejection.
