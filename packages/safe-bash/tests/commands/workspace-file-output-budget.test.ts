import assert from "node:assert/strict";
import test from "node:test";
import { PdfDocument, encodePng } from "@poe-code/pdf-ast";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts";
import { bindFileOutputBudget } from "safe-bash-contracts/filesystem-output-budget";
import { createSpongeCommand } from "../../../safe-bash-command-sponge/src/index.js";
import { createSqlite3Command } from "../../../safe-bash-command-sqlite3/src/index.js";
import { SqliteDatabase } from "../../../safe-bash-command-sqlite3/src/engine.js";
import { createQpdfCommand } from "../../../safe-bash-command-qpdf/src/index.js";
import { createSofficeCommand } from "../../../safe-bash-command-soffice/src/index.js";
import { createMmdcCommand } from "../../../safe-bash-command-mmdc/src/index.js";
import { createPdfimagesCommand } from "../../../safe-bash-command-pdfimages/src/index.js";
import { createPdfuniteCommand, createPdfseparateCommand } from "../../../safe-bash-command-pdfinfo/src/index.js";
import { createPdftkCommand } from "../../../safe-bash-command-pdftk/src/index.js";
import { createPdftoppmCommand, createPdftocairoCommand } from "../../../safe-bash-command-pdftoppm/src/index.js";
import { createPdftotextCommand, createPdftohtmlCommand } from "../../../safe-bash-command-pdftotext/src/index.js";
import { createSipsCommand } from "../../../safe-bash-command-sips/src/index.js";
import { createConvertCommand } from "../../../safe-bash-command-imagemagick/src/index.js";
import { createFfmpegCommand } from "../../../safe-bash-command-ffmpeg/src/index.js";
import { createHostnameCommand } from "../../../safe-bash-command-hostname/src/index.js";
import { mikeYqCommands } from "../../../safe-bash-command-yq/src/mike.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { csvkitCommands } from "../../src/commands/csvkit/index.js";
import workbook from "../../../../docs/csvkit/in2csv-workbook-package-reference.json" with { type: "json" };

const encoder = new TextEncoder();
const document = PdfDocument.create();
const page = document.addPage([20, 20]);
page.drawText("Hi", { x: 1, y: 1, size: 6 });
page.drawImage(document.embedRgbImage(1, 1, new Uint8Array([255, 0, 0])), { x: 10, y: 10, width: 2, height: 2 });
const fixtures: Record<string, Uint8Array> = {
  "/in.pdf": document.save(),
  "/in.png": encodePng({ width: 1, height: 1, data: new Uint8Array([255, 0, 0, 255]) }),
  "/in.mp4": createSyntheticMp4({ width: 2, height: 2, fps: 1, frameCount: 2 }),
  "/in.csv": encoder.encode("name,count\nexample,1\n"),
  "/in.mmd": encoder.encode("flowchart TD; A --> B"),
  "/out": encoder.encode("old"),
};

function createSqliteWithoutSerializer(): CommandDefinition {
  const database = new SqliteDatabase();
  return createSqlite3Command({ engine: { exec: database.exec.bind(database) } });
}

