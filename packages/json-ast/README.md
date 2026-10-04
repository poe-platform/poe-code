# @poe-code/json-ast

Parse and replay large JSON documents using your filesystem for strings, containers, nesting state, and key indexes. Consume scalar text and serialized output in bounded chunks without building a JavaScript object tree.

```ts
import { BackedJson, parseBackedJson } from "@poe-code/json-ast";
import { PagedStorage } from "@poe-code/safe-fs/storage";

const treeStorage = new PagedStorage(context, 4);
const keyStorage = new PagedStorage(context, 4);
const cooperate = async () => { context.signal.throwIfAborted(); };
const tree = new BackedJson(treeStorage, cooperate);
try {
  await parseBackedJson(textChunks, tree, keyStorage, cooperate,
    (offset, message) => { throw new SyntaxError(`${offset}: ${message}`); });
  for await (const bytes of tree.chunks()) await sink.write(bytes);
} finally {
  await treeStorage.close();
  await keyStorage.close();
}
```

Input fragments contain decoded UTF-16 text. Surrogate pairs may cross fragment boundaries, and lone surrogates are preserved. `property`, `children`, `describe`, and `scalarChunks` inspect stored values; `smallText` admits only a caller-selected number of code units. `value` is a convenience for already-resident JavaScript values.

The caller owns storage, cancellation, cooperative scheduling, limits, and error formatting. Use an external safe-fs backend for large documents: memory-backed files still occupy memory. The parser rejects duplicate keys by default; its optional permissive mode preserves their occurrences on tape. `property` returns the first occurrence. Number tokens keep their original spelling; optional validation and serialization callbacks define numeric policy and object ordering. Close backing only after all readers finish.

`readJsonNumber(fragments, cooperate, exactInteger)` converts syntax-validated numeric tokens with bounded decimal state. It rejects rounded integers and nonfinite results by default. Pass `false` to use native binary64 rounding, including infinity, without collecting the token.
