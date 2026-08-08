const fs = require('fs');
const bump = ['ui.js', 'i18n.js', 'settings.js', 'app.js'];
for (const f of ['index.html', 'sw.js']) {
  let s = fs.readFileSync(f, 'utf8'), log = [];
  for (const k of bump) s = s.replace(new RegExp('(' + k.replace('.', '\\.') + '\\?v=)(\\d+)', 'g'), (m, p, n) => { log.push(k + ':' + (+n + 1)); return p + (+n + 1); });
  fs.writeFileSync(f, s);
  console.log(f, log.join(' '));
}
const sw = fs.readFileSync('sw.js', 'utf8');
const v = sw.match(/VERSION\s*=\s*'v(\d+)'/);
fs.writeFileSync('sw.js', sw.replace(/VERSION\s*=\s*'v\d+'/, "VERSION = 'v" + (+v[1] + 1) + "'"));
console.log('VERSION v' + v[1] + ' -> v' + (+v[1] + 1));
