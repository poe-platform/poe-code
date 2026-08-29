# Primary references — read August 29, 2026

Official GNU directory listings retrieved through web search/open show stable
family **5.3**, and the official 5.3 patch directory through **bash53-015** (June 9,
2026). The manual identifies Edition5.3, updated May18,2025. This verifies the
available official reference, not a locally executed5.3.15 binary. Web responses
include cached crawls; some direct opens returned internal errors. Successful
complete listing/search responses, rather than those errors, support the finding.
No release archive or executable was downloaded, built, installed or executed.

Primary URLs (reference identifiers used in the proposal):

```
R1 https://ftp.gnu.org/pub/gnu/bash/?C=N%3BO%3DD
R2 https://ftp.gnu.org/gnu/bash/bash-5.3-patches/
R3 https://www.gnu.org/software/bash/manual/bash.html
R4 https://www.gnu.org/software/bash/manual/html_node/Shell-Expansions.html
R5 https://www.gnu.org/software/bash/manual/html_node/Word-Splitting.html
R6 https://www.gnu.org/s/bash/manual/html_node/The-Set-Builtin.html
R7 https://www.gnu.org/software/bash/manual/html_node/Pipelines
R8 https://www.gnu.org/software/bash/manual/html_node/Redirections.html
R9 https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html
```

R4/R5 distinguish quote protection, implicit-null removal and IFS whitespace from
non-whitespace delimiters. R6 describes nounset and conditional errexit exceptions.
R7 specifies last-status/pipefail and the ordering of implicit `|&` redirection.
R8 requires left-to-right redirections. R9 documents declaration and record-reader
builtins. These rules motivate comparisons, not assumed outputs of unrun cases.

## Local binary metadata, not a version probe

- `/bin/bash`: regular file,1293840bytes, mode0555;
  SHA256 `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
  Size admitted before streaming65536-byte hash reads; identity/size/time rechecked.
  Version, GNU patch level, dependencies and runtime behavior **not qualified**.
- `/opt/homebrew/bin/bash`: absent at observation. No install/fallback performed.

Do not call `/bin/bash` GNU5.3 or Bash3.2 from its pathname or an old host capture.
Future comparison needs a separately approved exact GNU binary/version/closure;
a platform Bash, if authorized, is a separate labeled profile, never a substitute.
