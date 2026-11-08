import { retainedRotations } from "./retained-rotate.js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments } from "safe-bash-contracts";
import { createPdftkCommand, runPdftkCli } from "./index.js";

it.each([[], ["1-endeast"], ["end-1left"], ["1-endevenright"], ["1-endeastodd"], ["1right", "1right"], ["1right", "1north"], ["Bendwest"], ["r2south"], ["garbagenorth"]].map(ranges => ({ ranges })))("streams rotation $ranges with exact legacy bytes", async ({ ranges }) => {
  const doc = PdfDocument.create(); for (let i = 0; i < 5; i++) { const page = doc.addPage(); page.drawText(`Page ${i}`, { x: 10, y: 20 }); page.setRotation(([0, 90, 180, 270] as const)[i % 4]!); }
  const other = PdfDocument.create(); other.addPage(); other.addPage();
  const input = doc.save(), secondary = other.save(), args = ["A=in.pdf", "B=other.pdf", "rotate", ...ranges, "output", "out.pdf"];
  const files = new Map([["in.pdf", input], ["other.pdf", secondary]]), expected = await runPdftkCli(args, files);
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); await fs.writeFile("/in.pdf", input); await fs.writeFile("/other.pdf", secondary);
  const guarded = new Proxy(fs, { get(owner, key) { if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); }; const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value; } });
  const carrier = createCommandArguments(args); let stderr = "";
  const result = await createPdftkCommand().execute({ command: "pdftk", args: carrier.args, argumentValues: carrier, cwd: "/", env: { TMPDIR: "/scratch" }, fs: guarded, signal: new AbortController().signal, stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
  expect(result.exitCode).toBe(expected.exitCode); expect(stderr).toBe(expected.stderr); expect(await fs.readFile("/out.pdf")).toEqual(files.get("out.pdf")); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each([8192, 16384])("stages %i rotations with bounded caller writes and last-selection wins", async pageCount => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); let writes = 0, outstanding = 0;
  const guarded = new Proxy(fs, { get(owner, key) {
    if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file I/O forbidden"); };
    if (key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) {
        if (prop === "write") return async (...args: Parameters<NonNullable<typeof handle.write>>) => {
          expect(outstanding).toBe(0); outstanding += args[0].byteLength; expect(args[0].buffer.byteLength).toBeLessThanOrEqual(65536); writes++;
          try { await Promise.resolve(); return await handle.write!(...args); } finally { outstanding -= args[0].byteLength; }
        };
        const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value;
      } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  let count = 0;
  for await (const rotation of retainedRotations(["1-endright", "1-endevenwest"], new Map([["", { pageCount }]]), "", pageCount, { fs: guarded, directory: "/scratch" }, new AbortController().signal)) {
    expect(rotation).toEqual({ pageIndex: count, degrees: count % 2 ? 270 : 90, relative: count % 2 === 0 }); count++; await Promise.resolve();
  }
  expect(count).toBe(pageCount); expect(writes).toBeGreaterThan(0); expect(await fs.readdir("/scratch")).toEqual([]);
});

it.each(["cancel", "return", "write"])("closes rotation backing after %s", async mode => {
  const fs = createMemoryFileSystem(); await fs.mkdir("/scratch"); const controller = new AbortController(), reason = new Error("rotation failure");
  const guarded = new Proxy(fs, { get(owner, key) {
    if (mode === "write" && key === "open") return async (...args: Parameters<NonNullable<typeof fs.open>>) => {
      const handle = await fs.open!(...args); return new Proxy(handle, { get(target, prop) { if (prop === "write") return async () => { throw reason; }; const value = Reflect.get(target, prop); return typeof value === "function" ? value.bind(target) : value; } });
    };
    const value = Reflect.get(owner, key); return typeof value === "function" ? value.bind(owner) : value;
  } });
  const rotations = retainedRotations(["1-endright"], new Map([["", { pageCount: 10000 }]]), "", 10000, { fs: guarded, directory: "/scratch" }, controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (mode === "cancel") timer = setTimeout(() => controller.abort(reason), 0);
    if (mode === "return") { expect((await rotations.next()).done).toBe(false); await rotations.return(); }
    else await expect(rotations.next()).rejects.toBe(reason);
  } finally { clearTimeout(timer); await rotations.return(); }
  expect(await fs.readdir("/scratch")).toEqual([]);
});
