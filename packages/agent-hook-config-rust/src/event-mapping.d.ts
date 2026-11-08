import { type HookEvent } from "./configs.js";
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
export declare function getEventMappings(sourceAgentId: string, targetAgentId: string): EventMapping[];
export declare function getHandlerTypeRules(targetAgentId: string): HandlerTypeRule[];
export declare function getPlaceholderRewrites(sourceAgentId: string, targetAgentId: string): PlaceholderRewrite[];
