import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url)), dist = path.join(root, 'dist');
const files = ['index.html','styles.css','config.js','manifest.webmanifest','service-worker.js', ...(await readdir(path.join(root,'js'))).filter(f => f.endsWith('.js')).map(f => `js/${f}`), ...(await readdir(path.join(root,'icons'))).filter(f => /\.(png|svg)$/.test(f)).map(f => `icons/${f}`)];
const hash = createHash('sha256');
for (const name of files) hash.update(await readFile(path.join(root,name)));
const version = hash.digest('hex').slice(0,16);
await mkdir(dist,{recursive:true});
for (const name of files) {
  const target = path.join(dist,name); await mkdir(path.dirname(target),{recursive:true});
  if (name === 'service-worker.js') await writeFile(target,(await readFile(path.join(root,name),'utf8')).replace('form-v1-dev',`form-${version}`));
  else await copyFile(path.join(root,name),target);
}
await writeFile(path.join(dist,'.nojekyll'),'');
console.log(`Built ${files.length} assets to dist/ (offline cache ${version}). No private data included.`);
