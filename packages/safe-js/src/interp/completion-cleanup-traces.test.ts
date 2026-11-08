import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { dump } from "../dump.js";
import { run } from "../run.js";

// Explicit ECMA-262 edition 16 completion/IteratorClose oracles. Native execution
// is a separate control; it does not supply the expected result.
it.each([
  {
    name: "a finally continue cancels return without closing the iterator",
    source: `const t=[];let n=0;
      const iterable={ [Symbol.iterator](){return this},
        next(){t.push('next');return {value:++n,done:false}},
        return(){t.push('close');return {done:true}} };
      function f(){for(const value of iterable){try{return 'lost'}
        finally{t.push('finally:'+value);if(value===1)continue;break}}
        t.push('after');return 'kept'}
      t.push(f());return t`,
    expected: ["next", "finally:1", "next", "finally:2", "close", "after", "kept"]
  },
  {
    name: "a delegated missing throw closes before outer catch and finally",
    source: `const t=[];
      const iterator={ [Symbol.iterator](){return this},
        next(){t.push('next');return {value:'value',done:false}},
        get throw(){t.push('get throw');return undefined},
        get return(){t.push('get return');return function(){t.push('close');return {done:true}}} };
      function* f(){try{yield* iterator}catch(e){t.push(e instanceof TypeError)}finally{t.push('finally')}}
      const g=f();t.push(g.next().value);t.push(g.throw('injected').done);return t`,
    expected: ["next", "value", "get throw", "get return", "close", true, "finally", true]
  },
  {
    name: "a close failure replaces missing-throw TypeError before outer finally",
    source: `const t=[];const close={};
      const iterator={ [Symbol.iterator](){return this},next(){return {value:1,done:false}},
        return(){t.push('close');throw close} };
      function* f(){try{yield* iterator}catch(e){t.push(e===close);throw e}finally{t.push('finally')}}
      const g=f();g.next();try{g.throw('injected')}catch(e){t.push(e===close)}return t`,
    expected: ["close", true, "finally", true]
  }
])("traces original and completed replay: $name", async ({ source, expected }) => {
  expect(runInNewContext(`(()=>{${source}})()`)).toEqual(expected);
  const original = await run(source);
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});

// Separately pinned resource-management extension: DisposeResources suppresses
// the previous throw, while an outer abrupt finally replaces that completion.
it("preserves nested async disposal rejection identities before finally overrides them", async () => {
  const source = `const t=[];const body=new AggregateError([], 'body');
    const first=new TypeError('first',{cause:body}),second=new RangeError('second');
    async function f(){try{try{
      await using a={async [Symbol.asyncDispose](){t.push('a:start');await 0;t.push('a:end');throw first}};
      await using b={async [Symbol.asyncDispose](){t.push('b:start');await 0;t.push('b:end');throw second}};
      t.push('body');throw body;
    }catch(e){t.push(e instanceof SuppressedError,e.error===first,
      e.suppressed instanceof SuppressedError,e.suppressed.error===second,
      e.suppressed.suppressed===body,e.error.cause===body);throw e}}
    finally{t.push('finally');return 'override'}}
    t.push(await f());return t`;
  const expected = ["body", "b:start", "b:end", "a:start", "a:end",
    true, true, true, true, true, true, "finally", "override"];
  const original = await run(source);
  expect(original).toMatchObject({ ok: true, returnValue: expected });
  expect(await run(source, { snapshot: JSON.parse(await dump(original)) }))
    .toMatchObject({ ok: true, returnValue: expected });
});
