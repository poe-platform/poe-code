/* Disposable native fixture: report actual argv bytes, echo stdin on fd 3. */
#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
    if (argc == 2 && !strcmp(argv[1], "--pause")) {
        fputs("ready", stdout);
        fflush(stdout);
        for (;;) pause();
    }
    for (int index = 1; index < argc; index++) {
        size_t length = strlen(argv[index]);
        printf("%zu:", length);
        for (size_t offset = 0; offset < length; offset++) printf("%02x", (unsigned char)argv[index][offset]);
        putchar('\n');
    }
    char cwd[4096];
    if (!getcwd(cwd, sizeof(cwd))) return 99;
    const char *value = getenv("VALUE");
    fprintf(stderr, "cwd=%s;VALUE=%s", cwd, value ? value : "absent");
    unsigned char input[4096];
    ssize_t count;
    while ((count = read(STDIN_FILENO, input, sizeof(input))) > 0) {
        ssize_t offset = 0;
        while (offset < count) {
            ssize_t written = write(3, input + offset, (size_t)(count - offset));
            if (written <= 0) return 98;
            offset += written;
        }
    }
    return 23;
}
