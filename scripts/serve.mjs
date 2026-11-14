import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const root = path.resolve(fileURLToPath(new URL('../',import.meta.url)), args.includes('--dist') ? 'dist' : '.');
const baseArg = args.indexOf('--base'); const base = baseArg >= 0 ? `/${args[baseArg+1].replace(/^\/+|\/+$/g,'')}/` : '/';
const portArg = args.indexOf('--port'); const port = Number(portArg >= 0 ? args[portArg+1] : process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png' };
const server = http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url,'http://localhost');
    if (!url.pathname.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
    const relative = decodeURIComponent(url.pathname.slice(base.length));
    if (relative.split('/').some(part => part.startsWith('.')) || /(?:^|\/)(?:backups|node_modules)(?:\/|$)/.test(relative)) { res.writeHead(404); res.end('Not found'); return; }
    const file = path.resolve(root,relative || 'index.html');
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200,{ 'Content-Type':types[path.extname(file)] || 'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' }); res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(port,'127.0.0.1',() => console.log(`FORM local preview: http://127.0.0.1:${port}${base}`));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => process.exit(0)));
