import type {TokenVerifier} from './auth.js';
import type {HttpServer,HttpServerHandle} from './http-server.js';
import type {McpClientOptions} from './client/index.js';
import type {Client} from '@modelcontextprotocol/sdk/client/index.js';
import type {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
export {createTestMcpServer,installInMemoryHttp,nodeFetch} from './test-support.js';
export interface InMemoryAccessTokenInput {
 token?: string;
 issuer: string;
 audience: readonly string[];
 scopes: readonly string[];
 expiresAt: number;
 claims?: Record<string,unknown>;
 subject?: string;
 clientId?: string;
}
export interface InMemoryTokenVerifier {
 verifier: TokenVerifier;
 issueToken(input: InMemoryAccessTokenInput): string;
}
export declare function createInMemoryTokenVerifier(options?: Partial<{now:()=>number}>): InMemoryTokenVerifier;
export interface HttpTestPair {
 client:Client;
 transport:StreamableHTTPClientTransport;
 handle:HttpServerHandle;
 url:string;
 cleanup():Promise<void>;
}
export interface TinyHttpRequestLogEntry {
 method:string;
 sessionId:string|null;
 jsonRpcMethod?:string;
 responseContentType?:string|null;
}
export interface TinyHttpTestPair {
 client:{
  listTools():Promise<{tools:Array<{name:string}>}>;
  callTool(params:{name:string;arguments?:Record<string,unknown>}):Promise<{content:unknown[];isError?:boolean}>;
  close():Promise<void>;
 };
 transport:unknown;
 handle:HttpServerHandle;
 url:string;
 requests:TinyHttpRequestLogEntry[];
 cleanup():Promise<void>;
}
export declare function createHttpTestPair(server:HttpServer):Promise<HttpTestPair>;
export declare function createHttpTestPairWithTinyClient(server:HttpServer,clientOptions?:Pick<McpClientOptions,'protocolVersion'>):Promise<TinyHttpTestPair>;
