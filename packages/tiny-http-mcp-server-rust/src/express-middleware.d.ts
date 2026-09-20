import type {IncomingMessage,ServerResponse} from 'node:http';
import type {HttpServer,ProtectedResourceMetadataOptions,TinyHttpMcpServerOAuthOptions} from './http-server.js';
import type {HttpObservabilityOptions} from './http-transport.js';
export type ExpressRequest=IncomingMessage&{path:string};
export type ExpressResponse=ServerResponse&{
 set(field:string,value:string):unknown;status(code:number):ExpressResponse;json(body:unknown):unknown;
};
export type ExpressRequestHandler=(request:ExpressRequest,response:ExpressResponse,next:(error?:unknown)=>void)=>void|Promise<void>;
export declare function createExpressMiddleware(server:HttpServer):ExpressRequestHandler;
export declare function createProtectedResourceMetadataRouter(options:ProtectedResourceMetadataOptions&{path?:string}):ExpressRequestHandler;
export interface CreateExpressOAuthHandlersOptions{
 path:string;server:HttpServer;oauth:TinyHttpMcpServerOAuthOptions;trustedProxy?:boolean;observability?:HttpObservabilityOptions;
}
export declare function createExpressOAuthHandlers(options:CreateExpressOAuthHandlersOptions):{metadataMiddleware:ExpressRequestHandler;mcpMiddleware:ExpressRequestHandler};
