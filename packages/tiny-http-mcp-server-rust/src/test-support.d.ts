import type {HttpServer,TinyHttpMcpServerOAuthOptions} from './http-server.js';
export declare function installInMemoryHttp(): void;
export declare function nodeFetch(input: string|URL|Request,init?:RequestInit):Promise<Response>;
export declare function createTestMcpServer(options?:Partial<{
 name:string;
 version:string;
 enableJsonResponse:boolean;
 sessionIdGenerator:(()=>string)|undefined;
 oauth:TinyHttpMcpServerOAuthOptions;
}>):HttpServer;
