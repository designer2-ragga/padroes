// Decode a fresh snapshot dump and compare each PNG against baseline-snapshots/.
// Usage: node scripts/diff-snapshots.cjs <path-to-dump.txt>
//   Writes byte-equal PNGs nowhere; writes diverged PNGs to /tmp-snapshots/ for inspection.
//   Reports the per-file delta count.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const src = process.argv[2];
if (!src) { console.error('missing source path'); process.exit(1); }

let content = fs.readFileSync(src, 'utf8').trim();
if (content.startsWith('"') && content.endsWith('"')) content = JSON.parse(content);

const baselineDir = path.join(__dirname, '..', 'baseline-snapshots');
const tmpDir = path.join(__dirname, '..', 'tmp-snapshots');
fs.mkdirSync(tmpDir, { recursive: true });

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');

const entries = content.split('|||');
let identical = 0, diverged = 0;
const diff = [];

for (const entry of entries) {
  if (!entry.includes(':::')) continue;
  const idx = entry.indexOf(':::');
  const key = entry.slice(0, idx).trim();
  const b64 = entry.slice(idx + 3).trim();
  const fresh = Buffer.from(b64, 'base64');
  const baselinePath = path.join(baselineDir, key + '-42.png');
  let baselineExists = false;
  try { fs.accessSync(baselinePath); baselineExists = true; } catch {}
  if (!baselineExists) {
    diff.push({ key, status: 'no baseline' });
    diverged++;
    continue;
  }
  const baseline = fs.readFileSync(baselinePath);
  const freshHash = md5(fresh);
  const baseHash = md5(baseline);
  if (freshHash === baseHash) {
    identical++;
  } else {
    fs.writeFileSync(path.join(tmpDir, key + '-fresh.png'), fresh);
    diff.push({ key, status: 'diverged', freshHash: freshHash.slice(0,8), baseHash: baseHash.slice(0,8), freshBytes: fresh.length, baseBytes: baseline.length });
    diverged++;
  }
}

console.log(JSON.stringify({ identical, diverged, diff }, null, 2));
