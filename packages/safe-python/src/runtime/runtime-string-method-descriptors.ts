import {ExecutionLimitError,type ExecutionMeter} from "./execution-budget.js";
import {runtimeStringPayload} from "./runtime-string-payload.js";
import {createRuntimeStringCaseMethod} from "./runtime-string-case-method.js";
import {createRuntimeStringClassificationMethod} from "./runtime-string-classification-method.js";
import {createRuntimeStringSearchMethod} from "./runtime-string-search-method.js";
import {createRuntimeStringAffixMethod} from "./runtime-string-affix-method.js";
import {createRuntimeStringCutMethod} from "./runtime-string-cut-method.js";
import {createRuntimeStringStripMethod} from "./runtime-string-strip-method.js";
import {createRuntimeStringJoinMethod} from "./runtime-string-join-method.js";
import {runtimeIterate} from "./runtime-iteration.js";
import {createRuntimeSplitMethod} from "./runtime-split-method.js";
import {createRuntimeSplitlinesMethod} from "./runtime-splitlines-method.js";
import {createRuntimePadMethod} from "./runtime-pad-method.js";
import {createRuntimeExpandtabsMethod} from "./runtime-expandtabs-method.js";
import {createRuntimeStringReplaceMethod} from "./runtime-string-replace-method.js";
import {createRuntimeStringTranslateMethod} from "./runtime-string-translate-method.js";
import type {BuiltinFunctionValue,RuntimeValues,TypeValue} from "./runtime-values.js";

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
const searchMethods=[
  ["find","Return the lowest index in S where substring sub is found, such that sub is contained within S[start:end].\n\nOptional arguments start and end are interpreted as in slice\nnotation.  Return -1 on failure."],
  ["rfind","Return the highest index in S where substring sub is found, such that sub is contained within S[start:end].\n\nOptional arguments start and end are interpreted as in slice\nnotation.  Return -1 on failure."],
  ["index","Return the lowest index in S where substring sub is found, such that sub is contained within S[start:end].\n\nOptional arguments start and end are interpreted as in slice\nnotation.  Raises ValueError when the substring is not found."],
  ["rindex","Return the highest index in S where substring sub is found, such that sub is contained within S[start:end].\n\nOptional arguments start and end are interpreted as in slice\nnotation.  Raises ValueError when the substring is not found."],
  ["count","Return the number of non-overlapping occurrences of substring sub in string S[start:end].\n\nOptional arguments start and end are interpreted as in slice\nnotation."]
] as const;
const affixMethods=[
  ["startswith","Return True if the string starts with the specified prefix, False otherwise.\n\n  prefix\n    A string or a tuple of strings to try.\n  start\n    Optional start position. Default: start of the string.\n  end\n    Optional stop position. Default: end of the string."],
  ["endswith","Return True if the string ends with the specified suffix, False otherwise.\n\n  suffix\n    A string or a tuple of strings to try.\n  start\n    Optional start position. Default: start of the string.\n  end\n    Optional stop position. Default: end of the string."]
] as const;
const stripMethods=[
  ["strip","Return a copy of the string with leading and trailing whitespace removed.\n\nIf chars is given and not None, remove characters in chars instead."],
  ["lstrip","Return a copy of the string with leading whitespace removed.\n\nIf chars is given and not None, remove characters in chars instead."],
  ["rstrip","Return a copy of the string with trailing whitespace removed.\n\nIf chars is given and not None, remove characters in chars instead."]
] as const;
const cutMethods=[
  ["removeprefix","Return a str with the given prefix string removed if present.\n\nIf the string starts with the prefix string, return\nstring[len(prefix):].  Otherwise, return a copy of the original\nstring."],
  ["removesuffix","Return a str with the given suffix string removed if present.\n\nIf the string ends with the suffix string and that suffix is not\nempty, return string[:-len(suffix)].  Otherwise, return a copy of\nthe original string."],
  ["partition","Partition the string into three parts using the given separator.\n\nThis will search for the separator in the string.  If the separator\nis found, returns a 3-tuple containing the part before the\nseparator, the separator itself, and the part after it.\n\nIf the separator is not found, returns a 3-tuple containing\nthe original string and two empty strings."],
  ["rpartition","Partition the string into three parts using the given separator.\n\nThis will search for the separator in the string, starting at the\nend.  If the separator is found, returns a 3-tuple containing the\npart before the separator, the separator itself, and the part after\nit.\n\nIf the separator is not found, returns a 3-tuple containing two\nempty strings and the original string."]
] as const;
const splitMethods=[
  ["split","Return a list of the substrings in the string, using sep as the separator string.\n\n  sep\n    The separator used to split the string.\n\n    When set to None (the default value), will split on any\n    whitespace character (including \\n \\r \\t \\f and spaces) and\n    will discard empty strings from the result.\n  maxsplit\n    Maximum number of splits.\n    -1 (the default value) means no limit.\n\nSplitting starts at the front of the string and works to the end.\n\nNote, str.split() is mainly useful for data that has been\nintentionally delimited.  With natural text that includes\npunctuation, consider using the regular expression module."],
  ["rsplit","Return a list of the substrings in the string, using sep as the separator string.\n\n  sep\n    The separator used to split the string.\n\n    When set to None (the default value), will split on any\n    whitespace character (including \\n \\r \\t \\f and spaces) and\n    will discard empty strings from the result.\n  maxsplit\n    Maximum number of splits.\n    -1 (the default value) means no limit.\n\nSplitting starts at the end of the string and works to the front."]
] as const;
const padMethods=[
  ["center","Return a centered string of length width.\n\nPadding is done using the specified fill character (default is\na space)."],
  ["ljust","Return a left-justified string of length width.\n\nPadding is done using the specified fill character (default is\na space)."],
  ["rjust","Return a right-justified string of length width.\n\nPadding is done using the specified fill character (default is\na space)."],
  ["zfill","Pad a numeric string with zeros on the left, to fill a field of the given width.\n\nThe string is never truncated."]
] as const;
const methods=[...caseMethods.map(([name,doc])=>({name,doc,kind:"case" as const})),...classificationMethods.map(([name,doc])=>({name,doc,kind:"classification" as const})),
  ...searchMethods.map(([name,doc])=>({name,doc,kind:"search" as const})),...affixMethods.map(([name,doc])=>({name,doc,kind:"affix" as const})),
  ...stripMethods.map(([name,doc])=>({name,doc,kind:"strip" as const})),...cutMethods.map(([name,doc])=>({name,doc,kind:"cut" as const})),
  ...splitMethods.map(([name,doc])=>({name,doc,kind:"split" as const})),
  ...padMethods.map(([name,doc])=>({name,doc,kind:"pad" as const})),
  {name:"translate",kind:"translate" as const,doc:"Replace each character in the string using the given translation table.\n\n  table\n    Translation table, which must be a mapping of Unicode ordinals\n    to Unicode ordinals, strings, or None.\n\nThe table must implement lookup/indexing via __getitem__, for\ninstance a dictionary or list.  If this operation raises\nLookupError, the character is left untouched.  Characters mapped to\nNone are deleted."},
  {name:"replace",kind:"replace" as const,doc:"Return a copy with all occurrences of substring old replaced by new.\n\n  count\n    Maximum number of occurrences to replace.\n    -1 (the default value) means replace all occurrences.\n\nIf the optional argument count is given, only the first count occurrences are\nreplaced."},
  {name:"expandtabs",kind:"expandtabs" as const,doc:"Return a copy where all tab characters are expanded using spaces.\n\nIf tabsize is not given, a tab size of 8 characters is assumed."},
  {name:"splitlines",kind:"splitlines" as const,doc:"Return a list of the lines in the string, breaking at line boundaries.\n\nLine breaks are not included in the resulting list unless keepends\nis given and true."},
  {name:"join",kind:"join" as const,doc:"Concatenate any number of strings.\n\nThe string whose method is called is inserted in between each given\nstring.  The result is returned as a new string.\n\nExample: '.'.join(['ab', 'pq', 'rs']) -> 'ab.pq.rs'"}];
