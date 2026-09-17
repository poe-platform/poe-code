import { Volume } from "memfs";
import { expect, it } from "vitest";
import type { FileSystem } from "@poe-code/safe-fs/core";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import { createDocxInspectionCommandEngine, packDocumentArchive } from "./index.js";
import { textContext } from "../tests/fixtures/text.js";
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const)
for (const type of ["application/xml;", "application/xml; charset=", 'application/xml; charset="open', "application /xml", "text/xml; a=x\r\nInjected:yes", ...["core-properties+xml", "digital-signature-certificate", "digital-signature-origin", "digital-signature-xmlsignature+xml", "relationships+xml"].map(suffix => "application/vnd.openxmlformats-package." + suffix + "; audit=native")])
for (const route of ["sdk", "shell"] as const)
it(`${route} rejects invalid MIME metadata ${JSON.stringify(type)} before payload reads; ${kind} strict=${strict}`, async () => {
  const payload = Uint8Array.of(1), digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", payload))].map(byte => byte.toString(16).padStart(2, "0")).join("");
  const inventory = {version: 1, kind, dialect: strict ? "strict" : "transitional", entries: [{part: "/audit/payload.bin", path: "payload.bin", contentType: type, bytes: 1, sha256: digest}]};
  const memory = Volume.fromJSON({"/tree/payload.bin": Buffer.from(payload), "/out": ""}), reads: string[] = [];
  if (route === "sdk") {
    const filesystem = {async lstat(path: string) {const stat = memory.lstatSync(path); return {type: stat.isDirectory() ? "directory" : "file", size: stat.size};}, async realpath(path: string) {return String(memory.realpathSync(path));}, async readFile(path: string) {reads.push(path); return new Uint8Array(memory.readFileSync(path) as Buffer);}} as unknown as FileSystem;
    await expect(packDocumentArchive(inventory, {output: "-"}, {...textContext, inventoryDirectory: "/tree", filesystem, stdout: {async write(bytes) {memory.appendFileSync("/out", bytes);}}})).rejects.toMatchObject({code: "invalid-package"});
  } else {
    const fs = new MemoryFileSystem(); await fs.mkdir("/tree", {recursive: true}); await fs.writeFile("/tree/payload.bin", payload); await fs.writeFile("/tree/manifest.json", new TextEncoder().encode(JSON.stringify(inventory))); const read = fs.readStream.bind(fs); fs.readStream = (path, options) => {if (path !== "/tree/manifest.json") reads.push(path); return read(path, options);};
    const output = await new Shell({fs}).use(docxCommands({engine: createDocxInspectionCommandEngine({limits: textContext.limits})})).exec("docx pack /tree/manifest.json --output - > /out"); expect(output.exitCode).not.toBe(0); expect(output.stderr).toContain("invalid-package"); expect(await fs.readFile("/tree/payload.bin")).toEqual(payload); memory.writeFileSync("/out", await fs.readFile("/out"));
  }
  expect(reads).toEqual([]); expect(memory.readFileSync("/tree/payload.bin")).toEqual(Buffer.from(payload)); expect(memory.readFileSync("/out").length).toBe(0);
});
