import { parentPort, workerData } from "node:worker_threads";
import { classifyScriptOutcome } from "./result.js";
import { createTest262Realm, type ScriptOutcome } from "./realm.js";
import type { AgentHost } from "./agents.js";

const port = parentPort!;
type Broadcast = { buffer: SharedArrayBuffer; id: number | bigint; messageId: number };
const messages: Broadcast[] = [];
let receive: ((message: Broadcast) => void) | undefined;
port.on("message", (message: Broadcast) => {
  port.postMessage({ type: "received", id: message.messageId });
  if (receive) { const deliver = receive; receive = undefined; deliver(message); }
  else messages.push(message);
});
const agent: AgentHost = {
  async receiveBroadcast() {
    const message = messages.shift() ?? await new Promise<Broadcast>(resolve => { receive = resolve; });
    return message;
  },
  report(message) { port.postMessage({ type: "report", message }); },
  leaving() { port.postMessage({ type: "leaving" }); }
};
const reportFailure = (outcome: ScriptOutcome) => {
  const result = classifyScriptOutcome(outcome);
  port.postMessage({ type: "error", message: result.status === "failed" ? JSON.stringify(result.detail) : "Test262 agent failed" });
};
const realm = createTest262Realm(workerData.budget, undefined, undefined, undefined, {
  agent, canBlock: true, onError: error => reportFailure({ status: "throw", phase: "runtime", error })
});
port.postMessage({ type: "ready" });
const outcome = await realm.evaluate(workerData.source);
const settlement = outcome.status === "normal" ? await realm.settle() : outcome;
if (settlement.status !== "normal") reportFailure(settlement);