const cases: [string, () => CommandDefinition, string[], string?][] = [
  ["sponge overwrite", createSpongeCommand, ["/out"], "é🌊"],
  ["sponge append", createSpongeCommand, ["-a", "/out"], "é🌊"],
  ["sqlite persistence", createSqlite3Command, ["/db", "CREATE TABLE t (a); INSERT INTO t VALUES (1);"]],
  ["sqlite once", createSqlite3Command, [":memory:"], ".once /out\nSELECT 123;\n"],
  ["sqlite output", createSqlite3Command, [":memory:"], ".output /out\nSELECT 123;\nSELECT 456;\n"],
  ["sqlite save", createSqlite3Command, [":memory:"], "CREATE TABLE t (a);\n.save /db\n"],
  ["sqlite backup", createSqlite3Command, [":memory:"], "CREATE TABLE t (a);\n.backup /db\n"],
  ["sqlite injected persistence", createSqliteWithoutSerializer, ["/db", "CREATE TABLE t (a); INSERT INTO t VALUES (1);"]],
  ["sqlite injected save", createSqliteWithoutSerializer, [":memory:"], "CREATE TABLE t (a);\n.save /db\n"],
  ["sqlite injected backup", createSqliteWithoutSerializer, [":memory:"], "CREATE TABLE t (a);\n.backup /db\n"],
  ["qpdf", createQpdfCommand, ["/in.pdf", "/out.pdf"]],
  ["soffice", createSofficeCommand, ["--convert-to", "txt", "/in.csv"]],
  ["mmdc conditional", createMmdcCommand, ["-i", "/in.mmd", "-o", "/out.svg"]],
  ["mmdc non-enumerable budget owner", createMmdcCommand, ["-i", "/in.mmd", "-o", "/out.svg"]],
  ["mmdc publish", createMmdcCommand, ["-i", "/in.mmd", "-o", "/out.svg"]],
  ["mmdc fallback", createMmdcCommand, ["-i", "/in.mmd", "-o", "/out.svg"]],
  ["pdfimages", createPdfimagesCommand, ["-png", "/in.pdf", "/image"]],
  ["pdfunite", createPdfuniteCommand, ["/in.pdf", "/in.pdf", "/out.pdf"]],
  ["pdfseparate", createPdfseparateCommand, ["/in.pdf", "/page-%d.pdf"]],
  ["pdftk", createPdftkCommand, ["/in.pdf", "cat", "output", "/out.pdf"]],
  ["pdftoppm", createPdftoppmCommand, ["-r", "12", "/in.pdf", "/page"]],
  ["pdftocairo", createPdftocairoCommand, ["-png", "-r", "12", "/in.pdf", "/page"]],
  ["pdftotext", createPdftotextCommand, ["/in.pdf", "/out.txt"]],
  ["pdftohtml", createPdftohtmlCommand, ["/in.pdf", "/out.html"]],
  ["sips", createSipsCommand, ["-s", "format", "bmp", "/in.png", "--out", "/out.bmp"]],
  ["imagemagick", createConvertCommand, ["/in.png", "/out.bmp"]],
  ["ffmpeg file", createFfmpegCommand, ["-i", "/in.mp4", "-c", "copy", "/out.mp4"]],
  ["ffmpeg segments", createFfmpegCommand, ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "/index.m3u8"]],
  ["ffmpeg images", createFfmpegCommand, ["-i", "/in.png", "/frame-%d.png"]],
  ["hostname", () => createHostnameCommand({ allowSet: true }), ["example"]],
];

for (const [name, create, args, input = ""] of cases) {
  test(`${name} charges file output once and rejects writes beyond the shared budget`, async () => {
    async function run(limit: number) {
      const fs = createMemoryFileSystem();
      // PDF commands use caller-provided scratch storage, separate from output.
      await fs.mkdir("/tmp");
      for (const [path, bytes] of Object.entries(fixtures)) await fs.writeFile(path, bytes);
      if (name === "mmdc publish" || name === "mmdc fallback") Object.defineProperty(fs, "writeFileConditional", { value: undefined });
      if (name === "mmdc fallback") Object.defineProperty(fs, "publishFileConditional", { value: undefined });
      let written = 0, charged = 0, attempts = 0;
      for (const method of ["writeFile", "appendFile", "writeFileConditional"] as const) {
        const original = fs[method]?.bind(fs);
        if (!original) continue;
        Object.defineProperty(fs, method, { configurable: true, value: async (path: string, bytes: Uint8Array, options: never) => {
          const result = await original(path, bytes, options);
          if (!path.startsWith("/tmp/")) written += bytes.length;
          return result;
        } });
      }
      const open = fs.open.bind(fs);
      Object.defineProperty(fs, "open", { configurable: true, value: async (...args: Parameters<typeof fs.open>) => {
        const handle = await open(...args);
        if (args[0].startsWith("/tmp/")) return handle;
        return new Proxy(handle, { get(target, key) {
          if (key === "write") return async (...args: Parameters<typeof handle.write>) => {
            const count = await handle.write(...args); written += count; return count;
          };
          const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
        } });
      } });
      const stage = fs.createStagedFile.bind(fs);
      Object.defineProperty(fs, "createStagedFile", { configurable: true, value: async (...args: Parameters<typeof fs.createStagedFile>) => {
        const staged = await stage(...args);
        if (args[0].startsWith("/tmp/")) return staged;
        if (args[2].type === "file") written += args[2].data.length;
        const writer = staged.writer;
        if (!writer) return staged;
        return { ...staged, writer: { ...writer, async write(...args: Parameters<typeof writer.write>) {
          await writer.write(...args); written += args[0].length;
        } } };
      } });
      const stream = fs.writeStream.bind(fs);
      Object.defineProperty(fs, "writeStream", { configurable: true, value: async (path: string, source: Parameters<typeof fs.writeStream>[1], options: Parameters<typeof fs.writeStream>[2]) => {
        await stream(path, (async function* () { for await (const bytes of source) { yield bytes; if (!path.startsWith("/tmp/")) written += bytes.length; } })(), options);
      } });
      const errors: string[] = [];
      const carrier = createCommandArguments(args);
      const context: CommandContext = {
        command: create().name, args: carrier.args, argumentValues: carrier, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, registerCleanup() {},
        stdin: (async function* () { yield encoder.encode(input); })(),
        stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } },
      };
      if (name === "mmdc non-enumerable budget owner") Object.defineProperty(context, "registerCleanup", { enumerable: false });
      bindFileOutputBudget(context, sink => ({ async write(bytes) {
        attempts++;
        if (bytes.length > limit - charged) throw new Error("bound file-output budget exceeded");
        charged += bytes.length;
        await sink.write(bytes);
      } }), async (bytes, write) => {
        attempts++;
        if (bytes.length > limit - charged) throw new Error("bound file-output budget exceeded");
        const count = await write(); charged += count; return count;
      });
      let exitCode: number | undefined;
      try { exitCode = (await create().execute(context)).exitCode; }
      catch (error) { errors.push(String(error)); }
      return { charged, written, attempts, exitCode, errors: errors.join(""), fs };
    }
    const success = await run(Infinity);
    assert.equal(success.exitCode, 0, success.errors);
    assert.ok(success.charged > 0, "file output must reach the bound budget");
    assert.equal(success.charged, success.written, "each output byte is charged once");
    if (name === "sponge append" || name === "sponge overwrite") {
      assert.equal(new TextDecoder().decode(await success.fs.readFile("/out")), name === "sponge append" ? "oldé🌊" : "é🌊");
      assert.equal(success.charged, 6, "existing file content must not consume the append budget");
    }
    if (name === "sqlite output") {
      assert.equal(new TextDecoder().decode(await success.fs.readFile("/out")), "123\n456\n");
      assert.equal(success.charged, 8, "each statement must consume only its new output bytes");
    }
    if (name.startsWith("sqlite injected")) {
      const saved = new SqliteDatabase();
      saved.loadFromBytes(await success.fs.readFile("/db"));
      assert.ok(saved.tables.has("t"), "fallback persistence must retain the schema");
      if (name === "sqlite injected persistence") assert.deepEqual(saved.exec("SELECT a FROM t;")[0]!.rows, [[1]]);
    }
    const denied = await run(0);
    assert.ok(denied.attempts > 0, "the bound budget must be consulted");
    assert.equal(denied.charged, 0);
    assert.equal(denied.written, 0, "denied data must not reach the filesystem");
    const partial = await run(success.charged - 1);
    assert.ok(partial.charged < success.charged);
    assert.ok(partial.written <= partial.charged);
  });
}

