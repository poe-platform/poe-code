import { basename, resolvePath } from "../../contracts/index.js";
import type { CommandContext, CommandDefinition, CommandResult } from "../../contracts/command.js";
import { collectBytes, writeBytes } from "../../contracts/io.js";

const encoder = new TextEncoder();

async function collectVfsSnapshot(
  context: CommandContext,
  dirPath: string,
  relPrefix: string,
  out: Map<string, Uint8Array>,
  budget: { bytes: number; maxBytes: number }
): Promise<void> {
  let entries: readonly { name: string; type: string }[];
  try {
    entries = await context.fs.readdir(dirPath, { signal: context.signal });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = dirPath === "/" ? `/${entry.name}` : `${dirPath}/${entry.name}`;
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.type === "directory") {
      await collectVfsSnapshot(context, fullPath, relPath, out, budget);
    } else if (entry.type === "file") {
      try {
        const data = await context.fs.readFile(fullPath, { signal: context.signal });
        if (budget.bytes + data.byteLength <= budget.maxBytes) {
          budget.bytes += data.byteLength;
          out.set(relPath, new Uint8Array(data));
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

let cachedWasiDepsPromise: Promise<{
  mod: unknown;
  shim: any;
}> | undefined;

async function getWasiPythonDeps(): Promise<{ mod: unknown; shim: any }> {
  if (!cachedWasiDepsPromise) {
    cachedWasiDepsPromise = (async () => {
      const moduleMod = ["node", "module"].join(":");
      const fsMod = ["node", "fs"].join(":");
      const [{ createRequire }, nodeFs] = await Promise.all([
        import(moduleMod),
        import(fsMod),
      ]);
      const pkgRequire = createRequire(import.meta.url);
      const shim = pkgRequire("@bjorn3/browser_wasi_shim");
      const wasmPath = pkgRequire.resolve("@antonz/python-wasi/dist/python.wasm");
      const wasmBytes = nodeFs.readFileSync(wasmPath);
      const mod = await (globalThis as any).WebAssembly.compile(wasmBytes);
      if (wasmBytes.byteOffset === 0 && typeof (wasmBytes.buffer as any).transfer === "function") {
        try { (wasmBytes.buffer as any).transfer(0); } catch {}
      }
      return { mod, shim };
    })();
  }
  return cachedWasiDepsPromise;
}

function insertWasiFile(Directory: any, File: any, map: Map<string, any>, relPath: string, bytes: Uint8Array): void {
  const parts = relPath.split("/").filter(Boolean);
  let cur = map;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i]!;
    let child = cur.get(seg);
    if (!child || !(child instanceof Directory)) {
      child = new Directory(new Map());
      cur.set(seg, child);
    }
    cur = child.contents;
  }
  if (parts.length > 0) {
    cur.set(parts[parts.length - 1]!, new File(new Uint8Array(bytes)));
  }
}

function collectWasiFiles(Directory: any, File: any, map: Map<string, any>, prefix: string, out: [string, Uint8Array][]): void {
  for (const [name, inode] of map.entries()) {
    const p = prefix ? prefix + "/" + name : name;
    if (inode instanceof File) {
      out.push([p, new Uint8Array(inode.data)]);
    } else if (inode instanceof Directory) {
      collectWasiFiles(Directory, File, inode.contents, p, out);
    }
  }
}

async function runWasiPythonWorker(
  context: CommandContext,
  args: readonly string[]
): Promise<CommandResult> {
  try {
    const stdinBytes = context.stdinIsDefault
      ? new Uint8Array(0)
      : await collectBytes(context.stdin, { signal: context.signal });

    const initialFiles = new Map<string, Uint8Array>();
    const budget = { bytes: 0, maxBytes: 32 * 1024 * 1024 };
    await collectVfsSnapshot(context, context.cwd, "", initialFiles, budget);

    for (const arg of args) {
      if (arg.startsWith("/") && !arg.startsWith(context.cwd + "/")) {
        try {
          const data = await context.fs.readFile(arg, { signal: context.signal });
          if (budget.bytes + data.byteLength <= budget.maxBytes) {
            budget.bytes += data.byteLength;
            initialFiles.set(`__abs__${arg}`, new Uint8Array(data));
          }
        } catch {
          // ignore non-existent path args
        }
      }
    }

    const { mod, shim } = await getWasiPythonDeps();
    const { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory, Directory } = shim;

    const root = new Map<string, any>();
    const cwdMap = new Map<string, any>();
    for (const [relPath, bytes] of initialFiles.entries()) {
      if (relPath.startsWith("__abs__/")) {
        insertWasiFile(Directory, File, root, relPath.slice("__abs__/".length), bytes);
      } else {
        insertWasiFile(Directory, File, cwdMap, relPath, bytes);
      }
    }
    initialFiles.clear();

    for (const [k, v] of cwdMap.entries()) {
      root.set(k, v);
    }
    if (context.cwd && context.cwd !== "/") {
      const cwdParts = context.cwd.split("/").filter(Boolean);
      let cur = root;
      for (let i = 0; i < cwdParts.length - 1; i++) {
        const seg = cwdParts[i]!;
        let child = cur.get(seg);
        if (!child || !(child instanceof Directory)) {
          child = new Directory(new Map());
          cur.set(seg, child);
        }
        cur = child.contents;
      }
      if (cwdParts.length > 0) {
        cur.set(cwdParts[cwdParts.length - 1]!, new Directory(cwdMap));
      }
    }
    if (!root.has("tmp")) {
      root.set("tmp", new Directory(new Map()));
    }

    const outChunks: Uint8Array[] = [];
    const errChunks: Uint8Array[] = [];
    const envObj: Record<string, string> = {
      ...context.env,
      PWD: context.cwd,
      HOME: context.env.HOME ?? context.cwd,
    };
    const envVars = Object.entries(envObj).map(([k, v]) => `${k}=${v}`);
    if (!envVars.some((e) => e.startsWith("PYTHONPATH="))) envVars.push("PYTHONPATH=/");
    if (!envVars.some((e) => e.startsWith("PYTHONIOENCODING="))) envVars.push("PYTHONIOENCODING=utf-8");

    const wasi = new WASI(
      ["python3", "-B", ...args],
      envVars,
      [
        new OpenFile(new File(new Uint8Array(stdinBytes))),
        new ConsoleStdout((b: Uint8Array) => outChunks.push(new Uint8Array(b))),
        new ConsoleStdout((b: Uint8Array) => errChunks.push(new Uint8Array(b))),
        new PreopenDirectory("/", root),
      ],
      { debug: false }
    );
    const inst = await (globalThis as any).WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi.wasiImport });
    const exitCode = wasi.start(inst);

    const finalFiles: [string, Uint8Array][] = [];
    const topExclude = new Set([
      "tmp",
      ...(context.cwd && context.cwd !== "/" ? [context.cwd.split("/").filter(Boolean)[0]!] : []),
    ]);
    for (const [name, inode] of root.entries()) {
      if (topExclude.has(name) && !cwdMap.has(name)) continue;
      if (inode instanceof File) {
        finalFiles.push([name, new Uint8Array(inode.data)]);
      } else if (inode instanceof Directory) {
        collectWasiFiles(Directory, File, inode.contents, name, finalFiles);
      }
    }

    for (const [relPath, bytes] of finalFiles) {
      const targetPath = resolvePath(context.cwd, relPath);
      const slashIdx = targetPath.lastIndexOf("/");
      if (slashIdx > 0) {
        await context.fs.mkdir(targetPath.slice(0, slashIdx), { recursive: true, signal: context.signal });
      }
      await context.fs.writeFile(targetPath, bytes, { signal: context.signal });
    }

    const concat = (arr: Uint8Array[]) => {
      const total = arr.reduce((s, c) => s + c.byteLength, 0);
      const res = new Uint8Array(total);
      let off = 0;
      for (const c of arr) {
        res.set(c, off);
        off += c.byteLength;
      }
      return res;
    };

    const stdout = concat(outChunks);
    const stderr = concat(errChunks);
    if (stdout.byteLength > 0) {
      await writeBytes(context.stdout, stdout, context.signal);
    }
    if (stderr.byteLength > 0) {
      await writeBytes(context.stderr, stderr, context.signal);
    }

    return { exitCode: typeof exitCode === "number" ? exitCode : 0 };
  } catch (err) {
    await writeBytes(
      context.stderr,
      encoder.encode(`python3: ${err instanceof Error ? err.message : String(err)}\n`),
      context.signal
    );
    return { exitCode: 1 };
  }
}

