import { existsSync, mkdirSync, chmodSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { extract } from 'tar';
import { fileURLToPath } from 'url';
import path from 'path';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.join(__dirname, '..', 'bin', 'freeze-bin');

const VERSION = '0.2.0';

interface PlatformMapping {
  platform: string;
  arch: string;
}

function getPlatformMapping(): PlatformMapping {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js platform/arch to freeze release naming
  const platformMap: Record<string, string> = {
    darwin: 'Darwin',
    linux: 'Linux',
  };

  const archMap: Record<string, string> = {
    arm64: 'arm64',
    x64: 'x86_64',
  };

  const mappedPlatform = platformMap[platform];
  const mappedArch = archMap[arch];

  if (!mappedPlatform || !mappedArch) {
    throw new Error(
      `Unsupported platform/arch combination: ${platform}/${arch}. ` +
        `Supported: darwin-arm64, darwin-x64, linux-x64, linux-arm64`
    );
  }

  return { platform: mappedPlatform, arch: mappedArch };
}

function getDownloadUrl(): string {
  const { platform, arch } = getPlatformMapping();
  return `https://github.com/charmbracelet/freeze/releases/download/v${VERSION}/freeze_${VERSION}_${platform}_${arch}.tar.gz`;
}

async function downloadAndExtract(): Promise<void> {
  const url = getDownloadUrl();
  console.log(`Downloading freeze v${VERSION} from ${url}`);

  // Create bin directory if it doesn't exist
  if (!existsSync(binDir)) {
    mkdirSync(binDir, { recursive: true });
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download freeze: ${response.status} ${response.statusText}`);
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  // Extract tar.gz directly to bin directory (strip the top-level directory)
  const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
  await pipeline(nodeStream, createGunzip(), extract({ cwd: binDir, strip: 1 }));

  // Make binary executable
  const binaryPath = path.join(binDir, 'freeze');
  if (existsSync(binaryPath)) {
    chmodSync(binaryPath, 0o755);
  }

  console.log(`Successfully installed freeze to ${binDir}`);
}

downloadAndExtract().catch((error) => {
  console.error('Failed to download freeze:', error.message);
  process.exit(1);
});