for (const source of ["yq -i '.a = 2' /input", "yq --split-exp '\"out\"' '.a = 2' /input"]) {
  test(`${source} preserves counted file budgets`, async () => {
    for (const maxOutputBytes of [4, 5]) {
      const fs = createMemoryFileSystem();
      await fs.writeFile("/input", encoder.encode("a: 1\n"));
      const shell = new Shell({ fs, limits: { maxOutputBytes } }).use(mikeYqCommands());
      try {
        if (maxOutputBytes === 4) {
          await assert.rejects(shell.exec(source), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
          assert.equal(new TextDecoder().decode(await fs.readFile("/input")), "a: 1\n");
          if (source.includes("-i ")) await assert.rejects(fs.readFile("/out.yml"));
          else assert.equal((await fs.readFile("/out.yml")).length, 0, "denied split output must stay empty");
        } else {
          const result = await shell.exec(source);
          assert.equal(result.exitCode, 0, result.stderr);
          const output = source.includes("-i ") ? "/input" : "/out.yml";
          assert.equal(new TextDecoder().decode(await fs.readFile(output)), "a: 2\n");
        }
      } finally { await shell.dispose(); }
    }
  });
}

for (const descriptors of [true, false]) {
  test(`csvkit side-file ${descriptors ? "streaming" : "buffered"} adapter enforces shell output budgets`, async () => {
    const fs = createMemoryFileSystem();
    if (!descriptors) Object.defineProperty(fs, "open", { value: undefined });
    await fs.writeFile("/book.xlsx", Uint8Array.from(Buffer.from(workbook.binary.relocated, "base64")));
    const shell = new Shell({ fs, limits: { maxOutputBytes: 0 } }).use(csvkitCommands());
    try {
      await assert.rejects(shell.exec("in2csv -f xlsx --write-sheets - /book.xlsx"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
      for (const entry of await fs.readdir("/")) {
        if (entry.name.endsWith(".csv")) assert.equal((await fs.readFile("/" + entry.name)).length, 0);
      }
    } finally { await shell.dispose(); }
  });
}
