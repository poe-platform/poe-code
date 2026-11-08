import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const opaque = Uint8Array.from(Buffer.from("R0lGODdhCQALAIEAABEhMf8AAADIAAAA3CwAAAAACQALAAAIJgABBBAwQCBBAAcHFhxocOHBhBAbSoToUKJChA4rXrxI0aDFgwEBADs=", "base64"));

for (const retained of [false, true]) {
  for (const delay of [undefined, 0, 24]) {
    it(`preserves GIF timing without inventing a delay (retained=${retained}, delay=${delay})`, async () => {
      // The original GIF87a has no control extension. Add one only for controls.
      const input = delay === undefined ? opaque : Uint8Array.from([
        ...opaque.subarray(0, 25), 33, 249, 4, 0, delay, 0, 0, 0, ...opaque.subarray(25)
      ]);
      const files = new Map([["input.gif", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/input.gif", input);
      expect(await runConvertCli(["input.gif", "out.gif"], retained ? { filesystem, cwd: "/" } : files))
        .toMatchObject({ exitCode: 0 });
      const bytes = retained ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
      expect(new TextDecoder().decode(bytes.subarray(0, 6))).toBe("GIF89a");
      expect(decodeImage(bytes).delay).toEqual([(delay ?? 0) * 10]);
      expect(decodeImage(bytes).data).toEqual(decodeImage(input).data);
    });
  }
}

it("resets an explicit delay before a following frame without a control extension", () => {
  const bytes = Uint8Array.from([
    ...opaque.subarray(0, 25), 33, 249, 4, 0, 24, 0, 0, 0,
    ...opaque.subarray(25, -1), ...opaque.subarray(25)
  ]);
  expect(decodeImage(bytes, { animated: true }).delay).toEqual([240, 0]);
});
