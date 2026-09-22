FROM --platform=linux/amd64 node:24-bookworm@sha256:b977d0f785d96029d8d4c0790b6bf1c2a4c72e0f26319808e7ba2e9d966a1ac3 AS native-assets
WORKDIR /app
COPY packages/remote-execution/native/execve.c /app/execve.c
RUN mkdir -p /opt/remote-execution && gcc -std=c11 -O2 -Wall -Wextra -Werror execve.c -o /opt/remote-execution/execve
COPY packages/media-cli/server/download.mjs /app/download.mjs
COPY packages/media-cli/server/container-lock.json /app/container-lock.json
# The checksum-pinned AppImage has its SquashFS payload at byte 944632.
# Extract it without executing its architecture-specific AppImage launcher.
# Keep downloads and extraction in one layer so archives are never shipped.
RUN node download.mjs \
 && mkdir -p /opt/ffmpeg \
 && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=2 ffmpeg-n9.0.1-29-gad500d59cb-linux64-gpl-9.0/bin/ffmpeg ffmpeg-n9.0.1-29-gad500d59cb-linux64-gpl-9.0/bin/ffprobe \
 && dpkg -i /tmp/squashfs-tools.deb \
 && unsquashfs -o 944632 -d /opt/imagemagick /tmp/magick.AppImage \
 && rm /tmp/ffmpeg.tar.xz /tmp/magick.AppImage /tmp/squashfs-tools.deb
COPY packages/media-cli/dist/build-assets.js /app/build-assets.js
RUN node --input-type=module -e "import{readFile}from'node:fs/promises';import{verifyMediaExecutableAssets}from'./build-assets.js';const lock=JSON.parse(await readFile('/app/container-lock.json'));await verifyMediaExecutableAssets({executablePaths:lock.executablePaths,expectedExecutableDigests:lock.executables,maxExecutableBytes:lock.maxExecutableBytes});"

# Explicit service target. No tool executes until an authenticated admitted job.
# Operators mount their configuration, TLS, ledger and qualified bridge assets.
FROM native-assets AS service
COPY packages/remote-execution/package.json /app/node_modules/@poe-code/remote-execution/package.json
COPY packages/remote-execution/dist/ /app/node_modules/@poe-code/remote-execution/dist/
COPY packages/remote-execution/schemas/v1/ /app/node_modules/@poe-code/remote-execution/schemas/v1/
COPY packages/safe-fs/package.json /app/node_modules/@poe-code/safe-fs/package.json
COPY packages/safe-fs/dist/ /app/node_modules/@poe-code/safe-fs/dist/
COPY packages/media-cli/package.json /app/node_modules/@poe-code/media-cli/package.json
COPY packages/media-cli/dist/ /app/node_modules/@poe-code/media-cli/dist/
COPY packages/media-cli/server/start.mjs /app/node_modules/@poe-code/media-cli/server/start.mjs
USER node
ENTRYPOINT ["node", "/app/node_modules/@poe-code/media-cli/server/start.mjs"]
CMD []

# Keep the maintained default target as disposable native integration.
FROM native-assets AS integration
COPY packages/remote-execution/dist/native-process.js /app/native-process.js
COPY packages/remote-execution/dist/byte-argv-launcher.js /app/byte-argv-launcher.js
COPY packages/media-cli/dist/ /app/
COPY packages/remote-execution/package.json /app/node_modules/@poe-code/remote-execution/package.json
COPY packages/remote-execution/dist/ /app/node_modules/@poe-code/remote-execution/dist/
COPY packages/remote-execution/schemas/v1/ /app/node_modules/@poe-code/remote-execution/schemas/v1/
COPY packages/safe-fs/package.json /app/node_modules/@poe-code/safe-fs/package.json
COPY packages/safe-fs/dist/ /app/node_modules/@poe-code/safe-fs/dist/
COPY packages/media-cli/server/media.native.mjs /app/media.native.mjs
COPY packages/media-cli/server/inventory.mjs /app/inventory.mjs
USER node
CMD ["node", "--test", "media.native.mjs"]
