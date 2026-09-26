import { Volume } from "memfs";
import * as api from "docx";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";

// Each request owns its budget, filesystem and shell.
async function execute(request) {
  const input = new Uint8Array(Buffer.from(request.input, "base64")),
    memory = Volume.fromJSON({ "/output": "" }),
    signal = new AbortController().signal,
    context = {
      limits: request.limits,
      signal,
      budget: new api.DocumentBudget(request.documentLimits, signal),
      encoding: { order: "input", compression: "store" },
      stdout: {
        async write(bytes) {
          memory.appendFileSync("/output", bytes);
        }
      }
    },
    batch = {
      version: 1,
      operations: [{ operation: request.operation, arguments: { revision: 1 } }]
    };
  try {
    let result;
    if (request.route.includes("sdk"))
      result = request.route.endsWith("batch")
        ? (await api.executeDocumentBatch(input, batch, { output: "-" }, context)).results[0].data
        : await api.editDocumentRevisionDecisions(
            input,
            { operation: request.operation, options: { revision: 1, output: "-" } },
            context
          );
    else {
      const fs = new MemoryFileSystem(),
        retained = new TextEncoder().encode("Retained forced destination");
      await fs.writeFile("/input", input);
      await fs.writeFile("/output", retained);
      await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
      const shell = new Shell({ fs }).use(
        docxCommands({
          engine: api.createDocxInspectionCommandEngine({
            limits: request.limits,
            documentLimits: request.documentLimits
          })
        })
      );
      try {
        const response = await shell.exec(
          (request.route.endsWith("batch")
            ? "docx batch /input --ops-file /ops"
            : "docx " + request.operation.split(".").join(" ") + " /input --revision 1") +
            " --output /output --force --json"
        );
        if (Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(input)))
          throw Error("Input changed");
        if (response.exitCode) {
          if (Buffer.compare(Buffer.from(await fs.readFile("/output")), Buffer.from(retained)))
            throw Error("Destination changed");
          throw Error(response.stdout + response.stderr);
        }
        const envelope = JSON.parse(response.stdout);
        result = request.route.endsWith("batch") ? envelope.data.results[0].data : envelope.data;
        memory.writeFileSync("/output", await fs.readFile("/output"));
      } finally {
        await shell.dispose();
      }
    }
    return {
      ok: true,
      result,
      output: Buffer.from(memory.readFileSync("/output")).toString("base64")
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error),
      stack: error.stack,
      code: error.code ?? null,
      outputBytes: memory.statSync("/output").size
    };
  }
}

let lastId = 0,
  busy = false,
  stopping = false;
process.on("message", async (request) => {
  try {
    if (busy || stopping) throw Error("Overlapping native requests");
    if (request.type === "shutdown" && request.id === lastId) {
      stopping = true;
      process.send({ type: "closed", id: lastId }, (error) => {
        if (error) throw error;
        process.disconnect();
      });
      return;
    }
    if (request.type !== "execute" || request.id !== lastId + 1)
      throw Error("Unexpected native request");
    lastId = request.id;
    busy = true;
    const response = await execute(request);
    busy = false;
    process.send({ type: "result", id: lastId, ...response }, (error) => {
      if (error) throw error;
    });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
    process.disconnect();
  }
});
process.on("disconnect", () => {
  if (!stopping) process.exitCode = 1;
});
process.send({ type: "ready" }, (error) => {
  if (error) throw error;
});
