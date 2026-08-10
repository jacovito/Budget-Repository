import { readFile, writeFile } from "node:fs/promises";

const configPath = ".deploy/Paycheck-Local-v1.0.0/dist/server/wrangler.json";
const config = JSON.parse(await readFile(configPath, "utf8"));

delete config.legacy_env;

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("Prepared Cloudflare configuration.");
