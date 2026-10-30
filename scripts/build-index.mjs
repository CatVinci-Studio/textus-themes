// Rebuilds index.json from themes/*/meta.json, with the install counts as
// they are now: daily (.github/workflows/stats.yml), and for a maintainer
// who edited a theme by hand. The publisher rebuilds it too, keeping the
// counts it lists.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeIndex } from "./lib/catalog.mjs";
import { fetchInstalls } from "./lib/stats.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = await writeIndex(root, (await fetchInstalls()) ?? undefined);
console.log(`index.json: ${index.count} theme(s).`);
