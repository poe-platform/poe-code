FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl bzip2 python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

RUN npm i -g poe-code

ENV PATH="/root/.local/bin:${PATH}"
RUN poe-code install claude-code \
  && poe-code install codex \
  && poe-code install opencode \
  && poe-code install kimi \
  && poe-code install goose
