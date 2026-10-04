import {readFileSync, readdirSync, existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createContext, runInContext} from "node:vm";
import {createFsFromVolume, Volume} from "memfs";
import {build} from "esbuild";
import ts from "typescript";
import {expect, it} from "vitest";
import {packageSafeLibraries} from "./package-safe.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

it("packs the retained Soffice file SDK with canonical filesystem types and no private runtime imports", async () => {
  const volume = new Volume();
  const write = (filename: string, bytes: string | Uint8Array) => {
    volume.mkdirSync(path.dirname(filename), {recursive: true});
    volume.writeFileSync(filename, bytes);
  };
  const copy = (source: string, target: string): void => {
    for (const entry of readdirSync(source, {withFileTypes: true})) {
      if (entry.isDirectory()) copy(path.join(source, entry.name), path.join(target, entry.name));
      else write(path.join(target, entry.name), readFileSync(path.join(source, entry.name)));
    }
  };
  const rootManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  write("/repo/package.json", JSON.stringify({license: "MIT", dependencies: rootManifest.dependencies, devDependencies: rootManifest.devDependencies}));
  // Root shell/interpreter entries are fixtures; Soffice and its dependency closure are built artifacts.
  for (const name of ["safe-js", "safe-bash"]) {
    const exports: Record<string, {types: string; import: string}> = {".": {types: "./dist/index.d.ts", import: "./dist/index.js"}};
    if (name === "safe-bash") exports["./commands/soffice"] = {types: "./dist/commands/soffice/index.d.ts", import: "./dist/commands/soffice/index.js"};
    write(`/repo/packages/${name}/package.json`, JSON.stringify({name: `@poe-code/${name}`, private: true, type: "module", exports, devDependencies: name === "safe-bash" ? {"safe-bash-command-soffice": "*"} : {}}));
    write(`/repo/packages/${name}/README.md`, `# ${name}\n`);
    for (const extension of ["js", "d.ts"]) {
      write(`/repo/packages/${name}/dist/index.${extension}`, "export {};\n");
      if (name === "safe-bash") write(`/repo/packages/${name}/dist/commands/soffice/index.${extension}`,
        'export * from "safe-bash-command-soffice";\n');
    }
  }
  const workspaces = new Map<string, {directory: string; manifest: Record<string, unknown>}>();
  for (const name of readdirSync(path.join(root, "packages"))) {
    const filename = path.join(root, "packages", name, "package.json");
    if (!existsSync(filename)) continue;
    const manifest = JSON.parse(readFileSync(filename, "utf8"));
    workspaces.set(manifest.name, {directory: name, manifest});
  }
  const pendingWorkspaces = ["safe-bash-command-soffice"], copied = new Set<string>();
  while (pendingWorkspaces.length) {
    const workspace = pendingWorkspaces.shift()!;
    if (copied.has(workspace)) continue;
    copied.add(workspace);
    const selected = workspaces.get(workspace)!;
    for (const dependency of Object.keys({...selected.manifest.dependencies as object, ...selected.manifest.devDependencies as object}))
      if (workspaces.has(dependency)) pendingWorkspaces.push(dependency);
    const name = selected.directory;
    const directory = path.join(root, "packages", name);
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    if (name === "safe-fs") manifest.exports = Object.fromEntries(["./contracts", "./storage", "./core", "./xml"].map(route => [route, manifest.exports[route]]));
    write(`/repo/packages/${name}/package.json`, JSON.stringify(manifest));
    write(`/repo/packages/${name}/README.md`, readFileSync(path.join(directory, "README.md")));
    copy(path.join(directory, "dist"), `/repo/packages/${name}/dist`);
    if (existsSync(path.join(directory, "src"))) copy(path.join(directory, "src"), `/repo/packages/${name}/src`);
    if (name === "safe-fs") {
      copy(path.join(directory, "native"), `/repo/packages/${name}/native`);
      copy(path.join(directory, "src/native"), `/repo/packages/${name}/src/native`);
    }
    for (const notice of manifest.poeCode?.safeLibraryNotices?.["safe-bash"] ?? []) write(`/repo/packages/${name}/${notice}`, readFileSync(path.join(directory, notice)));
  }
  await packageSafeLibraries({rootDir: "/repo", outDir: "/output", version: "0.1.0", files: createFsFromVolume(volume).promises, bundle: async () => ({outputFiles: []})});
  const manifests = Object.fromEntries(["safe-fs", "safe-bash"].map(name => [name, JSON.parse(volume.readFileSync(`/output/${name}/package.json`, "utf8").toString())]));
  for (const manifest of Object.values(manifests)) expect(Object.keys(manifest.dependencies)).not.toContain("@poe-code/safe-fs");
  volume.mkdirSync("/node_modules/@poe-platform", {recursive: true});
  for (const name of ["safe-fs", "safe-bash"]) volume.symlinkSync(`/output/${name}`, `/node_modules/@poe-platform/${name}`);
  write("/consumer.mts", 'import {runSofficeFileCli} from "@poe-platform/safe-bash/commands/soffice"; import type {FileSystem} from "@poe-platform/safe-fs/contracts"; import {createEngine} from "@poe-platform/safe-bash/ssconvert/core"; createEngine().transcode({input: {kind: "stream", source: []}, destination: {kind: "stream", sink: {async write(bytes: Uint8Array) {}}}, exportType: "csv"}, {signal: new AbortController().signal}); declare const filesystem: FileSystem; runSofficeFileCli(["--cat", "/input.txt"], {filesystem, stdout: {async write(bytes: Uint8Array) {}}, stderr: {async write(bytes: Uint8Array) {}}});');
  const compilerOptions: ts.CompilerOptions = {strict: true, noEmit: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, customConditions: ["workerd"]};
  const host = ts.createCompilerHost(compilerOptions);
  // Only TypeScript standard libraries may escape the published in-memory installation.
  const standardRead = host.readFile;
  const standardExists = host.fileExists;
  const libraries = path.dirname(ts.getDefaultLibFilePath(compilerOptions)) + path.sep;
  host.readFile = filename => filename.startsWith(libraries) ? standardRead(filename) : volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined;
  host.fileExists = filename => filename.startsWith(libraries) ? standardExists(filename) : volume.existsSync(filename);
  host.directoryExists = filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory();
  host.realpath = filename => volume.realpathSync(filename).toString();
  host.getCurrentDirectory = () => "/";
  const program = ts.createProgram(["/consumer.mts"], compilerOptions, host);
  expect(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  const pending = Object.values(manifests).flatMap(manifest => Object.keys(manifest.dependencies ?? {}));
  const installed = new Set<string>();
  while (pending.length) {
    const name = pending.shift()!;
    if (name.startsWith("@poe-platform/") || installed.has(name)) continue;
    installed.add(name);
    const directory = path.join(root, "node_modules", name);
    const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    copy(directory, "/installed/" + name);
    pending.push(...Object.keys(manifest.dependencies ?? {}));
  }
  write("/consumer.js", 'export {runSofficeFileCli, createStoredZipArchive, readZipArchiveEntries} from "@poe-platform/safe-bash/commands/soffice"; export {MemoryFileSystem} from "@poe-platform/safe-fs/core";');
  const select = (value: unknown): string => {
    if (typeof value === "string") return value;
    for (const condition of ["workerd", "browser", "import", "default"]) {
      const target = (value as Record<string, unknown>)[condition];
      if (target !== undefined) return select(target);
    }
    throw new Error("No portable export: " + JSON.stringify(value));
  };
  const result = await build({entryPoints: ["/consumer.js"], bundle: true, write: false, platform: "browser", format: "cjs", metafile: true,
    plugins: [{name: "published-soffice-only", setup(builder) {
      builder.onResolve({filter: /.*/}, args => {
        let target: string;
        if (args.path.startsWith(".") || args.path.startsWith("/")) target = path.resolve(args.resolveDir, args.path);
        else if (args.path.startsWith("#safe-fs-")) target = path.resolve("/output/safe-fs", select(manifests["safe-fs"].imports[args.path]));
        else {
          const segments = args.path.split("/");
          const name = segments.splice(0, args.path.startsWith("@") ? 2 : 1).join("/");
          const directory = name.startsWith("@poe-platform/") ? "/output/" + name.split("/")[1] : "/installed/" + name;
          const manifest = JSON.parse(volume.readFileSync(directory + "/package.json", "utf8").toString());
          const route = segments.length ? "./" + segments.join("/") : ".";
          if (manifest.exports !== undefined) target = path.resolve(directory, select(route === "." && !Object.keys(manifest.exports).some(key => key.startsWith(".")) ? manifest.exports : manifest.exports[route]));
          else {
            const entry = path.resolve(directory, segments.length ? segments.join("/") : manifest.main ?? "index.js");
            const resolved = [entry, entry + ".js", path.join(entry, "index.js")].find(filename => volume.existsSync(filename) && volume.statSync(filename).isFile());
            if (resolved === undefined) throw new Error("Missing installed package entry: " + args.path);
            target = resolved;
          }
        }
        return {path: target, namespace: "packed"};
      });
      builder.onLoad({filter: /.*/, namespace: "packed"}, args => ({contents: volume.readFileSync(args.path, "utf8").toString(), resolveDir: path.dirname(args.path)}));
    }}]});
  expect(Object.values(result.metafile!.outputs).flatMap(output => output.imports)).toEqual([]);
  const module = {exports: {} as {createStoredZipArchive: typeof import("../packages/safe-bash-command-soffice/src/index.js").createStoredZipArchive; runSofficeFileCli: typeof import("../packages/safe-bash-command-soffice/src/index.js").runSofficeFileCli; readZipArchiveEntries: typeof import("../packages/safe-bash-command-soffice/src/index.js").readZipArchiveEntries; MemoryFileSystem: typeof import("../packages/safe-fs/src/core.js").MemoryFileSystem}};
  runInContext("(function(module, exports) {\n" + result.outputFiles[0]!.text + "\n})(module, module.exports);", createContext({module, exports: module.exports, Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, AbortSignal, AbortController, structuredClone, ReadableStream, WritableStream, TransformStream, queueMicrotask, setTimeout, clearTimeout, crypto: globalThis.crypto}));
  const {runSofficeFileCli, createStoredZipArchive, readZipArchiveEntries, MemoryFileSystem} = module.exports;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.md", new TextEncoder().encode("# Packed document\nCaller-backed text"));
  const filesystem = new Proxy(fs, {get(target, key) {
    if (key === "readFile" || key === "writeFile") return () => {throw new Error("whole-file fallback forbidden");};
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  }});
  for (const format of ["html", "docx", "pdf"]) {
    const result = await runSofficeFileCli(["--convert-to", format, "/input.md"], {filesystem, stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(result.exitCode).toBe(0);
    const bytes = await fs.readFile("/input." + format);
    const text = new TextDecoder().decode(format === "docx" ? readZipArchiveEntries(bytes).get("word/document.xml") : bytes);
    expect(text).toContain(format === "pdf" ? "%PDF-1.7" : "Packed document");
  }
  await fs.writeFile("/office.odt", createStoredZipArchive({"content.xml": new TextEncoder().encode("<office><text:p>Packed &amp; retained</text:p></office>")}));
  let output = "";
  const extracted = await runSofficeFileCli(["--cat", "/office.odt"], {filesystem,
    stdout: {async write(bytes) {output += new TextDecoder().decode(bytes);}},
    stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(extracted.exitCode).toBe(0); expect(output).toBe("Packed & retained\n");
  const converted = await runSofficeFileCli(["--convert-to", "html", "/office.odt"], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(converted.exitCode).toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/office.html"))).toContain("<p>Packed &amp; retained</p>");
  const docx = await runSofficeFileCli(["--convert-to", "docx", "/office.odt"], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(docx.exitCode).toBe(0);
  expect(new TextDecoder().decode(readZipArchiveEntries(await fs.readFile("/office.docx")).get("word/document.xml"))).toContain("<w:t>Packed &amp; retained</w:t>");
  const pdf = await runSofficeFileCli(["--convert-to", "pdf", "/office.odt"], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(pdf.exitCode).toBe(0);
  expect(new TextDecoder().decode((await fs.readFile("/office.pdf")).subarray(0, 8))).toBe("%PDF-1.7");
  await fs.writeFile("/book.xlsx", createStoredZipArchive({
    "xl/worksheets/sheet1.xml": new TextEncoder().encode('<worksheet><row><c t="s"><v>0</v></c></row></worksheet>'),
    "xl/sharedStrings.xml": new TextEncoder().encode("<sst><si><t>Packed spreadsheet</t></si></sst>")
  }));
  let sheetText = "";
  const sheet = await runSofficeFileCli(["--cat", "/book.xlsx"], {filesystem,
    stdout: {async write(bytes) {sheetText += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(sheet.exitCode).toBe(0); expect(sheetText).toBe("Packed spreadsheet\n");
  const sheetConversion = await runSofficeFileCli(["--convert-to", "txt", "/book.xlsx"], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(sheetConversion.exitCode).toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/book.txt"))).toBe("Packed spreadsheet\n");
  for (const input of ["/book.xlsx", "/book.csv"]) for (const format of ["html", "docx", "pdf", "csv", "xlsx"]) {
    const converted = await runSofficeFileCli(["--convert-to", format, input], {filesystem,
      stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(converted.exitCode).toBe(0);
    const bytes = await fs.readFile("/book." + format);
    const text = new TextDecoder().decode(format === "docx" ? readZipArchiveEntries(bytes).get("word/document.xml") : format === "xlsx" ? readZipArchiveEntries(bytes).get("xl/worksheets/sheet1.xml") : bytes);
    expect(text).toContain(format === "pdf" ? "%PDF-1.7" : "Packed spreadsheet");
  }
  for (const format of ["csv", "xlsx"]) {
    const converted = await runSofficeFileCli(["--convert-to", format, "/input.md"], {filesystem,
      stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(converted.exitCode).toBe(0);
    const bytes = await fs.readFile("/input." + format);
    expect(new TextDecoder().decode(format === "xlsx" ? readZipArchiveEntries(bytes).get("xl/worksheets/sheet1.xml") : bytes)).toContain("Packed document");
  }
  for (const format of ["html", "docx", "pdf"]) {
    const converted = await runSofficeFileCli(["--convert-to", format, "/input.docx"], {filesystem,
      stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(converted.exitCode).toBe(0);
    const bytes = await fs.readFile("/input." + format);
    expect(new TextDecoder().decode(format === "docx" ? readZipArchiveEntries(bytes).get("word/document.xml") : bytes)).toContain(format === "pdf" ? "%PDF-1.7" : "Packed document");
  }
  await fs.writeFile("/slides.pptx", createStoredZipArchive({"ppt/slides/slide1.xml": new TextEncoder().encode("<p:sp><a:p><a:t>Packed slides</a:t></a:p></p:sp>")}));
  for (const format of ["txt", "html", "docx", "pdf"]) {
    const result = await runSofficeFileCli(["--convert-to", format, "/slides.pptx"], {filesystem, stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(result.exitCode).toBe(0);
    const bytes = await fs.readFile("/slides." + format);
    expect(new TextDecoder().decode(format === "docx" ? readZipArchiveEntries(bytes).get("word/document.xml") : bytes)).toContain(format === "pdf" ? "%PDF-1.7" : "Packed slides");
  }
  let docxText = "";
  const docxCat = await runSofficeFileCli(["--cat", "/input.docx"], {filesystem,
    stdout: {async write(bytes) {docxText += new TextDecoder().decode(bytes);}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(docxCat.exitCode).toBe(0); expect(docxText).toContain("Packed document");
  const docxTextConversion = await runSofficeFileCli(["--convert-to", "txt", "/input.docx"], {filesystem,
    stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
  expect(docxTextConversion.exitCode).toBe(0);
  expect(new TextDecoder().decode(await fs.readFile("/input.txt"))).toContain("Caller-backed text");
  await fs.writeFile("/scalar.ods", createStoredZipArchive({"content.xml": new TextEncoder().encode(
    '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet><table:table table:name="Data"><table:table-row table:number-rows-repeated="100"><table:table-cell office:value-type="string"><text:p>Packed ODS</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>')}));
  for (const format of ["csv", "xlsx"]) {
    const result = await runSofficeFileCli(["--convert-to", format, "/scalar.ods"], {filesystem,
      stdout: {async write() {}}, stderr: {async write(bytes) {throw new Error(new TextDecoder().decode(bytes));}}});
    expect(result.exitCode).toBe(0);
    const bytes = await fs.readFile("/scalar." + format);
    if (format === "csv") expect(new TextDecoder().decode(bytes)).toBe('"Packed ODS"\n'.repeat(100));
    else expect(new TextDecoder().decode(readZipArchiveEntries(bytes).get("xl/sharedStrings.xml"))).toContain("Packed ODS");
  }
  expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["book.csv", "book.docx", "book.html", "book.pdf", "book.txt", "book.xlsx", "input.csv", "input.docx", "input.html", "input.md", "input.pdf", "input.txt", "input.xlsx", "office.docx", "office.html", "office.odt", "office.pdf", "scalar.csv", "scalar.ods", "scalar.xlsx", "slides.docx", "slides.html", "slides.pdf", "slides.pptx", "slides.txt"]);
});
