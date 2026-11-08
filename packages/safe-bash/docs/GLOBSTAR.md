# Recursive pathname expansion

Enable recursive matching for the current shell execution with `shopt -s globstar`:

```sh
shopt -s globstar
printf '%s\n' **/*.txt
```

A standalone, unquoted `**` pathname component matches zero or more directory
levels. `**/*.txt` includes matching files in the current directory and below it.
`**` includes files, directories and symlinks; a trailing slash selects
directories. Adjacent recursive components do not duplicate output paths.
Unmatched patterns remain literal. Other wildcard components keep their existing
meaning; `ab**cd` is not a recursive component.

`globstar` defaults to off for each `Shell.exec` invocation. Functions and sourced
scripts share the current option; subshells and command substitutions inherit an
independent copy. `shopt -u globstar` disables it. `shopt -p`, `-q`, `-s` and `-u`
support both `dotglob` and `globstar`. `dotglob` controls traversal into hidden
directories; `.` and `..` are never wildcard entries. Quoted components remain
literal.

Recursive descent does not follow directory symlinks. Terminal matches can still
include symlinks, including dangling links. An explicit prefix or an ordinary
suffix can resolve a directory symlink. For example, `alias/**/*.txt` starts from
the explicitly named `alias`, and `./**/*.txt` can match a direct `.txt` child of a
symlink encountered by `**`, without recursively walking that symlink. Bare
`**/*.txt` excludes those symlink children. These distinctions and zero-depth
trailing-slash spellings are qualified against GNU Bash 5.2.37 on Darwin.

The iterative traversal allows at most 100,000 returned directory entries and
100,000 admitted traversal states per invocation, with at most 128 recursive
directory levels. Hidden and nonmatching entries count toward the entry bound;
they do not count as emitted expansion fields. Listings receive the remaining
entry allowance before the host call, and returned lengths are checked. A host
filesystem must honor its own resource contract; this cannot prevent arbitrary
allocations inside custom host code.

Existing expansion byte/field, filesystem operation/path component, parse,
command, loop and time limits still apply. Traversal metadata and pathname
storage use the shared value byte budget before allocation, so it can refuse a
large traversal even when final output is small. Scanning, matching and lexical
sorting are charged and yield for cancellation. Cancellation preserves its
original reason and prevents later guest dispatch; it cannot undo completed host
effects or forcibly stop an uncooperative host promise.
