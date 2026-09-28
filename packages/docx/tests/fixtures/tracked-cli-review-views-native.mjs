import { Volume } from "memfs";
import * as api from "docx";

// Keep package imports on a native main thread; every request owns fresh state.
export async function run(request) {
  const input = new Uint8Array(Buffer.from(request.input, "base64"));
  const memory = Volume.fromJSON({ "/output": "" });
  const sink = { async write(bytes) { memory.appendFileSync("/output", bytes); } };
  const limits = request.limits, signal = new AbortController().signal;
  const documentLimits = { xmlDepth: 16384, retainedBytes: 2 ** 31, work: 2 ** 31 };
  const context = {
    limits, signal, budget: new api.DocumentBudget(documentLimits, signal),
    encoding: { order: "input", compression: "store" }, stdout: sink
  };
  const arguments_ = {
    find: "Coast", with: "Shore", all: true, bold: false, italic: true,
    trackChanges: true, author: "", timestamp: "2026-01-02T03:04:06Z"
  };
  const ops = { version: 1, operations: [{ operation: "text.replace", arguments: arguments_ }] };
  try {
    if (request.phase.startsWith("decision-")) {
      const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
      const { docxCommands } = await import("@poe-platform/safe-bash/commands/docx");
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input);
      const retained = new TextEncoder().encode("Retained forced destination");
      await fs.writeFile("/destination", retained);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
      try {
        const result = await shell.exec("docx revisions " + request.phase.slice(9) + " /input --all --output /destination --force --json");
        const data = JSON.parse(result.stdout);
        if (result.exitCode === 0 || data.errors[0]?.code !== "unsupported-edit" || data.affected !== 0)
          throw new Error(result.stdout + result.stderr);
        if (Buffer.compare(await fs.readFile("/input"), input) || Buffer.compare(await fs.readFile("/destination"), retained))
          throw new Error("Refusal changed source/destination");
        return { ok: true, decisionCode: data.errors[0].code, affected: data.affected, outputBytes: memory.statSync("/output").size, retainedSourceDestination: true };
      } finally { await shell.dispose(); }
    }
    if (request.phase !== "edit") {
      const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
      const { docxCommands } = await import("@poe-platform/safe-bash/commands/docx");
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input);
      const saved = input.slice();
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
      try {
        const view = request.phase === "baseline" ? "final" : request.phase;
        const result = await shell.exec("docx text get /input --view " + view + " --json");
        if (result.exitCode !== 0) throw new Error(result.stdout + result.stderr);
        const data = JSON.parse(result.stdout).data;
        if (Buffer.compare(await fs.readFile("/input"), saved)) throw new Error("Readonly CLI input changed");
        return { ok: true, text: data.text, outputBytes: memory.statSync("/output").size, actualCliView: view };
      } finally { await shell.dispose(); }
    }
    if (request.route === "sdk") await api.replaceDocumentText(input, { ...arguments_, output: "-" }, context);
    else if (request.route === "sdk-batch") await api.executeDocumentBatch(input, ops, { output: "-" }, context);
    else {
      const { Shell, MemoryFileSystem } = await import("@poe-platform/safe-bash");
      const { docxCommands } = await import("@poe-platform/safe-bash/commands/docx");
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", input);
      const shell = new Shell({ fs }).use(docxCommands({ engine: api.createDocxInspectionCommandEngine({ limits, documentLimits }) }));
      try {
        const command = request.route === "cli"
          ? "docx text replace /input --find Coast --with Shore --all --bold false --italic true --track-changes --author '' --timestamp 2026-01-02T03:04:06Z --output /output --json"
          : "docx batch /input --ops-json " + JSON.stringify(JSON.stringify(ops)) + " --output /output --json";
        const result = await shell.exec(command);
        if (result.exitCode !== 0) {
          const failure = new Error(result.stdout + result.stderr);
          failure.code = JSON.parse(result.stdout).errors[0].code;
          throw failure;
        }
        memory.writeFileSync("/output", await fs.readFile("/output"));
        if (Buffer.compare(await fs.readFile("/input"), input)) throw new Error("Input changed");
      } finally { await shell.dispose(); }
    }
    return { ok: true, output: Buffer.from(memory.readFileSync("/output")).toString("base64") };
  } catch (error) {
    return { ok: false, error: String(error), code: error.code ?? null, stack: error.stack, outputBytes: memory.statSync("/output").size };
  }
}
