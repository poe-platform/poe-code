import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { errorRecord, json } from "./telemetry.mjs";

export function orderedStop(output, control, graceMs) {
  const originalSpawn = childProcess.spawn;
  const state = { control, consumerPid: process.pid, producerPid: null, events: [], sameFailureObject: false, completed: false, error: null };
  let producer, exitPromise, closePromise, callerFailure, exited = false, closed = false;
  const event = (type, fields = {}) => state.events.push({ sequence: state.events.length + 1, monotonicNs: process.hrtime.bigint().toString(), type, ...fields });
  childProcess.spawn = function (...args) {
    if (producer) throw new Error("V32_MULTIPLE_PRODUCERS");
    producer = Reflect.apply(originalSpawn, this, args);
    state.producerPid = producer.pid;
    event("spawn", { pid: producer.pid, executable: args[0], args: args[1] });
    exitPromise = new Promise(resolveExit => producer.once("exit", (status, signal) => {
      exited = true;
      state.exit = { status, signal };
      event("producer-exit", { status, signal, pipeDestroyed: producer.stdout.destroyed });
      resolveExit();
    }));
    closePromise = new Promise(resolveClose => producer.once("close", (status, signal) => {
      closed = true;
      state.close = { status, signal };
      event("producer-close", { status, signal });
      resolveClose();
    }));
    producer.stdout.once("close", () => event("pipe-close", { exited }));
    return producer;
  };
  syncBuiltinESMExports();
  return {
    async stop(error) {
      callerFailure = error;
      state.caller = { code: error.code, message: error.message };
      const deadline = performance.now() + graceMs;
      const bounded = async (promise, stage) => {
        let timer;
        try {
          await Promise.race([promise, new Promise((resolveUnused, rejectTimeout) => {
            timer = setTimeout(() => rejectTimeout(Object.assign(new Error(`V32_CLEANUP:${stage}`), { code: "V32_CLEANUP" })), Math.max(1, deadline - performance.now()));
          })]);
        } finally { clearTimeout(timer); }
      };
      try {
        if (!producer || exited || closed || producer.stdout.destroyed) throw new Error("V32_PRODUCER_NOT_OWNED_OPEN");
        event("stop-request", { reason: state.caller, pipeDestroyed: producer.stdout.destroyed });
        state.signalAccepted = producer.kill("SIGTERM");
        event("signal-return", { accepted: state.signalAccepted });
        if (!state.signalAccepted) throw new Error("V32_SIGNAL_NOT_ACCEPTED");
        await bounded(exitPromise, "exit");
        event("owned-pipe-destroy", { exited, status: producer.exitCode, signal: producer.signalCode });
        producer.stdout.destroy();
        await bounded(closePromise, "close");
        state.completed = true;
        event("throw-original", state.caller);
        return error;
      } catch (failure) {
        state.error = errorRecord(failure);
        event("cleanup-failure", { error: state.error });
        json(join(output, "ORDERED-STOP-FAILURE.json"), state);
        throw Object.assign(new Error("V32_CLEANUP_FAILED", { cause: failure }), { code: "V32_CLEANUP_FAILED" });
      }
    },
    settled(error) {
      state.sameFailureObject = error === callerFailure;
      event("core-settled", { exited, closed, sameFailureObject: state.sameFailureObject });
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      json(join(output, "ORDERED-STOP.json"), state);
      return state;
    },
  };
}
