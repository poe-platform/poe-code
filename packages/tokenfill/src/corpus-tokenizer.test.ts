import { beforeEach, describe, expect, it, vi } from "vitest";
import { get_encoding } from "tiktoken";
import { BUILT_IN_CORPUS_ARTICLES, CORPUS_ARTICLE_SEPARATOR } from "./corpus.js";
import { runCli } from "./cli.js";
import { tokenfill } from "./tokenfill.js";

// === tokenizer.test.ts ===

vi.mock("tiktoken", () => ({
  get_encoding: vi.fn((_encoding: string) => {
    const textEncoder = new TextEncoder();
    return {
      encode: (text: string): Uint32Array =>
        Uint32Array.from([...text].map((ch) => ch.codePointAt(0)!)),
      decode: (tokens: Uint32Array): Uint8Array =>
        textEncoder.encode(String.fromCodePoint(...tokens)),
      free: vi.fn()
    };
  })
}));

vi.mock("./tokenfill.js", () => ({
  tokenfill: vi.fn((count: number, options?: { encoding?: string }) => ({
    text: `generated(${options?.encoding ?? "cl100k_base"}):${count}`,
    actualTokens: count
  }))
}));

import { countTokens, createTokenizer, DEFAULT_ENCODING } from "./index.js";

describe("tokenizer wrapper", () => {
  it("exports countTokens from the package barrel", () => {
    expect(countTokens("hello world")).toBe(11);
  });

  it("uses cl100k_base as default encoding", () => {
    const tokenizer = createTokenizer();

    expect(DEFAULT_ENCODING).toBe("cl100k_base");
    expect(tokenizer.encoding).toBe("cl100k_base");
  });

  it("wraps encode and decode for the configured encoding", () => {
    const tokenizer = createTokenizer({ encoding: "cl100k_base" });
    const text = "hello world";

    const tokens = tokenizer.encode(text);
    expect(tokens.length).toBe(11);
    expect(tokenizer.decode(tokens)).toBe(text);
  });

  it.each([
    ["fractional", [1.5]],
    ["NaN", [Number.NaN]],
    ["negative", [-1]]
  ])("rejects %s token ids before decoding", (_label, tokens) => {
    const tokenizer = createTokenizer();

    expect(() => tokenizer.decode(tokens)).toThrow(
      "token id at index 0 must be a finite non-negative integer."
    );
  });

  it("rejects decode output that would corrupt UTF-8 text", () => {
    vi.mocked(get_encoding).mockReturnValueOnce({
      encode: (): Uint32Array => Uint32Array.from([1]),
      decode: () => Uint8Array.from([0xf0, 0x9f]),
      free: vi.fn()
    } as never);
    const tokenizer = createTokenizer();

    expect(() => tokenizer.decode(Uint32Array.from([1]))).toThrow(
      "Cannot decode tokens without corrupting UTF-8 text."
    );
  });

  it.each([
    ["hello", 5],
    ["hello world", 11],
    ["The quick brown fox jumps over the lazy dog.", 44],
    ["今天天气很好，我们去公园散步吧。", 16]
  ])("counts tokens accurately for %s", (text, expectedCount) => {
    const tokenizer = createTokenizer();

    expect(tokenizer.count(text)).toBe(expectedCount);
  });

  it("passes encoding option through to tiktoken", async () => {
    const { get_encoding } = await import("tiktoken");
    const o200kTokenizer = createTokenizer({ encoding: "o200k_base" });

    expect(o200kTokenizer.encoding).toBe("o200k_base");
    expect(get_encoding).toHaveBeenCalledWith("o200k_base");
  });

  it("truncates to an exact token count", () => {
    const tokenizer = createTokenizer();
    const text = "The quick brown fox jumps over the lazy dog.";
    const truncated = tokenizer.truncate(text, 5);

    expect(tokenizer.count(truncated)).toBe(5);
  });

  it("rejects invalid truncation token counts", () => {
    const tokenizer = createTokenizer();

    expect(() => tokenizer.truncate("hello world", 1.5)).toThrow(
      "tokenCount must be a non-negative integer, received 1.5"
    );
    expect(() => tokenizer.truncate("hello world", Number.NaN)).toThrow(
      "tokenCount must be a non-negative integer, received NaN"
    );
  });

  it("rejects truncation when a token prefix would corrupt Unicode text", () => {
    vi.mocked(get_encoding).mockReturnValueOnce({
      encode: (text: string): Uint32Array =>
        text === "👨" ? Uint32Array.from([1, 2]) : Uint32Array.from([3]),
      decode: () => Uint8Array.from([0xf0, 0x9f]),
      free: vi.fn()
    } as never);
    const tokenizer = createTokenizer();

    expect(() => tokenizer.truncate("👨", 1)).toThrow(
      "Cannot truncate text to exactly 1 tokens without corrupting UTF-8 text."
    );
  });
});

