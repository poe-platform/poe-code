# Integration gate after JSON, Date and Iterator repairs

## Candidate

Local runtime at `9ebc60d21` includes JSON reviver guest-object operations,
removed Date JSON hooks, BigInt/Symbol Date JSON receiver boxing, and Iterator
prototype setter receiver operations. Existing dirty/untracked tests remain
preserved and participate in the checkout-level gate; this is not a clean-tree
qualification. Runtime sources will remain unchanged during the full run.

## Build

`npm run build:workspaces -- --workspace=@poe-code/safe-js` passed on the default
Node 22.23.2 runtime (aaf59b): 23 workspace builds and all five fresh-process
SafeJS ESM import checks passed. Dependency/task membership came from the
maintained workspace runner.

## Full tests

Started the maintained command in session `94973` (a00e3e):

```sh
npm test --workspace=@poe-code/safe-js -- --reporter=json --outputFile=/tmp/safejs-post-json-iterator-gate.xKWLzs/results.json
```

The run finished with 27,690 passed, 14 failed and 47 skipped. The JSON report
was inspected after the worker process terminated. Twelve failures concern
ISO month names and Temporal locale formatting; two concern native Promise
own-property admission. These remain unresolved, not waived.

The updated test262-semantics file contributed nine passing tests. The later
array-proxy-index-keys and string-search-coercion files were absent from this
run's discovery, so this result does not qualify either pending repair.

## Read-only reflection qualification

A bounded native-comparison probe passed 63 cases without changes (c2f81a).
It applies Object keys, values, entries, getOwnPropertyNames,
getOwnPropertySymbols, getOwnPropertyDescriptors, isExtensible, isSealed and
isFrozen to undefined, null, boolean, number, BigInt, string and Symbol inputs.
Each native control uses a fresh VM context. Results are JSON-normalized and
exceptions compared by name. This checks basic primitive reflection behavior,
not accessor/proxy ordering, cross-realm behavior or exhaustive conformance.

No push, issue closure or release was performed. The release hold remains active.
