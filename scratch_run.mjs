import { config } from "dotenv"; config({ path: ".env.local" });
process.env.PLAYWRIGHT_ENABLED = "false";
delete process.env.VERCEL;
const { runDiscoveryPipeline } = await import("./src/lib/pipeline/run.ts");
const t0 = Date.now(); let last = "";
const { stats } = await runDiscoveryPipeline((p) => {
  const line = `[${p.stage}${p.harvester?`:${p.harvester}`:""}] ${p.message}`;
  if (line !== last) { console.log(`+${((Date.now()-t0)/1000).toFixed(0)}s ${line}`); last = line; }
}, { campaignId: "3315e947-9a35-4e25-bc45-d7baa230ed60", customKeywords: ["seedance 2.0"] });
console.log(`\nDONE ${((Date.now()-t0)/1000).toFixed(0)}s — ${JSON.stringify(stats)}`);
