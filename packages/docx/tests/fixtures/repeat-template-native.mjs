import { Volume } from "memfs";
import * as api from "docx";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

// Keep the public imports on a native main thread, but allocate every document,
// budget and filesystem inside its request. No operation state crosses cases.
async function execute(request) {
  const input = new Uint8Array(Buffer.from(request.input, "base64"));
  const memory = Volume.fromJSON({ "/output": "" });
  const signal = new AbortController().signal;
  const context = {
    limits: request.limits, signal,
    budget: new api.DocumentBudget(request.documentLimits, signal),
    encoding: { order: "input", compression: "store" },
    stdout: { async write(bytes) { memory.appendFileSync("/output", bytes); } },
  };
  const data = [{ values: [{ binding: "entry", value: "New 海🌊" }] }];
  const args = request.operation === "controls.repeat" ? { control: 1, data } : { data };
  const batch = { version: 1, operations: [{ operation: request.operation, arguments: args }] };
  try {
    if (request.route.includes("sdk")) {
      const pending = request.route.endsWith("batch")
        ? api.executeDocumentBatch(input, batch, { output: "-" }, context)
        : request.operation === "controls.repeat"
          ? api.editDocumentControlRepeats(input, { control: 1, data, output: "-" }, context)
          : api.applyDocumentTemplate(input, { data, output: "-" }, context);
      if (request.allowed) await pending;
      else {
        let caught;
        try { await pending; } catch (error) { caught = error; }
        if (caught?.code !== "unsupported-edit") throw caught ?? Error("Unsupported edit succeeded");
        if (memory.statSync("/output").size) throw Error("Failed SDK published");
      }
    } else {
      const fs = new MemoryFileSystem();
      const retained = new TextEncoder().encode("Retained forced destination");
      await fs.writeFile("/input", input);
      await fs.writeFile("/output", retained);
      await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
      await fs.writeFile("/data", new TextEncoder().encode(JSON.stringify(data)));
      const shell = new Shell({ fs }).use(docxCommands({
        engine: api.createDocxInspectionCommandEngine({ limits: request.limits, documentLimits: request.documentLimits }),
      }));
      try {
        const command = request.route.endsWith("batch") ? "docx batch /input --ops-file /ops"
          : request.operation === "controls.repeat" ? "docx controls repeat /input --control 1 --data-file /data"
            : "docx template apply /input --data-file /data";
        const response = await shell.exec(command + " --output /output --force --json");
        const envelope = JSON.parse(response.stdout);
        if (Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input))) throw Error("Input changed");
        if (request.allowed) {
          if (response.exitCode) throw Error(response.stdout + response.stderr);
          memory.writeFileSync("/output", await fs.readFile("/output"));
        } else {
          if (response.exitCode !== 1 || envelope.data !== null || envelope.affected !== 0 || envelope.errors[0]?.code !== "unsupported-edit") throw Error(response.stdout + response.stderr);
          if (Buffer.compare(Buffer.from(await fs.readFile("/output")), Buffer.from(retained))) throw Error("Destination changed");
        }
      } finally { await shell.dispose(); }
    }
    return { ok: true, output: Buffer.from(memory.readFileSync("/output")).toString("base64") };
  } catch (error) {
    return { ok: false, error: String(error), stack: error.stack, code: error.code ?? null, outputBytes: memory.statSync("/output").size };
  }
}

let lastId = 0, busy = false, stopping = false;
process.on("message", async request => {
  try {
    if (busy || stopping) throw Error("Overlapping native requests");
    if (request.type === "shutdown" && request.id === lastId) {
      stopping = true;
      process.send({ type: "closed", id: lastId }, error => {
        if (error) throw error;
        process.disconnect();
      });
      return;
    }
    if (request.type !== "execute" || request.id !== lastId + 1) throw Error("Unexpected native request");
    lastId = request.id;
    busy = true;
    const response = await execute(request);
    busy = false;
    process.send({ type: "result", id: lastId, ...response }, error => { if (error) throw error; });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
  }
});
process.on("disconnect", () => { if (!stopping) process.exitCode = 1; });
process.send({ type: "ready" }, error => { if (error) throw error; });
