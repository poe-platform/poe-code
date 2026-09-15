import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/source-literal-codec-boundaries-3.14.7.json" with {type:"json"};

it.each(reference.cases)("source literal codec boundary: $name", ({source,stdout,warnings})=>{
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  let output="";
  const observed:unknown[]=[];
  const session=new PythonSession({hashSeed:[1n,2n],
    limits:{maxSteps:1000000,maxAllocatedBytes:16000000,maxDepth:100},
    warning(warning){observed.push({category:warning.category,message:warning.message,filename:warning.filename,line:warning.position?.line});},
    output:{write(text){output+=text;},flush(){}}});
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(stdout);
  expect(observed).toEqual(warnings);
});
