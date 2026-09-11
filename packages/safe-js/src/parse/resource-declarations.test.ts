import { expect, it } from "vitest";
import { parseModule } from "./parser.js";

it.each([['using', 'sync'], ['await using', 'async']])("parses %s declarations as immutable resource bindings", (head, disposal) => {
  expect(parseModule(`${head} first = null, second = resource;`).body).toMatchObject([
    { type: 'VariableDeclaration', kind: 'const', disposal, declarations: [
      {id:{type:'Identifier',name:'first'}}, {id:{type:'Identifier',name:'second'}}
    ] }
  ]);
});

it.each(['using', 'await using'])("accepts %s in classic and iteration loop heads", head => {
  const disposal = head === 'using' ? 'sync' : 'async';
  expect(parseModule(`for (${head} value = resource; false;) {}`).body[0])
    .toMatchObject({type:'ForStatement',init:{kind:'const',disposal}});
  expect(parseModule(`for (${head} value of resources) {}`).body[0])
    .toMatchObject({type:'ForOfStatement',left:{kind:'const',disposal}});
  expect(parseModule(`for await (${head} value of resources) {}`).body[0])
    .toMatchObject({type:'ForOfStatement',await:true,left:{kind:'const',disposal}});
});

it.each([
  'using value;', 'await using value;', 'using {value} = resource;',
  'using value = null, value = null;',
  'using let = null;', 'await using await = null;',
  'function f(){await using value = null;}', 'function* f(){await using value = null;}',
  'class C {static {await using value = null;}}',
  'for (using value in resources) {}', 'for (await using value in resources) {}',
  'for (using of of resources) {}', 'for (using value = null of resources) {}',
  'if (true) using value = null;', 'while (false) using value = null;',
  'label: using value = null;', 'export using value = null;',
  'await\nusing value = null;'
])("rejects invalid resource declaration: %s", source => {
  expect(() => parseModule(source)).toThrow();
});

it("keeps using contextual and respects newlines", () => {
  expect(parseModule('let using = 1; using += 1; using\nvalue = null;').body.map(node => node.type))
    .toEqual(['VariableDeclaration','ExpressionStatement','ExpressionStatement','ExpressionStatement']);
  expect(parseModule('for (using of resources) {}').body[0])
    .toMatchObject({type:'ForOfStatement',left:{type:'Identifier',name:'using'}});
  expect(parseModule('using [value] = resource;').body[0])
    .toMatchObject({type:'ExpressionStatement',expression:{type:'AssignmentExpression'}});
  expect(parseModule('await using\nvalue = null;').body.map(node => node.type))
    .toEqual(['ExpressionStatement','ExpressionStatement']);
});

it("accepts async function resources and ordinary names using and of", () => {
  expect(parseModule('async function f(){await using using = null; using of = null;}').body[0])
    .toMatchObject({body:{body:[{disposal:'async'},{disposal:'sync'}]}});
});
