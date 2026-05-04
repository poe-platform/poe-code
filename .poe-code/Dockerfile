FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

ENV UV_INSTALL_DIR=/usr/local/bin
RUN curl -LsSf https://astral.sh/uv/install.sh | sh

RUN npm i -g \
      poe-code \
      @anthropic-ai/claude-code \
      @openai/codex \
      opencode-ai

RUN uv tool install --python 3.13 kimi-cli
ENV PATH="/root/.local/bin:${PATH}"

RUN curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh \
  | CONFIGURE=false bash
