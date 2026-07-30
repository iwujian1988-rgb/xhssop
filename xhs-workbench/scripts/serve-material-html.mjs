import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.PORT || 4010);
const file = path.resolve(process.cwd(), 'public/material-results-temp.html');

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/material-results-temp.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`material html server: http://localhost:${port}/material-results-temp.html`);
});
