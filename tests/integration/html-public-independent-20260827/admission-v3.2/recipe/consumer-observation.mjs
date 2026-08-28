import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { json } from "./telemetry.mjs";

export function observeConsumerFailure(output) {
  const originalSpawn = childProcess.spawn;
  const state = { token: randomUUID(), consumerPid: process.pid, producerPid: null, events: [], caller: null, sameFailureObject: false };
  let callerFailure, producer;
  function event(type, fields = {}) {
    const row = { sequence: state.events.length + 1, monotonicNs: process.hrtime.bigint().toString(), type, ...fields };
    state.events.push(row);
    return row;
  }
  childProcess.spawn = function (...args) {
    const child = Reflect.apply(originalSpawn, this, args);
    producer = child;
    state.producerPid = child.pid;
    state.spawn = { executable: args[0], args: args[1], stdio: args[2].stdio, pid: child.pid, consumerPid: process.pid };
    event("producer-spawn");
    child.stdout.once("close", () => event("consumer-pipe-close", { destroyed: child.stdout.destroyed }));
    child.once("exit", (status, signal) => event("producer-exit", { status, signal }));
    child.once("close", (status, signal) => event("producer-close", { status, signal }));
    return child;
  };
  syncBuiltinESMExports();
  return {
    token: state.token,
    caller(error, chunks) {
      callerFailure = error;
      state.caller = { token: state.token, control: "consumer-failure", consumerPid: process.pid, producerPid: producer.pid, chunks, code: error.code, message: error.message };
      event("caller-failure", state.caller);
      json(join(output, "CALLER-FAILURE.json"), state.caller);
      return error;
    },
    settled(error) {
      event("core-settled", { stdoutDestroyed: producer?.stdout.destroyed ?? null });
      state.sameFailureObject = error === callerFailure;
      try { process.kill(state.producerPid, 0); state.producerAtSettlement = "live-or-zombie"; }
      catch (probeError) { state.producerAtSettlement = probeError.code === "ESRCH" ? "absent" : "unknown"; }
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      json(join(output, "CONSUMER-OBSERVATION.json"), state);
      return state;
    },
  };
}
