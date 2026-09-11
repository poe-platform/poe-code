import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { interpret } from "../interp/interpreter.js";
import { isSandboxPromise } from "../interp/values.js";
import { parseModule } from "../parse/parser.js";
import { restore } from "./restore.js";
import { serialize } from "./serialize.js";

const cases = ["&&=", "||=", "??="].flatMap(operator =>
  ["member", "private", "super"].flatMap(kind =>
    [false, true].map(async => ({ operator, kind, async }))));

it.each(cases)("restores logical assignment references: $kind $operator (async=$async)", async ({operator,kind,async}) => {
  const initial=operator==="&&="?"1":operator==="||="?"0":"null";
  const generator=async?"async *":"*";
  const definition=kind==="member"
    ? `const original={get x(){log.push('get');return ${initial}},set x(v){log.push(['set',v,this===original])}};
       let target=original;const replacement={x:100};
       const holder={${generator}values(){const result=target.x ${operator} (target=replacement,yield 'rhs');return [result,log,replacement.x]}};`
    : kind==="private"
      ? `class C{get #x(){log.push('get');return ${initial}}set #x(v){log.push(['set',v,this===holder])}
         ${generator}values(){const result=this.#x ${operator} (yield 'rhs');return [result,log]}}const holder=new C();`
      : `class A{get x(){log.push('get');return ${initial}}set x(v){log.push(['set',v,this===holder])}}
         class C extends A{${generator}values(){const result=super.x ${operator} (yield 'rhs');return [result,log]}}const holder=new C();`;
  const source=`{const log=[];${definition}const iterator=holder.values();await iterator.next();return iterator}`;
  const ast=parseModule(source);
  const original=await interpret(ast.body[0]);
  if(!original.ok)throw new Error(original.error.message);
  const wire=serialize({source,currentAstNodeId:ast.body[0].nodeId!,scopeChain:[{id:"external",bindings:{iterator:original.returnValue}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const restored=restore(JSON.parse(JSON.stringify(wire)),{source});
  const binding=restored.currentScope.lookup("iterator");
  if(!binding.found)throw new Error("Missing restored iterator");
  const next=await interpret(parseModule("{return iterator.next(7)}").body[0],{budget:restored.budget,bindings:{iterator:binding.value}});
  if(!next.ok)throw new Error(next.error.message);
  const actual=isSandboxPromise(next.returnValue)?await next.returnValue.promise:next.returnValue;
  const native=await runInNewContext(`(async()=>${source})()`);
  expect(actual).toEqual(await native.next(7));
});
