export const diagnosticCases = [
  { name: "root-missing", source: "absent_tool" },
  { name: "multiline-missing", source: ":\nabsent_tool" },
  { name: "command-missing", source: "command absent_tool" },
  { name: "child-function-isolation", source: "bash -c 'child_function() { :; }; child_function'; child_function" },
  { name: "bash-default-name", source: "bash -c absent_tool" },
  { name: "bash-explicit-name", source: "bash -c absent_tool named" },
  { name: "sh-default-name", source: "sh -c absent_tool" },
  { name: "sh-explicit-name", source: "sh -c absent_tool named" },
  { name: "eval-frame", source: ":\neval absent_tool" },
  { name: "source-frame", source: ". ./library" },
  { name: "bash-file-frame", source: "bash ./program" },
  { name: "sh-file-frame", source: "sh ./program" },
  { name: "dot-directory", source: ". ./directory" },
  { name: "source-directory", source: "source ./directory" },
  { name: "directory-symlink", source: ". ./dirlink" },
  { name: "file-source-directory", source: "bash ./directory-program" },
] as const;
export const diagnosticFiles = {
  library: ":\nabsent_tool\n",
  program: "#!/bin/bash\nabsent_tool\n",
  "directory-program": "#!/bin/bash\n. ./directory\n",
  "directory/sentinel": "unchanged\n",
};
