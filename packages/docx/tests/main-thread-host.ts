import { isMainThread } from "node:worker_threads";

if (!isMainThread || !process.send) throw new Error("Fixture requires a main-thread IPC host");
const fixture = await import(process.argv[2]!);
process.on("message", async (request: string) => {
  try { process.send!({ value: JSON.stringify(await fixture.run(JSON.parse(request))) }); }
  catch (error) { process.send!({ error: error instanceof Error ? error.stack ?? error.message : String(error) }); }
});
process.send({ ready: true });
