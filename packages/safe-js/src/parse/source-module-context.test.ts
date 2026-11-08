import {expect,it} from "vitest";
import {parseEvalScript} from "./parser.js";
import {parseSourceModule} from "./source-module.js";
it.each(["",'"use strict";'])("permits a class named await in Script code (%s)",prefix=>{
  expect(()=>parseEvalScript(`${prefix}class await{};new await instanceof await`)).not.toThrow();
  expect(()=>parseEvalScript(`${prefix}class ordinary{};new ordinary instanceof ordinary`)).not.toThrow();
  expect(()=>parseSourceModule("class await{}","entry")).toThrow(SyntaxError);
});
