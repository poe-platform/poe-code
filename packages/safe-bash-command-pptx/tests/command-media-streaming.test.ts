import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createPptxCommandEngine } from "../src/command-engine.js";
import { mediaFixture } from "../../safe-bash-presentation-engine/tests/fixtures/media.js";
const encode = (value: string) => new TextEncoder().encode(value);
for (const operation of ["list", "get"])
  for (const json of [false, true])
    for (const mode of [
      {},
      { strict: true },
      { broken: true },
      { missing: true },
      { mediaOnly: true }
    ])
      it(`streams media ${operation}, json=${json}, ${JSON.stringify(mode)}`, async () => {
        const bytes = mediaFixture(mode),
          fs = createMemoryFileSystem(),
          signal = new AbortController().signal,
          engine = createPptxCommandEngine();
        const args = ["media", operation, "/deck.pptx", ...(json ? ["--json"] : [])].map(encode),
          chunks: Uint8Array[] = [],
          diagnostics: Uint8Array[] = [];
        const expected = await engine.execute({ args, signal, readInput: async () => bytes });

        const result = await engine.execute({
          args,
          signal,
          readInput: async () => {
            throw new Error("buffered input forbidden");
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
                await Promise.resolve();
                expect(bytes.length).toBeLessThanOrEqual(16384);
                chunks.push(new Uint8Array(bytes));
              }
            },
            stderr: {
              async write(bytes) {
                diagnostics.push(new Uint8Array(bytes));
              }
            }
          }
        });
        expect(result.exitCode).toBe(expected.exitCode);
        expect(Buffer.concat([...chunks, result.stdout]).toString()).toBe(
          Buffer.from(expected.stdout).toString()
        );
        expect(Buffer.concat([...diagnostics, result.stderr])).toEqual(
          Buffer.from(expected.stderr)
        );
        expect(await fs.readdir("/")).toEqual([]);
      });

