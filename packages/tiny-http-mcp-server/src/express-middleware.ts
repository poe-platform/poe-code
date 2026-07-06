import express, { type RequestHandler } from "express";
import { authorizeBearerRequest, type AuthenticatedIncomingMessage } from "./auth.js";
import {
  createProtectedResourceMetadataDocument,
  type HttpServer,
  type ProtectedResourceMetadataOptions,
  type TinyHttpMcpServerOAuthOptions,
} from "./http-server.js";
import type { HttpObservabilityOptions } from "./http-transport.js";
import { PROTECTED_RESOURCE_METADATA_PATH } from "./auth.js";
import { PROTECTED_RESOURCE_METADATA_CACHE_CONTROL } from "./auth.js";

function normalizePath(path: string): string {
  if (path.length === 0 || path === "/") {
    return "/";
  }

  if (path.includes("?") || path.includes("#")) {
    throw new Error("path must not include a query or fragment");
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function setHardeningHeaders(res: {
  set(field: string, value: string): unknown;
}): void {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
}

function readSessionId(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const value = headers["mcp-session-id"];
  const sessionId = Array.isArray(value) ? value[0] : value;
  return sessionId !== undefined && sessionId.length > 0 ? sessionId : undefined;
}

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
  options: ProtectedResourceMetadataOptions & {
    path?: string;
  }
): RequestHandler {
  const router = express.Router();
  const document = createProtectedResourceMetadataDocument(options);
  const metadataPaths = (() => {
    const path = normalizePath(options.path ?? "/");
    if (path === "/") {
      return [PROTECTED_RESOURCE_METADATA_PATH];
    }

    return [`${PROTECTED_RESOURCE_METADATA_PATH}${path}`];
  })();

  for (const metadataPath of metadataPaths) {
    router.get(metadataPath, (_req, res) => {
      setHardeningHeaders(res);
      res.set("Cache-Control", PROTECTED_RESOURCE_METADATA_CACHE_CONTROL);
      res.status(200).json(document);
    });
  }

  return router;
}

export interface CreateExpressOAuthHandlersOptions {
  path: string;
  server: HttpServer;
  oauth: TinyHttpMcpServerOAuthOptions;
  trustedProxy?: boolean;
  observability?: HttpObservabilityOptions;
}

export function createExpressOAuthHandlers(
  options: CreateExpressOAuthHandlersOptions
): {
  metadataMiddleware: RequestHandler;
  mcpMiddleware: RequestHandler;
} {
  const mcpMiddleware = createExpressMiddleware(options.server);
  const path = normalizePath(options.path);

  return {
    metadataMiddleware: createProtectedResourceMetadataRouter({
      ...options.oauth,
      path,
    }),
    mcpMiddleware: async (req, res, next) => {
      if (req.method === "OPTIONS") {
        await mcpMiddleware(req, res, next);
        return;
      }

      const authorization = await authorizeBearerRequest(
        req as AuthenticatedIncomingMessage,
        {
          ...options.oauth,
          protectedResourcePath: path,
          trustedProxy: options.trustedProxy,
        }
      );
      if (!authorization.ok) {
        options.observability?.onEvent?.({
          type: "auth.failure",
          statusCode: authorization.statusCode,
          challenge: authorization.challenge,
          sessionId: readSessionId(req.headers),
        });
        res.set("WWW-Authenticate", authorization.challenge);
        setHardeningHeaders(res);
        res.status(authorization.statusCode).end();
        return;
      }

      await mcpMiddleware(req, res, next);
    },
  };
}
