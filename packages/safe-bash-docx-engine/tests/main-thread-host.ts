import { isMainThread } from "node:worker_threads";

export function serveFixture<Request>(run: (request: Request) => unknown): void {
  if (!isMainThread || !process.send) throw new Error("Fixture requires a main-thread IPC host");
  process.on("message", async (request: string) => {
    try { process.send!({ value: JSON.stringify(await run(JSON.parse(request))) }); }
    catch (error) { process.send!({ error: error instanceof Error ? error.stack ?? error.message : String(error) }); }
  });
  process.send({ ready: true });
}
