import { createRequire } from "node:module";
const native = createRequire(import.meta.url)("./toolcraft-rust.node");
const machine = JSON.parse(native.approvalStateMachineJson());
Object.freeze(machine.states);
for (const event of Object.values(machine.events)) {
  Object.freeze(event.from);
  Object.freeze(event);
}
Object.freeze(machine.events);
export const approvalStateMachine = Object.freeze(machine);
