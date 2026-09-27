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
