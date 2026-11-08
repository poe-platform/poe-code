import { PassThrough, Writable } from "node:stream";

export interface PromptHarness {
  input: PassThrough & { isTTY?: boolean; setRawMode?: (enabled: boolean) => void };
  output: Writable & { columns?: number; rows?: number; isTTY?: boolean; frames: string[] };
  rawModes: boolean[];
  getOutput: () => string;
}

export function createPromptHarness(options: { tty?: boolean; columns?: number; rows?: number } = {}): PromptHarness {
  const chunks: string[] = [];
  const frames: string[] = [];
  const rawModes: boolean[] = [];
  const input = new PassThrough() as PromptHarness["input"];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      const value = String(chunk);
      chunks.push(value);
      frames.push(value);
      callback();
    }
  }) as PromptHarness["output"];

  input.isTTY = options.tty ?? true;
  input.setRawMode = (enabled: boolean) => {
    rawModes.push(enabled);
  };
  output.isTTY = options.tty ?? true;
  output.columns = options.columns ?? 80;
  output.rows = options.rows ?? 20;
  output.frames = frames;

  return {
    input,
    output,
    rawModes,
    getOutput: () => chunks.join("")
  };
}

export async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}
