import express, { type RequestHandler } from "express";
import { authorizeBearerRequest, type AuthenticatedIncomingMessage } from "./auth.js";
import {
  createProtectedResourceMetadataDocument,
  type HttpServer,
  type ProtectedResourceMetadataOptions,
  type TinyHttpMcpServerOAuthOptions,
} from "./http-server.js";
import { PROTECTED_RESOURCE_METADATA_PATH } from "./auth.js";

export function createExpressMiddleware(server: HttpServer): RequestHandler {
  return async (req, res, next) => {
    try {
      await server.handleRequest(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function createProtectedResourceMetadataRouter(
  options: ProtectedResourceMetadataOptions
): RequestHandler {
  const router = express.Router();
  const document = createProtectedResourceMetadataDocument(options);

  router.get(PROTECTED_RESOURCE_METADATA_PATH, (_req, res) => {
    res.status(200).json(document);
  });

  return router;
}

export interface CreateExpressOAuthHandlersOptions {
  path: string;
  server: HttpServer;
  oauth: TinyHttpMcpServerOAuthOptions;
}

export function createExpressOAuthHandlers(
  options: CreateExpressOAuthHandlersOptions
): {
  metadataMiddleware: RequestHandler;
  mcpMiddleware: RequestHandler;
} {
  const mcpMiddleware = createExpressMiddleware(options.server);

  return {
    metadataMiddleware: createProtectedResourceMetadataRouter(options.oauth),
    mcpMiddleware: async (req, res, next) => {
      const authorization = await authorizeBearerRequest(
        req as AuthenticatedIncomingMessage,
        options.oauth
      );
      if (!authorization.ok) {
        res.set("WWW-Authenticate", authorization.challenge);
        res.status(401).end();
        return;
      }

      await mcpMiddleware(req, res, next);
    },
  };
}