// === corpus.test.ts ===

function getArticleTitle(article: string): string {
  const [firstLine = ""] = article.split("\n", 1);
  return firstLine.startsWith("# ") ? firstLine.slice(2).trim() : firstLine.trim();
}

describe("built-in corpus", () => {
  it("loads separate markdown articles", () => {
    expect(BUILT_IN_CORPUS_ARTICLES.length).toBeGreaterThan(40);

    for (const article of BUILT_IN_CORPUS_ARTICLES) {
      expect(article.startsWith("# ")).toBe(true);
      expect(article.length).toBeGreaterThan(1_000);
    }
  });

  it("contains distinct topics", () => {
    const titles = BUILT_IN_CORPUS_ARTICLES.map(getArticleTitle);

    expect(new Set(titles).size).toBe(titles.length);
  });

  it("has a large corpus payload", () => {
    const corpusText = BUILT_IN_CORPUS_ARTICLES.join(CORPUS_ARTICLE_SEPARATOR);

    expect(corpusText.length).toBeGreaterThanOrEqual(10_000_000);
    expect(corpusText.length).toBeLessThanOrEqual(14_000_000);
  });
});

// === cli.test.ts ===

interface CapturedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly io: {
    stdout: { write: (chunk: string | Uint8Array) => boolean };
    stderr: { write: (chunk: string | Uint8Array) => boolean };
  };
}

function createCapturedOutput(): CapturedOutput {
  let stdout = "";
  let stderr = "";

  const append = (chunk: string | Uint8Array): string =>
    typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      stdout: {
        write: (chunk) => {
          stdout += append(chunk);
          return true;
        }
      },
      stderr: {
        write: (chunk) => {
          stderr += append(chunk);
          return true;
        }
      }
    }
  };
}

const tokenfillMock = vi.mocked(tokenfill);

describe("tokenfill CLI", () => {
  beforeEach(() => {
    tokenfillMock.mockReset();
    tokenfillMock.mockImplementation((count: number, options?: { encoding?: string }) => ({
      text: `generated(${options?.encoding ?? "cl100k_base"}):${count}`,
      actualTokens: count
    }));
  });

  it("outputs generated text to stdout and stats to stderr", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["18"], output.io);

    expect(exitCode).toBe(0);
    expect(output.stdout).toBe("generated(cl100k_base):18");
    expect(output.stderr).toContain("Generated 18 tokens using cl100k_base");
    expect(tokenfillMock).toHaveBeenCalledWith(18, { encoding: "cl100k_base" });
  });

  it("outputs structured JSON to stdout with --json", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["9", "--json"], output.io);
    const payload = JSON.parse(output.stdout) as {
      text: string;
      stats: { requestedTokens: number; actualTokens: number; encoding: string };
    };

    expect(exitCode).toBe(0);
    expect(payload.stats.requestedTokens).toBe(9);
    expect(payload.stats.actualTokens).toBe(9);
    expect(payload.stats.encoding).toBe("cl100k_base");
    expect(payload.text).toBe("generated(cl100k_base):9");
    expect(output.stderr).toBe("");
    expect(tokenfillMock).toHaveBeenCalledWith(9, { encoding: "cl100k_base" });
  });

  it("applies --tokenizer to set the encoding", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["12", "--tokenizer", "o200k_base", "--json"], output.io);
    const payload = JSON.parse(output.stdout) as {
      text: string;
      stats: { actualTokens: number; encoding: string };
    };

    expect(exitCode).toBe(0);
    expect(payload.stats.encoding).toBe("o200k_base");
    expect(payload.stats.actualTokens).toBe(12);
    expect(payload.text).toBe("generated(o200k_base):12");
    expect(tokenfillMock).toHaveBeenCalledWith(12, { encoding: "o200k_base" });
  });

  it("returns non-zero and prints to stderr for runtime errors", async () => {
    tokenfillMock.mockImplementationOnce(() => {
      throw new Error("exceeds built-in corpus size");
    });

    const output = createCapturedOutput();
    const exitCode = await runCli(["999999999"], output.io);

    expect(exitCode).toBe(1);
    expect(output.stderr).toContain("exceeds built-in corpus size");
  });

  it("uses commander parsing for invalid options", async () => {
    const output = createCapturedOutput();
    const exitCode = await runCli(["5", "--unsupported"], output.io);

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stderr).toContain("unknown option '--unsupported'");
  });

  it.each(["0x10", "1e2", "010"])("rejects non-plain-decimal count syntax %s", async (count) => {
    const output = createCapturedOutput();
    const exitCode = await runCli([count, "--json"], output.io);

    expect(exitCode).toBeGreaterThan(0);
    expect(output.stdout).toBe("");
    expect(output.stderr).toContain("count must be a non-negative decimal integer");
    expect(tokenfillMock).not.toHaveBeenCalled();
  });
});
