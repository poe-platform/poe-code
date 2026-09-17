import {expect, it} from "vitest";
import {parseExecutableModule} from "./parser.js";
import {parseSourceModule} from "./source-module.js";
import {run} from "../run.js";

it("permits ordinary import.meta property writes only in the source-module path", async () => {
  const body = "import.meta.value=1; import.meta.value++; for(import.meta.value of [3]) {}";
  expect(() => parseExecutableModule(body)).toThrow("import.meta assignment");
  expect(await run(`${body} export const value=import.meta.value;`, {sourceType: "module"}))
    .toMatchObject({ok: true, returnValue: {value: 3}});
});

it.each(["import.meta=1", "import.meta++", "for(import.meta of []) {}"])(
  "still rejects assigning to the meta-property itself: %s", source => {
    expect(() => parseSourceModule(source, "entry")).toThrow(SyntaxError);
  }
);
