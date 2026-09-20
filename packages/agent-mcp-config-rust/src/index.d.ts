import type {FileSystem,MutationObservers} from './config/execution.js';
export interface McpStdioServer{transport:'stdio';command:string;args?:string[];env?:Record<string,string>;}
export interface McpHttpServer{transport:'http';url:string;headers?:Record<string,string>;}
export type McpServerConfig=McpStdioServer|McpHttpServer;
export interface McpServerEntry{name:string;config:McpServerConfig;enabled?:boolean;}
export interface ApplyOptions{fs:FileSystem;homeDir:string;platform:'darwin'|'linux'|'win32';dryRun?:boolean;observers?:MutationObservers;}
export interface AgentMcpConfig{configFile:string|((platform:ApplyOptions['platform'])=>string);configKey:string;format:'json'|'toml'|'yaml';shape:'standard'|'opencode'|'goose';mcpOutputFormat?:string;}
export interface AgentSupportResult{status:'supported'|'unsupported'|'unknown';input:string;id?:string;config?:AgentMcpConfig;}
export const supportedAgents:readonly string[];
export function isSupported(agentId:string):boolean;
export function resolveAgentSupport(input:string,registry?:Record<string,AgentMcpConfig>):AgentSupportResult;
export class UnsupportedAgentError extends Error{constructor(agentId:string);}
export function configure(agentId:string,server:McpServerEntry,options:ApplyOptions):Promise<void>;
export function unconfigure(agentId:string,server:string|McpServerEntry,options:ApplyOptions):Promise<void>;
