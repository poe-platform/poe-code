#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void print_bytes(const char *value) {
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor++) printf("%02x", *cursor);
}

int main(int count, char **arguments) {
  printf("argc=%d\n", count);
  for (int index = 0; index < count; index++) {
    printf("arg%d=", index);
    print_bytes(arguments[index]);
    putchar('\n');
  }
  const char *names[] = {"V", "EMPTY", "KEEP", "A", "B", "FLAG", NULL};
  for (int index = 0; names[index]; index++) {
    const char *value = getenv(names[index]);
    printf("env:%s=", names[index]);
    if (value) print_bytes(value); else printf("<unset>");
    putchar('\n');
  }
  return 0;
}
