export const mapfileSynopsis = "[-d delim] [-n count] [-O origin] [-s count] [-t] [-u fd] [-C callback] [-c quantum] [array]";

const help = [
  "    Read lines from the standard input into an indexed array variable.",
  "    ",
  "    Read lines from the standard input into the indexed array variable ARRAY, or",
  "    from file descriptor FD if the -u option is supplied.  The variable MAPFILE",
  "    is the default ARRAY.",
  "    ",
  "    Options:",
  "      -d delim\tUse DELIM to terminate lines, instead of newline",
  "      -n count\tCopy at most COUNT lines.  If COUNT is 0, all lines are copied",
  "      -O origin\tBegin assigning to ARRAY at index ORIGIN.  The default index is 0",
  "      -s count\tDiscard the first COUNT lines read",
  "      -t\tRemove a trailing DELIM from each line read (default newline)",
  "      -u fd\tRead lines from file descriptor FD instead of the standard input",
  "      -C callback\tEvaluate CALLBACK each time QUANTUM lines are read",
  "      -c quantum\tSpecify the number of lines read between each call to",
  "    \t\t\tCALLBACK",
  "    ",
  "    Arguments:",
  "      ARRAY\tArray variable name to use for file data",
  "    ",
  "    If -C is supplied without -c, the default quantum is 5000.  When",
  "    CALLBACK is evaluated, it is supplied the index of the next array",
  "    element to be assigned and the line to be assigned to that element",
  "    as additional arguments.",
  "    ",
  "    If not supplied with an explicit origin, mapfile will clear ARRAY before",
  "    assigning to it.",
  "    ",
  "    Exit Status:",
  "    Returns success unless an invalid option is given or ARRAY is readonly or",
  "    not an indexed array.",
  "",
].join("\n");

export function mapfileHelp(command: string): string {
  const body = command === "readarray" ? "    Read lines from a file into an array variable.\n    \n    A synonym for `mapfile'.\n" : help;
  return `${command}: ${command} ${mapfileSynopsis}\n${body}`;
}
