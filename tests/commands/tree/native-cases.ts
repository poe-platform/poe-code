export const exactCases: readonly (readonly string[])[] = [
  [], ["-a"], ["-d"], ["-L", "1"], ["-L2"], ["-P", "*.txt"], ["-P", "*.txt", "-P", "*.md"],
  ["-I", "dir"], ["-I", "*.txt|B"], ["-P", "[a-z]*"], ["-P", "[^a]*"], ["-P", "?.txt"],
  ["-fi", "--noreport"], ["-ai"], ["-r"], ["--dirsfirst"], ["-dr"], ["--charset=UTF-8", "-L1"],
  ["dir", "empty"], ["empty"], ["-d", "-P", "*.txt"], ["-a", "-P", ".*"], ["--", "dir"], ["-Ji"],
];

export const semanticCases: readonly (readonly string[])[] = [
  ["-J"], ["-Jd"], ["-Jf", "-L1"], ["-J", "--noreport"],
];

export const divergentCases: readonly (readonly string[])[] = [
  ["-l"], ["link"], ["a.txt"], ["missing"], ["-J", "missing"], ["-J", "a.txt"],
];
