import assert from "node:assert/strict";
import test from "node:test";
import {PdfDocument, cosArray, cosDict, cosNumber, cosName, cosString, cosHexString, cosStream, dictSet} from "@poe-code/pdf-ast";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const version of [1, 2]) for (const metadata of [false, true]) {
  test(`${runtime} qpdf attachment JSON ${version} metadata=${metadata}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
    const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
    const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
    const fs = memory ?? shell.fs;
    try {
      for (const keys of [["F"], ["UF"], ["F", "UF"]]) {
        const doc = PdfDocument.create(); doc.addPage();
        const stream = doc.cos.allocateObject(cosStream(cosDict({Type: cosName("EmbeddedFile"), ...(metadata ? {
          Subtype: cosName("text/plain"), Params: cosDict({CheckSum: cosHexString(Uint8Array.from([0, 127, 255])),
            CreationDate: cosString("D:20261105060000-06'00'"), ModDate: cosString("D:20261105070000Z")}),
        } : {})}), new TextEncoder().encode("attached payload")));
        const names = Object.fromEntries(keys.map(key => [key, cosString(key === "UF" ? "π.txt" : "note.txt")]));
        const spec = doc.cos.allocateObject(cosDict({Type: cosName("Filespec"), ...names,
          ...(metadata ? {Desc: cosString("Attachment description")} : {}), EF: cosDict(Object.fromEntries(keys.map(key => [key, stream])))}));
        dictSet(doc.cos.resolveDict(doc.cos.rootRef), "Names", cosDict({EmbeddedFiles: cosDict({Names: cosArray([cosString("lookup-key"), spec])})}));
        dictSet(doc.cos.resolveDict(doc.cos.rootRef), "PageLabels", cosDict({Nums: cosArray([cosNumber(0), cosDict({S: cosName("D"), St: cosNumber(5), P: cosString("P2-")})])}));
        const input = doc.save(); await fs.writeFile("/in.pdf", input);
        const info = {checksum: metadata ? "007fff" : null, creationdate: metadata ? "2026-11-05T06:00:00-06:00" : null,
          modificationdate: metadata ? "2026-11-05T06:00:00-06:00" : null, mimetype: metadata ? "text/plain" : null};
        const expected = {"lookup-key": {description: metadata ? "Attachment description" : null, filespec: `${spec.objectNumber} 0 R`,
          names: Object.fromEntries(keys.map(key => [`/${key}`, key === "UF" ? "π.txt" : "note.txt"])),
          preferredcontents: `${stream.objectNumber} 0 R`, preferredname: keys.includes("UF") ? "π.txt" : "note.txt",
          streams: Object.fromEntries(keys.map(key => [`/${key}`, info]))}};
        for (const selected of ["", "--json-key=attachments"]) {
          const result = await shell.exec(`qpdf /in.pdf --json=${version} ${selected}`);
          assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
          assert.deepEqual(JSON.parse(result.stdout).attachments, expected, keys.join(","));
          if (!selected) assert.deepEqual(JSON.parse(result.stdout).pagelabels, [{index: 0, label: {"/S": "/D", "/St": 5, "/P": version === 1 ? "P2-" : "u:P2-"}}]);
        }
        const extracted = await shell.exec("qpdf /in.pdf --show-attachment=lookup-key");
        assert.equal(extracted.exitCode, 0, extracted.stderr); assert.equal(extracted.stdout, "attached payload");
        const removed = await shell.exec(`qpdf /in.pdf --remove-attachment=lookup-key /removed.pdf && qpdf /removed.pdf --json=${version} --json-key=attachments`);
        assert.equal(removed.exitCode, 0, removed.stderr); assert.deepEqual(JSON.parse(removed.stdout).attachments, {});
        assert.deepEqual(Buffer.from(await fs.readFile("/in.pdf")), Buffer.from(input));
      }
      if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
    } finally {await shell.dispose();}
  });
}

for (const runtime of ["TypeScript", "Rust"]) test(`${runtime} PDF merge retains associated attachment and page-label metadata`, {skip: !WebAssembly.Suspending}, async () => {
  const {Shell, createMemoryFileSystem, agentCommands} = await import("@poe-platform/safe-bash");
  const memory = runtime === "TypeScript" ? createMemoryFileSystem() : undefined;
  const shell = memory ? new Shell({fs: memory}).use(agentCommands()) : new RustWasmBash({cwd: "/", forceNative: true});
  const fs = memory ?? shell.fs;
  try {
    const first = PdfDocument.create(); first.addPage();
    const second = PdfDocument.create(); second.addPage([300, 200]).drawText("Part Two Body", {x: 20, y: 100, size: 12});
    const stream = second.cos.allocateObject(cosStream(new TextEncoder().encode("attached-manifest-v1")));
    const spec = second.cos.allocateObject(cosDict({Type: cosName("Filespec"), UF: cosString("manifest.txt"), EF: cosDict({UF: stream})}));
    const catalog = second.cos.resolveDict(second.cos.rootRef);
    dictSet(catalog, "AF", cosArray([spec]));
    dictSet(catalog, "PageLabels", cosDict({Nums: cosArray([cosNumber(0), cosDict({S: cosName("D"), St: cosNumber(5), P: cosString("P2-")})])}));
    await fs.writeFile("/first.pdf", first.save()); await fs.writeFile("/second.pdf", second.save());
    await fs.mkdir("/unpacked", {recursive: true});
    const merged = await shell.exec("pdfunite /first.pdf /second.pdf /united.pdf && qpdf /united.pdf --json");
    assert.equal(merged.exitCode, 0, merged.stderr);
    const json = JSON.parse(merged.stdout);
    assert.equal(json.attachments["manifest.txt"].preferredname, "manifest.txt");
    assert.equal(json.attachments["manifest.txt"].names["/UF"], "manifest.txt");
    assert.deepEqual(json.pagelabels, [{index: 1, label: {"/S": "/D", "/St": 5, "/P": "u:P2-"}}]);
    const result = await shell.exec("pdftk /united.pdf cat 1-2 output /catted.pdf && pdftk /catted.pdf unpack_files output /unpacked && pdftk /catted.pdf burst output /pg_%02d.pdf uncompress");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(Buffer.from(await fs.readFile("/unpacked/manifest.txt")).toString(), "attached-manifest-v1");
    assert.match(Buffer.from(await fs.readFile("/pg_02.pdf")).toString("latin1"), /\(Part Two Body\)/);
    if (runtime === "Rust") {assert.equal(shell.forceNative, true); assert.equal(shell._companion, null);}
  } finally {await shell.dispose();}
});
