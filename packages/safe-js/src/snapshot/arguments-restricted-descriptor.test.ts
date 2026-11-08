import { expect, it } from "vitest";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it("restores strict callee descriptor identity in the resumed realm", async () => {
  const source = `const args=(function(){"use strict";return arguments})();
    const saved=Object.getOwnPropertyDescriptor(args,"callee").get;await 0;
    const descriptor=Reflect.getOwnPropertyDescriptor(args,"callee");
    let error;try{descriptor.set(1)}catch(e){error=e.name}
    return [saved===descriptor.get,descriptor.get===descriptor.set,
      descriptor.get===Object.getOwnPropertyDescriptor(Object.getPrototypeOf(function(){}),"caller").get,error];`;
  const pending = run(source);
  const completed = pending.catch(error => error);
  try {
    const snapshot = JSON.parse(await dump(pending));
    const expected = { ok: true, returnValue: [true, true, true, "TypeError"] };
    expect(await completed).toMatchObject(expected);
    expect(await run(source, { snapshot: restore(snapshot, { source }) })).toMatchObject(expected);
  } finally { await completed; }
});
