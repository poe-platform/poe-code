import { expect, it } from "vitest";
import { parseModule } from "../parse/parser.js";
import { interpret } from "./interpreter.js";
import { Budget } from "./budget.js";
import { createBuiltinBindings } from "./globals.js";
import { createGuestProxy } from "./guest-proxy.js";
import { createSandboxClosure } from "./values.js";

it.each(['map(x=>x*2)', 'filter(x=>true)', 'slice()', 'splice(0,3)', 'flat()', 'flatMap(x=>[x,x])', 'concat(9)']
  .flatMap(method => ['accept', 'reject', 'throw'].flatMap(mode =>
    ['object', 'array', 'fixed'].map(shape => ({ method, mode, shape })))))(
  "defines $method results through Proxy traps ($mode, $shape)", async ({ method, mode, shape }) => {
    const source = `const events=[];const target=${shape === 'array' ? '[]' : shape === 'fixed' ? 'Object.preventExtensions({})' : '{}'};const values=[1,,3];
      const output=wrap(target,{
        defineProperty(t,k,d){events.push([k,d.value,d.writable,d.enumerable,d.configurable]);
          if(k!=="0"&&${JSON.stringify(mode)}==="reject")return false;
          if(k!=="0"&&${JSON.stringify(mode)}==="throw")throw 43;
          return Reflect.defineProperty(t,k,d)},
        set(t,k,v){events.push(["set",k,v]);return Reflect.set(t,k,v)}
      });
      values.constructor={[Symbol.species]:function(){return output}};
      let status;try{status=values.${method}===output}catch(e){status=typeof e==="object"?e.name:e}
      return [status,target,events,values.length,values[0],values[1],values[2]]`;
    const expected = new Function("wrap", source)((target: object, handler: ProxyHandler<object>) => new Proxy(target, handler));
    const budget = new Budget(), parsed = parseModule(source);
    const wrap = createSandboxClosure({ guest: true, call: ([target, handler]) => createGuestProxy(target, handler) });
    expect(await interpret({ type: "BlockStatement", body: parsed.body, span: parsed.span }, {
      budget, bindings: { ...createBuiltinBindings({ budget }), wrap }
    })).toMatchObject({ ok: true, returnValue: expected });
  }
);
