import { describe, expect, it } from "vitest";

import { runExampleFile } from "./example-runner.js";

function createSink(): {
  output: () => string;
  write: (chunk: string) => void;
} {
  const chunks: string[] = [];

  return {
    output: () => chunks.join(""),
    write: (chunk) => {
      chunks.push(chunk);
    }
  };
}

function createBrokenPipeSink(options: { failAfterWrites: number }): {
  output: () => string;
  write: (chunk: string) => void;
} {
  const sink = createSink();
  let writes = 0;

  return {
    output: sink.output,
    write(chunk) {
      if (writes >= options.failAfterWrites) {
        throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
      }
      writes += 1;
      sink.write(chunk);
    }
  };
}

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("runExampleFile", () => {
  it("prints own messages from thrown non-Error values", async () => {
    const stderr = createSink();

    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () => {
        throw { message: "configured failure" };
      },
      stderr,
      stdout: createSink()
    });

    expect(exitCode).toBe(1);
    expect(stderr.output()).toBe("configured failure\n");
  });

  it("ignores inherited messages from thrown non-Error values", async () => {
    const stderr = createSink();

    await withObjectPrototypeProperties({ message: "polluted failure" }, async () => {
      const exitCode = await runExampleFile("/repo/example.md", {
        readFile: async () => {
          throw {};
        },
        stderr,
        stdout: createSink()
      });

      expect(exitCode).toBe(1);
      expect(stderr.output()).toBe("[object Object]\n");
    });
  });

  it("treats stdout EPIPE as a clean early exit", async () => {
    const stdout = createBrokenPipeSink({ failAfterWrites: 1 });
    const stderr = createSink();
    const source = [
      "```js",
      'import { info } from "log";',
      'info("one");',
      'info("two");',
      "return 1;",
      "```"
    ].join("\n");

    const exitCode = await runExampleFile("/repo/example.md", {
      readFile: async () => source,
      stderr,
      stdout
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      type: "info",
      args: ["one"]
    });
    expect(stderr.output()).toBe("");
  });
});
