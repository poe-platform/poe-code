import { constants, platform } from "node:os";
import { portableTrapExtension, type TrapExtensionOptions } from "../../trap.js";
export type { TrapExtensionOptions, TrapSignalHost } from "../../trap.js";

export function trapExtension(configuration: TrapExtensionOptions = {}) {
  return portableTrapExtension({
    ...configuration,
    signalNames: configuration.signalNames ?? { ...constants.signals, ...(platform() === "darwin" ? { SIGEMT: 7 } : {}) },
  });
}
