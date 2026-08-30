export const baselineNames = Object.freeze(["C", "POSIX", "C.UTF-8", "C.utf8"]);
export const encodingNames = Object.freeze([...baselineNames, "en_US.UTF-8"]);
export const diagnostics = Object.freeze({
  encoding: "expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n",
  collation: "expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n",
  bracket: "expr: unsupported BRE: bracket expressions require C/POSIX or C.UTF-8/C.utf8 LC_CTYPE and LC_COLLATE\n",
});

export function select(env, category) {
  for (const key of ["LC_ALL", category, "LANG"]) {
    if (env[key] !== undefined && env[key] !== "") return { selectedBy: key, value: env[key] };
  }
  return { selectedBy: "virtual-default", value: "C" };
}

export function admission(control) {
  if (control.operation === "arithmetic" || control.operation === "numeric-comparison" || control.operation === "literal-value") {
    return { decision: "allow", profile: null, stderr: "" };
  }
  const character = select(control.env, "LC_CTYPE");
  const collation = select(control.env, "LC_COLLATE");
  if (control.operation === "string-comparison") {
    return baselineNames.includes(collation.value)
      ? { decision: "allow", profile: null, stderr: "" }
      : { decision: "refuse", profile: null, stderr: diagnostics.collation };
  }
  if (!encodingNames.includes(character.value)) return { decision: "refuse", profile: null, stderr: diagnostics.encoding };
  const profile = character.value === "C" || character.value === "POSIX" ? "byte" : "utf8-scalar";
  if (control.operation === "match" && (!baselineNames.includes(character.value) || !baselineNames.includes(collation.value))) {
    const pattern = Buffer.from(control.pattern);
    for (let offset = 0; offset < pattern.length; offset++) {
      if (pattern[offset] === 92) offset++;
      else if (pattern[offset] === 91) return { decision: "refuse", profile, stderr: diagnostics.bracket };
    }
  }
  return { decision: "allow", profile, stderr: "" };
}
