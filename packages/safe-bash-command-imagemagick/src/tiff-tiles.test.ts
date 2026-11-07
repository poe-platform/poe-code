import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const pixels = Uint8Array.from({ length: 48 * 40 * 4 }, (_, i) => i % 4 === 3 ? 255 : (7 * (Math.floor(i / 4) % 48) + 11 * Math.floor(i / 192)) % 256);
const input = sharp(pixels, { raw: { width: 48, height: 40, channels: 4 } }).greyscale().removeAlpha().png().toBufferSync();
for (const mode of ["sync", "buffered", "retained"] as const) {
    it.each([16, 32, 64])(`writes tiled TIFF including edge pixels in ${mode} conversion (%s wide)`, async width => {
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const height = width === 64 ? 64 : 16;
        const args = ["/in.png", "-define", `tiff:tile-geometry=${width}x${height}`, "-write", "/copy.tif", "/out.tif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        for (const path of ["/copy.tif", "/out.tif"]) {
            const bytes = mode === "retained" ? await filesystem.readFile(path) : files.get(path)!;
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ifd = view.getUint32(4, true);
            const tags = new Map<number, number[]>();
            for (let n = 0; n < view.getUint16(ifd, true); n++) {
                const at = ifd + 2 + n * 12, count = view.getUint32(at + 4, true);
                const offset = count === 1 ? at + 8 : view.getUint32(at + 8, true);
                if ([273, 278, 279, 322, 323, 324, 325].includes(view.getUint16(at, true))) tags.set(view.getUint16(at, true), Array.from({length: count}, (_, i) => view.getUint32(offset + i * 4, true)));
            }
            expect(tags.get(322)).toEqual([width]);
            expect(tags.get(323)).toEqual([height]);
            expect(tags.get(324)).toHaveLength(Math.ceil(48 / width) * Math.ceil(40 / (width === 64 ? 64 : 16)));
            expect(tags.get(325)).toEqual(Array(Math.ceil(48 / width) * Math.ceil(40 / (width === 64 ? 64 : 16))).fill(width * height));
            expect([273, 278, 279].some(tag => tags.has(tag))).toBe(false);
            for (let y = 0; y < 40; y++) for (let x = 0; x < 48; x++) {
                const tile = Math.floor(y / height) * Math.ceil(48 / width) + Math.floor(x / width);
                const offset = tags.get(324)![tile]! + (y % height) * width + x % width;
                expect(bytes[offset]).toBe((7 * x + 11 * y) % 256);
            }
            const decoded = decodeImage(bytes);
            expect([decoded.width, decoded.height]).toEqual([48, 40]);
            expect(decoded.data).toEqual(pixels);
        }
    });
}

for (const mode of ["sync", "retained"] as const) for (const method of ["LZW", "Zip", "RLE", "JPEG"]) {
    it(`writes independently compressed ${method} tiles in ${mode} output`, async () => {
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args=["/in.png", "-define", "tiff:tile-geometry=32x16", "-compress", method, "/out.tif"],files=new Map([["/in.png",input]]);
        expect(mode === "sync" ? runConvertCliSync(args,files) : await runConvertCli(args, {filesystem, cwd:"/"})).toMatchObject({exitCode:0,stderr:""});
        const decoded = decodeImage(mode === "sync" ? files.get("/out.tif")! : await filesystem.readFile("/out.tif"));
        expect([decoded.width,decoded.height]).toEqual([48,40]);
        if(method !== "JPEG") expect(decoded.data).toEqual(pixels);
    });
}
it("resets tiling for later outputs", () => {
    const files = new Map([["/in.png", input]]);
    expect(runConvertCliSync(["/in.png", "-define", "tiff:tile-geometry=16x16", "-write", "/tiles.tif", "+define", "tiff:tile-geometry", "/strips.tif"], files)).toMatchObject({exitCode:0,stderr:""});
    const bytes=files.get("/strips.tif")!,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ifd=view.getUint32(4,true);
    const tags=Array.from({length:view.getUint16(ifd,true)},(_,i)=>view.getUint16(ifd+2+i*12,true));
    expect(tags).toContain(273);expect(tags).not.toContain(322);
});
it.each(["0x16", "17x16", "16x-16", "16x16x16"])("rejects invalid tile geometry %s without replacing output", async geometry => {
    const filesystem=new MemoryFileSystem();await filesystem.writeFile("/in.png",input);await filesystem.writeFile("/out.tif",Uint8Array.of(42));
    expect((await runConvertCli(["/in.png","-define",`tiff:tile-geometry=${geometry}`,"/out.tif"],{filesystem,cwd:"/"})).exitCode).toBe(1);
    expect(await filesystem.readFile("/out.tif")).toEqual(Uint8Array.of(42));
});

it.each(["sync", "retained"])("preserves RGB alpha, comments, and page links in tiled %s output", async mode => {
    const data=Uint8Array.from({length:19*17*4},(_,i)=>(i*37)%256);
    const input=sharp(data,{raw:{width:19,height:17,channels:4}}).png().toBufferSync();
    const files=new Map([["/in.png",input]]),filesystem=new MemoryFileSystem();await filesystem.writeFile("/in.png",input);
    const args=["/in.png","/in.png","-set","comment","tiled pages","-define","tiff:tile-geometry=16x16","/out.tif"];
    expect(mode === "sync" ? runConvertCliSync(args,files) : await runConvertCli(args,{filesystem,cwd:"/"})).toMatchObject({exitCode:0,stderr:""});
    const bytes=mode === "sync" ? files.get("/out.tif")! : await filesystem.readFile("/out.tif"),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let offset=view.getUint32(4,true);
    for(let page=0;page<2;page++) {
        expect(offset).toBeGreaterThan(0);
        const single=bytes.slice();new DataView(single.buffer).setUint32(4,offset,true);
        expect(decodeImage(single).data).toEqual(data);
        offset=view.getUint32(offset+2+view.getUint16(offset,true)*12,true);
    }
    expect(offset).toBe(0);
});
