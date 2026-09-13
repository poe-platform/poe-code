import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseEvalScript } from "./parser.js";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each(["\n", "\r\n", "\u2028", "/*\n*/"])("ends the async identifier statement at %j", separator => {
  const source = `let async=7; async${separator}x=>x;`;
  expect(typeof new Script(source).runInNewContext()).toBe("function");
  expect(() => parseEvalScript(source)).not.toThrow();
  expect(lint(source).filter(d=>d.severity==="error")).toEqual([]);
});

it.each(["async\nx\n=>x", "async x\n=>x", "async\n(x)=>x"])("preserves invalid arrow grammar: %j", source => {
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseEvalScript(source)).toThrow();
});

it("preserves ReferenceError phase, ordinary arrow source and replay", async () => {
  const source = `const t=[];try{eval("async\\nx=>x");}catch(e){t.push(e.name,e instanceof ReferenceError);}
    const f=eval("let async=7;async\\nx=>x");await 0;
    return [t,f(4),f.toString(),Function("let async=7;async\\nx=>x;return 8")(),
      f.constructor("return typeof process+','+typeof require")()];`;
  const expected={ok:true,returnValue:[["ReferenceError",true],4,"x=>x",8,"undefined,undefined"]};
  let pending=run(source);
  for(let i=0;i<3;i++){
    const settled=pending.catch(error=>error);
    try{const saved=JSON.parse(await dump(pending));expect(await settled).toMatchObject(expected);
      pending=run(source,{snapshot:restore(saved,{source})});}finally{await settled;}
  }
  expect(await pending).toMatchObject(expected);
  const saved=JSON.parse(await dump(pending));
  expect(await run(source,{snapshot:restore(saved,{source})})).toMatchObject(expected);
});
