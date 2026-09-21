import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultStateMachine,
  assertTransition,
  findEvent,
  eventsFromState,
  validateMachine
} from "../dist/index.js";
import { validateTaskId, isTrimmedPrintableIdentifier } from "../dist/backends/utils.js";
test("native UTF16 identities and wildcard semantics", () => {
  for (const value of ["issue:2", "\ud800", "\udfff", "💡"])
    assert.equal(validateTaskId(value), value);
  for (const value of ["", "../x", "a/b", "a\\b", " a", "a\ufeff", "a\u007f"])
    assert.throws(() => validateTaskId(value));
  assert.equal(isTrimmedPrintableIdentifier("\u0085"), true);
  assert.deepEqual(eventsFromState(defaultStateMachine, "draft"), ["plan", "archive"]);
  assert.equal(findEvent(defaultStateMachine, "archived", "archive"), undefined);
  assert.doesNotThrow(() => assertTransition("done", "in-progress"));
});
test("callbacks remain references and validation does not invoke them", () => {
  const guard = () => {
    throw Error("must not invoke");
  };
  const event = { from: ["\ud800"], to: "done", guard };
  const machine = { initial: "\ud800", states: ["\ud800", "done"], events: { go: event } };
  validateMachine(machine);
  assert.equal(findEvent(machine, "\ud800", "go"), event);
  assert.throws(() => assertTransition(machine, "done", "\ud800"));
  assert.ok(Object.isFrozen(defaultStateMachine.events.archive));
});
test('wildcard getters are read once and custom source methods remain effectful', () => {
  let reads=0;
  const wildcard={from:'*',get to(){reads++;return 'done';}};
  const machine={initial:'draft',states:['draft','done'],events:{finish:wildcard}};
  assert.equal(findEvent(machine,'draft','finish'),wildcard);
  assert.equal(reads,1);
  const source=[];let calls=0;
  source.includes=function(state){calls++;assert.equal(this,source);return state==='draft';};
  const custom={...machine,events:{go:{from:source,to:'done'}}};
  assert.deepEqual(eventsFromState(custom,'draft'),['go']);assert.equal(calls,1);
});
