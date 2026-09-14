import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.mastra/output",
);

async function fixDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") await fixDirectory(entryPath);
      continue;
    }
    if (!entry.name.endsWith(".mjs")) continue;

    const source = await readFile(entryPath, "utf8");
    // Mastra 1.66 can emit escaped Windows separators in external ESM package specifiers.
    const portable = source
      .split("\n")
      .map((line) => line.includes("@modelcontextprotocol/sdk") ? line.replaceAll("\\\\", "/") : line)
      .join("\n");
    if (portable !== source) await writeFile(entryPath, portable);
  }
}

await fixDirectory(outputDirectory);
