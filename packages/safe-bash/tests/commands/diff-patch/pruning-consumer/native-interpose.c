#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int prune_unlinkat(int directory, const char *path, int flags) {
  int (*original)(int, const char *, int) = unlinkat;
  const char *mode = getenv("PRUNE_MODE");
  int result;
  if ((flags & AT_REMOVEDIR) && mode && *mode && strcmp(path, "leaf") == 0) {
    if (strcmp(mode, "enoent") == 0) {
      result = original(directory, path, flags);
      if (result == 0) errno = ENOENT;
      result = -1;
    } else if (strcmp(mode, "child") == 0) {
      int child = openat(directory, "leaf/concurrent", O_CREAT | O_EXCL | O_WRONLY, 0600);
      if (child >= 0) { write(child, "survives\n", 9); close(child); }
      result = original(directory, path, flags);
    } else {
      errno = strcmp(mode, "eio") == 0 ? EIO : EACCES;
      result = -1;
    }
  } else result = original(directory, path, flags);
  int saved = errno;
  if (flags & AT_REMOVEDIR) {
    const char *log = getenv("PRUNE_LOG");
    FILE *stream = log ? fopen(log, "a") : NULL;
    if (stream) { fprintf(stream, "%s\t%d\t%d\n", path, result, result ? saved : 0); fclose(stream); }
  }
  errno = saved;
  return result;
}

__attribute__((used)) static struct { const void *replacement; const void *replacee; }
interpose_unlinkat __attribute__((section("__DATA,__interpose"))) = {
  (const void *)prune_unlinkat, (const void *)unlinkat
};
