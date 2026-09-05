import { getCommandArguments, type CommandContext } from "../../contracts/index.js";
import { MikeError } from "./native-work.js";

export const mikeEvalHelp = "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) \nSee https://mikefarah.gitbook.io/yq/ for detailed documentation and examples.\n\n## Evaluate Sequence ##\nThis command iterates over each yaml document from each given file, applies the \nexpression and prints the result in sequence.\n\nUsage:\n  yq eval [expression] [yaml_file1]... [flags]\n\nAliases:\n  eval, e\n\nExamples:\n\n# Reads field under the given path for each file\nyq e '.a.b' f1.yml f2.yml \n\n# Prints out the file\nyq e sample.yaml \n\n# Pipe from STDIN\n## use '-' as a filename to pipe from STDIN\ncat file2.yml | yq e '.a.b' file1.yml - file3.yml\n\n# Creates a new yaml document\n## Note that editing an empty file does not work.\nyq e -n '.a.b.c = \"cat\"' \n\n# Update a file in place\nyq e '.a.b = \"cool\"' -i file.yaml \n\n\nFlags:\n  -h, --help   help for eval\n\nGlobal Flags:\n  -C, --colors                            force print with colors\n      --csv-auto-parse                    parse CSV YAML/JSON values (default true)\n      --csv-separator char                CSV Separator character (default ,)\n      --debug-node-info                   debug node info\n  -e, --exit-status                       set exit status if there are no matches or null or false is returned\n      --expression string                 forcibly set the expression argument. Useful when yq argument detection thinks your expression is a file.\n      --from-file string                  Load expression from specified file.\n  -f, --front-matter string               (extract|process) first input as yaml front-matter. Extract will pull out the yaml content, process will run the expression against the yaml content, leaving the remaining data intact\n      --header-preprocess                 Slurp any header comments and separators before processing expression. (default true)\n  -I, --indent int                        sets indent level for output (default 2)\n      --ini-preserve-quotes               preserve surrounding quotes on INI values during round-trip\n  -i, --inplace                           update the file in place of first file given.\n  -p, --input-format string               [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|lua|l|ini|i] parse format for input. (default \"auto\")\n      --lua-globals                       output keys as top-level global variables\n      --lua-prefix string                 prefix (default \"return \")\n      --lua-suffix string                 suffix (default \";\\n\")\n      --lua-unquoted                      output unquoted string keys (e.g. {foo=\"bar\"})\n  -M, --no-colors                         force print with no colors\n  -N, --no-doc                            Don't print document separators (---)\n  -0, --nul-output                        Use NUL char to separate values. If unwrap scalar is also set, fail if unwrapped scalar contains NUL char.\n  -n, --null-input                        Don't read input, simply evaluate the expression given. Useful for creating docs from scratch.\n  -o, --output-format string              [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|shell|s|lua|l|ini|i] output format type. (default \"auto\")\n  -P, --prettyPrint                       pretty print, shorthand for '... style = \"\"'\n      --properties-array-brackets         use [x] in array paths (e.g. for SpringBoot)\n      --properties-separator string       separator to use between keys and values (default \" = \")\n      --security-disable-env-ops          Disable env related operations.\n      --security-disable-file-ops         Disable file related operations (e.g. load)\n      --security-enable-system-operator   Enable system operator to allow execution of external commands.\n      --shell-key-separator string        separator for shell variable key paths (default \"_\")\n  -s, --split-exp string                  print each result (or doc) into a file named (exp). [exp] argument must return a string. You can use $index in the expression as the result counter. The necessary directories will be created.\n      --split-exp-file string             Use a file to specify the split-exp expression.\n      --string-interpolation              Toggles strings interpolation of \\(exp) (default true)\n      --tsv-auto-parse                    parse TSV YAML/JSON values (default true)\n  -r, --unwrapScalar                      unwrap scalar, print the value with no quotes, colours or comments. Defaults to true for yaml (default true)\n  -v, --verbose                           verbose mode\n      --xml-attribute-prefix string       prefix for xml attributes (default \"+@\")\n      --xml-content-name string           name for xml content (if no attribute name is present). (default \"+content\")\n      --xml-directive-name string         name for xml directives (e.g. <!DOCTYPE thing cat>) (default \"+directive\")\n      --xml-keep-namespace                enables keeping namespace after parsing attributes (default true)\n      --xml-proc-inst-prefix string       prefix for xml processing instructions (e.g. <?xml version=\"1\"?>) (default \"+p_\")\n      --xml-raw-token                     enables using RawToken method instead Token. Commonly disables namespace translations. See https://pkg.go.dev/encoding/xml#Decoder.RawToken for details. (default true)\n      --xml-skip-directives               skip over directives (e.g. <!DOCTYPE thing cat>)\n      --xml-skip-proc-inst                skip over process instructions (e.g. <?xml version=\"1\"?>)\n      --xml-strict-mode                   enables strict parsing of XML. See https://pkg.go.dev/encoding/xml for more details.\n  -c, --yaml-compact-seq-indent           Use compact sequence indentation where '- ' is considered part of the indentation.\n      --yaml-fix-merge-anchor-to-spec     Fix merge anchor to match YAML spec. Will default to true in late 2025\n";
export const mikeAllHelp = "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) \nSee https://mikefarah.gitbook.io/yq/ for detailed documentation and examples.\n\n## Evaluate All ##\nThis command loads _all_ yaml documents of _all_ yaml files and runs expression once\nUseful when you need to run an expression across several yaml documents or files (like merge).\nNote that it consumes more memory than eval.\n\nUsage:\n  yq eval-all [expression] [yaml_file1]... [flags]\n\nAliases:\n  eval-all, ea\n\nExamples:\n\n# Merge f2.yml into f1.yml (in place)\nyq eval-all --inplace 'select(fileIndex == 0) * select(fileIndex == 1)' f1.yml f2.yml\n## the same command and expression using shortened names:\nyq ea -i 'select(fi == 0) * select(fi == 1)' f1.yml f2.yml\n\n\n# Merge all given files\nyq ea '. as $item ireduce ({}; . * $item )' file1.yml file2.yml ...\n\n# Pipe from STDIN\n## use '-' as a filename to pipe from STDIN\ncat file2.yml | yq ea '.a.b' file1.yml - file3.yml\n\n\nFlags:\n  -h, --help   help for eval-all\n\nGlobal Flags:\n  -C, --colors                            force print with colors\n      --csv-auto-parse                    parse CSV YAML/JSON values (default true)\n      --csv-separator char                CSV Separator character (default ,)\n      --debug-node-info                   debug node info\n  -e, --exit-status                       set exit status if there are no matches or null or false is returned\n      --expression string                 forcibly set the expression argument. Useful when yq argument detection thinks your expression is a file.\n      --from-file string                  Load expression from specified file.\n  -f, --front-matter string               (extract|process) first input as yaml front-matter. Extract will pull out the yaml content, process will run the expression against the yaml content, leaving the remaining data intact\n      --header-preprocess                 Slurp any header comments and separators before processing expression. (default true)\n  -I, --indent int                        sets indent level for output (default 2)\n      --ini-preserve-quotes               preserve surrounding quotes on INI values during round-trip\n  -i, --inplace                           update the file in place of first file given.\n  -p, --input-format string               [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|lua|l|ini|i] parse format for input. (default \"auto\")\n      --lua-globals                       output keys as top-level global variables\n      --lua-prefix string                 prefix (default \"return \")\n      --lua-suffix string                 suffix (default \";\\n\")\n      --lua-unquoted                      output unquoted string keys (e.g. {foo=\"bar\"})\n  -M, --no-colors                         force print with no colors\n  -N, --no-doc                            Don't print document separators (---)\n  -0, --nul-output                        Use NUL char to separate values. If unwrap scalar is also set, fail if unwrapped scalar contains NUL char.\n  -n, --null-input                        Don't read input, simply evaluate the expression given. Useful for creating docs from scratch.\n  -o, --output-format string              [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|shell|s|lua|l|ini|i] output format type. (default \"auto\")\n  -P, --prettyPrint                       pretty print, shorthand for '... style = \"\"'\n      --properties-array-brackets         use [x] in array paths (e.g. for SpringBoot)\n      --properties-separator string       separator to use between keys and values (default \" = \")\n      --security-disable-env-ops          Disable env related operations.\n      --security-disable-file-ops         Disable file related operations (e.g. load)\n      --security-enable-system-operator   Enable system operator to allow execution of external commands.\n      --shell-key-separator string        separator for shell variable key paths (default \"_\")\n  -s, --split-exp string                  print each result (or doc) into a file named (exp). [exp] argument must return a string. You can use $index in the expression as the result counter. The necessary directories will be created.\n      --split-exp-file string             Use a file to specify the split-exp expression.\n      --string-interpolation              Toggles strings interpolation of \\(exp) (default true)\n      --tsv-auto-parse                    parse TSV YAML/JSON values (default true)\n  -r, --unwrapScalar                      unwrap scalar, print the value with no quotes, colours or comments. Defaults to true for yaml (default true)\n  -v, --verbose                           verbose mode\n      --xml-attribute-prefix string       prefix for xml attributes (default \"+@\")\n      --xml-content-name string           name for xml content (if no attribute name is present). (default \"+content\")\n      --xml-directive-name string         name for xml directives (e.g. <!DOCTYPE thing cat>) (default \"+directive\")\n      --xml-keep-namespace                enables keeping namespace after parsing attributes (default true)\n      --xml-proc-inst-prefix string       prefix for xml processing instructions (e.g. <?xml version=\"1\"?>) (default \"+p_\")\n      --xml-raw-token                     enables using RawToken method instead Token. Commonly disables namespace translations. See https://pkg.go.dev/encoding/xml#Decoder.RawToken for details. (default true)\n      --xml-skip-directives               skip over directives (e.g. <!DOCTYPE thing cat>)\n      --xml-skip-proc-inst                skip over process instructions (e.g. <?xml version=\"1\"?>)\n      --xml-strict-mode                   enables strict parsing of XML. See https://pkg.go.dev/encoding/xml for more details.\n  -c, --yaml-compact-seq-indent           Use compact sequence indentation where '- ' is considered part of the indentation.\n      --yaml-fix-merge-anchor-to-spec     Fix merge anchor to match YAML spec. Will default to true in late 2025\n";

