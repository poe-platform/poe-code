import {
  getAgentConfig,
  supportedHookAgents,
  type AgentHookConfig,
  type HookEvent,
  type HookHandlerType
} from "./configs.js";

export interface EventMapping {
  /** Source event name as written by the source agent. */
  sourceEvent: string;
  /** Target event name. `null` means "drop this hook entirely". */
  targetEvent: HookEvent | null;
  /** Human-readable reason used in drop warnings. */
  dropReason?: string;
}

export interface HandlerTypeRule {
  sourceType: string;
  allowed: boolean;
  dropReason?: string;
}

export interface PlaceholderRewrite {
  /** Source placeholder, matched as an exact substring. */
  from: string;
  /** Target placeholder, substituted as an exact substring. */
  to: string;
}

type PlaceholderKey = keyof AgentHookConfig["placeholders"];

function requireAgentConfig(agentId: string): AgentHookConfig {
  const config = getAgentConfig(agentId);
  if (!config) {
    throw new Error(`Unknown hook agent "${agentId}"`);
  }

  return config;
}

export function getEventMappings(sourceAgentId: string, targetAgentId: string): EventMapping[] {
  const source = requireAgentConfig(sourceAgentId);
  const target = requireAgentConfig(targetAgentId);

  return source.supportedEvents.map((sourceEvent) => {
    if (target.supportedEvents.includes(sourceEvent)) {
      return { sourceEvent, targetEvent: sourceEvent };
    }

    return {
      sourceEvent,
      targetEvent: null,
      dropReason: `${targetAgentId} has no ${sourceEvent} hook`
    };
  });
}

export function getHandlerTypeRules(targetAgentId: string): HandlerTypeRule[] {
  const target = requireAgentConfig(targetAgentId);
  const registeredTypes = supportedHookAgents.flatMap(
    (agentId) => requireAgentConfig(agentId).supportedHandlerTypes
  );
  const sourceTypes = [...new Set<HookHandlerType>(registeredTypes)];
  const supportedTypes = target.supportedHandlerTypes
    .map((handlerType) => `"${handlerType}"`)
    .join(", ");

  return sourceTypes.map((sourceType) => {
    if (target.supportedHandlerTypes.includes(sourceType)) {
      return { sourceType, allowed: true };
    }

    return {
      sourceType,
      allowed: false,
      dropReason: `${targetAgentId} only honors handlers of type ${supportedTypes}`
    };
  });
}

export function getPlaceholderRewrites(
  sourceAgentId: string,
  targetAgentId: string
): PlaceholderRewrite[] {
  const source = requireAgentConfig(sourceAgentId);
  const target = requireAgentConfig(targetAgentId);

  return (Object.keys(source.placeholders) as PlaceholderKey[]).flatMap((key) => {
    const from = source.placeholders[key];
    const to = target.placeholders[key];

    if (!from || !to || from === to) {
      return [];
    }

    return [{ from, to }];
  });
}
