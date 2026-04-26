import type { Command, HandlerContext } from "../index.js";
import { defaultProviderForPlatform } from "./default-provider.js";
import { ApprovalDeclinedError } from "./types.js";
import type { HumanInLoopPending, HumanInLoopProvider, HumanInLoopRuntimeOptions } from "./types.js";

const providersByRuntime = new WeakMap<HumanInLoopRuntimeOptions, HumanInLoopProvider>();
let providerWithoutRuntime: HumanInLoopProvider | undefined;

function resolveProvider(runtimeOptions: HumanInLoopRuntimeOptions | undefined): HumanInLoopProvider {
  if (runtimeOptions?.provider !== undefined) {
    return runtimeOptions.provider;
  }

  if (runtimeOptions === undefined) {
    providerWithoutRuntime ??= defaultProviderForPlatform();
    return providerWithoutRuntime;
  }

  const cachedProvider = providersByRuntime.get(runtimeOptions);
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }

  const provider = defaultProviderForPlatform();
  providersByRuntime.set(runtimeOptions, provider);
  return provider;
}

export async function invokeWithHumanInLoop<T>(
  node: Command<any, any, any, T>,
  ctx: HandlerContext<any, any, any>,
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  commandPath: string,
): Promise<T | HumanInLoopPending> {
  if (!node.humanInLoop) {
    return node.handler(ctx);
  }

  if (node.humanInLoop.mode === "async") {
    throw new Error("human-in-loop async mode not yet implemented");
  }

  const message = node.humanInLoop.message({
    params: ctx.params,
    commandPath,
  });
  const provider = resolveProvider(runtimeOptions);
  const result = await provider.requestApproval({
    message,
    declineInputPrompt: node.humanInLoop.declineInputPrompt,
  });

  if (result.outcome === "declined") {
    throw new ApprovalDeclinedError({
      reason: result.reason,
      commandPath,
    });
  }

  return node.handler(ctx);
}
