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
