import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/index.js";
const load=()=>import("../dist/index.js");

test("standalone template engine preserves rendering, partials and UTF-16 diagnostics",async()=>{
  const native=await load();
  for(const [source,view,options] of [
    ["Hello {{name}}",{name:"<world>"},{}],
    ["{{#items}}{{name}} {{/items}}{{^items}}empty{{/items}}",{items:[{name:"one"},{name:"two"}]},{}],
    ["{{> header}}\n{{yield}}",{name:"demo"},{partials:{header:"# {{name}}"},yield:"body"}],
    ["{{name}}",{name:"<raw>"},{escape:"none"}],
    ["{{.}}",{toString(){return "object";}},{}]
  ])assert.equal(native.renderTemplate(source,view,options),reference.renderTemplate(source,view,options));
  assert.deepEqual(native.getTemplatePartialNames("{{> a}}{{> b}}{{> a}}"),reference.getTemplatePartialNames("{{> a}}{{> b}}{{> a}}"));
  assert.equal(native.resolveTemplatePartials("{{> a}}",{a:"Hello"}),"Hello");
  let expected;try{reference.getTemplatePartialNames("😀 {{>");}catch(error){expected=error;}
  assert.throws(()=>native.getTemplatePartialNames("😀 {{>"),error=>error instanceof native.TemplateParseError&&error.message===expected.message&&error.line===expected.line&&error.column===expected.column);
});

test("template host failures preserve partial, coercion, lambda and iterator cleanup behavior",async()=>{
  const native=await load();
  for(const thrown of [null,undefined,42,"failure",{toString(){throw new Error("must not stringify the failure");}}]){
    const cases=[
      api=>api.resolveTemplatePartials("{{> item}}",{get item(){throw thrown;}}),
      api=>api.renderTemplate("{{> item}}",{},{partials:{get item(){throw thrown;}}}),
      api=>api.renderTemplate("{{name}}",{name:{toString(){throw thrown;}}}),
      api=>api.renderTemplate("{{#lambda}}body{{/lambda}}",{lambda(){return ()=>{throw thrown;};}})
    ];
    for(const run of cases)for(const api of [reference,native]){
      let caught=false;
      try{run(api);}catch(error){caught=true;assert.equal(error,thrown);}
      assert.equal(caught,true);
    }
    for(const api of [reference,native]){
      const events=[],items=[1];
      items[Symbol.iterator]=()=>({next(){events.push("next");return {done:false,value:{get name(){events.push("get");throw thrown;}}};},return(){events.push("close");throw "cleanup";}});
      let caught=false;
      try{api.renderTemplate("{{#items}}{{name}}{{/items}}",{items});}catch(error){caught=true;assert.equal(error,thrown);}
      assert.equal(caught,true);assert.deepEqual(events,["next","get","close"]);
    }
  }
});

test("standalone template engine retains getter, lambda and iterator behavior",async()=>{
  const native=await load();
  function run(render){
    const trace=[];
    const view={get name(){trace.push("name");return "Name";},lambda(){trace.push(this===view);return (text,expand)=>expand(text).toUpperCase();}};
    return [render("{{name}} {{#lambda}}{{name}}{{/lambda}}",view),trace];
  }
  assert.deepEqual(run(native.renderTemplate),run(reference.renderTemplate));
  for(const thrown of [{},null,undefined,17,"failure"]){
    let caught=false;
    try{native.renderTemplate("{{name}}",{get name(){throw thrown;}});}catch(error){caught=true;assert.equal(error,thrown);}
    assert.equal(caught,true);
  }
});
