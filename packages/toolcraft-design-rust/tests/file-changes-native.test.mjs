import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import { renderFileChanges as reference } from "../../toolcraft-design/dist/components/file-changes.js";

test("native file-change status and unified diffs match every kind and content boundary", async () => {
  const subpath = await import("toolcraft-design-rust/components/file-changes");
  assert.equal(subpath.renderFileChanges, native.renderFileChanges);
  assert.deepEqual(Object.keys(subpath), ["renderFileChanges"]);
  const contents = [undefined, "", "\n", "a", "a\n", "a\r\nb\r\n", "東京\ud800\n", "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n"];
  for (const mode of [undefined, "status", "diff"]) {
    for (const format of [undefined, "terminal", "markdown", "other"]) {
      for (const oldContent of contents) {
        for (const newContent of contents) {
          const changes = ["added", "modified", "deleted", "renamed"].map((kind, index) => ({ kind, path: `file${index}`, oldPath: "old", oldContent, newContent, conflict: index % 2 === 0 }));
          assert.equal(native.renderFileChanges(changes, { mode, format }), reference(changes, { mode, format }));
        }
      }
    }
  }
  assert.equal(native.renderFileChanges([], null), reference([], null));
});

test("file-change getters, array species and changing kind reads retain their order", () => {
  function run(render, mode, format) {
    const trace = [];
    const observe = (object, name) => new Proxy(object, {
      get(target, key, receiver) { trace.push(`${name}.${String(key)}`); return Reflect.get(target, key, receiver); }
    });
    let reads = 0;
    const first = observe({
      get kind() { return ["renamed", "modified", "added", "deleted"][reads++ % 4]; },
      path: "new", oldPath: "old", oldContent: "same\nold\ntail\n", newContent: "same\nnew\ntail\n", conflict: true
    }, "first");
    class Changes extends Array { static get [Symbol.species]() { trace.push("species"); return Array; } }
    const changes = observe(new Changes(first, observe({ kind: "modified", path: "plain", oldContent: "a", newContent: "b" }, "second")), "changes");
    const options = observe({mode,format}, "options");
    return { result: render(changes,options), trace };
  }
  for (const mode of ["status", "diff"])
    for (const format of ["terminal", "markdown"])
      assert.deepEqual(run(native.renderFileChanges, mode, format), run(reference, mode, format));
});

test("unified hunks retain exactly three context lines around late and separated edits", () => {
  const original = Array.from({ length: 20 }, (_, index) => `line${index}`);
  const modified = [...original];
  modified[10] = "changed";
  const change = { kind: "modified", path: "file", oldContent: original.join("\n") + "\n", newContent: modified.join("\n") + "\n" };
  const options = { mode: "diff", format: "markdown" };
  assert.equal(native.renderFileChanges([change], options), [
    "```diff", "--- a/file", "+++ b/file", "@@ -8,7 +8,7 @@",
    " line7", " line8", " line9", "-line10", "+changed", " line11", " line12", " line13", "```"
  ].join("\n"));
  for (const lines of [[...original, "appended"], original.slice(0, -1), [...original.slice(0, 8), ...original.slice(16)], ["first", ...original.slice(1, -1), "last"]]) {
    const changes = [{ ...change, newContent: lines.join("\n") + "\n" }];
    assert.equal(native.renderFileChanges(changes, options), reference(changes, options));
  }
});

test("diff content arrays preserve split, indexed reads, slice methods and coercion", () => {
  function run(render) {
    const trace=[];
    function content(name, values) {
      return { split(separator) {
        assert.equal(this, contents[name]);
        trace.push(`${name}.split:${separator}`);
        return new Proxy(values, { get(target,key,receiver) { trace.push(`${name}.${String(key)}`); return Reflect.get(target,key,receiver); } });
      } };
    }
    const contents={};
    contents.old=content("old",["same","before","last",""]);
    contents.new=content("new",["same","after","last",""]);
    return { result:render([{kind:"modified",path:"file",oldContent:contents.old,newContent:contents.new}],{mode:"diff",format:"markdown"}),trace };
  }
  assert.deepEqual(run(native.renderFileChanges),run(reference));
});

test("file-change callbacks preserve arbitrary failures and nested calls", () => {
  for (const failure of [undefined,null,false,"failed",Symbol("failed"),{failed:true}]) {
    assert.throws(() => native.renderFileChanges([{get kind(){throw failure;}}]), error => Object.is(error,failure));
  }
  function run(render) {
    const nested=[];
    return { result:render([{kind:"renamed",get oldPath(){nested.push(render([]));return "old";},path:"new"}]),nested };
  }
  assert.deepEqual(run(native.renderFileChanges),run(reference));
});
