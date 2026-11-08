import { expect, it, vi } from "vitest";
import * as parser from "./parse/parser.js";
import { run } from "./run.js";

it("compiles each source module once, including the one-shot result hash", async () => {
  const compile = vi.spyOn(parser, "parseSourceModule");
  try {
    expect(await run("import {x} from 'dep'; export {x}", {
      sourceType: "module",
      sourceResolver: () => ({id: "dep", source: "export const x=42"})
    })).toMatchObject({ok: true, returnValue: {x: 42}});
    expect(compile).toHaveBeenCalledTimes(2);
  } finally { compile.mockRestore(); }
});
