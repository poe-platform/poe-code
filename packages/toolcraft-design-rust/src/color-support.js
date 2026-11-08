export function supportsColor(env = process.env, stream = process.stdout) {
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  if (env.NO_COLOR !== undefined || stream.isTTY !== true) return false;
  return typeof env.TERM === "string" && env.TERM.length > 0 && env.TERM !== "dumb";
}
