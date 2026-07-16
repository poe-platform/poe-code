// Output sinks for the injected-stream seam that `runCli` and `runExampleFile` write through.
// Lives outside src/ because it is test-only: tsconfig builds src/ minus *.test.ts, so a helper
// here cannot reach dist the way a src/ sibling would.

export type Sink = {
  output: () => string;
  write: (chunk: string) => void;
};

export function createSink(): Sink {
  const chunks: string[] = [];

  return {
    output: () => chunks.join(""),
    write: (chunk) => {
      chunks.push(chunk);
    }
  };
}

export function createBrokenPipeSink(options: { failAfterWrites: number }): Sink {
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
