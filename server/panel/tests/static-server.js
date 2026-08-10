const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http
  .createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    // Espelha a rota dinâmica `/admin/tenants/:id` registrada no Fastify real
    // (US28/CA01) — aqui não existe arquivo físico com esse nome. Aceita tanto
    // `/admin/tenants/:id` quanto `/tenants/:id` (US83/PR#163 removeu o
    // prefixo `/admin/` dos links internos do painel; em produção o domínio
    // admin.kyvvo.com.br resolve o caminho raiz via reescrita do Nginx, fora
    // do git — aqui replicamos só essa reescrita específica, sem prefixo
    // colidir com nada do lado tenant).
    const rota = /^\/(admin\/)?tenants\/[^/]+$/.test(urlPath) ? '/admin/tenant-detalhe.html' : urlPath;
    const filePath = path.join(PUBLIC_DIR, rota === '/' ? '/index.html' : rota);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`Static panel server ouvindo na porta ${PORT}`);
  });
