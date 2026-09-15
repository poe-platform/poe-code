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
  -X          strip optional metadata
  -fz / -fz-  force / disable ZIP64 output
  -fd         force data descriptors
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
`;
