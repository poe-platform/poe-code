FROM e2b/claude-code

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN npm i -g poe-code

RUN poe-code install codex \
  && poe-code install opencode
