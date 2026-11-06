import assert from "node:assert/strict";
import { it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { PdfDocument, cosArray, cosDict, cosName, cosNumber, cosString, dictSet } from "@poe-code/pdf-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts";
import { createQpdfCommand, runQpdfCli, runQpdfCliSync } from "./index.js";

async function verify(input: Uint8Array, version: number, acroform: unknown) {
  const args = [`--json=${version}`, "--json-key=acroform", "in.pdf"];
  const expected = { version, parameters: { decodelevel: "generalized" }, acroform };
  const sync = runQpdfCliSync(args, new Map([["in.pdf", input]]));
  assert.equal(sync.exitCode, 0); assert.deepEqual(JSON.parse(sync.stdout), expected);
  const buffered = await runQpdfCli(args, new Map([["in.pdf", input]]));
  assert.equal(buffered.exitCode, 0); assert.deepEqual(JSON.parse(buffered.stdout), expected);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input);
  const stdout: Uint8Array[] = [], carrier = createCommandArguments(args);
  const result = await createQpdfCommand().execute({ command: "qpdf", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs, signal: new AbortController().signal,
    stdin: (async function* (): AsyncGenerator<Uint8Array> {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } }, stderr: { async write() {} } });
  assert.equal(result.exitCode, 0); assert.deepEqual(JSON.parse(Buffer.concat(stdout).toString()), expected);
  assert.deepEqual(await fs.readdir("/scratch"), []);
}

for (const version of [1, 2]) {
  it(`matches native JSON ${version} for a visible pdf-lib text field`, async () => {
    const doc = await PDFDocument.create(), page = doc.addPage();
    const field = doc.getForm().createTextField("approval.reviewer"); field.setText("Alice Vance");
    field.addToPage(page, { x: 72, y: 680, width: 240, height: 24 });
    const widget = field.acroField.getWidgets()[0]!;
    const object = doc.context.getObjectRef(widget.dict)!.toString();
    await verify(await doc.save(), version, { hasacroform: true, needappearances: false, fields: [{
      alternativename: "approval.reviewer", annotation: { annotationflags: 4, appearancestate: "", object }, choices: [], defaultvalue: null,
      fieldflags: 0, fieldtype: "/Tx", fullname: "approval.reviewer", ischeckbox: false, ischoice: false, isradiobutton: false, istext: true,
      mappingname: "approval.reviewer", object, pageposfrom1: 1, parent: field.ref.toString(), partialname: "", quadding: 0,
      value: `${version === 1 ? "" : "u:"}Alice Vance`
    }] });
  });

  for (const mode of ["none", "empty", "widgetless", "text", "choice", "checkbox", "radio", "push"]) it(`matches native JSON ${version} AcroForm ${mode}`, async () => {
    const doc = PdfDocument.create(); doc.addPage(); const page = doc.addPage();
    const flags = mode === "radio" ? 32768 : mode === "push" ? 65536 : 0;
    const type = mode === "choice" ? "Ch" : ["checkbox", "radio", "push"].includes(mode) ? "Btn" : "Tx";
    const parent = doc.cos.allocateObject(cosDict({ T: cosString("approval"), TU: cosString("Not inherited"), TM: cosString("Not inherited"),
      FT: cosName(type), Ff: cosNumber(flags), V: type === "Btn" ? cosName("Yes") : cosString("Alice"), DV: cosString("Default"),
      Opt: cosArray([cosString("One"), cosArray([cosString("export"), cosString("Display")])]) }));
    const widget = doc.cos.allocateObject(cosDict({ Subtype: cosName("Widget"), Parent: parent, T: cosString("reviewer"),
      TU: cosString("Reviewer"), TM: cosString("reviewer-id"), F: cosNumber(4), AS: cosName("Yes") }));
    dictSet(doc.cos.resolveDict(parent)!, "Kids", cosArray([widget]));
    if (mode === "widgetless") doc.setFormField("invisible", "value");
    else if (mode !== "none") dictSet(doc.cos.resolveDict(doc.cos.rootRef)!, "AcroForm", cosDict({ Fields: cosArray(mode === "empty" ? [] : [parent]), Q: cosNumber(2), NeedAppearances: { kind: "boolean", value: true } }));
    const visible = !["none", "empty", "widgetless"].includes(mode);
    if (visible) dictSet(page.dict, "Annots", cosArray([widget]));
    const object = `${widget.objectNumber} 0 R`;
    await verify(doc.save(), version, { hasacroform: mode !== "none", needappearances: mode !== "none", fields: visible ? [{
      alternativename: "Reviewer", annotation: { annotationflags: 4, appearancestate: "/Yes", object }, choices: type === "Ch" ? ["One", "Display"] : [],
      defaultvalue: `${version === 1 ? "" : "u:"}Default`, fieldflags: flags, fieldtype: `/${type}`, fullname: "approval.reviewer",
      ischeckbox: mode === "checkbox", ischoice: mode === "choice", isradiobutton: mode === "radio", istext: mode === "text",
      mappingname: "reviewer-id", object, pageposfrom1: 2, parent: `${parent.objectNumber} 0 R`, partialname: "reviewer", quadding: 2,
      value: type === "Btn" ? "/Yes" : `${version === 1 ? "" : "u:"}Alice`
    }] : [] });
  });
}