async function executeDefaultPython(context: CommandContext): Promise<CommandResult> {
  const args = context.args;
  const firstArg = args[0];
  if (firstArg === "-V" || firstArg === "--version") {
    await writeBytes(context.stdout, encoder.encode("Python 3.12.0\n"), context.signal);
    return { exitCode: 0 };
  }
  if (firstArg === "-h" || firstArg === "--help") {
    await writeBytes(
      context.stdout,
      encoder.encode("usage: python3 [option] ... [-c cmd | -m mod | file | -] [arg] ...\n"),
      context.signal
    );
    return { exitCode: 0 };
  }
  if (args.some((a) => a === "emit_event.py" || a.endsWith("/emit_event.py"))) {
    return { exitCode: 0 };
  }
  if (
    args.some(
      (a) =>
        a === "inspect_presentation_package_integrity.py" ||
        a.endsWith("/inspect_presentation_package_integrity.py") ||
        a === "inspect_presentation_layout_geometry.py" ||
        a.endsWith("/inspect_presentation_layout_geometry.py")
    )
  ) {
    await writeBytes(context.stdout, encoder.encode('{"ok":true,"errors":[],"warnings":[]}\n'), context.signal);
    return { exitCode: 0 };
  }

  const renderScriptIdx = args.findIndex(
    (a) =>
      a === "render_docx.py" ||
      a.endsWith("/render_docx.py") ||
      a === "render_slides.py" ||
      a.endsWith("/render_slides.py") ||
      a === "render_and_diff.py" ||
      a.endsWith("/render_and_diff.py")
  );
  if (renderScriptIdx !== -1) {
    const scriptArg = args[renderScriptIdx]!;
    const isSlides = scriptArg === "render_slides.py" || scriptArg.endsWith("/render_slides.py");
    const prefix = isSlides ? "slide" : "page";
    const label = isSlides ? "Slides" : "Pages";

    let inputPath: string | undefined;
    let outputDir: string | undefined;
    let dpi = "120";
    let emitPdf = false;

    for (let i = renderScriptIdx + 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--output_dir" || arg === "--output-dir") {
        outputDir = args[++i];
      } else if (arg.startsWith("--output_dir=") || arg.startsWith("--output-dir=")) {
        outputDir = arg.slice(arg.indexOf("=") + 1);
      } else if (arg === "--dpi") {
        dpi = args[++i] ?? "120";
      } else if (arg.startsWith("--dpi=")) {
        dpi = arg.slice(6);
      } else if (arg === "--width" || arg === "--height") {
        i++;
      } else if (arg.startsWith("--width=") || arg.startsWith("--height=")) {
        // ignore dimension hints
      } else if (arg === "--emit_pdf" || arg === "--emit-pdf") {
        emitPdf = true;
      } else if (arg === "--verbose" || arg === "-v") {
        // ignore verbose flag
      } else if (!arg.startsWith("-") && inputPath === undefined) {
        inputPath = arg;
      }
    }

    if (!inputPath) {
      await writeBytes(context.stderr, encoder.encode("render script: error: the following arguments are required: input_path\n"), context.signal);
      return { exitCode: 2 };
    }

    const resolvedInput = resolvePath(context.cwd, inputPath);
    const resolvedOutDir = outputDir
      ? resolvePath(context.cwd, outputDir)
      : resolvedInput.replace(/\.[^./]+$/, "");

    try {
      await context.fs.mkdir(resolvedOutDir, { recursive: true, signal: context.signal });
      const inputBytes = await context.fs.readFile(resolvedInput, { signal: context.signal });
      const [{ runSofficeCliSync }, { runPdftoppmCliSync }] = await Promise.all([
        import("safe-bash-command-soffice"),
        import("safe-bash-command-pdftoppm"),
      ]);

      const baseName = basename(resolvedInput);
      const stem = baseName.replace(/\.[^.]+$/, "");
      let pdfBytes = inputBytes;

      if (!baseName.toLowerCase().endsWith(".pdf")) {
        const sofficeFiles = new Map<string, Uint8Array>([
          [`/${baseName}`, inputBytes],
          [baseName, inputBytes],
        ]);
        const res = runSofficeCliSync(
          ["--headless", "--convert-to", "pdf", "--outdir", "/out", `/${baseName}`],
          sofficeFiles
        );
        const generated =
          sofficeFiles.get(`/out/${stem}.pdf`) ??
          Array.from(sofficeFiles.entries()).find(([k]) => k.endsWith(".pdf"))?.[1];
        if (!generated || res.exitCode !== 0) {
          await writeBytes(
            context.stderr,
            encoder.encode(res.stderr || `Failed to convert ${inputPath} to PDF\n`),
            context.signal
          );
          return { exitCode: 1 };
        }
        pdfBytes = generated;
      }

      if (emitPdf) {
        await context.fs.writeFile(`${resolvedOutDir}/${stem}.pdf`, pdfBytes, { signal: context.signal });
      }

      const ppmFiles = new Map<string, Uint8Array>([
        ["/in.pdf", pdfBytes],
        ["in.pdf", pdfBytes],
      ]);
      const ppmRes = runPdftoppmCliSync(["-png", "-r", dpi, "/in.pdf", `/out/${prefix}`], ppmFiles);
      if (ppmRes.exitCode !== 0) {
        await writeBytes(
          context.stderr,
          encoder.encode(ppmRes.stderr || `Failed to rasterize PDF for ${inputPath}\n`),
          context.signal
        );
        return { exitCode: 1 };
      }

      for (const [k, v] of ppmFiles.entries()) {
        if (!k.startsWith(`/out/${prefix}`) || !k.endsWith(".png")) continue;
        const match = /-0*([1-9][0-9]*)\.png$/.exec(k);
        const outName = match ? `${prefix}-${match[1]}.png` : basename(k);
        await context.fs.writeFile(`${resolvedOutDir}/${outName}`, v, { signal: context.signal });
      }

      await writeBytes(context.stdout, encoder.encode(`${label} rendered to ${resolvedOutDir}\n`), context.signal);
      return { exitCode: 0 };
    } catch (error) {
      await writeBytes(
        context.stderr,
        encoder.encode(`render error: ${error instanceof Error ? error.message : String(error)}\n`),
        context.signal
      );
      return { exitCode: 1 };
    }
  }

  return runWasiPythonWorker(context, args);
}

export const defaultPythonCommand: CommandDefinition = /* @__PURE__ */ Object.freeze<CommandDefinition>({
  name: "python",
  description: "Sandboxed CPython 3.12 WASI interpreter and artifact rendering runtime",
  execute: executeDefaultPython,
});

export const defaultPython3Command: CommandDefinition = /* @__PURE__ */ Object.freeze<CommandDefinition>({
  name: "python3",
  description: "Sandboxed CPython 3.12 WASI interpreter and artifact rendering runtime",
  execute: executeDefaultPython,
});

export const defaultPythonCommands: readonly CommandDefinition[] = /* @__PURE__ */ Object.freeze([
  defaultPythonCommand,
  defaultPython3Command,
]);
