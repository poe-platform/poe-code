---
title: BigInt JSON hooks
---

Native comparisons reproduced seven failures: JSON.stringify skipped toJSON on
BigInt primitives. Follow ECMAScript SerializeJSONProperty: look up the hook with
the BigInt receiver, call it before the replacer, and apply ordinary JSON handling
to the result. Cover root/nested/array values, getters, receivers, hook errors,
undefined results, non-callable hooks, and boxed overrides.

Reference: https://tc39.es/ecma262/multipage/structured-data.html#sec-serializejsonproperty

Preserve converted JSON through checkpoint transport. A separate validated gap
remains: leaving `BigInt.prototype.toJSON = function(key) { return key + ':' + this; }`
installed across `await 0` makes dump reject with "Guest function properties and
prototype links cannot be serialized." This is intrinsic-prototype mutation
portability, not fixed by the JSON dispatch change. Continue that audit across
all builtin prototypes; do not claim hook mutation snapshots are supported.

Run relevant package tests, lint, types, selected build, and skill-guided CLI
validation with screenshot inspection. Commit/push this atomic fix directly to
main; monitor publication independently of the next validated issue.
