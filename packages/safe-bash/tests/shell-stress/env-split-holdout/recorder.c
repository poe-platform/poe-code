#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>

extern char **environ;

static void hex(const unsigned char *bytes, size_t length) {
  putchar('"');
  for (size_t index = 0; index < length; index++) printf("%02x", bytes[index]);
  putchar('"');
}

int main(int argc, char **argv) {
  char directory[PATH_MAX];
  unsigned char input[262145];
  size_t input_length = fread(input, 1, sizeof(input), stdin);
  if (input_length == sizeof(input) || ferror(stdin) || !getcwd(directory, sizeof(directory))) return 97;
  printf("{\"argc\":%d,\"argvHex\":[", argc);
  for (int index = 0; index < argc; index++) {
    if (index) putchar(',');
    hex((const unsigned char *)argv[index], strlen(argv[index]));
  }
  printf("],\"envHex\":[");
  for (size_t index = 0; environ[index]; index++) {
    if (index) putchar(',');
    hex((const unsigned char *)environ[index], strlen(environ[index]));
  }
  printf("],\"stdinHex\":");
  hex(input, input_length);
  printf(",\"cwdHex\":");
  hex((const unsigned char *)directory, strlen(directory));
  printf("}\n");
  return ferror(stdout) ? 98 : 0;
}
