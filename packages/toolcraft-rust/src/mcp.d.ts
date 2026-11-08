import type {SDKTransport,Server as TinyServer} from "tiny-stdio-mcp-server";
import type {Group} from "./index.js";
import type {RunMCPOptions} from "toolcraft/mcp";
export type {RunMCPOptions} from "toolcraft/mcp";
type CmdkitServer=Omit<TinyServer,"connect">&{connect(transport:SDKTransport):Promise<void>};
export declare const MCP_STREAM_METHODS:{readonly list:"toolcraft/streams/list";readonly subscribe:"toolcraft/streams/subscribe";readonly unsubscribe:"toolcraft/streams/unsubscribe";readonly notification:"notifications/toolcraft/stream"};
export declare function createMCPServer<TServices extends object=Record<string,unknown>>(roots:Group<TServices>|Group<TServices>[],options:RunMCPOptions<TServices>):CmdkitServer;
export declare function runMCP<TServices extends object=Record<string,unknown>>(roots:Group<TServices>|Group<TServices>[],options:RunMCPOptions<TServices>):Promise<void>;
