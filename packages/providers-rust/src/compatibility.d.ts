import type { ApiShapeId, AuthProvider } from "./types.js";
export declare function resolveApiShape(
  provider: AuthProvider,
  agent: {
    apiShapes?: readonly ApiShapeId[];
  }
): ApiShapeId | undefined;
