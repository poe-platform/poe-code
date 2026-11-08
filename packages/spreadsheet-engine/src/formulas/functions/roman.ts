import { error, numericResult } from "../values.js";
import { boundedText, numberArg, textArg } from "./common.js";
import type { FunctionImplementation } from "./types.js";

const values: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const classic: readonly (readonly [number, string])[] = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
const concise: readonly (readonly [string, string])[][] = [
  [["XLV","VL"],["XCV","VC"],["CDL","LD"],["CML","LM"],["CMVC","LMVL"]],
  [["CDXC","LDXL"],["CDVC","LDVL"],["CMXC","LMXL"],["XCIX","VCIV"],["XLIX","VLIV"]],
  [["XLIX","IL"],["XCIX","IC"],["CDXC","XD"],["CDVC","XDV"],["CDIC","XDIX"],["LMVL","XMV"],["CMIC","XMIX"],["CMXC","XM"]],
  [["XDV","VD"],["XDIX","VDIV"],["XMV","VM"],["XMIX","VMIV"]],
  [["VDIV","ID"],["VMIV","IM"]]
];
export const romanFunctions: Readonly<Record<string, FunctionImplementation>> = {
  ARABIC: (args, host) => {
    const characters = Array.from(textArg(args, 0, host)); let last = 0, result = 0;
    for (let i = characters.length - 1; i >= 0; i--) {
      host.tick(); const character = characters[i]!;
      const value = values[character >= "a" && character <= "z" ? character.toUpperCase() : character] ?? 0;
      // Released ARABIC recognizes only ASCII symbols and accumulates in C int.
      if (value < last) result = (result - value) | 0;
      else { result = (result + value) | 0; last = value; }
    }
    return numericResult(result);
  },
  ROMAN: (args, host) => {
    let n = Math.floor(numberArg(args, 0, host)); const mode = Math.floor(numberArg(args, 1, host));
    if (n < 0 || n > 3999 || mode < 0 || mode > 4) return error("#VALUE!");
    let result = "";
    for (const [value, letters] of classic) while (n >= value) { host.tick(); result += letters; n -= value; }
    const stages = mode === 0 ? [] : mode === 1 ? [concise[0]!, concise[1]!] : [concise[0]!, concise[2]!, ...(mode > 2 ? [concise[3]!] : []), ...(mode === 4 ? [concise[4]!] : [])];
    for (const stage of stages) for (const [from, to] of stage) { host.tick(); result = result.replace(from, to); }
    return boundedText(result, host);
  }
};
