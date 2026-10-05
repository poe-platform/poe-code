import type {
  PptxPublicationRequest,
  PptxStreamPublicationRequest
} from "../src/command-engine.js";
import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPptxCommandEngine } from "../src/command-engine.js";
import { mediaExtractionFixture } from "../../safe-bash-presentation-engine/tests/fixtures/media-extraction.js";
const encode = (text: string) => new TextEncoder().encode(text);
const deck = (payload?: string) =>
  mediaExtractionFixture(false, "video/mp4", false, payload ? encode(payload) : undefined);
for (const json of [false, true])
  for (const mode of [
    "success",
    "partial",
    "atomic",
    "preflight",
    "limit",
    "count",
    "unsupported",
    "deduplicate",
    "missing"
  ] as const)
    it(`streams media extraction ${mode}, json=${json}`, async () => {
      const bytes = deck(),
        signal = new AbortController().signal,
        engine = createPptxCommandEngine(mode === "limit" ? { maxOutputBytes: 200 } : {}),
        fs = createMemoryFileSystem(),
        chunks: Uint8Array[] = [],
        errors: Uint8Array[] = [];
      const argv = [
          "media",
          "extract",
          "/deck.pptx",
          "--output-dir",
          "/out",
          ...(mode === "deduplicate" ? ["--deduplicate"] : []),
          ...(mode === "missing" ? ["--slide", "1", "--shape", "absent"] : []),
          ...(["atomic", "unsupported"].includes(mode) ? [] : ["--allow-partial-output"]),
          ...(mode === "count" ? ["--limit", "maxOutputs=1"] : []),
          ...(json ? ["--json"] : [])
        ],
        args = argv.map(encode);
      let bufferedCount = 0,
        streamedCount = 0;
      const bufferedFiles: { path: string; bytes: Uint8Array }[] = [],
        streamedFiles: { path: string; bytes: Uint8Array }[] = [];
      const expected = await engine.execute({
        args,
        signal,
        readInput: async () => bytes,
        publishOutput: async (item: PptxPublicationRequest | PptxStreamPublicationRequest) => {
          if (item.dryRun) {
            if (mode === "preflight") throw new Error("preflight failed");
            return;
          }
          if (mode === "partial" && bufferedCount++ === 1) throw new Error("publication failed");
          bufferedFiles.push({ path: item.outputPath, bytes: item.bytes as Uint8Array });
        },
        ...(mode === "atomic"
          ? {
              publishOutputs: async (
                items: readonly import("../src/command-engine.js").PptxPublicationRequest[]
              ) => {
                for (const item of items)
                  bufferedFiles.push({ path: item.outputPath, bytes: item.bytes });
              }
            }
          : {})
      });
      const result = await engine.execute({
        args,
        signal,
        readInput: async () => {
          throw new Error("whole input forbidden");
        },
        publishOutput: async (item: PptxPublicationRequest | PptxStreamPublicationRequest) => {
          if (item.dryRun) {
            if (mode === "preflight") throw new Error("preflight failed");
            return;
          }
          if (mode === "partial" && streamedCount++ === 1) throw new Error("publication failed");
          const output: Uint8Array[] = [];
          if (item.bytes instanceof Uint8Array) throw new Error("buffered publication");
          for await (const chunk of item.bytes) output.push(new Uint8Array(chunk));
          streamedFiles.push({
            path: item.outputPath,
            bytes: new Uint8Array(Buffer.concat(output))
          });
        },
        ...(mode === "atomic"
          ? {
              publishOutputStreams: async (
                items: AsyncIterable<
                  import("../src/command-engine.js").PptxStreamPublicationRequest
                >
              ) => {
                for await (const item of items) {
                  const output: Uint8Array[] = [];
                  for await (const chunk of item.bytes) output.push(new Uint8Array(chunk));
                  streamedFiles.push({
                    path: item.outputPath,
                    bytes: new Uint8Array(Buffer.concat(output))
                  });
                }
              }
            }
          : {}),
        streaming: {
          workingStorage: { fs, directory: "/", cacheBytes: 16384 },
          openInput: async () => ({
            size: bytes.length,
            async read(p, n) {
              return bytes.subarray(p, p + n);
            },
            async *stream() {
              yield bytes;
            }
          }),
          stdout: {
            async write(bytes) {
              chunks.push(new Uint8Array(bytes));
            }
          },
          stderr: {
            async write(bytes) {
              errors.push(new Uint8Array(bytes));
            }
          }
        }
      });
      expect(result.exitCode).toBe(expected.exitCode);
      expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(
        Buffer.from(expected.stdout).toString()
      );
      expect(Buffer.concat([...errors, result.stderr]).toString()).toBe(
        Buffer.from(expected.stderr).toString()
      );
      expect(streamedFiles).toEqual(bufferedFiles);
      expect(await fs.readdir("/")).toEqual([]);
    });

