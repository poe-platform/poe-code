import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { run } from "../../run.js";

it.each([
  "return (function f(){f=1;return typeof f})()",
  "return (function f(){[f]=[1];return typeof f})()",
  "return (function f(){({x:f}={x:1});return typeof f})()",
  "return (function f(){f++;return typeof f})()",
  "return (function f(){f+=1;return typeof f})()",
  "return (function f(){for(f of [1]){}return typeof f})()",
  "return (function f(){return [f=1,typeof f]})()",
  "return (function f(){'use strict';f=1})()",
  "return (function f(){return (function(){'use strict';f=1})()})()",
  "const f=1;f=2;return f",
  "return (function f(f){f=2;return f})(1)",
  "return (function f(){let f=1;f=2;return f})()"
])("matches named function binding assignment: %s", body => {
  const source = `try{return Function(${JSON.stringify(body)})()}catch(e){return {error:e.name}}`;
  return expect(run(source)).resolves.toMatchObject({
    ok: true, returnValue: runInNewContext(`(function(){${source}})()`)
  });
});
