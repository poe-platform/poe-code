import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";

it.each([
  'let count=0;try{(42)`${count++}`}catch(error){return [count,error.name]}',
  'let count=0;try{(null)`${count++}`}catch(error){return [count,error.name]}',
  'let count=0;try{({}).missing`${count++}`}catch(error){return [count,error.name]}',
  'let count=0;try{({get tag(){count++;return 42}}).tag`${count++}:${count++}`}catch(error){return [count,error.name]}',
  'let count=0;function fail(){count++;throw "substitution"}try{(42)`${fail()}`}catch(error){return [count,error]}',
  'let count=0;try{({get tag(){throw "getter"}}).tag`${count++}`}catch(error){return [count,error]}',
  'let count=0;try{(null).tag`${count++}`}catch(error){return [count,error.name]}'
])("matches native tagged-template error order: %s", async body => {
  const source = `{${body}}`;
  const result = await interpret(parseModule(source).body[0]);
  if (!result.ok) throw new Error(result.error.message);
  expect(result.returnValue).toEqual(runInNewContext(`(()=>${source})()`));
});
