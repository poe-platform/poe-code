import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

const constructors = {
  normal: "Function", generator: "(function*(){}).constructor",
  async: "(async function(){}).constructor", "async-generator": "(async function*(){}).constructor"
} as const;

for (const kind of ["normal", "generator", "async", "async-generator"] as const) {
  it.each([
    "import value from 'module'",
    "import {value} from 'module'",
    "import * as values from 'module'",
    "import 'module'",
    "return function(){import value from 'module'}",
    "return ()=>{import value from 'module'}",
    "return class {read(){import value from 'module'}}",
    "return import('module')",
    "return function(){return import('module')}",
    "return import.meta"
  ])(`${kind} import grammar matches native: %s`, body => {
    let accepted = true;
    try {runInNewContext(`${constructors[kind]}(${JSON.stringify(body)})`);}
    catch (error) {
      expect((error as Error).name).toBe("SyntaxError");
      accepted = false;
    }
    const parse = () => parseDynamicFunction(kind, "", body);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(SyntaxError);
  });
}
