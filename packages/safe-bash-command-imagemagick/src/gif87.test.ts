import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const opaque = Uint8Array.from(Buffer.from("R0lGODdhCQALAIEAABEhMf8AAADIAAAA3CwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBADs=", "base64"));

for (const retained of [false, true]) {
  for (const intermediate of [false, true]) {
    it(`writes GIF87a without extensions and preserves RGB pixels (retained=${retained}, intermediate=${intermediate})`, async () => {
      const files = new Map([["opaque.gif", opaque]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/opaque.gif", opaque);
      const backend = retained ? { filesystem, cwd: "/" } : files;
      const args = ["opaque.gif", "-set", "comment", "omit in GIF87", "-delay", "10", "-loop", "0"];
      args.push(...(intermediate ? ["-write", "GIF87:out.gif", "final.gif"] : ["GIF87:out.gif"]));
      expect(await runConvertCli(args, backend)).toMatchObject({ exitCode: 0 });
      const bytes = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif");
      expect(bytes).toBeDefined();
      expect(files.has("GIF87:out.gif")).toBe(false);
      expect(new TextDecoder().decode(bytes!.subarray(0, 6))).toBe("GIF87a");
      // Walk the stream so compressed bytes cannot be mistaken for extensions.
      let at = 13 + (bytes![10]! & 128 ? 3 * (1 << ((bytes![10]! & 7) + 1)) : 0);
      expect(bytes![at++]).toBe(0x2c);
      const flags = bytes![at + 8]!;
      at += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0);
      at++; // LZW minimum code size
      while (bytes![at]) at += bytes![at]! + 1;
      expect(Array.from(bytes!.subarray(at))).toEqual([0, 0x3b]);
      expect(decodeImage(bytes!).data).toEqual(decodeImage(opaque).data);
    });
  }
}