export const runtimeStringMethodNames:ReadonlySet<string>=new Set(methods.map(method=>method.name));

/** Canonical descriptors adapt owned subtype storage to the shared Unicode
 * kernels. Native methods bypass guest overrides only when explicitly selected;
 * ordinary method lookup remains the object layer's responsibility. */
export function installRuntimeStringMethodDescriptors(owner:TypeValue,values:RuntimeValues,meter:ExecutionMeter):void {
  for(const method of methods){
    meter.checkpoint(0,96);
    owner.value.namespace.items.set(values.string(method.name),values.methodDescriptor({owner,name:method.name,doc:method.doc,accepts:receiver=>runtimeStringPayload(receiver)!==undefined,
      invoke(receiver,positional,keywords,meter,invocation){
        let fatal=false;
        try {
          const payload=runtimeStringPayload(receiver)!;
          let bound:BuiltinFunctionValue;
          switch(method.kind){
            case "case":bound=createRuntimeStringCaseMethod(payload,method.name,values,meter);break;
            case "classification":bound=createRuntimeStringClassificationMethod(payload,method.name,values,meter);break;
            case "search":bound=createRuntimeStringSearchMethod(payload,method.name,values,meter,invocation?.integerIndex);break;
            case "affix":bound=createRuntimeStringAffixMethod(payload,method.name,values,meter,invocation?.integerIndex);break;
            case "strip":bound=createRuntimeStringStripMethod(receiver,method.name,values,meter);break;
            case "cut":bound=createRuntimeStringCutMethod(receiver,method.name,values,meter);break;
            case "join":bound=createRuntimeStringJoinMethod(payload,values,meter,source=>runtimeIterate(source,values,meter,invocation?.iteration));break;
            case "split":bound=createRuntimeSplitMethod(receiver,method.name,values,meter,invocation?.integerIndex);break;
            case "splitlines":bound=createRuntimeSplitlinesMethod(receiver,values,meter,invocation?.truth?.bind(invocation));break;
            case "pad":bound=createRuntimePadMethod(receiver,method.name,values,meter,invocation?.integerIndex);break;
            case "expandtabs":bound=createRuntimeExpandtabsMethod(receiver,values,meter,invocation?.integerIndex);break;
            case "replace":bound=createRuntimeStringReplaceMethod(receiver,values,meter,invocation?.integerIndex);break;
            case "translate":bound=createRuntimeStringTranslateMethod(payload,values,meter);break;
          }
          return bound.value.invoke(positional,keywords,meter,invocation);
        } catch(error){fatal=error instanceof ExecutionLimitError;throw error;}
        finally{if(!fatal)meter.checkpoint();}
      }
    }));
  }
}
