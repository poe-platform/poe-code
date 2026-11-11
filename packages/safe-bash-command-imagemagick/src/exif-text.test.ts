import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// TIFF IFD0, independent of the encoder: ASCII values may be inline or offset.
function jpeg(little: boolean, values = ["grid desc", "grid maker", "grid model", "grid author"]): Uint8Array {
  const exif = new Uint8Array(256), view = new DataView(exif.buffer);
  exif.set(little ? [73, 73, 42, 0] : [77, 77, 0, 42]);
  view.setUint32(4, 8, little);
  view.setUint16(8, 5, little);
  let offset = 74;
  [270, 271, 272, 315].forEach((tag, index) => {
    const entry = 10 + index * 12, text = new TextEncoder().encode(values[index] + "\0");
    view.setUint16(entry, tag, little);
    view.setUint16(entry + 2, 2, little);
    view.setUint32(entry + 4, text.length, little);
    if (text.length <= 4) exif.set(text, entry + 8);
    else {
      view.setUint32(entry + 8, offset, little);
      exif.set(text, offset);
      offset += text.length;
    }
  });
  view.setUint16(58, 274, little);
  view.setUint16(60, 3, little);
  view.setUint32(62, 1, little);
  view.setUint16(66, 6, little);
  const { data } = encodeImage({ width: 3, height: 2, data: new Uint8Array(24).fill(255), format: "jpeg", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "jpeg" });
  const segment = Uint8Array.from([255, 225, 0, offset + 8, 69, 120, 105, 102, 0, 0, ...exif.subarray(0, offset)]);
  return Uint8Array.from([...data.subarray(0, 2), ...segment, ...data.subarray(2)]);
}

const format = "%[EXIF:Make]|%[EXIF:Model]|%[EXIF:Artist]|%[EXIF:ImageDescription]|%[EXIF:Orientation]";
for (const mode of ["command", "retained", "buffered", "sync"] as const) {
  for (const identify of [false, true]) for (const little of [false, true]) {
    it(`reads embedded JPEG EXIF text (${mode}, identify=${identify}, little=${little})`, async () => {
      for (const values of [undefined, ["D", "M", "XY", "ABC"], ["", "", "", ""]]) {
        const bytes = jpeg(little, values), fs = new MemoryFileSystem();
        await fs.writeFile("/tags.jpg", bytes);
        const args = identify ? ["identify", "-format", format, "/tags.jpg"] : ["/tags.jpg", "-format", format, "info:-"];
        const argumentValues = createCommandArguments(args);
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, new Map([["/tags.jpg", bytes]]))
          : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : new Map([["/tags.jpg", bytes]]));
        expect({ ...result, stdout: "stdout" in result ? result.stdout : stdout, stderr: "stderr" in result ? result.stderr : stderr })
          .toEqual({ exitCode: 0, stdout: values ? `${values[1]}|${values[2]}|${values[3]}|${values[0]}|6` : "grid maker|grid model|grid author|grid desc|6", stderr: "" });
      }
    });
  }
}

for (const input of ["jpeg", "png"] as const) {
  for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([["-strip"], ["+profile", "exif"], ["+profile", "*"]])(`retains EXIF text only in the current invocation (${input}/${mode}, %s)`, async (...operation) => {
      const bytes = input === "jpeg" ? jpeg(true) : encodeImage(decodeImage(jpeg(true)), { format: input }).data;
      const files = new Map([["/input", bytes]]), fs = new MemoryFileSystem();
      await fs.writeFile("/input", bytes);
      const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
        : runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
      const query = "%[profiles]|%[EXIF:Orientation]|%[EXIF:Artist]|%[EXIF:ImageDescription]";
      expect(await run(["/input", "-quiet", "-format", query, "info:"]))
        .toEqual({ exitCode: 0, stdout: "exif|6|grid author|grid desc", stderr: "" });
      expect(await run(["/input", ...operation, "-quiet", "-format", query, "info:"]))
        .toEqual({ exitCode: 0, stdout: "||grid author|grid desc", stderr: "" });
      expect(await run(["/input", ...operation, "/stripped.png"]))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      const output = mode === "retained" ? await fs.readFile("/stripped.png") : files.get("/stripped.png")!;
      expect(decodeImage(output).exif).toBeUndefined();
      expect(await run(["/stripped.png", "-quiet", "-format", query, "info:"]))
        .toEqual({ exitCode: 0, stdout: "|||", stderr: "" });
    });
  }
}

it("lets explicit properties override embedded EXIF and matches property names without case", async () => {
  expect(await runMagickCli(["/tags.jpg", "-set", "exif:make", "override", "-format", "%[exif:make]|%[eXiF:mOdEl]", "info:-"], new Map([["/tags.jpg", jpeg(true)]])))
    .toEqual({ exitCode: 0, stdout: "override|grid model", stderr: "" });
});

it.each(["offset", "length", "type", "empty"])("ignores an invalid EXIF Make %s without losing other tags", async invalid => {
  const bytes = jpeg(true), view = new DataView(bytes.buffer, bytes.byteOffset + 12);
  // Make is the second TIFF entry; corrupt only its type, count or offset.
  if (invalid === "type") view.setUint16(24, 3, true);
  else if (invalid === "offset") view.setUint32(30, 0xffffffff, true);
  else view.setUint32(26, invalid === "empty" ? 0 : 0xffffffff, true);
  expect(await runMagickCli(["identify", "-format", "%[EXIF:Make]|%[EXIF:Model]", "/tags.jpg"], new Map([["/tags.jpg", bytes]])))
    .toEqual({ exitCode: 0, stdout: "|grid model", stderr: "identify: unknown image property '%[EXIF:Make]'\n" });
});
