/** JSON.parse orders integer property names numerically; Python dictionaries do not. */
export function jsonDictionaryKeys(json: string): string[] {
 const keys = new Set<string>();
 let depth = 0;
 let expectingKey = false;
 for (let index = 0; index < json.length; index++) {
  const char = json[index];
  if (char === '"') {
   const start = index;
   while (++index < json.length) {
    if (json[index] === "\\") index++;
    else if (json[index] === '"') break;
   }
   if (depth === 1 && expectingKey) {
    keys.add(JSON.parse(json.slice(start, index + 1)) as string);
    expectingKey = false;
   }
  } else if (char === "{" || char === "[") {
   depth++;
   if (depth === 1) expectingKey = true;
  } else if (char === "}" || char === "]") depth--;
  else if (char === "," && depth === 1) expectingKey = true;
 }
 return [...keys];
}

