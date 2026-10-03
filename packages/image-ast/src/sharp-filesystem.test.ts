import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import sharp from "./index.js";

it("clones pending file inputs and reads operation paths through the same filesystem", async () => {
  const filesystem = new MemoryFileSystem();
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
  await filesystem.writeFile("/input.png", png);
  const original = sharp("/input.png", { filesystem });
  const clone = original.clone().resize(2, 2).png();
  expect((await clone.toBuffer({ resolveWithObject: true })).info.width).toBe(2);
  expect((await original.metadata()).width).toBe(1);
  const combined = original.clone().boolean("/input.png", "and").composite([{ input: "/input.png" }]).png();
  expect(combined.getAst().find(node => node.kind === "boolean")).toMatchObject({ operand: "/input.png" });
  expect((await combined.toBuffer({ resolveWithObject: true })).info.width).toBe(1);
}, 1000);

it("streams a PNG file conversion through retained reads, caller backing and atomic publication", async () => {
  const filesystem = new MemoryFileSystem();
  const bytes = await sharp({create:{width:2053,height:129,channels:4,background:"red"}}).png().toBuffer();
  await filesystem.writeFile("/input.png",bytes);
  const originalRead = filesystem.readFile.bind(filesystem);
  const injected = new Proxy(filesystem,{get(target,key) {
    if(key==="readFile" || key==="writeFile") return async () => {throw new Error("whole-file image I/O");};
    const value=Reflect.get(target,key,target);
    return typeof value==="function" ? value.bind(target) : value;
  }});
  const info = await sharp("/input.png",{filesystem:injected}).png().toFile("/output.png");
  expect(info).toMatchObject({format:"png",width:2053,height:129,channels:4});
  const output=await originalRead("/output.png");
  expect((await sharp(output).raw().toBuffer()).subarray(0,4)).toEqual(Uint8Array.of(255,0,0,255));
  expect((await filesystem.readdir("/")).map(entry=>entry.name)).toEqual(["input.png","output.png"]);
});
