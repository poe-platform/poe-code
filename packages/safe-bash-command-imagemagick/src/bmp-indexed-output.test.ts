import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const fixtures = [
  {name:"two-color palette", png:"iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAQMAAAAhLob3AAAACVBMVEX/AAAA/wAA/wCTbN91AAAACklEQVR4nGNIAAAAYgBhsZh58gAAAABJRU5ErkJggg==", rgb:[255,0,0,0,255,0,0,255,0], bpp:1},
  {name:"large palette", png:"iVBORw0KGgoAAAANSUhEUgAAABEAAAABCAMAAAAPZbVTAAAAM1BMVEUAAP8PAPAeAOEtANI8AMNLALRaAKVpAJZ4AIeHAHiWAGmlAFq0AEvDADzSAC3hAB7wAA9k5Nt9AAAAGklEQVR4nGNgYGRiZmFlY+fg5OLm4eXjFwAAA0IAiQ0kDGUAAAAASUVORK5CYII=", rgb:Array.from({length:17},(_,i)=>[i*15,0,255-i*15]).flat(), bpp:8},
  {name:"mono", png:"iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAQAAAAAzmykZAAAACklEQVR4nGNIAAAAYgBhsZh58gAAAABJRU5ErkJggg==", rgb:[0,0,0,255,255,255,255,255,255], bpp:1},
  {name:"gray", png:"iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAAAAAA+i0toAAAADElEQVR4nGNQqP4AAAJKAYyUjQ/5AAAAAElFTkSuQmCC", rgb:[32,32,32,123,123,123,240,240,240], bpp:8},
  {name:"palette", png:"iVBORw0KGgoAAAANSUhEUgAAAAMAAAABAgMAAABmjvwnAAAACVBMVEX/AAAA/wAAAP8tSs2KAAAACklEQVR4nGOQAAAAGgAZLYj0NgAAAABJRU5ErkJggg==", rgb:[255,0,0,0,255,0,0,0,255], bpp:4},
  {name:"rgb", png:"iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADklEQVR4nGP4z8DAAMYADvsC/gkcFjQAAAAASUVORK5CYII=", rgb:[255,0,0,0,255,0,0,0,255], bpp:24}
];
for (const fixture of fixtures) for (const version of ["BMP", "BMP2", "BMP3"]) for (const mode of ["sync","buffered","retained"] as const) {
  it(`preserves ${fixture.name} BMP storage and pixels (${mode}, ${version})`, async () => {
    const input=Buffer.from(fixture.png,"base64");
    const files=new Map([["/in.png",input as Uint8Array]]), filesystem=new MemoryFileSystem();
    await filesystem.writeFile("/in.png",input);
    const args=["/in.png","-write",`${version}:/copy.bmp`,`${version}:/out.bmp`];
    const result=mode==="sync"?runConvertCliSync(args,files):await runConvertCli(args,mode==="retained"?{filesystem,cwd:"/"}:files);
    expect(result).toMatchObject({exitCode:0,stderr:""});
    for(const path of ["/copy.bmp","/out.bmp"]) {
      const output=mode==="retained"?await filesystem.readFile(path):files.get(path)!;
      const view=new DataView(output.buffer,output.byteOffset,output.byteLength);
      expect(view.getUint16(version==="BMP2"?24:28,true)).toBe(fixture.bpp);
      expect(view.getUint32(2,true)).toBe(output.length);
      const paletteStart=14+view.getUint32(14,true);
      expect(view.getUint32(10,true)-paletteStart).toBe(fixture.bpp<=8?(version==="BMP2"?3:4)*2**fixture.bpp:0);
      expect(Array.from(decodeImage(output).data)).toEqual(fixture.rgb.flatMap((v,i)=>i%3===2?[v,255]:[v]));
      if(fixture.bpp<=8) {
        const step=version==="BMP2"?3:4;
        const palette=output.subarray(paletteStart,view.getUint32(10,true));
        for(let i=0;i<fixture.rgb.length;i+=3) expect(Array.from({length:palette.length/step},(_,j)=>Array.from(palette.subarray(j*step,j*step+3)))).toContainEqual(fixture.rgb.slice(i,i+3).reverse());
      }
    }
  });
}
