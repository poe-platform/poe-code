import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import type { AxisMap } from "./axis.js";

export type CartesianInterpolation = "linear" | "step-start" | "step-end" | "step-center-x" | "step-center-y";
export interface CartesianSeriesRequest {
  readonly count: number;
  readonly x?: readonly number[];
  readonly y?: readonly number[];
  readonly xMap: AxisMap;
  readonly yMap: AxisMap;
  readonly interpolation: CartesianInterpolation;
  readonly skipInvalid: boolean;
}
export interface SeriesPathCommand {
  readonly kind: "move" | "line";
  readonly x: number;
  readonly y: number;
}

/** GOffice 0.10.61 make_path_linear (Cartesian) and xy_make_path_step.
 * Step paths have GO_PATH_OPTIONS_SHARP; callers must retain sharp corners.
 * Missing vectors use one-based indices; invalid mapped values break/skip paths.
 * Splines, polar paths, fill closure and stroke styles are separate stages.
 */
export function* cartesianSeriesPath(request: CartesianSeriesRequest, context: CapabilityContext): Generator<SeriesPathCommand> {
  context.signal.throwIfAborted();
  if (!Number.isSafeInteger(request.count) || request.count < 0) throw new SsconvertError("invalid-request", "ssconvert invalid chart point count");
  if (!["linear", "step-start", "step-end", "step-center-x", "step-center-y"].includes(request.interpolation)) {
    throw new SsconvertError("unsupported-feature", "ssconvert unsupported chart interpolation");
  }
  const maximum = context.limits.workbookWork ?? context.limits.inputBytes + context.limits.cells * 32;
  let work = 0, valid = false, lastX = 0, lastY = 0;
  for (let index = 0; index < request.count; index++) {
    context.signal.throwIfAborted();
    if (++work > maximum) throw new SsconvertError("resource-limit", "ssconvert chart work limit exceeded");
    const x = request.xMap.toView(request.x === undefined ? index + 1 : request.x[index] ?? NaN);
    const y = request.yMap.toView(request.y === undefined ? index + 1 : request.y[index] ?? NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) === Number.MAX_VALUE || Math.abs(y) === Number.MAX_VALUE) {
      if (!request.skipInvalid) valid = false;
      continue;
    }
    if (!valid) yield { kind: "move", x, y };
    else {
      switch (request.interpolation) {
        case "step-start": yield { kind: "line", x, y: lastY }; break;
        case "step-end": yield { kind: "line", x: lastX, y }; break;
        case "step-center-x":
          yield { kind: "line", x: (lastX + x) / 2, y: lastY };
          context.signal.throwIfAborted();
          yield { kind: "line", x: (lastX + x) / 2, y };
          break;
        case "step-center-y":
          yield { kind: "line", x: lastX, y: (lastY + y) / 2 };
          context.signal.throwIfAborted();
          yield { kind: "line", x, y: (lastY + y) / 2 };
          break;
      }
      context.signal.throwIfAborted();
      yield { kind: "line", x, y };
    }
    valid = true;
    lastX = x; lastY = y;
  }
  context.signal.throwIfAborted();
}
