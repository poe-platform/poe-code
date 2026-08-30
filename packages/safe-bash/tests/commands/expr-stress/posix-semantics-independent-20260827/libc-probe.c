#include <inttypes.h>
#include <locale.h>
#include <regex.h>
#include <stdio.h>
#include <string.h>

int main(int argument_count, char **arguments) {
  if (argument_count != 3 || strlen(arguments[1]) > 256 || strlen(arguments[2]) > 64) return 64;
  if (setlocale(LC_ALL, "C") == NULL) return 65;
  char anchored[258];
  anchored[0] = '^';
  memcpy(anchored + 1, arguments[1], strlen(arguments[1]) + 1);
  regex_t expression;
  int compiled = regcomp(&expression, anchored, 0);
  if (compiled != 0) {
    printf("{\"compiled\":%d}\n", compiled);
    return 0;
  }
  regmatch_t matches[3];
  for (size_t index = 0; index < 3; index++) {
    matches[index].rm_so = -99;
    matches[index].rm_eo = -99;
  }
  int executed = regexec(&expression, arguments[2], 3, matches, 0);
  printf("{\"compiled\":0,\"executed\":%d,\"noMatchCode\":%d,\"nsub\":%zu,\"spans\":[", executed, REG_NOMATCH, expression.re_nsub);
  for (size_t index = 0; index < 3; index++) {
    printf("%s[%" PRIdMAX ",%" PRIdMAX "]", index ? "," : "", (intmax_t)matches[index].rm_so, (intmax_t)matches[index].rm_eo);
  }
  puts("]}");
  regfree(&expression);
  return 0;
}
