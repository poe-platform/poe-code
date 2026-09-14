import {expect,it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/unicode-text-consumers-3.14.7.json";

// Each exact source body was executed by the pinned external oracle. Tests run
// only the owned interpreter, including argument parsing and exception objects.
it.each(reference.cases)("public Unicode text conversions: $name / $policy",({source})=>{
  const session=new PythonSession({limits:{maxSteps:4000000,maxAllocatedBytes:32000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
});
