export interface NativeCase { readonly name: string; readonly args: readonly string[]; readonly locale: "C" | "C.UTF-8" }

export function nativeCases(): NativeCase[] {
  const result: NativeCase[] = [];
  function add(name: string, args: readonly string[], locale: NativeCase["locale"] = "C") { result.push({ name, args, locale }); }
  const numbers = ["-17", "-1", "-0", "0", "0002", "9", "9007199254740993"];
  for (const left of numbers) for (const right of numbers) for (const operator of ["+", "-", "*", "/", "%", "<", "<=", "=", "==", "!=", ">=", ">", "|", "&"]) {
    add(`integer ${left} ${operator} ${right}`, [left, operator, right]);
  }
  for (const left of ["", "-00", "02", "+0", "a", "10x", "é", "😀"]) {
    for (const right of ["", "0", "2", "b"]) for (const operator of ["<", "=", "!=", ">", "|", "&"]) {
      add(`string ${JSON.stringify([left, operator, right])}`, [left, operator, right]);
    }
  }
  for (const args of [
    ["2", "+", "3", "*", "4"], ["(", "2", "+", "3", ")", "*", "4"], ["20", "-", "5", "-", "3"],
    ["1", "<", "2", "=", "1"], ["1", "|", "2", "&", "0"], ["1", "|", "1", "/", "0"],
    ["0", "&", "x", "+", "1"], ["1", "|", "match", "x", "["], ["0", "&", "x", ":", "["],
    ["+", "length"], ["+", ")"], ["+", "+"], ["|"], ["*"], [":"], ["--unknown"], ["--help=wrong"],
    ["--", "--help"], ["length", "length", "abcd"], ["length", "(", "2", "+", "3", ")"],
    ["+5", "+", "1"], ["1", "%", "0"], ["1", "/", "0"],
  ]) add(`control ${JSON.stringify(args)}`, args);
  for (const locale of ["C", "C.UTF-8"] as const) {
    for (const text of ["", "abcdef", "é", "a😀éz", "line\nnext\tend"]) {
      add(`length ${locale} ${JSON.stringify(text)}`, ["length", text], locale);
      for (const accept of ["", "ef", "é", "😀", "z"]) add(`index ${locale} ${JSON.stringify([text, accept])}`, ["index", text, accept], locale);
      for (const position of ["-1", "0", "1", "2", "4", "999999999999999999999", "x"]) {
        for (const length of ["-1", "0", "1", "3", "999999999999999999999", "x"]) {
          add(`substr ${locale} ${JSON.stringify([text, position, length])}`, ["substr", text, position, length], locale);
        }
      }
    }
  }
  return result;
}