export const mikeHelp = "yq is a portable command-line data file processor (https://github.com/mikefarah/yq/) \nSee https://mikefarah.gitbook.io/yq/ for detailed documentation and examples.\n\nUsage:\n  yq [flags]\n  yq [command]\n\nExamples:\n\n# yq tries to auto-detect the file format based off the extension, and defaults to YAML if it's unknown (or piping through STDIN)\n# Use the '-p/--input-format' flag to specify a format type.\ncat file.xml | yq -p xml\n\n# read the \"stuff\" node from \"myfile.yml\"\nyq '.stuff' < myfile.yml\n\n# update myfile.yml in place\nyq -i '.stuff = \"foo\"' myfile.yml\n\n# print contents of sample.json as idiomatic YAML\nyq -P -oy sample.json\n\n\nAvailable Commands:\n  completion  Generate the autocompletion script for the specified shell\n  eval        (default) Apply the expression to each document in each yaml file in sequence\n  eval-all    Loads _all_ yaml documents of _all_ yaml files and runs expression once\n  help        Help about any command\n\nFlags:\n  -C, --colors                            force print with colors\n      --csv-auto-parse                    parse CSV YAML/JSON values (default true)\n      --csv-separator char                CSV Separator character (default ,)\n      --debug-node-info                   debug node info\n  -e, --exit-status                       set exit status if there are no matches or null or false is returned\n      --expression string                 forcibly set the expression argument. Useful when yq argument detection thinks your expression is a file.\n      --from-file string                  Load expression from specified file.\n  -f, --front-matter string               (extract|process) first input as yaml front-matter. Extract will pull out the yaml content, process will run the expression against the yaml content, leaving the remaining data intact\n      --header-preprocess                 Slurp any header comments and separators before processing expression. (default true)\n  -h, --help                              help for yq\n  -I, --indent int                        sets indent level for output (default 2)\n      --ini-preserve-quotes               preserve surrounding quotes on INI values during round-trip\n  -i, --inplace                           update the file in place of first file given.\n  -p, --input-format string               [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|lua|l|ini|i] parse format for input. (default \"auto\")\n      --lua-globals                       output keys as top-level global variables\n      --lua-prefix string                 prefix (default \"return \")\n      --lua-suffix string                 suffix (default \";\\n\")\n      --lua-unquoted                      output unquoted string keys (e.g. {foo=\"bar\"})\n  -M, --no-colors                         force print with no colors\n  -N, --no-doc                            Don't print document separators (---)\n  -0, --nul-output                        Use NUL char to separate values. If unwrap scalar is also set, fail if unwrapped scalar contains NUL char.\n  -n, --null-input                        Don't read input, simply evaluate the expression given. Useful for creating docs from scratch.\n  -o, --output-format string              [auto|a|yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|shell|s|lua|l|ini|i] output format type. (default \"auto\")\n  -P, --prettyPrint                       pretty print, shorthand for '... style = \"\"'\n      --properties-array-brackets         use [x] in array paths (e.g. for SpringBoot)\n      --properties-separator string       separator to use between keys and values (default \" = \")\n      --security-disable-env-ops          Disable env related operations.\n      --security-disable-file-ops         Disable file related operations (e.g. load)\n      --security-enable-system-operator   Enable system operator to allow execution of external commands.\n      --shell-key-separator string        separator for shell variable key paths (default \"_\")\n  -s, --split-exp string                  print each result (or doc) into a file named (exp). [exp] argument must return a string. You can use $index in the expression as the result counter. The necessary directories will be created.\n      --split-exp-file string             Use a file to specify the split-exp expression.\n      --string-interpolation              Toggles strings interpolation of \\(exp) (default true)\n      --tsv-auto-parse                    parse TSV YAML/JSON values (default true)\n  -r, --unwrapScalar                      unwrap scalar, print the value with no quotes, colours or comments. Defaults to true for yaml (default true)\n  -v, --verbose                           verbose mode\n  -V, --version                           Print version information and quit\n      --xml-attribute-prefix string       prefix for xml attributes (default \"+@\")\n      --xml-content-name string           name for xml content (if no attribute name is present). (default \"+content\")\n      --xml-directive-name string         name for xml directives (e.g. <!DOCTYPE thing cat>) (default \"+directive\")\n      --xml-keep-namespace                enables keeping namespace after parsing attributes (default true)\n      --xml-proc-inst-prefix string       prefix for xml processing instructions (e.g. <?xml version=\"1\"?>) (default \"+p_\")\n      --xml-raw-token                     enables using RawToken method instead Token. Commonly disables namespace translations. See https://pkg.go.dev/encoding/xml#Decoder.RawToken for details. (default true)\n      --xml-skip-directives               skip over directives (e.g. <!DOCTYPE thing cat>)\n      --xml-skip-proc-inst                skip over process instructions (e.g. <?xml version=\"1\"?>)\n      --xml-strict-mode                   enables strict parsing of XML. See https://pkg.go.dev/encoding/xml for more details.\n  -c, --yaml-compact-seq-indent           Use compact sequence indentation where '- ' is considered part of the indentation.\n      --yaml-fix-merge-anchor-to-spec     Fix merge anchor to match YAML spec. Will default to true in late 2025\n\nUse \"yq [command] --help\" for more information about a command.\n";
export const mikeUsage = mikeHelp.slice(mikeHelp.indexOf("Usage:")) + "\n";

