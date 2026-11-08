export async function copyTerminalPngAssets(fs, sourceDirectory, outputDirectory) {
  const fontFiles = (await fs.readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ttf"))
    .map((entry) => entry.name);

  if (fontFiles.length === 0) {
    throw new Error(`No terminal-png font assets found in ${sourceDirectory}`);
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    fontFiles.map((filename) =>
      fs.copyFile(`${sourceDirectory}/${filename}`, `${outputDirectory}/${filename}`)
    )
  );
}
