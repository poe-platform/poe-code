import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument, cosDict, cosName, cosNumber, cosStream, dictSet } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createPdfimagesCommand, runPdfimagesCli } from "./index.js";

async function listings(input: Uint8Array): Promise<string[]> {
  const direct = await runPdfimagesCli(["-list", "-f", "1", "-l", "1", "in.pdf"], new Map([["in.pdf", input]]));
  expect(direct.exitCode).toBe(0);
  expect(direct.stderr).toBe("");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/tmp");
  await fs.writeFile("/in.pdf", input);
  const args = createCommandArguments(["-list", "-f", "1", "-l", "1", "in.pdf"]);
  let stdout = "", stderr = "";
  const result = await createPdfimagesCommand().execute({
    command: "pdfimages", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { stdout += new TextDecoder().decode(bytes); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } },
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  return [direct.stdout, stdout];
}

it.each([
  ["pdfjs-jp2-resetprob.pdf", [" 2273B  70%"]],
  ["pdfbox-6077-example.pdf", [" 1062K 100%", " 1062K 100%"]],
  ["pdfbox-5403-bad-rendering.pdf", ["  207K 1.4%", "    8B 0.1%"]],
] as const)("matches Poppler size and ratio columns for %s", async (name, expected) => {
  const input = new Uint8Array(readFileSync(new URL(`../../pdf-ast/src/fixtures/${name}`, import.meta.url)));
  for (const stdout of await listings(input)) {
    const rows = stdout.split("\n").slice(2);
    for (const [index, suffix] of expected.entries()) expect(rows[index]!.slice(81)).toBe(suffix);
  }
});

// Expected columns follow native Poppler's four-character size and ratio fields.
it.each([
  [9999, 100, 100, " 9999B 100%"],
  [10000, 100, 100, " 9.77K 100%"],
  [10239, 100, 100, " 10.0K 102%"],
  [10240, 100, 100, " 10.0K 102%"],
  [102399, 100, 100, "  100K 1024%"],
  [102400, 100, 100, "  100K 1024%"],
  [9999 * 1024, 100, 100, " 9999K 102390%"],
  [9999 * 1024 + 1, 100, 100, " 9.76M 102390%"],
  [1, 100, 100, "    1B 0.0%"],
  [9, 100, 100, "    9B 0.1%"],
  [99, 100, 100, "   99B 1.0%"],
  [990, 100, 100, "  990B 9.9%"],
  [991, 100, 100, "  991B  10%"],
])("formats %i bytes at %ix%i with Poppler padding", async (size, width, height, expected) => {
  const doc = PdfDocument.create();
  const page = doc.addPage([100, 100]);
  const image = doc.cos.allocateObject(cosStream(new Uint8Array(size), {
    dict: cosDict({ Type: cosName("XObject"), Subtype: cosName("Image"), Width: cosNumber(width),
      Height: cosNumber(height), ColorSpace: cosName("DeviceGray"), BitsPerComponent: cosNumber(8) }),
    compress: false,
  }));
  dictSet(page.getResourcesDict(), "XObject", cosDict({ Im: image }));
  dictSet(page.pageDict, "Contents", doc.cos.allocateObject(cosStream(new TextEncoder().encode("q 100 0 0 100 0 0 cm /Im Do Q"), { compress: false })));
  for (const stdout of await listings(doc.save())) expect(stdout.split("\n")[2]!.slice(81)).toBe(expected);
});
