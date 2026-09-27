import { yieldTurn } from "safe-bash-contracts/yield";
import { pathOf } from "safe-bash-contracts/path";
import { writeDiagnostic } from "safe-bash-contracts/escaping";
import type { XmlCommandRuntime } from "safe-bash-xml-engine/io";

export const defaultRuntime: XmlCommandRuntime = {
  yieldTurn,
  pathOf,
  writeDiagnostic,
  async interruptible(operation, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const aborted = (): void => {
        signal.removeEventListener("abort", aborted);
        reject(signal.reason);
      };
      signal.addEventListener("abort", aborted, { once: true });
      try {
        Promise.resolve(operation()).then(
          (result) => {
            signal.removeEventListener("abort", aborted);
            resolve(result);
          },
          (error) => {
            signal.removeEventListener("abort", aborted);
            reject(error);
          }
        );
      } catch (error) {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    });
  }
};
