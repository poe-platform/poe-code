#!/bin/bash
set -e

# Check if actionlint is globally installed
if command -v actionlint &> /dev/null; then
  echo "✓ Using globally installed actionlint"
  exit 0
fi

# Check if local binary exists
if [ -f "./actionlint" ]; then
  echo "✓ Using local actionlint binary"
  exit 0
fi

# Download actionlint binary
echo "Downloading actionlint..."
bash <(curl -L -s https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
echo "✓ actionlint downloaded successfully"
