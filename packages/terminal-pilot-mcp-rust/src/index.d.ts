import type {Server,ServerOptions,Transport,SDKTransport,SDKCompatibleTransport} from './stdio-server.js';
import type {TerminalCommand,TerminalPilotRuntime,HandlerEnvironment} from './commands.js';
type McpCommand=Omit<TerminalCommand<any,any>,'__agentKitCommandTypeInfo'>;
interface McpGroupBase{kind:'group';name:string;aliases:string[];scope?:Array<'cli'|'mcp'|'sdk'>;secrets:Record<string,{env:string;description?:string;optional?:boolean}>;children:Array<McpCommand|McpGroupBase>;}
export interface TerminalPilotMcpGroup extends McpGroupBase{readonly __agentKitGroupTypeInfo:{name:'';children:McpCommand[];ownScope:readonly ['mcp'];ownHumanInLoopMode:undefined};}
export interface TerminalPilotMcpServer extends Server{connect(transport:Transport|SDKTransport|SDKCompatibleTransport):Promise<void>;close():Promise<void>;}
export interface TerminalPilotMcpOptions extends Partial<Omit<ServerOptions,'name'|'version'|'validateToolArguments'>>{terminalPilotRuntime?:TerminalPilotRuntime;env?:HandlerEnvironment;}
export declare function createTerminalPilotMCPGroup():TerminalPilotMcpGroup;
export declare function createTerminalPilotMcpServer(options?:TerminalPilotMcpOptions):TerminalPilotMcpServer;
export declare function main():Promise<void>;
