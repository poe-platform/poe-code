import type { Command, HandlerContext } from "../index.js";
import { enqueueApproval, ensureApprovalList } from "./approval-tasks.js";
import { defaultProviderForPlatform } from "./default-provider.js";
import { spawnApprovalRunner } from "./spawn.js";
import { ApprovalDeclinedError } from "./types.js";
import type {
  HumanInLoopPending,
  HumanInLoopProvider,
  HumanInLoopRuntimeOptions
} from "./types.js";
import {
  assertApprovalPlanHash,
  createApprovalPlan,
  formatApprovalMessage
} from "./plan-hash.js";

const providersByRuntime = new WeakMap<HumanInLoopRuntimeOptions, HumanInLoopProvider>();
let providerWithoutRuntime: HumanInLoopProvider | undefined;

export function resolveProvider(
  runtimeOptions: HumanInLoopRuntimeOptions | undefined
): HumanInLoopProvider {
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
  options: {
    enqueueApproval?: typeof enqueueApproval;
    spawnRunner?: boolean;
  } = {}
): Promise<T | HumanInLoopPending> {
  if (!node.humanInLoop) {
    return node.handler(ctx);
  }

  const planContext = {
    params: ctx.params,
    commandPath
  };
  const baseMessage = node.humanInLoop.message(planContext);
  const approvalPlan = node.humanInLoop.plan === undefined
    ? undefined
    : createApprovalPlan(await node.humanInLoop.plan(planContext));
  const message = approvalPlan === undefined
    ? baseMessage
    : formatApprovalMessage(baseMessage, approvalPlan);

  if (node.humanInLoop.mode === "async") {
    const { tasks } = await ensureApprovalList(runtimeOptions);
    const { approvalId, pending } = await (options.enqueueApproval ?? enqueueApproval)({
      tasks,
      payload: {
        commandPath,
        params: ctx.params,
        message,
        plan: approvalPlan?.value,
        planHash: approvalPlan?.hash,
        declineInputPrompt: node.humanInLoop.declineInputPrompt
      }
    });

    if (options.spawnRunner !== false) {
      spawnApprovalRunner(approvalId, runtimeOptions as HumanInLoopRuntimeOptions);
    }

    return pending;
  }

  const provider = resolveProvider(runtimeOptions);
  const result = await provider.requestApproval({
    message,
    declineInputPrompt: node.humanInLoop.declineInputPrompt
  });

  if (result.outcome === "declined") {
    throw new ApprovalDeclinedError({
      reason: result.reason,
      commandPath
    });
  }

  if (approvalPlan !== undefined && node.humanInLoop.plan !== undefined) {
    const executionPlan = createApprovalPlan(await node.humanInLoop.plan(planContext));
    assertApprovalPlanHash(approvalPlan.hash, executionPlan.hash);
  }

  return node.handler(ctx);
}
