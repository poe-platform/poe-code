import type { RequestHandler } from "express";
import type { HttpServer } from "./http-server.js";

export function createExpressMiddleware(server: HttpServer): RequestHandler {
  return async (req, res, next) => {
    try {
      await server.handleRequest(req, res);
    } catch (error) {
      next(error);
    }
  };
}
