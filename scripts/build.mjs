// Embeds data/scores.json into dashboard.html and writes the static site to docs/index.html.
import fs from 'node:fs';
const data = fs.readFileSync('data/scores.json', 'utf8');
const html = fs.readFileSync('scripts/dashboard.html', 'utf8');
if (!html.includes('/*__DATA__*/')) throw new Error('dashboard.html missing /*__DATA__*/ placeholder');
fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/index.html', html.replace('/*__DATA__*/', () => data.replace(/<\/script/gi, '<\\/script')));
fs.writeFileSync('docs/.nojekyll', '');
console.log(`docs/index.html written (${(fs.statSync('docs/index.html').size / 1024).toFixed(0)} KB)`);
