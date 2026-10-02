import assert from "node:assert/strict";
import { test } from "node:test";
import * as native from "../dist/index.js";
import * as reference from "../../toolcraft-design/dist/components/help-formatter.js";
import * as plain from "../../toolcraft-design/dist/components/help-formatter-plain.js";
import { withOutputFormat as referenceFormat } from "../../toolcraft-design/dist/internal/output-format.js";
import { text as referenceText } from "../../toolcraft-design/dist/components/text.js";

test("native help columns preserve Unicode, ANSI, hanging indents and fractional layouts", () => {
  assert.equal(typeof native.formatColumns, "function");
  const labels = ["", "run", "  nested --value <x>", "long-unbroken-command", "界", "e\u0301", "👩‍💻", "🇵🇱", "\ud800", "a\r\nb", "\x1b[31mred\x1b[0m", "\x1b]8;;https://example.test\x07link\x1b]8;;\x1b\\", "\x1b[", "\x1b]unfinished", "\x1bx"];
  for (const left of labels) for (const right of ["", "one two three four", "  wide 界 café longunbrokenvalue", "\t\r\n", "\ud800", "\x1b[2mabc\x1b[0m"]) {
    for (const totalWidth of [0, 1, 12, 30, 30.5]) {
      const options = { rows: [{left,right},{left:"other",right:"description"}], totalWidth, minLeftWidth:1, maxLeftWidth:12, gap:2.5, indent:1.5 };
      assert.equal(native.formatColumns(options), reference.formatColumns(options), JSON.stringify(options));
      assert.equal(native.helpFormatterPlain.formatColumns(options), plain.formatColumns(options), JSON.stringify(options));
    }
  }
});

test("help root, component subpaths, tokens, lists and usage retain output-format behavior", async () => {
  const help = await import("toolcraft-design-rust/components/help-formatter");
  const simple = await import("toolcraft-design-rust/components/help-formatter-plain");
  assert.equal(help.helpFormatter, native.helpFormatter);
  assert.deepEqual(Object.keys(help).sort(),Object.keys(reference).sort());
  assert.deepEqual(Object.keys(simple).sort(),Object.keys(plain).sort());
  assert.equal(simple.formatColumns, native.helpFormatterPlain.formatColumns);
  const tokens = ["command","argument","option","literal","dim","unknown"].map(role=>({role,text:role === "argument" ? "<x>" : role}));
  const commands = [{name:"run",description:"Run a task",depth:1},{name:"other",nameTokens:tokens,description:"Tokens"}];
  const options = [{flags:"--yes",description:"Accept defaults"},{flags:"--foo",flagTokens:tokens,description:"Tokens"}];
  for(const format of ["terminal","markdown","json"]) {
    const compare = (name,args) => assert.deepEqual(native.withOutputFormat(format,()=>native[name](...args)),referenceFormat(format,()=>reference[name](...args)),`${format}/${name}`);
    compare("formatCommandList",[commands]); compare("formatOptionList",[options]);
    compare("joinHelpTokens",[tokens]); compare("renderHelpTokens",[tokens]);
    for(const token of tokens) compare("styleHelpToken",[token]);
    for(const args of [undefined,"","<file>","a\nb"]) compare("formatUsage",["tool",args]);
    compare("formatCommand",["run","Run"]); compare("formatOption",["--yes","Accept"]);
  }
  assert.equal(simple.formatCommandList(commands),plain.formatCommandList(commands));
  assert.equal(simple.formatOptionList(options),plain.formatOptionList(options));
  for(const value of ["\x1b[31mred\x1b[0m","a\x1bx", "\x1b]title\x07", "\ud800🌍"]) assert.equal(simple.stripAnsi(value),plain.stripAnsi(value));
});

test("plain command depth is coerced before the name is read", () => {
  function run(format) {
    const trace=[],repeat=String.prototype.repeat;
    let first=true;
    String.prototype.repeat=function(count) {
      if(first) {first=false;return {toString(){trace.push("prefix");return "  ";}};}
      return repeat.call(this,count);
    };
    try {return [format([{depth:1,get name(){trace.push("name");return "run";},description:"Run"}]),trace];}
    finally {String.prototype.repeat=repeat;}
  }
  assert.deepEqual(run(native.helpFormatterPlain.formatCommandList),run(plain.formatCommandList));
});

test("help styling keeps method receivers, nested calls and thrown identities", () => {
  function run(api,text) {
    const trace=[],descriptor=Object.getOwnPropertyDescriptor(text,"command");
    Object.defineProperty(text,"command",{configurable:true,get(){trace.push("method");return function(value){trace.push(this===text ? "receiver" : "lost receiver");return api.formatColumns({rows:[{left:value,right:""}],indent:0});};}});
    try {return [api.styleHelpToken({role:"command",get text(){trace.push("content");return "run";}}),trace];}
    finally {Object.defineProperty(text,"command",descriptor);}
  }
  assert.deepEqual(run(native,native.text),run(reference,referenceText));
  const token={};
  const saved=native.text.argument;
  native.text.argument=()=>{throw token;};
  try {assert.throws(()=>native.styleHelpToken({role:"argument",text:"<arg>"}),error=>error===token);}
  finally {native.text.argument=saved;}
});

test("help preserves option validation order, sparse arrays, getters and arbitrary throws", () => {
  for(const name of ["totalWidth","minLeftWidth","maxLeftWidth","gap","indent"]) for(const value of [NaN,Infinity,-1,"10",null]) {
    const opts = {rows:[{left:"a",right:"b"}],[name]:value};
    const outcome = fn => {try{return fn(opts);}catch(error){return [error.constructor.name,error.message];}};
    assert.deepEqual(outcome(native.formatColumns),outcome(reference.formatColumns));
  }
  function run(formatColumns) {
    const trace=[];
    class Rows extends Array { static get [Symbol.species]() { trace.push("species"); return Array; } }
    const row=new Proxy({left:"run",right:"Description"},{get(target,key){trace.push(`row.${String(key)}`);return target[key];}});
    const rows=new Rows(2); rows[1]=row;
    const opts=new Proxy({rows,totalWidth:20},{get(target,key){trace.push(`opts.${String(key)}`);return target[key];}});
    return [formatColumns(opts),trace];
  }
  assert.deepEqual(run(native.formatColumns),run(reference.formatColumns));
  const thrown={identity:true};
  for(const fn of [native.formatColumns,native.helpFormatterPlain.formatColumns]) assert.throws(()=>fn({rows:[{get left(){throw thrown;}}]}),error=>error===thrown);
  assert.equal(native.formatColumns({rows:[],get totalWidth(){throw thrown;}}),"");
});
