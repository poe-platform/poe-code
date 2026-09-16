import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createDocxInspectionCommandEngine } from "./inspection-command.js";
import { chartFixture, chartContext, sheetMime } from "../tests/fixtures/charts.js";
import { r, paragraph } from "../tests/fixtures/text.js";

it("inventories inert package bytes through the shared command engine", async () => {
  const input = await chartFixture({
    definitions: [],
    body: paragraph("Original object area"),
    resources: [
      { name: "word/embeddings/book.bin", type: sheetMime, bytes: Uint8Array.of(0, 255, 5) }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: "embeddings/book.bin"
      }
    ]
  });
  const volume = Volume.fromJSON({ "/input.docx": Buffer.from(input) });
  let output = "",
    diagnostics = "";
  const result = await createDocxInspectionCommandEngine({ limits: chartContext.limits }).execute({
    args: ["objects", "list", "input.docx", "--json"].map((s) => new TextEncoder().encode(s)),
    cwd: "/",
    signal: chartContext.signal,
    filesystem: {
      async readFile(path) {
        return new Uint8Array(volume.readFileSync(path) as Buffer);
      }
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: {
      async write(b) {
        output += new TextDecoder().decode(b);
      }
    },
    stderr: {
      async write(b) {
        diagnostics += new TextDecoder().decode(b);
      }
    }
  });
  expect(result.exitCode, diagnostics).toBe(0);
  expect(JSON.parse(output)).toMatchObject({
    operation: "objects.list",
    ok: true,
    data: {
      items: [
        {
          kind: "objects",
          details: { role: "package", resource: { part: "/word/embeddings/book.bin", bytes: 3 } }
        }
      ]
    },
    affected: 0
  });
  expect(volume.readFileSync("/input.docx")).toEqual(Buffer.from(input));
});

it("admits exact stdout limits and rejects one fewer byte before extraction staging", async () => {
  const { publication } = await import("../tests/fixtures/object-publication.js");
  const { executeObjectsCommand } = await import("./objects-command.js");
  const { DocumentBudget } = await import("./budget.js");
  const { validateDocxInvocation } = await import("./command.js");
  const input = await chartFixture({
    definitions: [],
    resources: [
      { name: "word/embeddings/book.bin", type: sheetMime, bytes: Uint8Array.of(0, 255, 5) }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "book",
        type: r + "/package",
        target: "embeddings/book.bin"
      }
    ]
  });
  const run = async (
    operation: "objects.list" | "objects.extract",
    ceilings: ConstructorParameters<typeof DocumentBudget>[0] = {}
  ) => {
    const { fs, volume } = publication(input),
      budget = new DocumentBudget(ceilings, chartContext.signal);
    const invocation = validateDocxInvocation(
      {
        operation,
        inputs: ["document"],
        options: {
          json: true,
          ...(operation === "objects.extract"
            ? { outputDir: "/out", allowPartialOutput: true }
            : {})
        }
      },
      budget
    );
    const task = executeObjectsCommand(
      invocation,
      input,
      undefined,
      {
        args: [],
        cwd: "/",
        filesystem: fs,
        signal: chartContext.signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write() {} },
        stderr: { async write() {} }
      },
      { ...chartContext, budget }
    );
    return { task, volume, budget };
  };
  const full = await run("objects.list"),
    response = await full.task;
  await expect(
    (await run("objects.list", { serializedOutput: response.length })).task
  ).resolves.toEqual(response);
  await expect(
    (await run("objects.list", { serializedOutput: response.length - 1 })).task
  ).rejects.toMatchObject({ code: "limit-exceeded" });
  const extraction = await run("objects.extract"),
    extracted = await extraction.task;
  // Extraction reserves the larger success/failure receipt, including the final newline.
  const envelope = JSON.parse(new TextDecoder().decode(extracted));
  envelope.ok = false;
  envelope.data.complete = false;
  envelope.errors = [
    {
      code: "unsupported-publication",
      message: "Document operation failed: unsupported-publication"
    }
  ];
  for (const entry of envelope.data.entries) entry.published = false;
  envelope.data.manifest.published = false;
  const ceiling = new TextEncoder().encode(JSON.stringify(envelope) + "\n").length;
  await expect(
    (await run("objects.extract", { serializedOutput: ceiling })).task
  ).resolves.toBeInstanceOf(Uint8Array);
  const rejected = await run("objects.extract", { serializedOutput: ceiling - 1 });
  await expect(rejected.task).rejects.toMatchObject({ code: "limit-exceeded" });
  expect(rejected.volume.readdirSync("/out")).toEqual([]);
});

it("escapes declared resource types in human inventory output", async () => {
  const { executeObjectsCommand } = await import("./objects-command.js");
  const { validateDocxInvocation } = await import("./command.js");
  const input = await chartFixture({
    definitions: [],
    resources: [
      {
        name: "word/embeddings/item.bin",
        type: "application/x-\u202eopaque",
        bytes: Uint8Array.of(1)
      }
    ],
    relationships: [
      {
        owner: "/word/document.xml",
        id: "item",
        type: r + "/package",
        target: "embeddings/item.bin"
      }
    ]
  });
  const response = await executeObjectsCommand(
    validateDocxInvocation({ operation: "objects.list", inputs: ["document"], options: {} }),
    input,
    undefined,
    {
      args: [],
      cwd: "/",
      filesystem: {
        async readFile() {
          throw new Error("Unexpected capability read");
        }
      },
      signal: chartContext.signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} },
      stderr: { async write() {} }
    },
    chartContext
  );
  expect(new TextDecoder().decode(response)).not.toContain("\u202e");
});
