// Each theme's installs, ever and in the last 30 days, from Textus's
// anonymous install counts (the app's services/ext-stats).
const EXT_STATS = "https://textus.catvinci.com/api/ext/stats";

/** `{installs, installs30}` by theme id, or null when the counts can't be
 *  read: index.json then keeps the ones it has. */
export async function fetchInstalls(url = EXT_STATS) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(String(res.status));
    return themeInstalls(await res.json());
  } catch (err) {
    console.warn(`install counts not updated: ${url}: ${err.message}`);
    return null;
  }
}

/** The themes' installs in the endpoint's answer. */
export function themeInstalls(counts) {
  const out = {};
  for (const [id, s] of Object.entries(counts?.theme ?? {}))
    if (Number.isInteger(s?.installs) && Number.isInteger(s?.installs30))
      out[id] = { installs: s.installs, installs30: s.installs30 };
  return out;
}