async function collect(source: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of source) chunks.push(new Uint8Array(chunk));
  return Buffer.concat(chunks);
}
for (const mode of ["cancel", "sink", "transaction-failure", "manifest-limit"] as const)
  it(`preserves extraction failure reporting: ${mode}`, async () => {
    const bytes = deck(mode === "manifest-limit" ? "small" : "x".repeat(80000));
    const fs = createMemoryFileSystem(),
      engine = createPptxCommandEngine(),
      controller = new AbortController(),
      stdout: Uint8Array[] = [];
    let published = 0;
    const args = [
      "media",
      "extract",
      "/deck.pptx",
      "--output-dir",
      mode === "manifest-limit" ? "/" + "x".repeat(10000) : "/out",
      "--json",
      "--allow-partial-output",
      ...(mode === "manifest-limit" ? ["--limit", "maxOutputBytes=5000"] : [])
    ].map(encode);
    const execution = engine.execute({
      args,
      signal: controller.signal,
      readInput: async () => {
        throw new Error("buffered read forbidden");
      },
      streaming: {
        workingStorage: { fs, directory: "/", cacheBytes: 16384 },
        openInput: async () => ({
          size: bytes.length,
          async read(p, n) {
            return bytes.subarray(p, p + n);
          },
          async *stream() {
            yield bytes;
          }
        }),
        stdout: {
          async write(bytes) {
            if (mode === "sink") throw new Error("sink failed");
            stdout.push(new Uint8Array(bytes));
          }
        },
        stderr: {
          async write() {
            throw new Error("unexpected stderr");
          }
        }
      },
      publishOutput: async (item: PptxPublicationRequest | PptxStreamPublicationRequest) => {
        if (item.dryRun) return;
        if (mode === "cancel" && published === 1) {
          controller.abort();
          throw new Error("cancelled write");
        }
        await collect(item.bytes as AsyncIterable<Uint8Array>);
        published++;
      },
      ...(mode === "transaction-failure"
        ? {
            publishOutputStreams: async () => {
              throw new Error("transaction rejected");
            }
          }
        : {})
    });
    if (mode === "sink") {
      await expect(execution).rejects.toThrow("sink failed");
      expect(published).toBeGreaterThan(1);
    } else {
      const result = await execution,
        envelope = JSON.parse(Buffer.concat([...stdout, result.stdout]).toString());
      expect(result.exitCode).toBe(mode === "cancel" ? 130 : mode === "manifest-limit" ? 4 : 3);
      expect(published).toBe(mode === "cancel" ? 1 : 0);
      expect(envelope.affected).toBe(mode === "cancel" ? 1 : 0);
      if (mode === "cancel") {
        expect(envelope.data.outputs).toHaveLength(1);
        expect(envelope.errors[0].code).toBe("cancelled");
      } else expect(envelope.data).toBeNull();
    }
    expect(await fs.readdir("/")).toEqual([]);
  });

