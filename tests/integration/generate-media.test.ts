import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createProgram } from "../../src/cli/program.js";
import type { FileSystem } from "../../src/utils/file-system.js";

interface TestContext {
  fs: FileSystem;
  output: string;
  logs: string[];
}

let ctx: TestContext;
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

function createFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/repo", { recursive: true });
  volume.mkdirSync("/home/test", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

async function generate(args: string[], env: Record<string, string> = {}): Promise<void> {
  ctx.fs = createFs();
  const program = createProgram({
    fs: ctx.fs,
    prompts: vi.fn(),
    env: { cwd: "/repo", homeDir: "/home/test", variables: { ...process.env, ...env } },
    logger: () => {},
    suppressCommanderOutput: true
  });
  await program.parseAsync(["node", "cli", "generate", ...args]);
}

function mockDownload(bytes: number[]): void {
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    arrayBuffer: async () => new Uint8Array(bytes).buffer
  } as Response);
}

describe("generate command integration (snapshots)", () => {
  beforeEach(() => {
    ctx = { fs: createFs(), output: "", logs: [] };
    stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      ctx.output += String(chunk);
      return true;
    });
    logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      ctx.logs.push(args.join(" "));
    });
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    logSpy.mockRestore();
  });

  describe("text generation", () => {
    it("generates text response", async () => {
      await generate(["What is 2+2? Answer with just the number."]);
      expect(ctx.output).toContain("4");
    }, 30000);

    it("generates text with explicit subcommand", async () => {
      await generate(["text", "Say hello in one word."]);
      expect(ctx.output.toLowerCase()).toContain("hello");
    }, 30000);

    it("passes params to text generation", async () => {
      await generate(["--param", "temperature=0", "What is the capital of France? Answer in one word."]);
      expect(ctx.output.toLowerCase()).toContain("paris");
    }, 30000);
  });

  describe("media generation", () => {
    it("generates an image", async () => {
      mockDownload([1, 2, 3]);
      await generate(["image", "-o", "out.png", "A golden retriever sitting on a red couch."]);

      expect(await ctx.fs.readFile("/repo/out.png")).toEqual(Buffer.from([1, 2, 3]));
      expect(ctx.output).toContain("./out.png");
    }, 30000);

    it("generates a video", async () => {
      mockDownload([4, 5, 6]);
      await generate(["video", "-o", "out.mp4", "A drone flyover of a forest at sunrise."]);

      expect(await ctx.fs.readFile("/repo/out.mp4")).toEqual(Buffer.from([4, 5, 6]));
      expect(ctx.output).toContain("./out.mp4");
    }, 180000);

    it("generates audio", async () => {
      mockDownload([7, 8, 9]);
      await generate(["audio", "-o", "out.mp3", "Hello world. This is a short audio test."]);

      expect(await ctx.fs.readFile("/repo/out.mp3")).toEqual(Buffer.from([7, 8, 9]));
      expect(ctx.output).toContain("./out.mp3");
    }, 30000);

    it("passes params to image generation", async () => {
      mockDownload([10, 11, 12]);
      await generate(["image", "--param", "aspect_ratio=16:9", "-o", "wide.png", "A panoramic mountain landscape."]);

      expect(await ctx.fs.readFile("/repo/wide.png")).toEqual(Buffer.from([10, 11, 12]));
      expect(ctx.output).toContain("./wide.png");
    }, 30000);
  });

  describe("error cases", () => {
    it("shows error when text model used for image generation", async () => {
      await expect(
        generate(["image", "A simple red circle."], { POE_IMAGE_MODEL: "Claude-Haiku-4.5" })
      ).rejects.toThrow(/did not return an image/);
    }, 30000);

    it("shows error when no prompt provided", async () => {
      await expect(generate([])).rejects.toThrow(/No prompt provided/);
    });

    it("shows error for invalid param format", async () => {
      await expect(
        generate(["--param", "invalid-no-equals", "Hello"])
      ).rejects.toThrow(/Invalid param format/);
    });
  });
});
