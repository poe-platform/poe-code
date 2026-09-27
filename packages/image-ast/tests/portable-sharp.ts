import sharp from "../src/index.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";

export async function run(): Promise<boolean> {
  if ("Buffer" in globalThis || "process" in globalThis) throw new Error("Node globals present");
  const fs = new MemoryFileSystem();
  const input = sharp({ create: { width: 2, height: 2, channels: 3, background: "red" }, filesystem: fs });
  await input.png().toFile("/input.png");
  const info = await sharp("/input.png", { filesystem: fs }).resize(1, 1).toFile("/output.png");
  if (info.width !== 1 || !(await fs.readFile("/output.png")).length) throw new Error("file workflow failed");
  const stream = sharp().png();
  const web = stream as unknown as { readonly writable: WritableStream<Uint8Array>; readonly readable: ReadableStream<Uint8Array> };
  await new ReadableStream<Uint8Array>({ async start(controller) { controller.enqueue(await fs.readFile("/input.png")); controller.close(); } }).pipeTo(web.writable);
  const reader = web.readable.getReader();
  if (!(await reader.read()).value?.length || !(await reader.read()).done) throw new Error("stream workflow failed");
  const missing = sharp("/missing.png", { filesystem: fs }) as unknown as { readable: ReadableStream<Uint8Array> };
  let missingRejected = false;
  try { await missing.readable.getReader().read(); } catch { missingRejected = true; }
  if (!missingRejected) throw new Error("missing file must reject the readable stream");
  const cancelled = sharp();
  const pendingClone = cancelled.clone();
  await (cancelled as unknown as { writable: WritableStream<Uint8Array> }).writable.abort(new Error("caller stop"));
  const result = await Promise.race([
    Promise.all([cancelled, pendingClone, cancelled.clone()].map(image => image.toBuffer().then(() => "resolved", error => (error as Error).message))).then(results => results.join(",")),
    new Promise<string>(resolve => setTimeout(() => resolve("pending"), 100)),
  ]);
  if (result !== "caller stop,caller stop,caller stop") throw new Error(`cancelled output: ${result}`);
  const invalid = sharp();
  const invalidWeb = invalid as unknown as { writable: WritableStream<unknown>; readable: ReadableStream<Uint8Array> };
  try { await invalidWeb.writable.getWriter().write("invalid bytes"); } catch { /* Expected write failure. */ }
  const invalidResult = await Promise.race([
    invalidWeb.readable.getReader().read().then(() => "resolved", () => "rejected"),
    new Promise<string>(resolve => setTimeout(() => resolve("pending"), 100)),
  ]);
  if (invalidResult !== "rejected") throw new Error(`invalid write readable: ${invalidResult}`);
  return true;
}
