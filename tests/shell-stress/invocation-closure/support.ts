import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export { boundedProcess, fixtureBytes, head, quote, sha256, sourceHashes } from "../invocation-modes/harness.js";
export const owned = "tests/shell-stress/invocation-closure";
export async function save(name: string, value: unknown): Promise<void> {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(name)) throw new Error("Evidence filename must stay within owned directory");
  await writeFile(resolve(owned, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
export const json = async <Value>(name: string): Promise<Value> => JSON.parse(await readFile(resolve(owned, name), "utf8")) as Value;
