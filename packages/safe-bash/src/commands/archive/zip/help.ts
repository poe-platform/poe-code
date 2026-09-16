export const zipHelp = `safe-bash zip
Usage: zip [options] archive [file ...]
       zip [options] - [file ...]       write an archive to stdout
       zip [options] archive -          read a member from stdin

  -r          recurse into directories
  -j          store basenames, discarding directory paths
  -q          suppress progress messages
  -0          store without compression
  -1 .. -9    select compression effort
  -Z METHOD   select store, deflate, or bzip2 compression
  -n SUFFIXES store matching suffixes (colon-separated)
  -u / -f     update / freshen existing members
  -d / -U     delete / copy selected archive members
  -FS         synchronize selected members with filesystem sources
  -O FILE     write to a separate output archive
  -m          remove archived sources after successful publication
  -D / -y     omit directory entries / store symlinks
  -i / -x     include / exclude matching names
  -@          read filenames from stdin
  -t / -tt    select files from / before a date
  -T          test archive integrity before replacement
  -z / -c     read archive / entry comments from stdin
  -o          set archive time to the latest member time
  -l          convert text LF line endings to CRLF
  -ll         convert text CRLF line endings to LF (--from-crlf)
  -X          strip optional metadata
  -fz / -fz-  force / disable ZIP64 output
  -fd         force data descriptors
  -v          verbose operation (a lone -v shows implementation information)
  --version   show implementation information and exit
  -L          show this implementation's license
  -sf / -sf-  list selected files / totals only, without creating an archive
  -sc         show processed arguments and exit with status 9
  -so         show implemented options and exit
  -sd         show virtual archive processing steps
  -db / -dc   display byte / entry counters
  -du / -dv   display entry size / single-volume numbers
  -dd / -dg   display dots per entry / globally for output bytes
  -ds SIZE    dot interval (kmgt units; default MB; 0 disables dots)
  -h          show this help

Use -- after the archive name to pass filenames beginning with '-'.
Long option equivalents are accepted, for example --junk-paths and
--compression-method=bzip2. All filesystem operations use the virtual filesystem.
`;

export const zipExtendedHelp = `${zipHelp}
Selection
  -r traverses listed directories; -R recursively searches matching names.
  Do not combine -r and -R. -D omits directory records without stopping traversal.
  -i patterns and -x patterns accept lists ending at another option or at @.
  Quote patterns to prevent the shell expanding them before zip receives them.
  Exclusions take precedence over inclusions. -j flattens selected source names;
  duplicate basenames fail before the archive is replaced.
  -nw disables wildcard interpretation; -ws prevents wildcards crossing '/'.
  -MM makes missing input matches fatal. -t includes files from a date; -tt
  selects files before a date. Dates accept mmddyyyy or yyyy-mm-dd.
  -y stores the symbolic link itself; otherwise its target is read.
  -p accepts the native paths compatibility flag and does not undo -j.

Archive operations
  The default action adds new members and replaces selected existing members.
  -u updates changed/new sources; -f freshens existing members only.
  -d deletes matching archive members; -U copies matching archive members.
  -FS synchronizes selected existing members, including missing sources.
  -O output.zip preserves the input archive and publishes a separate output.
  -m removes sources only after successful publication or stdout completion.
  Removal needs atomic filesystem support; excluded/nonempty directories remain.
  -T checks integrity before replacement. With stdout output it is ignored.
  -z reads an archive comment; -c reads selected member comments in archive order.
  -X strips optional metadata; -X- preserves available metadata.
  -o sets the archive timestamp to the newest resulting member timestamp.

Compression and format
  -Z selects store, deflate, or bzip2; method names accept unique prefixes.
  -1 through -9 select effort. Store selection remains through later levels.
  -n .jpg:.png stores matching suffixes; -9 overrides suffix-based storage.
  Compression may fall back to STORE for regular files when it expands data.
  -l converts text LF to CRLF, leaving detected binary input unchanged.
  -fz forces ZIP64; -fz- disables it. -fd forces signed data descriptors.
  BZIP2 members use extraction version 4.6, including with ZIP64 records.

Streaming
  A '-' input filename reads one member from stdin, named '-'.
  A '-' archive name writes binary archive bytes to stdout and progress to stderr.
  With no archive or file operands, zip acts as a stdin-to-stdout filter.
  Streamed members retain compression even if it expands their data.
  -@ instead reads newline-separated input filenames; it cannot also read a '-'
  payload from the same stdin. Empty filename lines are ignored.
  Complete the output stream before using the resulting archive.

Arguments and ZIPOPT
  Long options accept unique abbreviations and --option=value where appropriate.
  Use -- after the archive name for literal filenames beginning with '-'.
  ZIPOPT supplies default arguments before the command arguments. Double quotes
  group words inside ZIPOPT; shell expansion is not performed on these defaults.
  -h and -h2 print basic and extended help as soon as they are encountered.
  --version and -L also exit immediately. Only a lone short -v shows information;
  --verbose and grouped -v perform an archive operation. Later -q or -v wins.
  -sc and -so validate all arguments before exiting; -sc returns status 9.

Displays
  -sf lists selected names and totals without reading source payloads or writing
  archives. -sf- and -q suppress names; totals remain visible. With no file
  operands, -sf lists the input archive. -sd reports only virtual processing steps.
  Command and diagnostic displays redact credential-shaped arguments and URLs.
  Display counters accept a trailing '-' to negate them. -ds accepts up to eight
  characters: digits with an optional k, m, g or t suffix (case-insensitive).
  Values below 1024 imply MB; nonzero intervals from 1 KB to below 32 KB fail.
  Empty -ds values restore 10 MB; 0 disables dots. Sizes must be safe integers.
  Dots use byte intervals, so counts can differ from native codec buffer dots.
  Per-entry progress appears after bounded preparation; global output dots stay
  visible with -q. Timed scanning dots and split-volume displays are unavailable.
`;

export const zipVersion = `safe-bash zip (virtual-bash)
Bounded virtual ZIP implementation; not an Info-ZIP native build.
Compression: store, deflate, bzip2. Single-volume ZIP and ZIP64 output.
Filesystem, signals and byte limits are supplied by the host.
Native compiler identity, ambient environment and encryption are not reported.
`;

export const zipLicense = `safe-bash zip (virtual-bash)
MIT License
Copyright (c) 2026 Poe Platform

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

This is the virtual implementation license, not the native Info-ZIP license.
`;
