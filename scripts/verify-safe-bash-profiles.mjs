import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const shell = `import { Shell } from "@poe-platform/safe-bash/shell";
import { MemoryFileSystem } from "@poe-platform/safe-fs/core";`;
const pdf = `import { pdfinfoCommands } from "@poe-platform/safe-bash/commands/pdfinfo";`;
const csv = `import { ssconvertCommands } from "@poe-platform/safe-bash/ssconvert/commands";
import { csvFormat } from "@poe-platform/safe-bash/ssconvert/formats/csv";`;

// These are installed ESM consumers. No checkout aliases, excluded imports or
// source rewriting: all static JS chunks and copied assets count in the total.
export const safeBashProfiles = {
  core: { imports: shell, setup: "", smoke: "", forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  rootCore: { imports: shell.replace('"@poe-platform/safe-bash/shell"', '"@poe-platform/safe-bash"'), setup: "", smoke: "", forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  pythonLlm: { imports: shell + `
import { pythonCommands } from "@poe-platform/safe-bash/commands/python";
import { llmCommands } from "@poe-platform/safe-bash/commands/llm";`,
    setup: `shell.use(pythonCommands({ createExecutor: () => ({ async run(start) { start.onReady(); return 0; }, terminate() {} }) }));
shell.use(llmCommands({ defaultModel: "fixture", providers: [{ name: "fixture", models: [{ id: "fixture" }], async *complete() { yield "hello"; } }] }));`,
    smoke: `check((await shell.exec("python -c pass")).exitCode === 0, "python executor");
check((await shell.exec("llm prompt")).stdout === "hello\\n", "LLM streaming");`, forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  pdf: { imports: shell + pdf, setup: "shell.use(pdfinfoCommands());", smoke: 'check((await shell.exec("pdfinfo --help")).exitCode === 0, "PDF command");', forbidden: ["spreadsheet", "ffmpeg", "git", "op"] },
  multiplePdf: { imports: shell + pdf + `
import { pdftotextCommands } from "@poe-platform/safe-bash/commands/pdftotext";
import { qpdfCommands } from "@poe-platform/safe-bash/commands/qpdf";
import { PdfDocument } from "@poe-platform/safe-bash/pdf-ast";`,
    setup: "shell.use(pdfinfoCommands()).use(pdftotextCommands()).use(qpdfCommands());",
    smoke: `const document = PdfDocument.create(); document.addPage([612, 792]); await fs.writeFile("/input.pdf", document.save());
check((await shell.exec("pdfinfo /input.pdf")).stdout.includes("Pages:"), "PDF inspection");
for (const command of ["pdftotext", "qpdf"]) check((await shell.exec(command + " --help")).exitCode === 0, command);`, forbidden: ["spreadsheet", "ffmpeg", "git", "op"] },
  csv: { imports: shell + csv, setup: "shell.use(ssconvertCommands({ formats: [csvFormat] }));", smoke: `await fs.writeFile("/input.csv", new TextEncoder().encode("Name,Value\\nOffice,7\\n"));
check((await shell.exec("ssconvert /input.csv /output.csv")).exitCode === 0, "CSV conversion");
check(new TextDecoder().decode(await fs.readFile("/output.csv")) === "Name,Value\\nOffice,7\\n", "CSV output");
check((await shell.exec("ssconvert /input.csv /refused.xlsx")).exitCode !== 0, "unselected XLSX rejected");`, forbidden: ["pdf", "xlsx", "ods", "xls", "ffmpeg", "git", "op"] },
  csvXlsx: { imports: shell + csv + '\nimport { xlsxFormat } from "@poe-platform/safe-bash/ssconvert/formats/xlsx";', setup: "shell.use(ssconvertCommands({ formats: [csvFormat, xlsxFormat] }));", smoke: `await fs.writeFile("/input.csv", new TextEncoder().encode("Name,Value\\nOffice,7\\n"));
check((await shell.exec("ssconvert /input.csv /output.xlsx")).exitCode === 0, "XLSX writer");
check((await shell.exec("ssconvert /output.xlsx /roundtrip.csv")).exitCode === 0, "XLSX reader");
check(new TextDecoder().decode(await fs.readFile("/roundtrip.csv")) === "Name,Value\\nOffice,7\\n", "XLSX round trip");`, forbidden: ["pdf", "ods", "xls", "ffmpeg", "git", "op"] },
  git: { imports: shell + '\nimport { gitCommands } from "@poe-platform/safe-bash/commands/git";',
    setup: "shell.use(gitCommands());",
    smoke: `check((await shell.exec("git init /repo")).exitCode === 0, "Git initialization");
check((await shell.exec("git -C /repo status --porcelain")).exitCode === 0, "Git status");`,
    forbidden: ["pdf", "spreadsheet", "ffmpeg"] },
  defaultRegistry: { imports: shell.replace('"@poe-platform/safe-bash/shell"', '"@poe-platform/safe-bash"') + '\nimport { agentCommands } from "@poe-platform/safe-bash";',
    setup: "shell.use(agentCommands());", smoke: 'check((await shell.exec("printf default | cat")).stdout === "default", "default registry");', forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  registryWithRegex: { imports: shell.replace('"@poe-platform/safe-bash/shell"', '"@poe-platform/safe-bash"') + '\nimport { agentCommands, createBoundedRegexProvider } from "@poe-platform/safe-bash";',
    setup: "shell.use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));",
    smoke: 'check((await shell.exec("printf actual | grep actual")).stdout === "actual\\n", "explicit regex provider");', forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  enabledConsumer: { imports: shell + `
import { agentCommands, createBoundedRegexProvider } from "@poe-platform/safe-bash";
import { bcCommands } from "@poe-platform/safe-bash/commands/bc";
import { csvcutCommands } from "@poe-platform/safe-bash/commands/csvcut";
import { csvgrepCommands } from "@poe-platform/safe-bash/commands/csvgrep";
import { diff3Commands } from "@poe-platform/safe-bash/commands/diff3";
import { fdCommands } from "@poe-platform/safe-bash/commands/fd";
import { htmlqCommands } from "@poe-platform/safe-bash/commands/htmlq";
import { lessCommands } from "@poe-platform/safe-bash/commands/less";
import { unrtfCommands } from "@poe-platform/safe-bash/commands/unrtf";
import { yqCommands } from "@poe-platform/safe-bash/commands/yq";
import { ddCommands } from "@poe-platform/safe-bash/dd";
import { yesCommands } from "@poe-platform/safe-bash/yes";`,
    setup: `shell.use(agentCommands({ regexExecutor: createBoundedRegexProvider() }));
shell.use(bcCommands());
shell.use(csvcutCommands());
shell.use(csvgrepCommands());
shell.use(diff3Commands());
shell.use(fdCommands());
shell.use(htmlqCommands());
shell.use(lessCommands());
shell.use(unrtfCommands());
shell.use(yqCommands());
shell.use(ddCommands());
shell.use(yesCommands());
await shell.exec("true");
for (const name of ["ln", "readlink"]) shell.commands.unregister(name);`,
    smoke: `check(JSON.stringify(shell.commands.list().filter(command => command.name !== "probe").map(command => command.name).sort()) === JSON.stringify(["[", "apply_patch", "awk", "base32", "base64", "basename", "bc", "bunzip2", "bzcat", "bzip2", "cat", "chmod", "cksum", "cmp", "column", "comm", "cp", "csplit", "csvcut", "csvgrep", "cut", "date", "dd", "diff", "diff3", "dirname", "dos2unix", "du", "echo", "egrep", "env", "expand", "expr", "factor", "false", "fd", "fgrep", "file", "find", "fmt", "fold", "getopt", "grep", "gunzip", "gzip", "hd", "head", "hexdump", "html-to-markdown", "htmlq", "iconv", "join", "jq", "less", "ls", "md5sum", "mdq", "mkdir", "mktemp", "more", "mv", "nl", "numfmt", "od", "paste", "patch", "pr", "printenv", "printf", "pwd", "realpath", "rev", "rg", "rm", "rmdir", "sed", "seq", "sha1sum", "sha224sum", "sha256sum", "sha384sum", "sha512sum", "shuf", "sleep", "sort", "split", "stat", "strings", "tac", "tail", "tar", "tee", "test", "timeout", "touch", "tr", "tree", "true", "truncate", "tsort", "unexpand", "uniq", "unix2dos", "unrtf", "unxz", "unzip", "unzstd", "wc", "which", "xargs", "xmllint", "xq", "xxd", "xz", "xzcat", "yes", "yq", "zcat", "zip", "zstd", "zstdcat"]), "enabled consumer inventory");`, forbidden: ["pdf", "spreadsheet", "ffmpeg", "git", "op"] },
  full: { imports: `import * as full from "@poe-platform/safe-bash/full";\n${shell}`,
    setup: "shell.use(full.agentCommands()); globalThis.fullProfile = full;",
    smoke: 'check((await shell.exec("printf full | cat")).stdout === "full", "full registry");', forbidden: [] },
};

safeBashProfiles.rootPythonLlm = { ...safeBashProfiles.pythonLlm,
  imports: safeBashProfiles.pythonLlm.imports
    .replaceAll('"@poe-platform/safe-bash/shell"', '"@poe-platform/safe-bash"')
    .replaceAll('"@poe-platform/safe-bash/commands/python"', '"@poe-platform/safe-bash"')
    .replaceAll('"@poe-platform/safe-bash/commands/llm"', '"@poe-platform/safe-bash"'),
};

safeBashProfiles.splitCore = { ...safeBashProfiles.core, splitting: true };
safeBashProfiles.splitPythonLlm = { ...safeBashProfiles.pythonLlm, splitting: true };
safeBashProfiles.splitFull = { ...safeBashProfiles.full, splitting: true };

const engineMarkers = {
  pdf: "Invalid FlateDecode compressed stream",
  spreadsheet: "Unsupported ssconvert feature: formula syntax at",
  xlsx: "E Invalid XLSX:",
  ods: "E Invalid OpenDocument:",
  xls: "E Invalid Excel BIFF:",
  ffmpeg: "ffmpeg version",
  git: "git_rust",
  op: "op requires VFS write, permissions and exclusive-create capabilities",
};

// Measured from clean installed tarballs using the exact profiles below.
// Allow 2% total growth and 5% incremental growth (at least 16 KiB) so
// optional-engine regressions cannot hide behind unrelated core reductions.
export const safeBashProfileBaselines = {
  "core": 4949332,
  "rootCore": 4954469,
  "pythonLlm": 5046947,
  "pdf": 5942440,
  "multiplePdf": 6018154,
  "csv": 6656262,
  "csvXlsx": 6852858,
  "git": 10269735,
  "defaultRegistry": 6212163,
  "registryWithRegex": 6213504,
  "enabledConsumer": 6287679,
  "full": 24851519,
  "rootPythonLlm": 5052096,
  "splitCore": 4871225,
  "splitPythonLlm": 4968430,
  "splitFull": 24702427
};
const reviewedBudgets = Object.fromEntries(Object.entries(safeBashProfileBaselines)
  .map(([name, bytes]) => [name, Math.ceil(bytes * 1.02)]));

export async function verifySafeBashProfiles(consumer, { budgets = reviewedBudgets, smoke = true } = {}) {
  const results = {};
  for (const [name, profile] of Object.entries(safeBashProfiles)) {
    const source = `${profile.imports}
const check = (ok, message) => { if (!ok) throw new Error(message); };
export default { async fetch() {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs });
  try {
    shell.use({ name: "profile-stream", setup(host) { host.commands.register({ name: "probe", async execute(context) {
      for await (const chunk of context.stdin) { context.signal.throwIfAborted(); await context.stdout.write(chunk); }
      return { exitCode: 0 };
    } }); } });
    ${profile.setup}
    await fs.writeFile("/retained", new TextEncoder().encode("retained"));
    check((await shell.exec("probe < /retained | probe > /copied")).exitCode === 0, "pipeline");
    check(new TextDecoder().decode(await fs.readFile("/copied")) === "retained", "streaming VFS output");
    const controller = new AbortController(); const reason = new Error("cancelled profile"); controller.abort(reason);
    let cancelled = false;
    try { await shell.exec("probe", { signal: controller.signal }); } catch (error) { cancelled = error === reason; }
    check(cancelled, "cancellation identity");
    ${profile.smoke}
    check(new TextDecoder().decode(await fs.readFile("/retained")) === "retained", "canonical VFS");
    return new Response("ok");
  } catch (error) { return new Response(String(error?.stack ?? error), { status: 500 }); }
  finally { await shell.dispose(); }
} };`;
    const outdir = path.resolve(consumer, "profile-" + name);
    const result = await build({ stdin: { contents: source, resolveDir: path.resolve(consumer), sourcefile: "profile.mjs" },
      bundle: true, format: "esm", platform: "browser", conditions: ["workerd", "worker", "browser"],
      splitting: profile.splitting ?? false, minify: true, metafile: true, write: false, outdir, loader: { ".wasm": "copy", ".bin": "copy" },
    });
    const bytes = result.outputFiles.reduce((size, output) => size + output.contents.length, 0);
    const javascript = result.outputFiles.filter(output => output.path.endsWith(".js")).map(output => output.text).join("\n");
    const contributing = Object.values(result.metafile.outputs).flatMap(output => Object.entries(output.inputs)
      .filter(([, input]) => input.bytesInOutput > 0).map(([filename]) => filename));
    for (const engine of profile.forbidden) {
      assert.ok(!javascript.includes(engineMarkers[engine]), `${name}: unused ${engine} engine code`);
      assert.ok(!result.outputFiles.some(output => output.path.includes(engineMarkers[engine])), `${name}: unused ${engine} asset`);
    }
    if (budgets) assert.ok(bytes <= budgets[name], `${name}: ${bytes} exceeds reviewed ${budgets[name]} byte budget`);
    const baselineDelta = safeBashProfileBaselines[name] - safeBashProfileBaselines.core;
    const delta = name === "core" ? 0 : bytes - results.core.bytes;
    const deltaBudget = baselineDelta + Math.max(16_384, Math.ceil(Math.abs(baselineDelta) * 0.05));
    assert.ok(delta <= deltaBudget, `${name}: ${delta} incremental bytes exceeds reviewed ${deltaBudget} byte budget`);
    if (name === "git") assert.equal(result.outputFiles.filter(output => output.path.endsWith(".wasm")).length, 1, "one selected Git Wasm");
    if (name === "multiplePdf") assert.equal(javascript.split(engineMarkers.pdf).length - 1, 1, "one shared PDF decoder");
    if (smoke) {
      const entry = Object.entries(result.metafile.outputs).find(([, output]) => output.entryPoint && path.resolve(output.entryPoint) === path.resolve(consumer, "profile.mjs"))?.[0];
      assert.ok(entry, name + ": Worker ESM entry");
      const outputs = [...result.outputFiles].sort((left, right) => Number(right.path === path.resolve(entry ?? "")) - Number(left.path === path.resolve(entry ?? "")));
      const modules = outputs.map(output => ({ path: output.path,
        type: output.path.endsWith(".wasm") ? "CompiledWasm" : output.path.endsWith(".js") ? "ESModule" : "Data",
        contents: output.path.endsWith(".js") ? output.text : output.contents,
      }));
      const runtime = new Miniflare({ modules, modulesRoot: outdir, compatibilityDate: "2026-07-01" });
      try {
        const response = await runtime.dispatchFetch("https://profile.test");
        const body = await response.text();
        assert.equal(response.status, 200, `${name}: Worker response: ${body.slice(0, 4096)}`);
        assert.equal(body, "ok", `${name}: Worker smoke`);
      } finally { await runtime.dispose(); }
    }
    results[name] = { bytes, deltaFromCore: name === "core" ? 0 : bytes - results.core.bytes,
      javascriptBytes: result.outputFiles.filter(output => output.path.endsWith(".js")).reduce((size, output) => size + output.contents.length, 0),
      assetBytes: result.outputFiles.filter(output => !output.path.endsWith(".js")).reduce((size, output) => size + output.contents.length, 0),
      staticModules: result.outputFiles.length, contributingModules: new Set(contributing).size };
    console.log(JSON.stringify({ profile: name, ...results[name] }));
  }
  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv[2], "Usage: node scripts/verify-safe-bash-profiles.mjs <installed-consumer-directory>");
  await verifySafeBashProfiles(process.argv[2]);
}
