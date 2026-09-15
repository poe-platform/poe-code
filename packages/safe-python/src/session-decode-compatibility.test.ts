import {expect,it} from "vitest";
import {PythonSession} from "./index.js";

import {decodeCases} from "./decode-compatibility-cases.js";

it.each(decodeCases)("decodes through the public session (case %#)",source=>{
  const session=new PythonSession({limits:{maxSteps:200000,maxAllocatedBytes:4000000,maxDepth:100},hashSeed:[1n,2n]});
  expect(session.exec(source).status).toBe("ok");
});
