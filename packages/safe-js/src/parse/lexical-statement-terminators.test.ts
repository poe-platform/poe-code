import { expect, it } from "vitest";
import { lint } from "../lint/index.js";
import { run } from "../run.js";
import { parseEvalScript } from "./parser.js";

// Test262 language/asi/do-while-same-line.js, pin 419d3e0a2273ba01a3bfcbec423f2801425b8e93.
it.each(["break;", "0;", "if(true) break;", "while(false) 0;", "do break;while(0)", "{break;}", ";"])(
  "consumes the terminating semicolon of a nested statement: %s", async body => {
    const source = `var x;do ${body} while(0) x=42;`;
    expect(() => parseEvalScript(source)).not.toThrow();
    expect(await run(source + "return x")).toMatchObject({ok:true,returnValue:42});
    expect(lint(source + "return x").filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
  }
);

it.each(["do {} ; while(0)", "do ;; while(0)", "if(true) 0;;else 1"])(
  "does not discard an additional empty statement: %s", source => {
    expect(() => parseEvalScript(source)).toThrow();
  }
);
