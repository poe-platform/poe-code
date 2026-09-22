FROM --platform=linux/amd64 node:24-bookworm@sha256:b977d0f785d96029d8d4c0790b6bf1c2a4c72e0f26319808e7ba2e9d966a1ac3
WORKDIR /app
COPY packages/remote-execution/native/execve.c /app/execve.c
COPY packages/remote-execution/integration/argv-probe.c /app/argv-probe.c
RUN gcc -std=c11 -O2 -Wall -Wextra -Werror execve.c -o rme-execve && gcc -std=c11 -O2 -Wall -Wextra -Werror argv-probe.c -o argv-probe
RUN openssl req -x509 -newkey rsa:2048 -nodes -days 1 -keyout service.key -out service.crt -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 && chown node:node service.key && chmod 600 service.key
COPY packages/remote-execution/dist/native-process.js /app/native-process.js
COPY packages/remote-execution/dist/byte-argv-launcher.js /app/byte-argv-launcher.js
COPY packages/remote-execution/dist/native-driver.js /app/native-driver.js
COPY packages/remote-execution/integration/process.native.mjs /app/process.native.mjs
COPY packages/remote-execution/package.json /app/node_modules/@poe-code/remote-execution/package.json
COPY packages/remote-execution/dist/*.js /app/node_modules/@poe-code/remote-execution/dist/
COPY packages/safe-fs/package.json /app/node_modules/@poe-code/safe-fs/package.json
COPY packages/safe-fs/dist/package.json /app/node_modules/@poe-code/safe-fs/dist/package.json
COPY packages/safe-fs/dist/contracts/object.js packages/safe-fs/dist/contracts/errors.js /app/node_modules/@poe-code/safe-fs/dist/contracts/
COPY packages/safe-fs/dist/platform/node.js /app/node_modules/@poe-code/safe-fs/dist/platform/node.js
COPY packages/remote-execution/integration/dependency-profile.native.mjs /app/integration/dependency-profile.native.mjs
COPY packages/remote-execution/integration/byte-argv.native.mjs /app/integration/byte-argv.native.mjs
COPY packages/remote-execution/integration/service.native.mjs /app/integration/service.native.mjs
USER node
CMD ["node", "--test", "process.native.mjs", "integration/dependency-profile.native.mjs", "integration/byte-argv.native.mjs", "integration/service.native.mjs"]
