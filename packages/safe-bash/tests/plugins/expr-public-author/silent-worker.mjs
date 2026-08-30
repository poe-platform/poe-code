import { parentPort } from "node:worker_threads";
if (!parentPort) throw new Error("silent startup control needs a real worker parent port");
parentPort.on("message", () => {});
