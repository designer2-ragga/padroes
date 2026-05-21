// Decode a calibration dump into calibration/{key}.png
// Usage: node scripts/decode-calibration.cjs <path-to-dump.txt>

const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src) { console.error('missing source path'); process.exit(1); }

let content = fs.readFileSync(src, 'utf8').trim();
if (content.startsWith('"') && content.endsWith('"')) content = JSON.parse(content);

const outDir = path.join(__dirname, '..', 'calibration');
fs.mkdirSync(outDir, { recursive: true });

const entries = content.split('|||');
let saved = 0;
for (const entry of entries) {
  if (!entry.includes(':::')) continue;
  const idx = entry.indexOf(':::');
  const key = entry.slice(0, idx).trim();
  const b64 = entry.slice(idx + 3).trim();
  const data = Buffer.from(b64, 'base64');
  const outPath = path.join(outDir, key + '.png');
  fs.writeFileSync(outPath, data);
  console.log('wrote ' + outPath + ' (' + data.length + ' bytes)');
  saved++;
}
console.log('saved=' + saved);