export interface MikeArguments {
  all: boolean;
  help: boolean;
  version: boolean;
  nullInput: boolean;
  inplace: boolean;
  exitStatus: boolean;
  input: string;
  output: string;
  indent: number;
  unwrap: boolean | undefined;
  noDoc: boolean;
  compactSequence: boolean;
  mergeSpec: boolean;
  expression: string | undefined;
  operands: string[];
}

const booleans: Readonly<Record<string, keyof MikeArguments>> = {
  n: "nullInput", "null-input": "nullInput", i: "inplace", inplace: "inplace",
  e: "exitStatus", "exit-status": "exitStatus", r: "unwrap", unwrapScalar: "unwrap",
  h: "help", help: "help", V: "version", version: "version", N: "noDoc", "no-doc": "noDoc",
  c: "compactSequence", "yaml-compact-seq-indent": "compactSequence", "yaml-fix-merge-anchor-to-spec": "mergeSpec",
};
const values: Readonly<Record<string, "input" | "output" | "indent" | "expression">> = {
  p: "input", "input-format": "input", o: "output", "output-format": "output", I: "indent", indent: "indent", expression: "expression",
};

export function mikeCommandMode(args: readonly string[]): "root" | "eval" | "eval-all" {
  if (args.length > 4096) return "root";
  let bytes = 0;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    bytes += Buffer.byteLength(argument);
    if (bytes > 65536) return "root";
    if (argument === "--") return index + 1 < args.length ? "eval" : "root";
    if (!argument.startsWith("-") || argument === "-") return argument === "ea" || argument === "eval-all" ? "eval-all" : "eval";
    const long = argument.startsWith("--");
    let remaining = argument.slice(long ? 2 : 1);
    while (remaining) {
      const equal = remaining.indexOf("=");
      const name = long ? equal < 0 ? remaining : remaining.slice(0, equal) : remaining[0]!;
      if (Object.hasOwn(values, name)) {
        if (long ? equal < 0 : remaining.length === 1) index++;
        break;
      }
      if (!Object.hasOwn(booleans, name) && name !== "M" && name !== "no-colors") return "root";
      if (long || remaining[1] === "=") break;
      remaining = remaining.slice(1);
    }
  }
  return "root";
}

