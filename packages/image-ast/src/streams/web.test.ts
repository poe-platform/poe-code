import {describe,expect,it,vi} from "vitest";
import {Duplex} from "./web.js";

function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}

describe("Web duplex resource lifetime",()=>{
 it("keeps an asynchronous pull pending until it supplies its owned chunk",async()=>{
  const pending=gate();let pulls=0;
  class Source extends Duplex {override async _read(){pulls++;if(pulls>2){this.push(null);return;}await pending.promise;this.push(new Uint8Array([7]));}}
  const source=new Source(),reader=source.readable.getReader();
  const first=reader.read(),second=reader.read();
  await Promise.resolve();await Promise.resolve();expect(pulls).toBe(1);
  pending.resolve();expect((await first).value).toEqual(new Uint8Array([7]));
  expect((await second).value).toEqual(new Uint8Array([7]));await reader.cancel();
 });
 it("turns an asynchronous pull failure into a reader rejection",async()=>{
  const failure=new Error("backing read failed");
  class Source extends Duplex {override async _read(){throw failure;}}
  const source=new Source(),reader=source.readable.getReader();
  await expect(Promise.race([reader.read(),new Promise(resolve=>setTimeout(resolve,20))])).rejects.toBe(failure);
 });
 it("waits for cleanup on cancellation and runs it only once",async()=>{
  const pending=gate(),cleanup=vi.fn(async()=>pending.promise);
  class Source extends Duplex {override _read(){} override async _destroy(){await cleanup();}}
  const source=new Source();let finished=false;
  const cancellation=source.readable.cancel().then(()=>{finished=true;});
  await Promise.resolve();expect(cleanup).toHaveBeenCalledOnce();expect(finished).toBe(false);
  source.destroy();pending.resolve();await cancellation;expect(cleanup).toHaveBeenCalledOnce();
 });
 it("cleans up on writable abort even after readable completion",async()=>{
  const cleanup=vi.fn(async()=>{});
  class Source extends Duplex {override _read(){this.push(null);} override async _destroy(){await cleanup();}}
  const source=new Source();expect((await source.readable.getReader().read()).done).toBe(true);
  await source.writable.abort();expect(cleanup).toHaveBeenCalledOnce();
 });
 it("reports cleanup failure to asynchronous disposal without rerunning cleanup",async()=>{
  const failure=new Error("scratch close failed"),cleanup=vi.fn(async()=>{throw failure;});
  class Source extends Duplex {override _read(){} override async _destroy(){await cleanup();}}
  const source=new Source();await expect(source.dispose()).rejects.toBe(failure);
  await expect(source.dispose()).rejects.toBe(failure);expect(cleanup).toHaveBeenCalledOnce();
 });
 it("preserves the read failure when cleanup also fails",async()=>{
  const failure=new Error("read failed"),cleanupFailure=new Error("cleanup failed");
  class Source extends Duplex {override async _read(){throw failure;} override async _destroy(){throw cleanupFailure;}}
  const source=new Source();await expect(source.readable.getReader().read()).rejects.toBe(failure);
  await expect(source.dispose()).rejects.toBe(cleanupFailure);
 });
 it("releases backing when the consumer stops asynchronous iteration",async()=>{
  const cleanup=vi.fn(async()=>{});
  class Source extends Duplex {override async _read(){this.push(new Uint8Array([1]));} override async _destroy(){await cleanup();}}
  const source=new Source();for await(const bytes of source){expect(bytes).toEqual(new Uint8Array([1]));break;}
  expect(cleanup).toHaveBeenCalledOnce();
 });

});

it("awaits destruction before rejecting iteration and releases its reader lock",async()=>{
 const pending=gate(),entered=gate(),failure=new Error("read failed");
 class Source extends Duplex {override async _read(){throw failure;} override async _destroy(){entered.resolve();await pending.promise;}}
 const source=new Source();let finished=false;
 const consuming=(async()=>{for await(const ignoredChunk of source){/* drain */}})();void consuming.catch(()=>{finished=true;});
 await entered.promise;for(let i=0;i<10;i++)await Promise.resolve();expect(finished).toBe(false);
 pending.resolve();await expect(consuming).rejects.toBe(failure);expect(source.readable.locked).toBe(false);
});
