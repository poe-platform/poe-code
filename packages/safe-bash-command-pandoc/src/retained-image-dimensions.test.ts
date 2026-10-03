import {expect, it} from "vitest";
import {imageLength, retainedImageLength} from "./image-dimensions.js";
import {ExecutionContext} from "./execution.js";
it("preserves authored dimensions across scalar chunks and long numeric strings", async () => {
  const context = new ExecutionContext("convert", {});
  try {
    for (const value of ["1in", "0.5pt", "0x10px", " 2.54 cm", "12mm", "-1in", "0px", "1e99in", "1em", "0".repeat(5000)+"1in", "1"+"0".repeat(5000)+"e-5000in"]) {
      let expected: unknown; try {expected = imageLength(value, 0, context, "odt");} catch (error) {expected = error;}
      const source = (function* () {for (let i=0;i<value.length;i+=7) yield value.slice(i,i+7);})();
      const actual = await retainedImageLength(source, context, "odt").catch(error => error);
      if (expected instanceof Error) expect(actual).toMatchObject({message: expected.message}); else expect(actual).toBe(expected);
    }
  } finally {await context.close();}
});
