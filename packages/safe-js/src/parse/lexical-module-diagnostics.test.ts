import { expect, it } from "vitest";
import { run } from "../run.js";
import { parseSourceModule } from "./source-module.js";

it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "retains imported syntax source positions across %j without host frames", async separator => {
    const prefix = '// 😀';
    const source = prefix + separator + 'export const x = );';
    const expected = {
      name: "SyntaxError", filename: "guest/dep.js", line: 2, column: 18,
      excerpt: `1 | ${prefix}\n2 | export const x = );`,
      span: {
        start: {line: 2, column: 18, offset: prefix.length + separator.length + 17},
        end: {line: 2, column: 19, offset: prefix.length + separator.length + 18}
      }
    };
    let error: unknown;
    try { parseSourceModule(source, "guest/dep.js"); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(SyntaxError);
    expect(error).toMatchObject(expected);
    expect((error as Error).stack).toBe(`SyntaxError: ${(error as Error).message}`);
    await expect(run("import 'dep'", {
      sourceType: "module", sourceResolver: () => ({id: "guest/dep.js", source})
    })).rejects.toMatchObject(expected);
  }
);

it.each(["\n", "\r\n", "\r", "\u2028", "\u2029"])(
  "accepts the neighboring imported declaration across %j", async separator => {
    expect(await run("import {x} from 'dep'; export {x}", {
      sourceType: "module", sourceResolver: () => ({id: "guest/dep.js", source: '// 😀' + separator + "export const x = 1;"})
    })).toMatchObject({ok: true, returnValue: {x: 1}});
  }
);
