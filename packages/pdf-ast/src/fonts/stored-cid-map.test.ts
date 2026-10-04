import {expect,it,vi} from "vitest";
import {readStoredCidGlyph} from "./stored-cid-map.js";

it("reads only a CID pair and preserves odd tails, zero mappings and absent entries",async()=>{
 const bytes=new Uint8Array([0,0,0x12,0x34,0xab]),read=vi.fn(async(at:number,length:number)=>bytes.subarray(at-100,at-100+length));
 const map={position:100,byteLength:bytes.length,storage:{allocate(){throw Error('unexpected allocation');},read,async write(){throw Error('unexpected write');}}};
 expect(await readStoredCidGlyph(map,0)).toBe(0);expect(await readStoredCidGlyph(map,1)).toBe(0x1234);expect(await readStoredCidGlyph(map,2)).toBe(0xab00);
 for(const code of [-1,1.5,3,Number.MAX_SAFE_INTEGER])expect(await readStoredCidGlyph(map,code)).toBe(0);
 expect(read.mock.calls).toEqual([[100,2,undefined],[102,2,undefined],[104,1,undefined]]);
});
it("preserves mapping read failures and cancellation",async()=>{
 const failure=new Error('map read'),read=vi.fn(async()=>{throw failure;}),controller=new AbortController();
 const map={position:0,byteLength:2,storage:{allocate(){return 0;},read,async write(){}}};
 await expect(readStoredCidGlyph(map,0)).rejects.toBe(failure);read.mockClear();controller.abort(failure);
 await expect(readStoredCidGlyph(map,0,controller.signal)).rejects.toBe(failure);expect(read).not.toHaveBeenCalled();
});
