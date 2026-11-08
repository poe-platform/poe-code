import type {AgentDefinition,AgentCapability} from './types.js';
export type {AgentDefinition,AgentCapability,ApiShapeId,OtelCaptureDefinition} from './types.js';
export * from './agents.js';
export interface AgentSpecifier {agent:string;model?:string;}
export declare const allAgents:readonly AgentDefinition[];
export declare function resolveAgentId(input:string):string|undefined;
export declare function parseAgentSpecifier(input:string):AgentSpecifier;
export declare function formatAgentSpecifier(specifier:AgentSpecifier):string;
export declare function normalizeAgentId(input:string):string;
export declare function listAgentsWithCapability(capability:AgentCapability,options?:{includeAliases?:boolean}):readonly string[];
export declare function agentSupportsCapability(input:string,capability:AgentCapability):boolean;
export declare function formatAgentCapabilityError(input:{agent:string;capability:AgentCapability}):string;
