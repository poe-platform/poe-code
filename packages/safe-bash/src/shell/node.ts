import { Shell as PortableShell } from "./shell.js";
import { createWorkerKillAfterPolicy, type WorkerShellOptions } from "../worker/host.js";
import { agentWorkerPlugins } from "../plugins/worker-recipes.js";

/** Node supplies a terminable worker boundary for timeout's kill-after policy. */
export class Shell extends PortableShell {
  #requiresModules = false;
  constructor(options: WorkerShellOptions) {
    const policy = createWorkerKillAfterPolicy(() => this.commands, options, () => this.#requiresModules);
    super({ ...options, capabilities: { timeoutKillAfterPolicy: policy, ...options.capabilities } });
  }

  override use(plugin: Parameters<PortableShell["use"]>[0]): this {
    if (typeof plugin === "function" || !agentWorkerPlugins.has(plugin)) this.#requiresModules = true;
    return super.use(plugin);
  }
}
