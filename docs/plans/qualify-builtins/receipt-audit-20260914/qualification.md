# Built-in receipt audit and arguments interaction disposition

Overall qualify-builtins acceptance remains open. This evidence-only increment verifies prior evidence against the actual working source and narrows QB-ARGUMENTS-ITERATOR with current corpus and cross-feature observations. It does not mark the task complete or claim a runtime repair.

## Exact target and revision

Observed on 2026-09-14 UTC (2026-09-13 America/Chicago), on main at `8cc2701664ae287eff96329a279084cc29dea2a8`, with inherited dirty source preserved. Node 22.23.2, ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64. The maintained source/build closure is `35cf739c3cb76c7a9d5ed555acf00306bdf0bef2b536992dbff50deacba9f04a`. The source SHA identifies HEAD; the closure identifies the tested dirty candidate. Neither means clean-HEAD qualification.

The target remains ECMA-262 edition 16 and ECMA-402 edition 12 (June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and the separately recorded extension pins. Direct retrieval of the official edition-16 document gives SHA-256 `6a28f9423133ed7b7c59a40baf620c2740f12f0bc9c251042f2a85b9cc5ed713`. CreateMappedArgumentsObject and CreateUnmappedArgumentsObject require the arguments iterator property to hold the realm's Array values intrinsic. This is a target requirement, not a proposal API. See [edition 16](https://262.ecma-international.org/16.0/#sec-createunmappedargumentsobject).

## Evidence reuse verified

All 86 artifact hashes in the preceding `remaining-categories-20260913/receipt.json` match. All 10,105 source/build file hashes in its `final-candidate-source.json` match the current workspace. All 255 linked focused artifact hashes also match. These are exact hash comparisons, not assumptions based on task status. The preceding maintained gate therefore remains reusable for that candidate: 30,065 tests passed, 47 skipped, zero failed; 1,398 files passed and two skipped. Its scoped lint and maintained workspace build, including eight built-import tests, passed. No complete suite was repeated without a source change.

Independently re-reading the 216 terminal V4 reports verifies their SHA-256, terminal completeness, source/runtime/execution identities, variant modes and counts. All 53,876 pinned fixture hashes and 44 harness hashes match. Recomputing each of the 108 built-in, intl402 and Annex B built-in category rows reproduces its recorded counts. Historical aggregate remains 93,220 passed / 6,388 failed / 3,318 unsupported at `a4476e3fabf1bf5f3c492aa76f38ff0bf3d05e46`. Parent rows overlap; do not sum them. This reuses actual corpus evidence, not property inventories. It does not transfer historical passes to changed source.

The current category-to-evidence map and individually indexed 6,777 historical nonpasses retain their earlier owners, edition qualifications and explicit missing controls. Object/Reflect/Proxy and descriptors/prototypes, arrays/binary memory, collections, primitive wrappers, errors, Math/Date/JSON, Promise jobs, iterators/disposables, RegExp and Intl retain their named focused owners. No owner-specific complete corpus is rerun or assumed passing. Newer APIs remain separately tracked; deliberate host-capability exclusions remain authority boundaries.

## Current original corpus

Executed from repository root, with the maintained runner and unchanged default 3,000 ms per-variant deadline:

```sh
node --import tsx packages/safe-js/test/conformance/command.ts \
  --corpus /tmp/safejs-regexp-test262-419d3e0 \
  --include built-ins/ArrayIteratorPrototype/next/Uint8ClampedArray.js \
  --include built-ins/ArrayIteratorPrototype/next/args-mapped-expansion-after-exhaustion.js \
  --report docs/plans/qualify-builtins/receipt-audit-20260914/arguments-corpus.jsonl
```

Exit 1; terminal report complete: two files, three variants, two passed, one failed, zero unsupported, zero metadata/execution errors. The typed-array control passes strict and sloppy modes. The mapped-arguments exhaustion fixture fails with runtime TypeError, “Attempted to call a non-function value.” The report records the exact current HEAD and the unchanged closure above. This targeted rerun investigates an unresolved concern; it is not a full Array iterator suite.

## New interactions and negative controls

Eight source-SDK observations give two passing controls and six mismatches. The results below are directly recorded, with native values obtained in isolated `node:vm` contexts. Native runs use a sloppy wrapper for the mapped case and strict wrappers otherwise. Values are JSON-domain data; comparison normalizes the native realm's prototypes before deep equality.

| Case                                                   | Expected               | Guest outcome                      |
| ------------------------------------------------------ | ---------------------- | ---------------------------------- |
| Direct strict iterator                                 | 7                      | TypeError                          |
| Direct mapped iterator after parameter update          | 9                      | TypeError                          |
| Frozen iterator identity                               | true                   | false                              |
| Getter ordering                                        | 7; length then index   | TypeError; neither getter runs     |
| Borrowed getter control                                | 7; length then index   | Pass                               |
| Proxy ordering                                         | 7; iterator, length, 0 | TypeError after iterator trap only |
| Borrowed Proxy control                                 | 7; length, 0           | Pass                               |
| Identity after replacing public Array.prototype.values | true                   | false                              |

Reproduce with `node --import tsx --input-type=module`, importing `run` from `./packages/safe-js/src/run.ts`, and evaluate the following function bodies one at a time with `await run(source)`. Inspect `returnValue`, or capture the thrown name and message. Use `runInNewContext('(function(){'+strictDirective+source+'})()')` for native controls. Each call creates a separate realm; no host intrinsic is passed into guest execution.

### direct-strict

```js
function f() {
  return arguments[Symbol.iterator]().next().value;
}
return f(7);
```

### direct-mapped

```js
return eval("(function(a){a=9;return arguments[Symbol.iterator]().next().value})(7)");
```

### frozen-identity

```js
function f() {
  Object.freeze(arguments);
  return arguments[Symbol.iterator] === Array.prototype.values;
}
return f(7);
```

### getter-order

```js
function f() {
  const log = [];
  Object.defineProperty(arguments, 0, {
    get() {
      log.push("index");
      return 7;
    }
  });
  Object.defineProperty(arguments, "length", {
    get() {
      log.push("length");
      return 1;
    }
  });
  let value;
  try {
    value = arguments[Symbol.iterator]().next().value;
  } catch (e) {
    value = e.name;
  }
  return [value, log];
}
return f(0);
```

### borrowed-getter-control

```js
function f() {
  const log = [];
  Object.defineProperty(arguments, 0, {
    get() {
      log.push("index");
      return 7;
    }
  });
  Object.defineProperty(arguments, "length", {
    get() {
      log.push("length");
      return 1;
    }
  });
  return [Array.prototype.values.call(arguments).next().value, log];
}
return f(0);
```

### proxy-order

```js
function f() {
  const log = [];
  const p = new Proxy(arguments, {
    get(t, k, r) {
      log.push(typeof k === "symbol" ? "iterator" : k);
      return Reflect.get(t, k, r);
    }
  });
  let value;
  try {
    value = p[Symbol.iterator]().next().value;
  } catch (e) {
    value = e.name;
  }
  return [value, log];
}
return f(7);
```

### proxy-borrow-control

```js
function f() {
  const log = [];
  const p = new Proxy(arguments, {
    get(t, k, r) {
      log.push(k);
      return Reflect.get(t, k, r);
    }
  });
  return [Array.prototype.values.call(p).next().value, log];
}
return f(7);
```

### intrinsic-replacement-control

```js
function f() {
  const values = Array.prototype.values;
  Array.prototype.values = function () {
    return 99;
  };
  return arguments[Symbol.iterator] === values;
}
return f(7);
```

The initial local observation attempt incorrectly used a strict native wrapper for the mapped eval and prototype-sensitive cross-realm deep equality. It reported the mapped native value as 7 and marked the two matching array controls false. The qualified observations correct those tooling errors; the initial attempt is retained locally and is not semantic evidence. A first standard-extraction attempt failed because Python bs4 was unavailable; the successful extraction used the standard-library HTML parser. Neither tooling failure is counted as a product failure or pass.

## Disposition and repair boundary

QB-ARGUMENTS-ITERATOR remains a validated current defect. `interp/arguments.ts` installs native Array.prototype.values, while guest invocation expects a sandbox callable. Native marker identity is also used in argument host-copy checks, mapped heap capture, serialized argument validation, replay-data reconstruction and snapshot restoration. A direct callable dispatch exception would not fix descriptor identity; resolving through the mutable public Array.prototype.values property would fail the replacement control. A coordinated realm-intrinsic representation and snapshot/host-copy repair is required. No such repair is claimed by this report, and no host function admission bypass is installed.

The verified prior pending/completed replay failures remain open at the identical source closure; they were not rerun. Native host isolation is preserved by construction of these probes; complete cross-runtime and installed-package qualification remains QB-MATRIX. QB-REVISION, QB-EDITION and QB-REVALIDATE remain open for the category-wide current-source/edition reconciliation. Date precision, Symbol realm attribution, Math/URI/parser deadlines, FinalizationRegistry execution ownership, shared corpus admission, Node18 binary prerequisites and the recorded RegExp backend/deadline/resource blockers retain their earlier dispositions. No deadline, budget, assertion, support requirement or regex work limit changed.

## Manual checks and delivery

This increment changes only this report and an appended ledger section. Manual checks: all receipt/source/focused hashes verified; all historical report accounting/category/fixture/harness checks passed; the current corpus finished with its one explicitly reported semantic failure; the eight interaction observations have two passing controls and six reported failures. Markdown formatting and task-owned staged whitespace checks passed before commit. No code change, new CLI output, build artifact, or test artifact is committed; no code unit or screenshot rerun is warranted for this documentation increment.

The entire inherited ledger prefix and staged Safe Bash changes are preserved. Local observation JSON/JSONL and logs remain uncommitted artifacts. Reproduce the audits by comparing each hash dictionary in the named receipts, recomputing per-category status counts from V4 raw rows, and executing the exact corpus command and source bodies above; do not run the old reconciliation script unmodified, because it also overwrites historical outputs and asserts its original source identity.

Fresh `git ls-remote origin refs/heads/main` returned `dea009de8f6c7ff608f295c6986d56f255570939`. That is a read-only remote observation, not delivery of local HEAD. This increment makes no push or publication claim. Local commit SHA is reported separately after commit; remote-main delivery and release publication remain unverified. Overall acceptance is incomplete.
