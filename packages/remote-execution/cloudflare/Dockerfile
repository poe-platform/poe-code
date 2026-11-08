FROM --platform=linux/amd64 node:24-bookworm@sha256:b977d0f785d96029d8d4c0790b6bf1c2a4c72e0f26319808e7ba2e9d966a1ac3 AS native-launcher
WORKDIR /app
COPY image/execve.c /app/execve.c
COPY image/container-lock.json /app/container-lock.json
RUN node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const lock=JSON.parse(readFileSync('container-lock.json'));if(createHash('sha256').update(readFileSync('execve.c')).digest('hex')!==lock.byteArgvLauncher.sourceDigest)throw new Error('Execve source digest mismatch');"
RUN mkdir -p /opt/remote-execution && gcc -std=c11 -O2 -Wall -Wextra -Werror execve.c -o /opt/remote-execution/execve
RUN node --input-type=module -e "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const lock=JSON.parse(readFileSync('container-lock.json'));const helper=readFileSync(lock.byteArgvLauncher.helperExecutable);if(helper.length>lock.byteArgvLauncher.maxHelperBytes||createHash('sha256').update(helper).digest('hex')!==lock.byteArgvLauncher.helperDigest)throw new Error('Execve binary digest mismatch');"

FROM --platform=linux/amd64 docker.io/cloudflare/sandbox:0.12.9
WORKDIR /app
# Prepare these bundles locally from this checkout; do not fetch floating npm
# media server releases or silently install an unqualified namespace backend.
COPY image/ /app/
COPY --from=native-launcher /opt/remote-execution/execve /opt/remote-execution/execve
RUN node download.mjs && mkdir -p /opt/ffmpeg && tar -xJf /tmp/ffmpeg.tar.xz -C /opt/ffmpeg --strip-components=2 ffmpeg-n9.0.1-29-gad500d59cb-linux64-gpl-9.0/bin/ffmpeg ffmpeg-n9.0.1-29-gad500d59cb-linux64-gpl-9.0/bin/ffprobe
RUN dpkg -i /tmp/squashfs-tools.deb && unsquashfs -o 944632 -d /opt/imagemagick /tmp/magick.AppImage
# Preserve the supported image's ENTRYPOINT. /sandbox owns its API and starts
# this child; media processes and cancellation remain owned by our server.
EXPOSE 8080
CMD ["node", "/app/bootstrap.mjs"]
