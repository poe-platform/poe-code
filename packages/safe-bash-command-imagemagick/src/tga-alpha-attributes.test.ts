import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

for (const retained of [false, true]) {
  for (const attributes of [0, 8]) {
    for (const rle of [false, true]) {
      it(`reads stored 32-bit TGA alpha (retained=${retained}, attributes=${attributes}, rle=${rle})`, async () => {
        const bytes = Buffer.from("0000020000000000000000000300010020200000ff0000ff0080ff0000ff", "hex");
        bytes[17] = 0x20 | attributes;
        bytes[2] = rle ? 10 : 2;
        const input = rle ? Buffer.concat([bytes.subarray(0, 18), Buffer.from([2]), bytes.subarray(18)]) : bytes;
        const files = new Map([["/sample.tga", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/sample.tga", input);
        expect(await runConvertCli(["/sample.tga", "-depth", "8", "rgba:/out.raw"],
          retained ? { filesystem, cwd: "/" } : files)).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const output = retained ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
        expect(Buffer.from(output).toString("hex")).toBe("ff00000000ff00800000ffff");
      });
    }
  }
}
