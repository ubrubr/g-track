import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const dir of ['js','scripts','tests']) for(const name of await readdir(path.join(root,dir))) if(/\.(js|mjs)$/.test(name)) {
  const check=spawnSync(process.execPath,['--check',path.join(root,dir,name)],{encoding:'utf8'}); if(check.status!==0) throw new Error(check.stderr);
}
const manifest=JSON.parse(await readFile(path.join(root,'manifest.webmanifest'),'utf8'));
if(manifest.start_url!=='./'||manifest.scope!=='./'||manifest.display!=='standalone') throw new Error('PWA paths or display mode are incorrect.');
for(const icon of manifest.icons) await stat(path.join(root,icon.src));
const sw=await readFile(path.join(root,'service-worker.js'),'utf8');
for(const file of ['index.html','styles.css','config.js',...(await readdir(path.join(root,'js'))).map(f=>`js/${f}`)]) if(!sw.includes(`./${file}`)) throw new Error(`Missing offline asset: ${file}`);
const html=await readFile(path.join(root,'index.html'),'utf8');
if(/(?:src|href)=["']\/(?!\/)/.test(html)) throw new Error('Root-relative asset breaks repository subdirectory deployment.');
if(/https?:\/\/.*(?:\.js|\.css)["']/.test(html)) throw new Error('Core app assets must be bundled locally.');
console.log('Source syntax, relative deployment paths, PWA manifest and offline asset list verified.');
