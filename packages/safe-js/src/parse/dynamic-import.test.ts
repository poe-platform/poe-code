import { expect, it } from "vitest";
import { parse, parseModule } from "./parser.js";

it.each(["import('fixture')", "import('fixture',)", "import('fixture',undefined)", "import('fixture',{},)"])("parses import expressions: %s", source => {
  expect(parse(source)).toMatchObject({type:"ImportExpression",source:{type:"StringLiteral",value:"fixture"}});
});

it("distinguishes static imports, dynamic imports and import.meta", () => {
  const module = parseModule("import * as fixed from 'fixture';import('fixture');import.meta");
  expect(module.body.map(node=>node.type)).toEqual(["ImportDeclaration","ExpressionStatement","ExpressionStatement"]);
  expect(module.body[1]).toMatchObject({expression:{type:"ImportExpression"}});
  expect(module.body[2]).toMatchObject({expression:{type:"MetaProperty"}});
});

it("allows a labeled import expression", () => {
  expect(parseModule("label: import('fixture')").body[0])
    .toMatchObject({type:"ExpressionStatement",labels:["label"],expression:{type:"ImportExpression"}});
});

it.each(["import()", "import(...names)", "import('fixture',{},7)", "import?.('fixture')", "new import('fixture')"])("rejects invalid import calls: %s", source => {
  expect(()=>parse(source)).toThrow();
});
