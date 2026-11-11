import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(join(root, "assets"), join(out, "assets"), { recursive: true });
await cp(join(root, "CREDITS.md"), join(out, "CREDITS.md"));
await writeFile(join(out, "index.html"), await readFile(join(root, "solar.html")));
console.log(`built ${out}`);