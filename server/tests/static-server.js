const http = require('http');
const fs = require('fs');
const path = require('path');

// Mesma ideia do static-server do painel (server/panel/tests/), mas
// servindo server/public-studio (landing do Studio, movida de server/public
// quando kyvvo.com.br virou a landing da plataforma e o conteúdo de vendas
// existente passou a viver em studio.kyvvo.com.br) — a landing não tinha
// nenhum harness de teste até aqui (US67).
const PUBLIC_DIR = path.join(__dirname, '..', 'public-studio');
const PORT = process.env.PORT || 4174;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

http
  .createServer((req, res) => {
    const urlPath = req.url.split('?')[0];
    const filePath = path.join(PUBLIC_DIR, urlPath === '/' ? '/index.html' : urlPath);

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
    console.log(`Static landing server ouvindo na porta ${PORT}`);
  });
