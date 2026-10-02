import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "toolcraft/file-changes";

test("public file-change renderers preserve output, lazy options, descriptors and JSON identity", async () => {
  const native = await import("toolcraft-rust/file-changes");
  assert.deepEqual(Object.keys(native), Object.keys(reference));
  function run(api) {
    const trace=[], writes=[];
    const write=process.stdout.write;
    let mode="status";
    const options={get mode(){trace.push(`mode:${mode}`);return mode;}};
    const result={get changes(){trace.push("changes");return [{kind:"modified",path:"file",oldContent:"old\n",newContent:"new\n"}];}};
    const renderers=api.createFileChangeRenderers(options);
    assert.deepEqual(trace,[]);
    assert.equal(renderers.json(result),result);
    assert.deepEqual(trace,[]);
    const rich=renderers.rich, markdown=renderers.markdown;
    const descriptors=Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(renderers)).map(([key,value])=>[key,{...value,value:typeof value.value}]));
    process.stdout.write=function(value){assert.equal(this,process.stdout);writes.push(value);return false;};
    try {
      const richResult=rich(result);
      mode="diff";
      const markdownResult=markdown(result);
      return {richResult,markdownResult,trace,writes,descriptors};
    } finally {process.stdout.write=write;}
  }
  assert.deepEqual(run(native),run(reference));
  const rejected={failed:true};
  assert.throws(()=>native.createFileChangeRenderers({get mode(){throw rejected;}}).rich({changes:[]}),error=>error===rejected);
});