for (const mode of [
  "new",
  "nested",
  "exists",
  "force",
  "protected",
  "partial",
  "unsupported",
  "unsupported-second",
  "limit"
] as const)
  it(`default adapter extracts through retained sources: ${mode}`, async () => {
    const { createPptxCommand } = await import("../src/index.js");
    const { createCommandArguments, toByteSource } = await import("safe-bash-contracts");
    const { extractMedia } = await import("safe-bash-presentation-engine/media-extraction");
    const { resourceContext } = await import("safe-bash-presentation-engine/resource-limits");
    const bytes = deck("x".repeat(80000)),
      extracted = await extractMedia(bytes, {}, resourceContext({}));
    const parts = extracted,
      owner = createMemoryFileSystem(),
      directory = mode === "nested" ? "/new/nested" : "/out";
    await owner.mkdir("/out");
    const input = mode === "protected" ? "/out/" + parts[0]!.name : "/input.pptx";
    await owner.writeFile(input, bytes);
    if (mode === "exists" || mode === "force")
      await owner.writeFile("/out/" + parts[1]!.name, encode("keep"));
    let publications = 0,
      outstanding = 0,
      peak = 0;
    const fs = new Proxy(owner, {
      get(target, key) {
        if (key === "readFile")
          return async () => {
            throw new Error("whole-file read forbidden");
          };
        if (key === "capabilitiesFor" && mode === "unsupported-second")
          return async (path: string) => ({
            ...owner.capabilities,
            ...(path.endsWith("/" + parts[1]!.name) ? { atomicFileStaging: false } : {})
          });
        if (key === "createStagedFile")
          return async (...args: Parameters<NonNullable<typeof owner.createStagedFile>>) => {
            const staged = await owner.createStagedFile!(...args);
            const number = ++publications;
            return {
              ...staged,
              writer: {
                async write(
                  bytes: Uint8Array,
                  options?: Parameters<NonNullable<typeof staged.writer>["write"]>[1]
                ) {
                  outstanding += bytes.length;
                  peak = Math.max(peak, outstanding);
                  try {
                    await Promise.resolve();
                    if (mode === "partial" && number === 2)
                      throw new Error("injected publication failure");
                    await staged.writer!.write(bytes, options);
                  } finally {
                    outstanding -= bytes.length;
                  }
                },
                finish: staged.writer!.finish.bind(staged.writer)
              }
            };
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const args = createCommandArguments([
      "media",
      "extract",
      input,
      "--output-dir",
      directory,
      "--json",
      ...(mode === "unsupported" ? [] : ["--allow-partial-output"]),
      ...(mode === "force" || mode === "protected" ? ["--force"] : []),
      ...(mode === "limit" ? ["--limit", "maxOutputs=1"] : [])
    ]);
    const chunks: Uint8Array[] = [];
    const result = await createPptxCommand().execute({
      command: "pptx",
      args: args.args,
      argumentValues: args,
      fs,
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: {
        async write(chunk) {
          expect(chunk.length).toBeLessThanOrEqual(16384);
          chunks.push(new Uint8Array(chunk));
        }
      },
      stderr: {
        async write(chunk) {
          chunks.push(new Uint8Array(chunk));
        }
      }
    });
    const envelope = JSON.parse(Buffer.concat(chunks).toString());
    expect(result.exitCode).toBe(
      ["new", "nested", "force"].includes(mode) ? 0 : mode === "limit" ? 4 : 3
    );
    expect(outstanding).toBe(0);
    expect(peak).toBeLessThanOrEqual(16384);
    expect(await owner.readFile(input)).toEqual(bytes);
    if (result.exitCode === 0 || mode === "partial") {
      expect(envelope.data.outputs).toHaveLength(mode === "partial" ? 1 : parts.length);
      for (const item of envelope.data.outputs)
        expect(await owner.readFile(item.path)).toEqual(
          parts.find((part) => part.name === item.name)!.bytes
        );
      expect((await owner.readdir(directory)).length).toBe(mode === "partial" ? 1 : parts.length);
    } else {
      expect(publications).toBe(0);
      expect((await owner.readdir("/out")).length).toBe(
        mode === "exists" || mode === "protected" ? 1 : 0
      );
    }
    expect((await owner.readdir("/")).every((entry) => !entry.name.startsWith("."))).toBe(true);
  });
