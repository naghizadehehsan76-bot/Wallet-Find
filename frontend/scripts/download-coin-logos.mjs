import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const outputDir = join(process.cwd(), "public", "assets", "coins");
await mkdir(outputDir, { recursive: true });

const base = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const assets = {
  ETH: `${base}/ethereum/info/logo.png`,
  BNB: `${base}/smartchain/info/logo.png`,
  USDT: `${base}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
  POL: `${base}/polygon/info/logo.png`,
};

for (const [symbol, url] of Object.entries(assets)) {
  const response = await fetch(url, { headers: { "User-Agent": "Wallet-Find-asset-sync/1.0" } });
  if (!response.ok) throw new Error(`Could not download ${symbol} logo: HTTP ${response.status} (${url})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const isPng = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!isPng) throw new Error(`Downloaded ${symbol} logo is not a valid PNG`);
  await writeFile(join(outputDir, `${symbol}.png`), bytes);
  console.log(`Installed local ${symbol} logo (${bytes.length} bytes)`);
}

// USDT0 is the same Tether USD brand mark as USDT; the network does not change its logo.
await writeFile(join(outputDir, "USDT0.png"), await (await import("node:fs/promises")).readFile(join(outputDir, "USDT.png")));
console.log("Installed local USDT0 logo");
