import { isDeepStrictEqual } from "node:util";

export function terminalPredicate(record, policy) {
  let stage = "case-only";
  function requireProof(condition, reason) {
    stage = reason;
    if (!condition) throw new Error(reason);
  }
  try {
    requireProof(record.control === "consumer-failure", "case-only");
    const consumer = record.consumer?.value, producer = record.producer?.value;
    requireProof(Boolean(consumer && producer), "receipts");
    requireProof(record.closeObserved === true && record.consumerState?.state === "absent" && record.producerState?.state === "absent" && isDeepStrictEqual(record.membersAtClose, []) && isDeepStrictEqual(record.remainingGroupMembers, []), "reap-barrier");
    requireProof(record.code === 17 && record.signal === null && isDeepStrictEqual(record.signalsSent, []) && isDeepStrictEqual(record.unexpected, []), "consumer-status");
    const elapsed = Date.parse(record.harnessSettlementAt) - Date.parse(record.started);
    requireProof(Number.isFinite(elapsed) && elapsed >= 0 && elapsed < policy.controlDeadlineMs, "bounded-settlement");
    const failure = consumer.failure, observation = consumer.consumerObservation;
    requireProof(failure?.code === "V3_CONSUMER_FAILURE" && failure.message === "CONTROL_BOUNDARY:V3_CONSUMER_FAILURE" && record.forwardedFailureCode === failure.code && record.forwardedFailureMessage === failure.message && observation?.sameFailureObject === true, "exact-caller-failure");
    requireProof(Number.isSafeInteger(consumer.pid) && consumer.pid > 0 && Number.isSafeInteger(producer.pid) && producer.pid > 0 && consumer.pid !== producer.pid && consumer.pid === record.pid && producer.pid === record.producerPid && producer.ppid === consumer.pid && observation.consumerPid === consumer.pid && observation.producerPid === producer.pid && record.consumerState.pid === consumer.pid && record.producerState.pid === producer.pid, "pid-binding");
    const caller = observation.caller;
    requireProof(typeof observation.token === "string" && /^[a-f0-9-]{36}$/u.test(observation.token) && caller?.token === observation.token && caller.control === record.control && caller.consumerPid === consumer.pid && caller.producerPid === producer.pid && caller.code === failure.code && caller.message === failure.message && caller.chunks === 16 && consumer.flow.chunks === 16, "caller-context");
    requireProof(observation.spawn?.pid === producer.pid && observation.spawn.consumerPid === consumer.pid && isDeepStrictEqual(observation.spawn.stdio, ["ignore", "pipe", "pipe"]), "pipe-binding");
    const events = observation.events;
    requireProof(Array.isArray(events) && events.length === 6 && events.every((event, index) => event.sequence === index + 1), "chronology");
    const only = type => events.filter(event => event.type === type);
    requireProof(["producer-spawn", "caller-failure", "consumer-pipe-close", "producer-exit", "producer-close", "core-settled"].every(type => only(type).length === 1), "chronology");
    const spawn = only("producer-spawn")[0], thrown = only("caller-failure")[0], pipe = only("consumer-pipe-close")[0], exit = only("producer-exit")[0], close = only("producer-close")[0], settled = only("core-settled")[0];
    requireProof(spawn.sequence < thrown.sequence && thrown.sequence < pipe.sequence && pipe.sequence < close.sequence && thrown.sequence < exit.sequence && exit.sequence < close.sequence && close.sequence < settled.sequence && pipe.destroyed === true && settled.stdoutDestroyed === true && observation.producerAtSettlement === "absent", "core-barrier");
    requireProof(Object.entries(caller).every(([key, value]) => thrown[key] === value), "event-context");
    const terminal = failure.process;
    requireProof(terminal && terminal.status === producer.status && terminal.signal === producer.signal && exit.status === producer.status && exit.signal === producer.signal && close.status === producer.status && close.signal === producer.signal && terminal.timedOut === false && terminal.stderrOverflow === false && terminal.processError === undefined, "terminal-status");
    if (producer.status === null && producer.signal === "SIGTERM") {
      requireProof(producer.uncaught === null, "signal-error-context");
      return { accepted: true, reason: "original-SIGTERM", terminal: "SIGTERM" };
    }
    requireProof(producer.status === 1 && producer.signal === null, "epipe-exit-status");
    const observed = producer.uncaught;
    requireProof(observed?.event === "uncaughtExceptionMonitor", "structured-observation");
    requireProof(observed.error?.code === "EPIPE", "error-code");
    requireProof(observed.error.syscall === "write", "error-syscall");
    requireProof(observed.error.errno === -32 && observed.error.name === "Error" && ["uncaughtException", "unhandledRejection"].includes(observed.origin), "error-context");
    requireProof(observed.pid === producer.pid && observed.ppid === consumer.pid && observed.token === observation.token, "observer-binding");
    requireProof(observed.stdoutErrorMonitorObserved === true && observed.stdoutErrorSameObject === true && observed.stdoutFd === 1, "stdout-error-identity");
    requireProof(observed.callerReadError === null && isDeepStrictEqual(observed.caller, caller), "closed-consumer-context");
    return { accepted: true, reason: "structured-closed-consumer-EPIPE", terminal: "exit1/EPIPE" };
  } catch (error) {
    return { accepted: false, reason: stage, detail: error.message, terminal: null };
  }
}
