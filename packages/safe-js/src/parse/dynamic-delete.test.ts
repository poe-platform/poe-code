import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { parseDynamicFunction } from "./parser.js";

const constructors = {
  normal: "Function", generator: "(function*(){}).constructor",
  async: "(async function(){}).constructor", "async-generator": "(async function*(){}).constructor"
} as const;

for (const kind of ["normal", "generator", "async", "async-generator"] as const) {
  it.each([
    "'use strict';return delete missing",
    "'use strict';return delete (missing)",
    "'use strict';return function(){return delete missing}",
    "return ()=>{'use strict';return delete missing}",
    "return class {read(){return delete missing}}",
    "return delete missing",
    "return delete (missing)",
    "'use strict';return delete object.value",
    "'use strict';return delete (0, missing)",
    "'use strict';return typeof missing"
  ])(`${kind} delete grammar matches native: %s`, body => {
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
