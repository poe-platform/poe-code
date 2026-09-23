import * as readline from "node:readline";
import { createProtocolServer, type Server } from "./protocol-server.js";
import { StdioInput } from "./stdio-input.js";
import { StdioOutput } from "./stdio-output.js";
import type { ServerOptions } from "./types.js";

export type {
  CustomMethodHandler, MessageHandler, MessageRequestContext, MessageSession,
  MessageSessionContext, Server
} from "./protocol-server.js";

export function createServer(options: ServerOptions): Server {
  return createProtocolServer(options, { readline, StdioInput, StdioOutput });
}
