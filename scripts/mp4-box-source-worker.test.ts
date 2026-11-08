import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, expect, it } from "vitest";

let runtime: Miniflare;
beforeAll(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `export { scanMp4Boxes, MediaBudgetTracker } from '@poe-code/mp4-ast';` }, bundle: true, platform: 'browser', conditions: ['workerd'], format: 'cjs', write: false, metafile: true, logLevel: 'silent' });
  for (const output of Object.values(bundle.metafile!.outputs)) expect(output.imports).toEqual([]);
  expect(Object.keys(bundle.metafile!.inputs).some(path => path.startsWith('node:'))).toBe(false);
  runtime = new Miniflare({ modules: true, compatibilityDate: '2026-07-01', cf: false, script: `
    const api=(()=>{const module={exports:{}};${bundle.outputFiles[0]!.text};return module.exports;})();
    export default {async fetch(request){
      const mode=new URL(request.url).searchParams.get('mode'),controller=new AbortController();
      let calls=0,largestRead=0,largestAllocation=0,count=0,last,failed,checkpoints=0;
      const Native=Uint8Array;
      globalThis.Uint8Array=new Proxy(Native,{construct(target,args){const bytes=Reflect.construct(target,args);largestAllocation=Math.max(largestAllocation,bytes.length);if(bytes.length>32)throw new Error('Unbounded allocation');return bytes;}});
      try {
        const size=mode==='huge'?2**40:mode==='many'?80000:8;
        const input={size,async read(offset,length){
          calls++;largestRead=Math.max(largestRead,length);if(length>16)throw new Error('Unbounded read');
          if(mode==='read')throw new Error('source failure');
          if(mode==='truncated')return new Uint8Array();
          if(mode==='cancel')controller.abort(new Error('cancelled source'));
          const header=new Uint8Array(mode==='huge'?16:8),view=new DataView(header.buffer);
          header.set([109,100,97,116],4);view.setUint32(0,mode==='huge'?1:8);
          if(mode==='huge')view.setBigUint64(8,2n**40n);
          const start=mode==='many'?offset%8:offset;
          return header.slice(start,start+Math.min(length,mode==='short'?2:length));
        }};
        const options={signal:controller.signal,checkpoint(){checkpoints++;if(mode==='checkpoint')throw new Error('checkpoint failure');},...(mode==='budget'?{depth:1,budget:new api.MediaBudgetTracker({maxBoxDepth:0})}:{})};
        for await(const span of api.scanMp4Boxes(input,options)){count++;last={type:span.type,offset:span.offset,size:span.size,payloadSize:span.payloadSize};if(mode==='stop')break;}
      }catch(error){failed=error.message;}finally{globalThis.Uint8Array=Native;}
      return Response.json({count,last,calls,largestRead,largestAllocation,checkpoints,failed});
    }}
  ` });
});
afterAll(async () => { await runtime?.dispose(); });
for (const mode of ['huge', 'many', 'short', 'stop', 'read', 'truncated', 'cancel', 'checkpoint', 'budget']) it(`scans public MP4 ranges in a Node-free Worker: ${mode}`, async () => {
  const result = await (await runtime.dispatchFetch('https://example.test/?mode=' + mode)).json() as { count: number; calls: number; largestRead: number; largestAllocation: number; checkpoints: number; failed?: string; last?: { type: string; offset: number; size: number; payloadSize: number } };
  expect(result.largestRead).toBeLessThanOrEqual(16); expect(result.largestAllocation).toBeLessThanOrEqual(32);
  if (['huge', 'many', 'short', 'stop'].includes(mode)) {
    expect(result.failed).toBeUndefined(); expect(result.count).toBe(mode === 'many' ? 10000 : 1);
    if (mode === 'huge') { expect(result.calls).toBe(2); expect(result.last).toEqual({ type: 'mdat', offset: 0, size: 2 ** 40, payloadSize: 2 ** 40 - 16 }); }
    if (mode === 'many') { expect(result.calls).toBe(10000); expect(result.last?.offset).toBe(79992); }
    if (mode === 'short') expect(result.calls).toBe(4);
    if (mode === 'stop') expect(result.calls).toBe(1);
  } else {
    expect(result.count).toBe(0);
    expect(result.failed).toContain(({ read: 'source failure', truncated: 'Truncated', cancel: 'cancelled source', checkpoint: 'checkpoint failure', budget: 'maxBoxDepth' } as Record<string, string>)[mode]);
    if (mode === 'budget') expect(result.calls).toBe(0);
  }
});
