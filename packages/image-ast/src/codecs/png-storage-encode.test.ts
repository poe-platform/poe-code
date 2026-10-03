import {inflateSync} from "node:zlib";
import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {PagedStorage} from "@poe-code/safe-fs/storage";
import {encodePngFromStorage, type StoredRgbaImage} from "./png-storage.js";

it("encodes caller-backed wide rows through bounded chunks with independent zlib decoding", async () => {
  const signal = new AbortController().signal;
  const storage = new PagedStorage({fs: new MemoryFileSystem(), cwd:"/", env:{}, signal},1);
  const width = 2051, height = 3, position = storage.allocate(width * height * 4);
  try {
    for(let offset=0;offset<width*height*4;offset+=4) await storage.write(position+offset,Uint8Array.of(12,34,56,78));
    const image: StoredRgbaImage = {position,width,height,format:"png",space:"srgb",channels:4,depth:"uchar",density:144,hasAlpha:true};
    const reads = vi.spyOn(storage,"read");
    const chunks: Uint8Array[] = [];
    for await (const bytes of encodePngFromStorage(image,storage,signal)) {expect(bytes.length).toBeLessThanOrEqual(4096); chunks.push(bytes);}
    expect(reads.mock.calls.every(([,length])=>length<=4096)).toBe(true);
    const png = Buffer.concat(chunks), compressed: Uint8Array[] = [];
    for(let offset=8;offset<png.length;) {
      const length=png.readUInt32BE(offset), name=png.toString("ascii",offset+4,offset+8);
      if(name==="IDAT") compressed.push(png.subarray(offset+8,offset+8+length));
      offset+=length+12;
    }
    const raw=inflateSync(Buffer.concat(compressed));
    expect(raw.length).toBe(height*(1+width*4));
    for(let y=0;y<height;y++) {
      const row=y*(1+width*4);
      expect([...raw.subarray(row,row+5)]).toEqual([1,12,34,56,78]);
      expect(raw.subarray(row+5,row+1+width*4).every(byte=>byte===0)).toBe(true);
    }
  } finally {await storage.close();}
});

it("does not read pixels before downstream pulls their encoded data", async () => {
  const signal=new AbortController().signal;
  const storage={allocate:vi.fn(),read:vi.fn(async()=>Uint8Array.of(1,2,3,4)),write:vi.fn()};
  const image: StoredRgbaImage={position:8,width:1,height:1,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
  const iterator=encodePngFromStorage(image,storage,signal);
  expect((await iterator.next()).value).toEqual(Uint8Array.of(137,80,78,71,13,10,26,10));
  expect(storage.read).not.toHaveBeenCalled();
  await iterator.return(undefined);
});

 it.each([[2 ** 32, 1], [1, 2 ** 32]])("rejects dimensions outside PNG fields (%s, %s) before storage access", async (width,height) => {
  const storage={allocate:vi.fn(),read:vi.fn(),write:vi.fn()};
  const image: StoredRgbaImage={position:0,width,height,format:"png",space:"srgb",channels:4,depth:"uchar",density:72,hasAlpha:true};
  const iterator=encodePngFromStorage(image,storage,new AbortController().signal);
  await expect(iterator.next()).rejects.toThrow("Invalid PNG dimensions");
  expect(storage.read).not.toHaveBeenCalled();
});
