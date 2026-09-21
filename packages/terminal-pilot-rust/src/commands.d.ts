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
