import type { ObjectSchema } from "toolcraft-schema";
import type { HumanInLoopConfig } from "./types.js";

type HumanInLoopValue<TParamsSchema extends ObjectSchema<any>> =
  | HumanInLoopConfig<TParamsSchema>
  | null
  | undefined;

export function validateHumanInLoopOnDefine<TParamsSchema extends ObjectSchema<any>>(config: {
  name: string;
  confirm?: boolean;
  children?: readonly unknown[];
  humanInLoop?: HumanInLoopValue<TParamsSchema>;
}): void {
  const label = Array.isArray(config.children) ? "group" : "command";

  if (config.confirm === true && config.humanInLoop !== undefined && config.humanInLoop !== null) {
    throw new Error(`${label} '${config.name}': use either confirm or humanInLoop, not both`);
  }

  if (config.humanInLoop === undefined || config.humanInLoop === null) {
    return;
  }

  if (config.humanInLoop.mode !== "sync" && config.humanInLoop.mode !== "async") {
    throw new Error(`${label} '${config.name}': humanInLoop.mode must be "sync" or "async"`);
  }

  if (typeof config.humanInLoop.message !== "function") {
    throw new Error(`${label} '${config.name}': humanInLoop.message must be a function`);
  }

  if (config.humanInLoop.plan !== undefined && typeof config.humanInLoop.plan !== "function") {
    throw new Error(`${label} '${config.name}': humanInLoop.plan must be a function`);
  }
}

export function mergeHumanInLoopFromGroup<
  TGroupParamsSchema extends ObjectSchema<any>,
  TChildParamsSchema extends ObjectSchema<any>,
>(
  groupHumanInLoop: HumanInLoopValue<TGroupParamsSchema>,
  childHumanInLoop: HumanInLoopValue<TChildParamsSchema>
): HumanInLoopValue<TChildParamsSchema> {
  if (childHumanInLoop !== undefined) {
    return childHumanInLoop;
  }

  return groupHumanInLoop as HumanInLoopValue<TChildParamsSchema>;
}
