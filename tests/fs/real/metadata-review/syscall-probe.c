#include <errno.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 4) return 64;
  char *end = NULL;
  long parsed = strtol(argv[3], &end, 8);
  if (*end || parsed < 0 || parsed > 07777) return 64;
  mode_t mode = (mode_t)parsed;
  int result;
  errno = 0;
  if (!strcmp(argv[1], "libc-chmod")) result = chmod(argv[2], mode);
  else if (!strcmp(argv[1], "kernel-chmod")) {
    int (*raw_chmod)(const char *, mode_t) = dlsym(RTLD_DEFAULT, "__chmod");
    if (!raw_chmod) return 69;
    result = raw_chmod(argv[2], mode);
  }
  else if (!strcmp(argv[1], "fchmodat")) result = fchmodat(AT_FDCWD, argv[2], mode, 0);
  else return 64;
  int saved_errno = errno;
  printf("{\"function\":\"%s\",\"modeOctal\":\"%04o\",\"modeDecimal\":%u,\"atFdcwd\":%d,\"flags\":0,\"returnValue\":%d,\"errno\":%d,\"error\":\"%s\"}\n",
    argv[1], mode, mode, AT_FDCWD, result, saved_errno,
    result < 0 ? strerror(saved_errno) : "");
  return result < 0 ? 1 : 0;
}