for (const mode of ["success", "limit", "sink", "cancel", "storage", "read", "close"] as const)
  it(`stages media reads with bounded caller IO and cleanup: ${mode}`, async () => {
    const bytes = mediaFixture({
      shapeExtra:
        '<p:pic><p:nvPicPr><p:cNvPr id="9" name="Large"/><p:nvPr><p:extLst><p:ext uri="media"><m:media r:embed="media"><m:data>' +
        "Long 😀 &quot; media text".repeat(4000) +
        "</m:data></m:media></p:ext></p:extLst></p:nvPr></p:nvPicPr></p:pic>"
    });
    const fs = createMemoryFileSystem(),
      open = fs.open!.bind(fs),
      controller = new AbortController();
    let written = 0,
      outstanding = 0,
      peak = 0,
      handles = 0;
    fs.readFile = async () => {
      throw new Error("payload-wide read forbidden");
    };
    fs.open = async (...args) => {
      const handle = await open(...args);
      handles++;
      return new Proxy(handle, {
        get(target, key) {
          if (key === "write")
            return async (...parameters: Parameters<typeof handle.write>) => {
              if (mode === "storage") throw new Error("injected storage failure");
              written += parameters[0].length;
              outstanding += parameters[0].length;
              peak = Math.max(peak, outstanding);
              try {
                await Promise.resolve();
                return await handle.write(...parameters);
              } finally {
                outstanding -= parameters[0].length;
              }
            };
          if (key === "read")
            return async (...parameters: Parameters<typeof handle.read>) => {
              if (mode === "read") throw new Error("injected storage read failure");
              return handle.read(...parameters);
            };
          if (key === "close")
            return async (...parameters: Parameters<typeof handle.close>) => {
              handles--;
              await handle.close(...parameters);
              if (mode === "close") throw new Error("injected close failure");
            };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
    };
    const engine = createPptxCommandEngine(mode === "limit" ? { maxOutputBytes: 1000 } : {}),
      args = ["media", "list", "/deck.pptx", "--json"].map(encode),
      chunks: Uint8Array[] = [],
      reused = new Uint8Array(16384);
    const execution = engine.execute({
      args,
      signal: controller.signal,
      readInput: async () => {
        throw new Error("buffered input forbidden");
      },
      streaming: {
        workingStorage: { fs, directory: "/", cacheBytes: 16384 },
        openInput: async () => ({
          size: bytes.length,
          async read(p, n) {
            const size = Math.min(n, reused.length, bytes.length - p);
            reused.set(bytes.subarray(p, p + size));
            return reused.subarray(0, size);
          },
          async *stream() {
            for (let p = 0; p < bytes.length; p += reused.length) {
              const size = Math.min(reused.length, bytes.length - p);
              reused.set(bytes.subarray(p, p + size));
              yield reused.subarray(0, size);
              reused.fill(255);
            }
          }
        }),
        stdout: {
          async write(bytes) {
            if (mode === "sink") throw new Error("injected sink failure");
            if (mode === "cancel") controller.abort();
            await Promise.resolve();
            expect(bytes.length).toBeLessThanOrEqual(16384);
            chunks.push(new Uint8Array(bytes));
          }
        },
        stderr: {
          async write() {
            throw new Error("unexpected diagnostics");
          }
        }
      }
    });
    if (mode === "sink") await expect(execution).rejects.toThrow("injected sink failure");
    else if (mode === "cancel")
      await expect(execution).rejects.toMatchObject({ code: "cancelled" });
    else {
      const result = await execution;
      if (mode === "storage" || mode === "read" || mode === "close") {
        expect(result.exitCode).toBe(3);
        expect(chunks).toEqual([]);
      } else {
        const expected = await engine.execute({
          args,
          signal: controller.signal,
          readInput: async () => bytes
        });
        expect(result.exitCode).toBe(expected.exitCode);
        expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
        expect(written).toBeGreaterThan(16384 * 4);
        expect(peak).toBeLessThanOrEqual(16384);
        if (mode === "limit") expect(chunks).toEqual([]);
      }
    }
    expect(handles).toBe(0);
    expect(await fs.readdir("/")).toEqual([]);
  });

for (const input of ["/deck.pptx", "-"])
  it(`routes media input ${input} through the default adapter and cleans caller scratch`, async () => {
    const { createPptxCommand } = await import("../src/index.js");
    const { createCommandArguments } = await import("safe-bash-contracts");
    const owner = createMemoryFileSystem(),
      bytes = mediaFixture();
    await owner.writeFile("/deck.pptx", bytes);
    await owner.mkdir("/scratch");
    let retained = 0;
    const fs = new Proxy(owner, {
      get(target, key) {
        if (key === "readFile")
          return async () => {
            throw new Error("whole-file read forbidden");
          };
        if (key === "openReadFile")
          return async (...args: Parameters<NonNullable<typeof owner.openReadFile>>) => {
            retained++;
            return owner.openReadFile!(...args);
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const args = createCommandArguments(["media", "list", input, "--json"]),
      chunks: Uint8Array[] = [];
    const result = await createPptxCommand().execute({
      command: "pptx",
      args: args.args,
      argumentValues: args,
      cwd: "/",
      env: { TMPDIR: "/scratch" },
      fs,
      signal: new AbortController().signal,
      stdin: (async function* () {
        if (input === "-") yield bytes;
      })(),
      stdout: {
        async write(bytes) {
          chunks.push(new Uint8Array(bytes));
        }
      },
      stderr: {
        async write() {
          throw new Error("unexpected diagnostic");
        }
      }
    });
    expect(result.exitCode, Buffer.concat(chunks).toString()).toBe(0);
    if (input !== "-") expect(retained).toBeGreaterThan(0);
    expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
      ok: true,
      data: {
        occurrences: [{ kind: "video" }, { kind: "video" }, { kind: "audio" }, { kind: "audio" }],
        playbackVerified: false
      }
    });
    expect(await owner.readdir("/scratch")).toEqual([]);
  });

for (const shape of ["Clip 2", "missing", "duplicate"])
  for (const json of [false, true])
    it(`streams exact media selection diagnostics for ${shape}, json=${json}`, async () => {
      const shapeExtra =
        shape === "duplicate"
          ? Array.from(
              { length: 120 },
              (_, i) =>
                '<p:sp><p:nvSpPr><p:cNvPr id="' +
                (i + 10) +
                '" name="duplicate"/></p:nvSpPr></p:sp>'
            ).join("")
          : "";
      const bytes = mediaFixture({ shapeExtra }),
        fs = createMemoryFileSystem(),
        signal = new AbortController().signal,
        engine = createPptxCommandEngine();
      const args = [
          "media",
          "get",
          "/deck.pptx",
          "--slide",
          "1",
          "--shape",
          shape,
          ...(json ? ["--json"] : [])
        ].map(encode),
        chunks: Uint8Array[] = [],
        diagnostics: Uint8Array[] = [];
      const expected = await engine.execute({ args, signal, readInput: async () => bytes });
      const result = await engine.execute({
        args,
        signal,
        readInput: async () => {
          throw Error("buffering forbidden");
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
              chunks.push(new Uint8Array(bytes));
            }
          },
          stderr: {
            async write(bytes) {
              diagnostics.push(new Uint8Array(bytes));
            }
          }
        }
      });
      expect(result.exitCode).toBe(expected.exitCode);
      expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
      expect(Buffer.concat([...diagnostics, result.stderr])).toEqual(Buffer.from(expected.stderr));
      if (shape === "duplicate" && json)
        expect(
          JSON.parse(Buffer.concat(chunks).toString()).errors[0].context.candidates
        ).toHaveLength(120);
      expect(await fs.readdir("/")).toEqual([]);
    });

for (const kind of ["slide", "part", "object"] as const)
  it(`preserves media token selection: ${kind}`, async () => {
    const { readSelectionIndex } =
      await import("../../safe-bash-presentation-engine/src/selectors.js");
    const { resourceContext } =
      await import("../../safe-bash-presentation-engine/src/resource-limits.js");
    const bytes = mediaFixture(),
      index = await readSelectionIndex(bytes, resourceContext({}));
    const record = (
      kind === "slide" ? index.slides : kind === "part" ? index.parts : index.objects
    ).find((record) => record.part === "/slide.xml")!;
    const args = ["media", "list", "/deck.pptx", "--select", record.token, "--json"].map(encode),
      signal = new AbortController().signal,
      fs = createMemoryFileSystem(),
      engine = createPptxCommandEngine(),
      chunks: Uint8Array[] = [];
    const expected = await engine.execute({ args, signal, readInput: async () => bytes });
    const result = await engine.execute({
      args,
      signal,
      readInput: async () => {
        throw Error("buffering forbidden");
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
            chunks.push(new Uint8Array(bytes));
          }
        },
        stderr: {
          async write() {
            throw Error("unexpected error");
          }
        }
      }
    });
    expect(result.exitCode).toBe(expected.exitCode);
    expect(Buffer.concat([...chunks, result.stdout])).toEqual(Buffer.from(expected.stdout));
    expect(result.stderr).toEqual(expected.stderr);
    expect(await fs.readdir("/")).toEqual([]);
  });
