import { Volume } from "memfs";
import * as api from "docx";
import { Shell, MemoryFileSystem } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import { createInterface } from "node:readline";
for await (const source of createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
})) {
  const request = JSON.parse(source),
    input = new Uint8Array(Buffer.from(request.input, "base64")),
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
        },
      },
    },
    data = [{ values: [{ binding: "entry", value: "New 海🌊" }] }],
    args =
      request.operation === "controls.repeat" ? { control: 1, data } : { data },
    batch = {
      version: 1,
      operations: [{ operation: request.operation, arguments: args }],
    };
  try {
    if (request.route.includes("sdk")) {
      const pending = request.route.endsWith("batch")
        ? api.executeDocumentBatch(input, batch, { output: "-" }, context)
        : request.operation === "controls.repeat"
          ? api.editDocumentControlRepeats(
              input,
              { control: 1, data, output: "-" },
              context,
            )
          : api.applyDocumentTemplate(input, { data, output: "-" }, context);
      if (request.allowed) await pending;
      else {
        let caught;
        try {
          await pending;
        } catch (error) {
          caught = error;
        }
        if (caught?.code !== "unsupported-edit")
          throw caught ?? Error("Unsupported edit succeeded");
        if (memory.statSync("/output").size)
          throw Error("Failed SDK published");
      }
    } else {
      const fs = new MemoryFileSystem(),
        retained = new TextEncoder().encode("Retained forced destination");
      await fs.writeFile("/input", input);
      await fs.writeFile("/output", retained);
      await fs.writeFile(
        "/ops",
        new TextEncoder().encode(JSON.stringify(batch)),
      );
      await fs.writeFile(
        "/data",
        new TextEncoder().encode(JSON.stringify(data)),
      );
      const shell = new Shell({ fs }).use(
        docxCommands({
          engine: api.createDocxInspectionCommandEngine({
            limits: request.limits,
            documentLimits: request.documentLimits,
          }),
        }),
      );
      try {
        const command = request.route.endsWith("batch")
            ? "docx batch /input --ops-file /ops"
            : request.operation === "controls.repeat"
              ? "docx controls repeat /input --control 1 --data-file /data"
              : "docx template apply /input --data-file /data",
          response = await shell.exec(
            command + " --output /output --force --json",
          ),
          envelope = JSON.parse(response.stdout);
        if (
          Buffer.compare(
            Buffer.from(await fs.readFile("/input")),
            Buffer.from(input),
          )
        )
          throw Error("Input changed");
        if (request.allowed) {
          if (response.exitCode) throw Error(response.stdout + response.stderr);
          memory.writeFileSync("/output", await fs.readFile("/output"));
        } else {
          if (
            response.exitCode !== 1 ||
            envelope.data !== null ||
            envelope.affected !== 0 ||
            envelope.errors[0]?.code !== "unsupported-edit"
          )
            throw Error(response.stdout + response.stderr);
          if (
            Buffer.compare(
              Buffer.from(await fs.readFile("/output")),
              Buffer.from(retained),
            )
          )
            throw Error("Destination changed");
        }
      } finally {
        await shell.dispose();
      }
    }
    console.log(
      JSON.stringify({
        ok: true,
        output: Buffer.from(memory.readFileSync("/output")).toString("base64"),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error: String(error),
        stack: error.stack,
        code: error.code ?? null,
        outputBytes: memory.statSync("/output").size,
      }),
    );
  }
}
