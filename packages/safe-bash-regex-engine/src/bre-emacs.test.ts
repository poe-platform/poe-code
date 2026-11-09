import assert from "node:assert/strict";
import { test } from "node:test";
import { reverseEmacsSteps, searchBreSteps } from "./bre-engine.js";
import { exprMatchCeilings, type BreSearchDescriptor } from "./execution/protocol.js";

test("Emacs bracket syntax stays separate from POSIX classes in the search cache", () => {
  const descriptor: BreSearchDescriptor = {
    kind: "bre-search", pattern: new TextEncoder().encode("[[:alpha:]]"),
    profile: "byte", limits: exprMatchCeilings,
  };
  const subject = new TextEncoder().encode("ab");
  for (let repeat = 0; repeat < 2; repeat++) {
    const search = searchBreSteps(descriptor, subject);
    let result = search.next();
    while (!result.done) result = search.next();
    assert.deepEqual(result.value.overall, { start: 0, end: 1 });
    assert.deepEqual([...reverseEmacsSteps(descriptor, subject)].filter(Boolean), []);
    assert.deepEqual([...reverseEmacsSteps(descriptor, new TextEncoder().encode("a]X"))].filter(Boolean), [{ start: 0, end: 2 }]);
  }
});
