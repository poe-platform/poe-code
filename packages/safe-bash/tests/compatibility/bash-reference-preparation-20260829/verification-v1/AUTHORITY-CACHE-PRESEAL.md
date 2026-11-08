# Narrow current publisher link and platform-cache metadata

Same25min ROOT budget; no reset. One zero-child controller. Exactly one new GET:
`https://savannah.gnu.org/users/chet`,128KiB,20s, no redirect/retry. This exact
publisher profile is linked as Bash group admin in the already captured official
project page. Do not treat an arbitrary profile key as a signing authorization
until the link/identity/purpose is inspected. No further linked URL fetched yet.

For platform closure, inspect only these two public OS directories (no recursion):
`/System/Library/dyld` and
`/System/Volumes/Preboot/Cryptexes/OS/System/Library/dyld`.
At most64 directory entries each; admit only regular `dyld_shared_cache_arm64`
or `dyld_shared_cache_arm64e` names with optional dot suffix composed of ASCII
letters/digits/dots. Record all other names as unselected metadata. Hash up to
32selected files,4GiB/file,24GiB cumulative **stream reads**,64KiB buffers,
180s including publication. No cache bytes copied/decoded/executed and no working
storage increase beyond1MiB metadata. Stop before reading an oversized set and
report unadmitted rather than claiming closure. No cache tool extraction.
These static cache bindings do not by themselves prove the runtime-selected
images; no platform trust is silently upgraded to a per-process loaded proof.
