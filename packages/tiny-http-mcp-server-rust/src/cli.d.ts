import type {HttpServer,HttpTransportOptions} from './http-server.js';
import type {TokenVerifier} from './auth.js';
export interface RunCliDependencies {
 createServer?:(options:HttpTransportOptions)=>Pick<HttpServer,'listenHttp'>;
 loadOAuthVerifier?:(input:{modulePath:string;exportName:string})=>Promise<TokenVerifier>;
 stdout?:Pick<NodeJS.WriteStream,'write'>;
 stderr?:Pick<NodeJS.WriteStream,'write'>;
 waitForShutdown?:(shutdown:()=>Promise<void>)=>Promise<void>;
 listenForShutdownSignals?:(listener:()=>void)=>()=>void;
 scheduleShutdownGrace?:(listener:()=>void,graceMs:number)=>()=>void;
}
export declare function isCliInvocation(argv:string[],moduleUrl:string,realpath?:(path:string)=>string):boolean;
export declare function runCli(args?:string[],dependencies?:RunCliDependencies):Promise<number>;
