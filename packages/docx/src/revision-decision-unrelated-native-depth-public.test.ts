import { Volume } from "memfs";
import { expect, it, onTestFinished } from "vitest";
import { nativeRepeatTemplate } from "../tests/native-repeat-template.js";
import { MemoryFileSystem, Shell } from "@poe-platform/safe-bash";
import { docxCommands } from "@poe-platform/safe-bash/commands/docx";
import * as api from "./index.js";
import type * as compiledTypes from "docx";
import { compiledPublicRuntime } from "../tests/compiled-public-runtime.js";
const native = (await compiledPublicRuntime) as unknown as typeof compiledTypes;
import { textContext, textFixture } from "../tests/fixtures/text.js";
import { readPackage } from "../tests/assertions.js";
const executeNative = nativeRepeatTemplate(
  new URL("../tests/fixtures/revision-decision-native.mjs", import.meta.url)
);

for (const strict of [false, true])
  for (const kind of ["docx", "dotx"] as const)
    for (const codec of ["utf8", "utf16le", "utf16be"] as const)
      for (const depth of [32, 8192])
        for (const action of ["accept", "reject"] as const) {
          const label = `revision decision retains unrelated admitted opaque property depth; strict=${strict}; kind=${kind}; codec=${codec}; depth=${depth}; action=${action}`;
          const baselines = new Map<string, { output: Uint8Array; input: Uint8Array }>();
          const verified = new Map<string, Set<string>>();
          const checks = ["xml", "text", "revisions"] as const;

          async function run(
            route:
              | "sdk"
              | "native-sdk"
              | "sdk-batch"
              | "native-sdk-batch"
              | "cli"
              | "native-cli"
              | "cli-batch"
              | "native-cli-batch",
            signal: AbortSignal
          ) {
            const product: typeof api = route.startsWith("native")
              ? (native as unknown as typeof api)
              : api;
            const limits = {
              ...textContext.limits,
              maxArchiveBytes: 2097152,
              maxEntryBytes: 1048576,
              maxTotalBytes: 4194304,
              maxRetainedBytes: 2147483648
            };
            const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
            const fresh = () => ({
              limits,
              signal,
              budget: new product.DocumentBudget(documentLimits, signal),
              encoding: { order: "input", compression: "store" } as const
            });
            const retained =
              "<w:pPr><f:opaque>" +
              "<f:owner>".repeat(depth) +
              "<f:leaf/>" +
              "</f:owner>".repeat(depth) +
              "</f:opaque></w:pPr>";
            const body = `<w:p xmlns:f="urn:original:revision-unrelated-property-depth" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="f">${retained}<w:ins w:id="7" w:author="Stored"><w:r><w:t>Inserted海🌊</w:t></w:r></w:ins><w:r><w:t>Outside</w:t></w:r></w:p>`;
            const parts = readPackage(await textFixture("", {}, strict, { kind }), limits);
            const w = strict
              ? "http://purl.oclc.org/ooxml/wordprocessingml/main"
              : "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            parts.set(
              "word/document.xml",
              new TextEncoder().encode(
                `<w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`
              )
            );
            if (codec !== "utf8")
              for (const [name, bytes] of parts) {
                const encoded = Buffer.from("\ufeff" + new TextDecoder().decode(bytes), "utf16le");
                if (codec === "utf16be") encoded.swap16();
                parts.set(name, new Uint8Array(encoded));
              }
            const memory = Volume.fromJSON({ "/input": "", "/output": "" });
            await product.writeArchive(
              {
                comment: new Uint8Array(),
                members: [...parts].map(([name, bytes]) => ({
                  name,
                  bytes,
                  directory: false,
                  modified: new Date("1980-01-01T00:00:00Z")
                }))
              },
              {
                async write(bytes: Uint8Array) {
                  memory.appendFileSync("/input", bytes);
                }
              },
              fresh().encoding,
              fresh()
            );
            const input = new Uint8Array(memory.readFileSync("/input") as Buffer),
              original = input.slice();
            const operation = `revisions.${action}` as const,
              arguments_ = { revision: 1 },
              batch = { version: 1 as const, operations: [{ operation, arguments: arguments_ }] };
            let receipt: { readonly drained: boolean } | undefined;
            if (route.startsWith("native")) {
              const observed = await executeNative({
                input: Buffer.from(input).toString("base64"),
                route: route as
                  | "native-sdk"
                  | "native-sdk-batch"
                  | "native-cli"
                  | "native-cli-batch",
                operation,
                limits,
                documentLimits,
                allowed: true
              });
              receipt = observed.receipt;
              expect(observed, observed.stack ?? observed.error).toMatchObject({
                ok: true,
                result: { changed: true, changes: [{ revision: { id: "7", type: "insert" } }] }
              });
              memory.writeFileSync("/output", Buffer.from(observed.output!, "base64"));
            } else if (route.includes("sdk")) {
              const io = {
                ...fresh(),
                stdout: {
                  async write(bytes: Uint8Array) {
                    memory.appendFileSync("/output", bytes);
                  }
                }
              };
              const result = route.endsWith("batch")
                ? (await product.executeDocumentBatch(input, batch, { output: "-" }, io))
                    .results[0]!.data
                : await product.editDocumentRevisionDecisions(
                    input,
                    { operation, options: { ...arguments_, output: "-" } },
                    io
                  );
              expect(result).toMatchObject({
                changed: true,
                changes: [{ revision: { id: "7", type: "insert" } }]
              });
            } else {
              const fs = new MemoryFileSystem(),
                destination = new TextEncoder().encode("Retained forced destination");
              await fs.writeFile("/input", input);
              await fs.writeFile("/output", destination);
              await fs.writeFile("/ops", new TextEncoder().encode(JSON.stringify(batch)));
              const shell = new Shell({ fs }).use(
                docxCommands({
                  engine: product.createDocxInspectionCommandEngine({ limits, documentLimits })
                })
              );
              try {
                const response = await shell.exec(
                  (route.endsWith("batch")
                    ? "docx batch /input --ops-file /ops"
                    : `docx revisions ${action} /input --revision 1`) +
                    " --output /output --force --json"
                );
                expect(
                  Buffer.compare(Buffer.from(await fs.readFile("/input")), Buffer.from(original))
                ).toBe(0);
                if (response.exitCode !== 0)
                  expect(
                    Buffer.compare(
                      Buffer.from(await fs.readFile("/output")),
                      Buffer.from(destination)
                    )
                  ).toBe(0);
                expect(response.exitCode, response.stdout + response.stderr).toBe(0);
                expect(JSON.parse(response.stdout)).toMatchObject({ ok: true, errors: [] });
                memory.writeFileSync("/output", await fs.readFile("/output"));
              } finally {
                await shell.dispose();
              }
            }
            const output = new Uint8Array(memory.readFileSync("/output") as Buffer);
            expect(Buffer.compare(Buffer.from(input), Buffer.from(original))).toBe(0);
            expect(
              Buffer.compare(
                Buffer.from(new Uint8Array(memory.readFileSync("/input") as Buffer)),
                Buffer.from(original)
              )
            ).toBe(0);
            return { output, input, parts, retained, receipt };
          }

          for (const runtime of ["source", "native"] as const) {
            const product: typeof api =
              runtime === "native" ? (native as unknown as typeof api) : api;
            const limits = {
              ...textContext.limits,
              maxArchiveBytes: 2097152,
              maxEntryBytes: 1048576,
              maxTotalBytes: 4194304,
              maxRetainedBytes: 2147483648
            };
            const documentLimits = { xmlDepth: 16384, retainedBytes: 2147483648, work: 2147483648 };
            const admitted: { candidate?: Awaited<ReturnType<typeof run>> } = {};
            verified.set(runtime, new Set());
            it(`${label}; baseline=${runtime}:request`, async () => {
              const controller = new AbortController();
              let cleaned = false;
              onTestFinished(({ task }) => {
                const candidate = admitted.candidate;
                if (
                  task.result?.state === "pass" &&
                  cleaned &&
                  candidate &&
                  (runtime === "source" || candidate.receipt?.drained)
                )
                  baselines.set(runtime, candidate);
              });
              onTestFinished(() => {
                controller.abort();
                cleaned = true;
              });
              const candidate = await run(
                runtime === "native" ? "native-sdk" : "sdk",
                controller.signal
              );
              const after = readPackage(candidate.output, limits);
              expect([...after.keys()]).toEqual([...candidate.parts.keys()]);
              for (const [name, bytes] of candidate.parts)
                if (name !== "word/document.xml")
                  expect(
                    Buffer.compare(Buffer.from(after.get(name)!), Buffer.from(bytes)),
                    name
                  ).toBe(0);
              admitted.candidate = candidate;
            });
            for (const check of checks)
              it(`${label}; baseline=${runtime}:${check}`, async () => {
                const controller = new AbortController();
                let completed = false,
                  cleaned = false;
                onTestFinished(({ task }) => {
                  if (task.result?.state === "pass" && completed && cleaned)
                    verified.get(runtime)!.add(check);
                });
                onTestFinished(() => {
                  controller.abort();
                  cleaned = true;
                });
                const baseline = baselines.get(runtime);
                if (!baseline)
                  throw new Error(
                    "Revision baseline request and cleanup did not complete successfully"
                  );
                const output = baseline.output,
                  original = output.slice();
                const fresh = () => ({
                  limits,
                  signal: controller.signal,
                  budget: new product.DocumentBudget(documentLimits, controller.signal),
                  encoding: { order: "input", compression: "store" } as const
                });
                if (check === "xml") {
                  const xml = (await product.getDocumentXml(output, fresh(), {
                    part: "/word/document.xml",
                    raw: true
                  })) as Uint8Array;
                  const parsed = await product.parseDocumentXmlAsync(
                    xml,
                    { maxDepth: 16384 },
                    new product.DocumentBudget(documentLimits, controller.signal)
                  );
                  expect(parsed.root.children[0]!.children[0]!.children[0]!.localName).toBe("pPr");
                  const decoded =
                    codec === "utf8"
                      ? new TextDecoder().decode(xml)
                      : new TextDecoder(codec === "utf16le" ? "utf-16le" : "utf-16be").decode(xml);
                  const retained =
                    "<w:pPr><f:opaque>" +
                    "<f:owner>".repeat(depth) +
                    "<f:leaf/>" +
                    "</f:owner>".repeat(depth) +
                    "</f:opaque></w:pPr>";
                  expect(decoded).toContain(retained);
                } else if (check === "text")
                  expect((await product.extractDocumentText(output, fresh())).text).toBe(
                    action === "accept" ? "Inserted海🌊Outside" : "Outside"
                  );
                else
                  expect(
                    (await product.inspectDocumentRevisions(output, {}, fresh())).items
                  ).toEqual([]);
                expect(Buffer.compare(Buffer.from(output), Buffer.from(original))).toBe(0);
                completed = true;
              });
          }

          for (const route of [
            "sdk",
            "native-sdk",
            "sdk-batch",
            "native-sdk-batch",
            "cli",
            "native-cli",
            "cli-batch",
            "native-cli-batch"
          ] as const)
            it(`${label}; route=${route}`, async () => {
              const controller = new AbortController();
              onTestFinished(() => {
                controller.abort();
              });
              const runtime = route.startsWith("native") ? "native" : "source",
                baseline = baselines.get(runtime);
              if (!baseline || !checks.every((check) => verified.get(runtime)!.has(check)))
                throw new Error("Revision baseline semantics and cleanup are incomplete");
              const observed = await run(route, controller.signal);
              expect(Buffer.compare(Buffer.from(observed.input), Buffer.from(baseline.input))).toBe(
                0
              );
              expect(
                Buffer.compare(Buffer.from(observed.output), Buffer.from(baseline.output))
              ).toBe(0);
            });
        }
