// Rebuilds index.json from themes/*/meta.json (the publisher does this on
// every run; this is for a maintainer who edited a theme by hand).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIndex } from "./lib/catalog.mjs";

const index = await writeIndex(join(dirname(fileURLToPath(import.meta.url)), ".."));
console.log(`index.json: ${index.count} theme(s).`);
