import type {ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {createRuntimeStringCaseMethod} from "./runtime-string-case-method.js";
import {createRuntimeStringClassificationMethod} from "./runtime-string-classification-method.js";
import type {RuntimeValues,TypeValue} from "./runtime-values.js";

const caseMethods=[
  ["upper","Return a copy of the string converted to uppercase."],
  ["casefold","Return a version of the string suitable for caseless comparisons."],
  ["lower","Return a copy of the string converted to lowercase."],
  ["title","Return a version of the string where each word is titlecased.\n\nMore specifically, words start with uppercased characters and all\nremaining cased characters have lower case."],
  ["capitalize","Return a capitalized version of the string.\n\nMore specifically, make the first character have upper case and the\nrest lower case."],
  ["swapcase","Convert uppercase characters to lowercase and lowercase characters to uppercase."]
] as const;
const classificationMethods=[
  ["isascii","Return True if all characters in the string are ASCII, False otherwise.\n\nASCII characters have code points in the range U+0000-U+007F.\nEmpty string is ASCII too."],
  ["isspace","Return True if the string is a whitespace string, False otherwise.\n\nA string is whitespace if all characters in the string are\nwhitespace and there is at least one character in the string."],
  ["isidentifier","Return True if the string is a valid Python identifier, False otherwise.\n\nCall keyword.iskeyword(s) to test whether string s is a reserved\nidentifier, such as \"def\" or \"class\"."],
  ["isalpha","Return True if the string is an alphabetic string, False otherwise.\n\nA string is alphabetic if all characters in the string are\nalphabetic and there is at least one character in the string."],
  ["isdecimal","Return True if the string is a decimal string, False otherwise.\n\nA string is a decimal string if all characters in the string are\ndecimal and there is at least one character in the string."],
  ["isdigit","Return True if the string is a digit string, False otherwise.\n\nA string is a digit string if all characters in the string are\ndigits and there is at least one character in the string."],
  ["isnumeric","Return True if the string is a numeric string, False otherwise.\n\nA string is numeric if all characters in the string are numeric and\nthere is at least one character in the string."],
  ["isalnum","Return True if the string is an alpha-numeric string, False otherwise.\n\nA string is alpha-numeric if all characters in the string are\nalpha-numeric and there is at least one character in the string."],
  ["isprintable","Return True if all characters in the string are printable, False otherwise.\n\nA character is printable if repr() may use it in its output."],
  ["islower","Return True if the string is a lowercase string, False otherwise.\n\nA string is lowercase if all cased characters in the string are\nlowercase and there is at least one cased character in the string."],
  ["isupper","Return True if the string is an uppercase string, False otherwise.\n\nA string is uppercase if all cased characters in the string are\nuppercase and there is at least one cased character in the string."],
  ["istitle","Return True if the string is a title-cased string, False otherwise.\n\nIn a title-cased string, upper- and title-case characters may only\nfollow uncased characters and lowercase characters only cased ones."]
] as const;
const methods=[...caseMethods.map(([name,doc])=>({name,doc,kind:"case" as const})),...classificationMethods.map(([name,doc])=>({name,doc,kind:"classification" as const}))];
export const runtimeStringMethodNames:ReadonlySet<string>=new Set(methods.map(method=>method.name));

/** Canonical descriptors adapt owned subtype storage to the shared Unicode
 * kernels. Native methods bypass guest overrides only when explicitly selected;
 * ordinary method lookup remains the object layer's responsibility. */
export function installRuntimeStringMethodDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const method of methods){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(method.name),values.methodDescriptor({owner,name:method.name,doc:method.doc,accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        const payload=runtimeStringPayload(receiver)!;
        const bound=method.kind==="case"?createRuntimeStringCaseMethod(payload,method.name,values,meter):createRuntimeStringClassificationMethod(payload,method.name,values,meter);
        return bound.value.invoke(positional,keywords,meter,invocation);
      }
    }));
  }
}
