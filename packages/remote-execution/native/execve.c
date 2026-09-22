/* Private server launcher ABI v1. Media bytes never pass through these pipes.
 * Compile inside the pinned deployment; authenticate the installed binary hash.
 * argv: helper, native executable, request fd, errno fd. No shell is involved. */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern char **environ;
static int diagnostic_fd = -1;

static void fail(int code) {
    unsigned char record[8] = {'R', 'M', 'E', '1',
        (unsigned char)((uint32_t)code >> 24), (unsigned char)((uint32_t)code >> 16),
        (unsigned char)((uint32_t)code >> 8), (unsigned char)code};
    size_t offset = 0;
    while (diagnostic_fd >= 0 && offset < sizeof(record)) {
        ssize_t count = write(diagnostic_fd, record + offset, sizeof(record) - offset);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) break;
        offset += (size_t)count;
    }
    _exit(127);
}

static void read_exact(int fd, void *destination, size_t length) {
    unsigned char *bytes = destination;
    size_t offset = 0;
    while (offset < length) {
        ssize_t count = read(fd, bytes + offset, length - offset);
        if (count < 0 && errno == EINTR) continue;
        if (count < 0) fail(errno);
        if (count == 0) fail(EINVAL);
        offset += (size_t)count;
    }
}

static uint32_t integer(const unsigned char *bytes) {
    return ((uint32_t)bytes[0] << 24) | ((uint32_t)bytes[1] << 16) |
        ((uint32_t)bytes[2] << 8) | (uint32_t)bytes[3];
}

static int descriptor(const char *text) {
    char *end;
    errno = 0;
    long value = strtol(text, &end, 10);
    if (errno || !*text || *end || value < 3 || value > 1023) return -1;
    return (int)value;
}

int main(int argc, char **argv) {
    if (argc != 4) return 127;
    diagnostic_fd = descriptor(argv[3]);
    int input_fd = descriptor(argv[2]);
    if (input_fd < 0 || diagnostic_fd < 0 || input_fd == diagnostic_fd || argv[1][0] != '/') fail(EINVAL);
    if (fcntl(diagnostic_fd, F_SETFD, FD_CLOEXEC) < 0) fail(errno);
    unsigned char header[12];
    read_exact(input_fd, header, sizeof(header));
    if (memcmp(header, "RMA1", 4)) fail(EINVAL);
    uint32_t count = integer(header + 4), total = integer(header + 8);
    /* Admit byte storage and token pointer storage before either allocation. */
    if (total > 1048576 || count > total) fail(E2BIG);
    char **native_argv = calloc((size_t)count + 2, sizeof(char *));
    char *tokens = malloc(total ? total : 1);
    if (!native_argv || !tokens) fail(ENOMEM);
    native_argv[0] = argv[1];
    size_t position = 0;
    for (uint32_t index = 0; index < count; index++) {
        unsigned char size_bytes[4];
        read_exact(input_fd, size_bytes, sizeof(size_bytes));
        uint32_t size = integer(size_bytes);
        if ((size_t)size + 1 > (size_t)total - position) fail(EINVAL);
        native_argv[index + 1] = tokens + position;
        read_exact(input_fd, tokens + position, size);
        if (memchr(tokens + position, 0, size)) fail(EINVAL);
        position += size;
        tokens[position++] = 0;
    }
    if (position != total) fail(EINVAL);
    unsigned char extra;
    ssize_t tail;
    do { tail = read(input_fd, &extra, 1); } while (tail < 0 && errno == EINTR);
    if (tail < 0) fail(errno);
    if (tail != 0) fail(EINVAL);
    if (close(input_fd) < 0) fail(errno);
    execve(argv[1], native_argv, environ);
    fail(errno);
    return 127;
}
