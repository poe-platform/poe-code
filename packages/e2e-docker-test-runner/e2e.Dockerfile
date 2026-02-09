FROM node:22

# Install uv for Python tools
RUN curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /build

# Copy and install the pre-built tarball
COPY poe-code.tgz ./
RUN npm install -g ./poe-code.tgz && rm poe-code.tgz

# Pre-install all agents
RUN poe-code install claude-code && \
    poe-code install codex && \
    poe-code install kimi && \
    poe-code install opencode

WORKDIR /workspace
