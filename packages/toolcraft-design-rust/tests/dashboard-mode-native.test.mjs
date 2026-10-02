import assert from "node:assert/strict";
import {test} from "node:test";
import * as original from "../../toolcraft-design/dist/index.js";

test("dashboard eligibility exports preserve strict enablement and output-format scopes", async () => {
  const native = await import("toolcraft-design-rust");
  const direct = await import("toolcraft-design-rust/should-use-interactive-dashboard");
  const internal = await import("toolcraft-design-rust/dashboard/should-use-dashboard");
  assert.equal(native.shouldUseInteractiveDashboard,direct.shouldUseInteractiveDashboard);
  assert.equal(native.shouldUseInteractiveDashboard,internal.shouldUseInteractiveDashboard);
  assert.equal(native.dashboard.shouldUseInteractiveDashboard,native.shouldUseInteractiveDashboard);
  assert.equal(native.shouldUseInteractiveDashboard.name,original.shouldUseInteractiveDashboard.name);
  assert.equal(native.shouldUseInteractiveDashboard.length,original.shouldUseInteractiveDashboard.length);
  for(const format of ["terminal","markdown","json"]) for(const enabled of [undefined,false,true,0,1,"true",{},null]) for(const input of [true,false,undefined,0,1,"yes"]) for(const output of [true,false,undefined,0,1,"yes"]) {
    const io={stdin:{isTTY:input},stdout:{isTTY:output}};
    const reference=original.withOutputFormat(format,()=>original.shouldUseInteractiveDashboard(enabled,io));
    assert.equal(native.withOutputFormat(format,()=>native.shouldUseInteractiveDashboard(enabled,io)),reference);
  }
  assert.equal(native.withOutputFormat("terminal",()=>native.shouldUseInteractiveDashboard(true)),original.withOutputFormat("terminal",()=>original.shouldUseInteractiveDashboard(true)));
});

test("dashboard eligibility short circuits getters and preserves arbitrary thrown values", async () => {
  const native=await import("toolcraft-design-rust");
  function observe(api) {
    const trace=[];
    const io={get stdin(){trace.push("stdin");return {get isTTY(){trace.push("input tty");return true;}};},get stdout(){trace.push("stdout");return {get isTTY(){trace.push("output tty");return false;}};}};
    const values=[api.withOutputFormat("terminal",()=>api.shouldUseInteractiveDashboard(false,io)),api.withOutputFormat("json",()=>api.shouldUseInteractiveDashboard(true,io)),api.withOutputFormat("terminal",()=>api.shouldUseInteractiveDashboard(true,io))];
    const failure={};assert.throws(()=>api.withOutputFormat("terminal",()=>api.shouldUseInteractiveDashboard(true,{get stdin(){throw failure;}})),error=>error===failure);
    assert.equal(api.withOutputFormat("terminal",()=>api.shouldUseInteractiveDashboard(true,{stdin:{isTTY:false},get stdout(){throw failure;}})),false);
    return [values,trace];
  }
  assert.deepEqual(observe(native),observe(original));
});
