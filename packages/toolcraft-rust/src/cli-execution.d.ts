import type {Command as CommanderCommand} from "commander";
import type {Command,CommandRequirementOptions,HandlerFs,LogLevel,RuntimeLoggerInput,RenderPrimitives,DiagnosticLogEvent} from "./index.js";
import type {HumanInLoopRuntime,HumanInLoopPending} from "./human-in-loop.js";
import type {ExecutionState} from "./cli-commands.js";
import type {CLIOutputFormats} from "./cli-policy.js";
import type {PromptStreams} from "./cli-prompts.js";
import type {ResolvedFlags} from "./cli-argv.js";
import type {OutputMode,RenderResultStatus} from "./renderer.js";
export interface CLIInvocationRuntime {signal:AbortSignal;write(chunk:string,stream?:"stdout"|"stderr"):void;flush():Promise<void>;exitCode:number;defaults?:Readonly<Record<string,Readonly<Record<string,unknown>>>>;capabilities?:Readonly<Record<string,unknown>>;}
export declare function getResolvedFlags(command:CommanderCommand):ResolvedFlags&Record<string,unknown>;
export declare function writeCLIDiagnosticEvent(event:DiagnosticLogEvent):void;
export declare function writeRichHeader(title:string):void;
export declare function isHumanInLoopPending(result:unknown):result is HumanInLoopPending;
export declare function renderHumanInLoopPending(pending:HumanInLoopPending,rootUsageName:string,outputEmitter?:((entry:string)=>void)):void;
export declare function renderCLIResult(command:Command<any,any,any,any>,commandPath:string,result:unknown,output:OutputMode,primitives:RenderPrimitives,outputFormats:CLIOutputFormats,write?:((chunk:string,stream?:"stdout"|"stderr")=>void),emitExact?:((chunk:string)=>void)):RenderResultStatus;
export declare function executeCommand<TServices extends object>(state:ExecutionState<TServices>,rootUsageName:string,services:TServices,requirementOptions:CommandRequirementOptions,runtimeFetch:typeof globalThis.fetch,humanInLoop:HumanInLoopRuntime|undefined,runtimeEnv:Record<string,string>|undefined,runtimeFs:HandlerFs|undefined,outputEmitter:((entry:string)=>void)|undefined,outputFormats:CLIOutputFormats,promptStreams:PromptStreams,diagnosticsOptions:{logLevel?:LogLevel;logger?:RuntimeLoggerInput;verboseControlEnabled:boolean},onErrorReportContext?:((context:{command:Command<TServices,any,any,any>;commandPath:string;params?:unknown;secrets?:Record<string,string|undefined>})=>void),invocation?:CLIInvocationRuntime):Promise<void>;
