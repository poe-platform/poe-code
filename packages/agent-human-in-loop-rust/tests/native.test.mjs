import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../agent-human-in-loop/dist/index.js";
import * as nativeScript from "../dist/osascript-script.js";
import * as referenceScript from "../../agent-human-in-loop/dist/providers/osascript-script.js";

test("approval providers expose the exact runtime export inventory", () => {
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
});

test("approval script text and response parsing preserve UTF-16 and line endings", () => {
  for (const message of ["", "Hello", 'Quote " and \\ slash', "\ud800\n😀\r"]) {
    assert.equal(nativeScript.escapeAppleScriptString(message), referenceScript.escapeAppleScriptString(message));
    for (const declineInputPrompt of [undefined, "", "Why?\udfff\n"]) {
      const request = { message, declineInputPrompt };
      assert.equal(nativeScript.buildScript(request, message), referenceScript.buildScript(request, message));
    }
  }
  for (const output of ["Approve", "APPROVED", "Decline", "DECLINED:", "DECLINED:reason:with\nnewlines", "DECLINED:\ud800", "other"]) {
    for (const newline of ["", "\n", "\r", "\r\n", "\n\n"]) {
      const value = output + newline;
      let expected;
      try { expected = referenceScript.parseStdout(value); }
      catch (error) { assert.throws(() => nativeScript.parseStdout(value), { name: error.name, message: error.message }); continue; }
      assert.deepEqual(nativeScript.parseStdout(value), expected);
    }
  }
});

test("approval normalization preserves own fields, getters, receiver and microtask order", async () => {
  async function run(api, answer) {
    const trace = [];
    const provider = { requestApproval(request) {
      assert.equal(this, provider); trace.push(["request", request]); return answer;
    } };
    const args = new Proxy({ message: "  keep whitespace  ", declineInputPrompt: "", extra: 9, provider }, {
      get(target, key, receiver) { trace.push(String(key)); return Reflect.get(target, key, receiver); }
    });
    const pending = api.requestApproval(args).then(value => { trace.push("resolved"); return value; }, error => {
      trace.push("rejected"); return { error: error?.message };
    });
    for (let i = 0; i < 6; i++) { trace.push(`tick:${i}`); await Promise.resolve(); }
    return { result: await pending, trace };
  }
  for (const answer of [null, undefined, [], { outcome: "approved", extra: 1 }, { outcome: "declined" },
    { outcome: "declined", reason: "" }, { outcome: "declined", reason: null }, Object.create({ outcome: "approved" })])
    assert.deepEqual(await run(native, answer), await run(reference, answer));
});

test("invalid requests fail before calling providers and arbitrary exceptions retain identity", async () => {
  for (const api of [native, reference]) {
    const provider = { requestApproval() { assert.fail("provider must not run"); } };
    for (const message of ["", "\u00a0", "\ufeff\t", null, 1])
      await assert.rejects(api.requestApproval({ provider, message }), { message: "Approval request message must not be blank" });
    for (const declineInputPrompt of [null, 1, {}])
      await assert.rejects(api.requestApproval({ provider, message: "ok", declineInputPrompt }), { message: "Approval request declineInputPrompt must be a string" });
    for (const failure of [null, undefined, 0, Symbol("failure"), { failure: true }]) {
      await assert.rejects(api.requestApproval({ message: "ok", provider: { requestApproval() { throw failure; } } }), error => error === failure);
      await assert.rejects(api.requestApproval({ message: "ok", provider: { requestApproval() { return { get outcome() { throw failure; } }; } } }), error => error === failure);
    }
  }
});

test("mock providers preserve result copies, changing getters and thunk settlement", async () => {
  async function run(api, callable) {
    const trace = [];
    const answer = { get outcome() { trace.push("outcome"); return "declined"; },
      get reason() { trace.push("reason"); return trace.length; } };
    const provider = api.mockProvider(callable ? function () { assert.equal(this, undefined); trace.push("call"); return answer; } : answer);
    const pending = provider.requestApproval({ message: "ok" }).then(value => { trace.push("done"); return value; });
    for (let i = 0; i < 6; i++) { trace.push(`tick:${i}`); await Promise.resolve(); }
    return { result: await pending, trace };
  }
  for (const callable of [false, true]) assert.deepEqual(await run(native, callable), await run(reference, callable));
});

test("script construction keeps custom replacement methods and getter order", () => {
  function run(api) {
    const trace = [];
    const value = { replace(pattern, replacement) {
      trace.push([String(pattern), replacement]); return { replace(pattern, replacement) { trace.push([String(pattern), replacement]); return "escaped"; } };
    } };
    const request = { get message() { trace.push("message"); return value; }, get declineInputPrompt() { trace.push("prompt"); return value; } };
    return { value: api.buildScript(request, value), trace };
  }
  assert.deepEqual(run(nativeScript), run(referenceScript));
});
