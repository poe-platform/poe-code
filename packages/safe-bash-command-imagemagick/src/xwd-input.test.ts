import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "../../../tests/fixtures/media/xwd-fixtures.json" with { type: "json" };

for (const [layout, encoded] of Object.entries(fixtures)) {
  for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`converts ${layout} XWD to PNG with native pixels (${mode})`, async () => {
      const input = Buffer.from(encoded, "base64"), files = new Map<string, Uint8Array>([["/in.xwd", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.xwd", input);
      const args = ["/in.xwd", "/out.png"];
      if (mode === "command") {
        const arguments_ = createCommandArguments(args);
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
      } else {
        expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const image = decodeImage(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
      expect(image).toMatchObject({ width: 7, height: 3 });
      const rgb = image.data.filter((_, i) => i % 4 !== 3);
      expect(rgb.length).toBe(63);
      expect(createHash("sha256").update(rgb).digest("hex")).toBe("bed3a6dc1b82cf207d47ca34c4763d6756229e52f04bf5fb9dd50f8dd5a852a6");
      expect(image.data.filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    });
  }
}
