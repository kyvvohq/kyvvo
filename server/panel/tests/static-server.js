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
    // Espelha as rotas dinâmicas registradas no Fastify real — aqui não
    // existe arquivo físico com esses nomes. `/admin/tenants/:id` é do
    // US28/CA01; `/onboarding` é do US82.2.
    const rota = /^\/admin\/tenants\/[^/]+$/.test(urlPath)
      ? '/admin/tenant-detalhe.html'
      : urlPath === '/onboarding'
        ? '/onboarding.html'
        : urlPath;
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
