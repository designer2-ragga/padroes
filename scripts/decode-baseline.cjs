const fs = require('fs');
const path = require('path');

const src = String.raw`C:\Users\desig\.claude\projects\C--Users-desig\ba58b789-3e94-4c5a-8c2e-2ad2f74ce9cf\tool-results\mcp-Claude_Preview-preview_eval-1779377240847.txt`;

let content = fs.readFileSync(src, 'utf8').trim();

// File contains the JSON-encoded eval result, wrapped in double quotes.
if (content.startsWith('"') && content.endsWith('"')) {
  content = JSON.parse(content);
}

const entries = content.split('|||');
console.log('entries=' + entries.length);

const outDir = path.join(__dirname, '..', 'baseline-snapshots');
fs.mkdirSync(outDir, { recursive: true });

let saved = 0;
for (const entry of entries) {
  if (!entry.includes(':::')) continue;
  const idx = entry.indexOf(':::');
  const key = entry.slice(0, idx).trim();
  const b64 = entry.slice(idx + 3).trim();
  try {
    const data = Buffer.from(b64, 'base64');
    const outPath = path.join(outDir, key + '-42.png');
    fs.writeFileSync(outPath, data);
    console.log('wrote ' + outPath + ' (' + data.length + ' bytes)');
    saved++;
  } catch (e) {
    console.log('fail ' + key + ': ' + e.message);
  }
}
console.log('saved=' + saved);
