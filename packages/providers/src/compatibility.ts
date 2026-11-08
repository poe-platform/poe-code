import type { ApiShapeId, AuthProvider } from "./types.js";

export function resolveApiShape(
  provider: AuthProvider,
  agent: { apiShapes?: readonly ApiShapeId[] }
): ApiShapeId | undefined {
  if (!provider.apiShapes || !agent.apiShapes) {
    return undefined;
  }
  for (const shapeId of agent.apiShapes) {
    if (provider.apiShapes.some((shape) => shape.id === shapeId)) {
      return shapeId;
    }
  }
  return undefined;
}