function parseIndent(value: string): number {
  const negative = value.startsWith("-");
  let digits = value.startsWith("+") || negative ? value.slice(1) : value;
  let base = 10;
  let prefixed = false;
  if (digits.length > 1 && digits[0] === "0") {
    prefixed = true;
    const prefix = digits[1]!.toLowerCase();
    base = prefix === "x" ? 16 : prefix === "b" ? 2 : 8;
    digits = digits.slice(prefix === "x" || prefix === "b" || prefix === "o" ? 2 : 1);
  }
  if (prefixed && digits.startsWith("_")) digits = digits.slice(1);
  let invalid = digits.length === 0;
  let previousDigit = false;
  let integer = 0n;
  const maximum = negative ? 9223372036854775808n : 9223372036854775807n;
  for (const character of digits) {
    if (character === "_") { if (!previousDigit) invalid = true; previousDigit = false; continue; }
    const digit = "0123456789abcdef".indexOf(character.toLowerCase());
    if (digit < 0 || digit >= base) invalid = true;
    else if (integer <= maximum) integer = integer * BigInt(base) + BigInt(digit);
    previousDigit = true;
  }
  if (!previousDigit) invalid = true;
  if (invalid || integer > maximum) throw new MikeError(`invalid argument ${JSON.stringify(value)} for "-I, --indent" flag: strconv.ParseInt: parsing ${JSON.stringify(value)}: ${invalid ? "invalid syntax" : "value out of range"}`, true);
  const result = Number(negative ? -integer : integer);
  if (!Number.isSafeInteger(result)) throw new MikeError("yq limit exceeded: indent");
  return result;
}

