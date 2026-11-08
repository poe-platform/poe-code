import { AsyncLocalStorage } from "node:async_hooks";

export type AcpLineWriter = (line: string) => void;

const storage = new AsyncLocalStorage<AcpLineWriter>();

const defaultWriter: AcpLineWriter = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Return the writer active in the current async context, or the default
 * stdout writer if none is bound.
 */
export function getAcpWriter(): AcpLineWriter {
  return storage.getStore() ?? defaultWriter;
}

/**
 * Run `fn` with `writer` bound as the active ACP line writer. All calls to
 * `renderAgentMessage`, `renderToolStart`, `renderAcpEvent`, etc. made inside
 * `fn` (or async work awaited from `fn`) will go through `writer` instead of
 * writing to `process.stdout`.
 */
export function withAcpWriter<T>(writer: AcpLineWriter, fn: () => Promise<T>): Promise<T> {
  return storage.run(writer, fn);
}
