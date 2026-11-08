import type {Command as CommanderCommand} from "commander";
import type {OutputMode} from "./renderer.js";
export interface RunErrorOptions {debugControlEnabled:boolean;debugStackMode:"trim"|"raw"|undefined;output:OutputMode;verbose:boolean;verboseControlEnabled:boolean;program?:CommanderCommand;argv?:readonly string[];rootUsageName:string;commandPath:string;outputEmitter?:((entry:string)=>void);userErrorPattern:"definition"|"runtime-user"|"usage";}
export type CLIErrorPattern={kind:"usage";message:string;rootUsageName:string;commandPath:string}|{kind:"runtime-user";message:string}|{kind:"definition"|"toolcraft-bug";error:Error;debugControlEnabled:boolean;debugStackMode:"trim"|"raw"|undefined}|{kind:"unexpected";message:string;stack:string|undefined;debugControlEnabled:boolean;debugStackMode:"trim"|"raw"|undefined};
export declare function renderCliErrorPattern(pattern:CLIErrorPattern,outputEmitter?:((entry:string)=>void)):void;
export declare function handleRunError(error:unknown,options:RunErrorOptions):Promise<void>;
export declare function appendUsagePointer(message:string,options:{rootUsageName:string;commandPath:string}):string;
export declare function formatCliCommandPath(path:string):string;
export declare function formatUnknownCommandMessage(input:string,current:CommanderCommand|undefined):string;
export declare function findCurrentCommanderCommand(program:CommanderCommand,argv:readonly string[]):CommanderCommand;
export declare function findCurrentCommanderCommandPath(program:CommanderCommand|undefined,argv:readonly string[]):string;
export declare function findUnknownCommanderCommand(program:CommanderCommand,argv:readonly string[]):{input:string;currentCommand:CommanderCommand;commandPath:string}|undefined;
export declare function configureCommanderSuggestionOutput(command:CommanderCommand,version?:string):void;
export declare function renderHttpError(error:{name:string;message:string;request:{method:string;url:string;headers:Record<string,string>;body?:unknown};response:{status:number;statusText:string;headers:Record<string,string>;body:unknown}},options:Pick<RunErrorOptions,"debugStackMode"|"verbose"|"verboseControlEnabled">):void;
