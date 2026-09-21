import type {NewSessionOptions,TerminalSession} from './index.js';
export declare const SESSION_ENV_VAR='TERMINAL_PILOT_SESSION';
export type TerminalSessionLike=Pick<TerminalSession,'id'|'command'|'pid'|'exitCode'|'fill'|'type'|'press'|'signal'|'waitFor'|'waitForExit'|'screen'|'history'|'resize'|'close'>;
export type TerminalPilotLike={newSession(options:NewSessionOptions):Promise<TerminalSessionLike>;getSession(id:string):TerminalSessionLike;deleteSession(id:string):void;sessions():TerminalSessionLike[];close():Promise<void>};
export interface HandlerEnvironment{get(key:string):string|undefined;}
export interface NamedSession{name:string;session:TerminalSessionLike;}
export interface TerminalPilotRuntime{
 createSession(params:NewSessionOptions&{session?:string},env?:HandlerEnvironment):Promise<NamedSession>;
 resolveSession(name:string|undefined,env?:HandlerEnvironment):Promise<NamedSession>;
 closeSession(name:string|undefined,env?:HandlerEnvironment):Promise<{exitCode:number;name:string}>;
 listSessions():Promise<NamedSession[]>;hasRetainedSessions():Promise<boolean>;close():Promise<void>;
}
export declare function createTerminalPilotRuntime(options?:{launchPilot?:()=>Promise<TerminalPilotLike>}):TerminalPilotRuntime;
export interface TerminalPilotCommandServices{terminalPilotRuntime?:TerminalPilotRuntime;}
type ValueSchema<T>=T extends string?{kind:'string'}:T extends number?{kind:'number'}:T extends boolean?{kind:'boolean'}:T extends Array<infer I>?{kind:'array';item:ValueSchema<I>}:{kind:'object';shape:Record<string,any>};
type ParamsSchema<T extends object>={kind:'object';shape:{[K in keyof T]-?:undefined extends T[K]?{kind:'optional';inner:ValueSchema<Exclude<T[K],undefined>>}:ValueSchema<T[K]>}};
type Secrets=Record<string,{env:string;description?:string;optional?:boolean}>;
export interface TerminalCommand<TParams extends object=Record<string,unknown>,TResult=unknown,TName extends string=string,TSchema extends {kind:'object';shape:Record<string,any>}=ParamsSchema<TParams>> {
 kind:'command';name:string;description?:string;title?:string;annotations?:{readOnlyHint?:boolean;destructiveHint?:boolean;idempotentHint?:boolean;openWorldHint?:boolean};
 hidden:boolean;examples:Array<{title:string;params:Record<string,unknown>}>;aliases:string[];positional:string[];params:TSchema;
 result?:any;secrets:Secrets;scope:Array<'cli'|'mcp'|'sdk'>;confirm:boolean;
 handler(context:TerminalPilotCommandServices&{params:TParams;env?:HandlerEnvironment}):TResult|Promise<TResult>;
 readonly __agentKitCommandTypeInfo:{name:TName;params:TSchema;result:TResult;ownScope:readonly ['cli','mcp','sdk'];ownHumanInLoopMode:undefined};
}
export interface TerminalCommandGroup{kind:'group';name:string;aliases:string[];scope:Array<'cli'|'mcp'|'sdk'>;secrets:Secrets;children:TerminalCommand<any,any>[];}
export declare function createTerminalPilotGroup():TerminalCommandGroup;
export declare const terminalPilotGroup:Readonly<TerminalCommandGroup>;
type SelectSession={session?:string};
type ExitResult={exitCode:number};
export declare const createSession:TerminalCommand<Omit<NewSessionOptions,'env'>&SelectSession,{session:string;pid:number},'create-session'>;
export declare const fill:TerminalCommand<{text:string}&SelectSession,undefined,'fill'>,type:TerminalCommand<{text:string}&SelectSession,undefined,'type'>;
export declare const pressKey:TerminalCommand<{key:string}&SelectSession,undefined,'press-key'>;
export declare const sendSignal:TerminalCommand<{signal:string}&SelectSession,undefined,'send-signal'>;
type WaitParams={pattern:string;timeout?:number;scope?:'history'|'screen';literal?:boolean}&SelectSession;
type WaitSchema={kind:'object';shape:Omit<ParamsSchema<WaitParams>['shape'],'scope'>&{scope:{kind:'optional';inner:{kind:'enum';values:readonly ['history','screen']}}}};
export declare const waitFor:TerminalCommand<WaitParams,{matched:true;line:string},'wait-for',WaitSchema>;
export declare const waitForExit:TerminalCommand<{timeout?:number}&SelectSession,ExitResult,'wait-for-exit'>,closeSession:TerminalCommand<SelectSession,ExitResult,'close-session'>;
export declare const readScreen:TerminalCommand<SelectSession,{lines:string[];cursor:{row:number;col:number};size:{rows:number;cols:number};exitCode:number|null},'read-screen'>;
export declare const readHistory:TerminalCommand<{last?:number}&SelectSession,{lines:string[];exitCode:number|null},'read-history'>;
export declare const resize:TerminalCommand<{cols:number;rows:number}&SelectSession,undefined,'resize'>;
export declare const getSession:TerminalCommand<SelectSession,{session:string;pid:number;command:string;exitCode:number|null},'get-session'>;
export declare const listSessions:TerminalCommand<Record<string,never>,{sessions:Array<{session:string;command:string;pid:number}>},'list-sessions'>;
export declare function getTerminalPilotRuntime(runtime:TerminalPilotRuntime|undefined):TerminalPilotRuntime;
export declare function closeSharedTerminalPilotRuntime():Promise<void>;
