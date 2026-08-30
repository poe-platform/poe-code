import {
  createTimeoutCommand,
  createTimeoutCommands,
  timeoutCommands,
  type TimeoutCommandOptions,
  type TimeoutCommandsOptions,
  type TimeoutScheduler,
} from "../../../../src/commands/timeout/index.js";

const scheduler: TimeoutScheduler = {
  now: () => 0,
  setTimeout: (_callback, _milliseconds) => Object.freeze({}),
  clearTimeout: _handle => {},
};
const one: TimeoutCommandOptions = { scheduler, maxTimerMilliseconds: 7, invoke: undefined };
const many: TimeoutCommandsOptions = { ...one, replace: false };

void createTimeoutCommand(one);
void createTimeoutCommands(many);
void timeoutCommands(many);