export function parseMikeArguments(context: CommandContext): MikeArguments {
  if (context.args.length > 4096) throw new MikeError("yq limit exceeded: argument count");
  let bytes = 0;
  for (const argument of context.args) { bytes += Buffer.byteLength(argument); if (bytes > 65536) throw new MikeError("yq limit exceeded: argument bytes"); }
  const carrier = getCommandArguments(context);
  for (let index = 0; index < carrier.args.length; index++) {
    try { new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(carrier.bytes(index)); }
    catch { throw new MikeError("yq filename/expression bytes must be valid UTF-8"); }
  }
  const result: MikeArguments = { all: false, help: false, version: false, nullInput: false, inplace: false,
    exitStatus: false, input: "auto", output: "auto", indent: 2, unwrap: undefined, noDoc: false,
    compactSequence: false, mergeSpec: false, expression: undefined, operands: [] };
  let ended = false;
  for (let index = 0; index < context.args.length; index++) {
    const argument = context.args[index]!;
    if (!ended && argument === "--") { ended = true; continue; }
    if (!ended && ["eval", "e", "eval-all", "ea"].includes(argument) && result.operands.length === 0) { result.all = argument === "eval-all" || argument === "ea"; continue; }
    if (ended || !argument.startsWith("-") || argument === "-") { result.operands.push(argument); continue; }
    const long = argument.startsWith("--");
    let remaining = argument.slice(long ? 2 : 1);
    while (remaining) {
      const equal = remaining.indexOf("=");
      const name = long ? (equal < 0 ? remaining : remaining.slice(0, equal)) : remaining[0]!;
      let attached = long ? (equal < 0 ? undefined : remaining.slice(equal + 1)) : remaining.slice(1) || undefined;
      if (!long && attached?.startsWith("=")) attached = attached.slice(1);
      const boolean = Object.hasOwn(booleans, name) ? booleans[name] : undefined;
      if (boolean || name === "M" || name === "no-colors") {
        const explicit = long ? equal >= 0 : remaining[1] === "=";
        let enabled = true;
        if (explicit) {
          if (["true", "1", "t", "TRUE", "True", "T"].includes(attached!)) enabled = true;
          else if (["false", "0", "f", "FALSE", "False", "F"].includes(attached!)) enabled = false;
          else {
            const fullName = name === "r" || name === "unwrapScalar" ? "-r, --unwrapScalar" : name === "n" || name === "null-input" ? "-n, --null-input" : `--${name}`;
            throw new MikeError(`invalid argument ${JSON.stringify(attached)} for "${fullName}" flag: strconv.ParseBool: parsing ${JSON.stringify(attached)}: invalid syntax`, true);
          }
        }
        if (boolean) Object.assign(result, { [boolean]: enabled });
        remaining = long || explicit ? "" : remaining.slice(1);
        continue;
      }
      const field = Object.hasOwn(values, name) ? values[name] : undefined;
      if (!field) throw new MikeError(long ? `unknown flag: --${name}` : `unknown shorthand flag: '${name}' in ${argument}`, true);
      const value = attached ?? context.args[++index];
      if (value === undefined) throw new MikeError(long ? `flag needs an argument: --${name}` : `flag needs an argument: '${name}' in ${argument}`, true);
      if (field === "indent") {
        result.indent = parseIndent(value);
      } else result[field] = value;
      remaining = "";
    }
  }
  return result;
}

export function mikeFormat(value: string): "auto" | "yaml" | "json" {
  if (value === "auto" || value === "a" || value === "") return "auto";
  if (value === "yaml" || value === "y") return "yaml";
  if (value === "json" || value === "j") return "json";
  if (["xml", "x", "csv", "c", "tsv", "t", "props", "p", "toml", "ini", "i", "hcl", "h", "lua", "l", "kyaml", "ky", "base64", "uri", "shell", "s"].includes(value)) throw new MikeError(`format '${value}' is not supported by this bounded yq profile`);
  throw new MikeError(`unknown format '${value}' please use [yaml|y|kyaml|ky|json|j|props|p|csv|c|tsv|t|xml|x|base64|uri|toml|hcl|h|shell|s|lua|l|ini|i]`);
}
