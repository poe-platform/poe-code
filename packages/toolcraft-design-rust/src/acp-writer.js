import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage(),
  defaultWriter = (line) => process.stdout.write(`${line}\n`);
export function getAcpWriter() {
  return storage.getStore() ?? defaultWriter;
}
export function withAcpWriter(writer, operation) {
  return storage.run(writer, operation);
}
