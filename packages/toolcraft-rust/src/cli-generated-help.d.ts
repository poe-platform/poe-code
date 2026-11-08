import type {Command,Group,Scope} from "./index.js";
import type {HelpToken} from "./design.js";
import type {Casing,CLIControls,CLIHelpDepth,ResolvedCLIControls} from "./cli-policy.js";
import type {CLIInvocationRuntime} from "./cli-execution.js";
import type {OutputMode} from "./renderer.js";
export interface GeneratedHelpOptions {casing?:Casing;rootUsageName?:string;rootDisplayName?:string;controls?:CLIControls;version?:string;presets?:boolean;}
export interface GlobalHelpOptions {controls:ResolvedCLIControls;showVersion:boolean;presetsEnabled:boolean;}
export interface ResolvedHelpTarget<TServices extends object> {breadcrumb:string[];node:Command<TServices,any,any,any>|Group<TServices>;}
export interface HelpCommandRow {name:string;nameTokens:HelpToken[];description:string;kind:"command"|"group";depth:number;}
export declare function resolveHelpOutput(argv:string[]):OutputMode;
export declare function inferProgramName(argv:string[]):string;
export declare function resolveHelpTarget<TServices extends object>(root:Group<TServices>,argv:string[],scope:Scope,rootUsageName:string,rootDisplayName?:string):ResolvedHelpTarget<TServices>;
export declare function formatCommandRows<TServices extends object>(group:Group<TServices>,scope:Scope,casing:Casing,globals:ReadonlySet<string>,help:CLIHelpDepth):HelpCommandRow[];
export declare function renderGroupHelp<TServices extends object>(group:Group<TServices>,breadcrumb:string[],scope:Scope,casing:Casing,globals:GlobalHelpOptions,usage:string,isRoot:boolean):string;
export declare function renderLeafHelp<TServices extends object>(command:Command<TServices,any,any,any>,breadcrumb:string[],casing:Casing,globals:GlobalHelpOptions,usage:string):string;
export declare function renderJsonHelp<TServices extends object>(target:ResolvedHelpTarget<TServices>,root:Group<TServices>,casing:Casing,globals:GlobalHelpOptions,usage:string):string;
export declare function renderGeneratedHelp<TServices extends object>(root:Group<TServices>,argv:string[],options:GeneratedHelpOptions,invocation?:CLIInvocationRuntime):Promise<void>;
