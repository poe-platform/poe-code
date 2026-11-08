import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli } from "./index.js";

// Produced with qpdf 12.4.2 --add-attachment notes.txt --key=notes --filename=display.txt --.
// Native --list-attachments on these exact bytes prints "notes -> 7,0";
// object 7 is the embedded stream, distinct from the file specification (object 5).
const input = Buffer.from("JVBERi0xLjcKJb/3ov4KMSAwIG9iago8PCAvTmFtZXMgPDwgL0VtYmVkZGVkRmlsZXMgMyAwIFIgPj4gL1BhZ2VNb2RlIC9Vc2VBdHRhY2htZW50cyAvUGFnZXMgNCAwIFIgL1R5cGUgL0NhdGFsb2cgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1Byb2R1Y2VyIChAcG9lLWNvZGUvcGRmLWFzdCkgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL05hbWVzIFsgKG5vdGVzKSA1IDAgUiBdID4+CmVuZG9iago0IDAgb2JqCjw8IC9Db3VudCAxIC9LaWRzIFsgNiAwIFIgXSAvVHlwZSAvUGFnZXMgPj4KZW5kb2JqCjUgMCBvYmoKPDwgL0VGIDw8IC9GIDcgMCBSIC9VRiA3IDAgUiA+PiAvRiAoZGlzcGxheS50eHQpIC9UeXBlIC9GaWxlc3BlYyAvVUYgKGRpc3BsYXkudHh0KSA+PgplbmRvYmoKNiAwIG9iago8PCAvQ29udGVudHMgOCAwIFIgL01lZGlhQm94IFsgMCAwIDEwMCAxMDAgXSAvUGFyZW50IDQgMCBSIC9SZXNvdXJjZXMgPDwgL0ZvbnQgPDwgPj4gPj4gL1R5cGUgL1BhZ2UgPj4KZW5kb2JqCjcgMCBvYmoKPDwgL1BhcmFtcyA8PCAvQ2hlY2tTdW0gPDJkYTFjNjY0NTRjZmI3ZjdkMzg3Y2QyOGZiZGZkMDYxPiAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMTA0MjMzOTM1LTA2JzAwJykgL01vZERhdGUgKEQ6MjAyNjExMDQyMzM5MzUtMDYnMDAnKSAvU2l6ZSAxNyA+PiAvVHlwZSAvRW1iZWRkZWRGaWxlIC9MZW5ndGggMjUgL0ZpbHRlciAvRmxhdGVEZWNvZGUgPj4Kc3RyZWFtCnicSywpSUzOyE3NK1FIqixJLeYCAD1aBntlbmRzdHJlYW0KZW5kb2JqCjggMCBvYmoKPDwgL0ZpbHRlciAvRmxhdGVEZWNvZGUgL0xlbmd0aCA4ID4+CnN0cmVhbQp4nAMAAAAAAWVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAxMjQgMDAwMDAgbiAKMDAwMDAwMDE3NSAwMDAwMCBuIAowMDAwMDAwMjIxIDAwMDAwIG4gCjAwMDAwMDAyODAgMDAwMDAgbiAKMDAwMDAwMDM4MSAwMDAwMCBuIAowMDAwMDAwNDk5IDAwMDAwIG4gCjAwMDAwMDA3NTcgMDAwMDAgbiAKdHJhaWxlciA8PCAvSW5mbyAyIDAgUiAvUm9vdCAxIDAgUiAvU2l6ZSA5IC9JRCBbPDM0YzViZTI2ZGQ3YjY0MTU1YzdjZDc1NTc5MmFmYjM5PjwzNGM1YmUyNmRkN2I2NDE1NWM3Y2Q3NTU3OTJhZmIzOT5dID4+CnN0YXJ0eHJlZgo4MzQKJSVFT0YK", "base64");

for (const mode of ["attached", "compressed-pages", "linearized", "empty"]) it(`lists native attachments for ${mode} through both execution paths`, async () => {
  const bytes = mode === "attached" || mode === "empty" ? input : await readFile(new URL(`./fixtures/${mode}.pdf`, import.meta.url));
  const args = ["--list-attachments", mode === "empty" ? "--empty" : "/in.pdf"];
  const expected = mode === "attached" ? "notes -> 7,0\n" : `${mode === "empty" ? "" : "/in.pdf"} has no embedded files\n`;
  assert.deepEqual(await runQpdfCli(args, new Map([["/in.pdf", bytes]])), { exitCode: 0, stdout: expected, stderr: "" });
  const fs = createMemoryFileSystem();
  await fs.mkdir("/scratch");
  await fs.writeFile("/in.pdf", bytes);
  const stdout: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write() { assert.fail("Unexpected diagnostic"); } },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(Buffer.concat(stdout).toString(), expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
});
