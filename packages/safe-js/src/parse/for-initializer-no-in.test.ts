import { Script } from "node:vm";
import { expect, it } from "vitest";
import { parseModule } from "./parser.js";
import { run } from "../run.js";

it.each([false, true])(
  "applies the In grammar to private brands (parenthesized=%s)",
  (parenthesized) => {
    const expression = parenthesized ? "(#x in {})" : "#x in {}";
    const source = `class C{#x;method(){for(${expression};;);}}`;
    if (parenthesized) {
      expect(() => new Script(source)).not.toThrow();
      expect(() => parseModule(source)).not.toThrow();
    } else {
      expect(() => new Script(source)).toThrow(SyntaxError);
      expect(() => parseModule(source)).toThrow();
    }
  }
);

it("restores In grammar for loop conditions, updates, bodies and later statements", async () => {
  const source = `let hits=0;const object={x:1};
    for(let count=('x' in object); 'x' in object; count=('x' in object)){
      hits++;if(hits===2)break;
    }
    return [hits,'x' in object]`;
  expect(await run(source)).toMatchObject({ ok: true, returnValue: [2, true] });
});

it.each([
  "yield * '' in {}",
  "yield '' in {}",
  "0 in {}",
  "var x = 0 in {}",
  "let x = 0 in {}",
  "const x = 0 in {}",
  "x = 0 in {}",
  "()=>0 in {}",
  "false ? 0 : 0 in {}",
  "var x = ()=>0 in {}",
  "true ? 0 in {} : 0 in {}",
  "x = (0 in {}), 0 in {}",
  "var x=(0 in {}), y=0 in {}",
  "[...[]] = 0 in {}"
])("rejects an unparenthesized in expression in a classic for initializer: %s", (head) => {
  const source = `function* g(){for(${head};;);}`;
  expect(() => new Script(source)).toThrow(SyntaxError);
  expect(() => parseModule(source)).toThrow();
});

it.each([
  "false ? 0 in {} : 0",
  "(0 in {})",
  "[0 in {}]",
  "f(0 in {})",
  "{x:0 in {}}",
  "[x = 0 in {}] = []",
  "{x = 0 in {}} = {}",
  "var [x = 0 in {}] = []",
  "(x = 0 in {}) => 0",
  "()=>{return 0 in {}}",
  "function(){return 0 in {}}",
  "class { x = 0 in {} }",
  "()=> (0 in {})",
  "{[0 in {}]:1}",
  "obj[0 in {}]"
])("preserves an allowed nested in expression in a classic for initializer: %s", (head) => {
  const source = `function* g(){for(${head};;);}`;
  expect(() => new Script(source)).not.toThrow();
  expect(() => parseModule(source)).not.toThrow();
});
