#include <errno.h>
#include <stdio.h>
#include <sys/stat.h>

static int traced_fchmodat(int descriptor, const char *path, mode_t mode, int flags) {
  int result = fchmodat(descriptor, path, mode, flags);
  int saved_errno = errno;
  fprintf(stderr, "METADATA_TRACE {\"function\":\"fchmodat\",\"descriptor\":%d,\"path\":\"%s\",\"modeDecimal\":%u,\"modeOctal\":\"%o\",\"flags\":%d,\"returnValue\":%d,\"errno\":%d}\n",
    descriptor, path, mode, mode, flags, result, saved_errno);
  errno = saved_errno;
  return result;
}

__attribute__((used)) static struct {
  const void *replacement;
  const void *original;
} interposition __attribute__((section("__DATA,__interpose"))) = {
  (const void *)traced_fchmodat, (const void *)fchmodat
};
