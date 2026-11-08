export interface ColorSupportEnv {
  NO_COLOR?: string;
  FORCE_COLOR?: string;
  TERM?: string;
}

export interface ColorSupportStream {
  isTTY?: boolean;
}

export function supportsColor(
  env: ColorSupportEnv = process.env as ColorSupportEnv,
  stream: ColorSupportStream = process.stdout
): boolean {
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") {
    return true;
  }

  if (env.NO_COLOR !== undefined) {
    return false;
  }

  if (stream.isTTY !== true) {
    return false;
  }

  return typeof env.TERM === "string" && env.TERM.length > 0 && env.TERM !== "dumb";
}
