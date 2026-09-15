// Test-only local reverse proxy: real review API, intercepted continuation, no generation routes.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
const output = process.argv[2];
if (!output || !path.basename(output).startsWith('.tmp-review-ui-')) throw Error('ISOLATED_OUTPUT_REQUIRED');
const events = [];
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const payload = JSON.parse(body.toString() || '{}');
      if (req.url === '/api/batch' && payload.action === 'resume_reviewed_inner') {
        const state = await (await fetch(`http://127.0.0.1:4126/api/batch?batch_id=${encodeURIComponent(payload.batch_id)}`)).json();
        const job = state.jobs.find(j => j.id === payload.job_id);
        const locked = job?.artifacts?.content?.data?.manualInnerReview?.status === 'locked' && job.status !== 'dropped';
        events.push({ action: payload.action, jobId: payload.job_id, locked, innerHash: job?.artifacts?.content?.data?.manualInnerReview?.innerHash, canonicalEqualsDraft: JSON.stringify(job?.artifacts?.content?.data?.innerPages) === JSON.stringify(job?.draft?.inner_pages), aiCalls: 0 });
        await fs.writeFile(path.join(output, 'intercepted-continuations.json'), JSON.stringify(events, null, 2));
        res.writeHead(locked ? 200 : 409, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ started: locked, testIntercepted: true }));
      }
      if (req.url !== '/api/batch' || payload.action !== 'update_draft_state' || !(payload.inner_pages || payload.confirm_inner_review || payload.drop_inner_review)) {
        res.writeHead(403); return res.end('TEST_ONLY_REVIEW_MUTATIONS');
      }
    }
    const forward = http.request({ hostname: '127.0.0.1', port: 4126, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:4126' } }, upstream => {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    forward.on('error', e => { res.writeHead(502); res.end(e.message); });
    forward.end(body);
  } catch(e) { res.writeHead(500); res.end(e.message); }
});
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(4126, '127.0.0.1', () => {
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    upstream.write(head); socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy()); socket.on('error', () => upstream.destroy());
});
server.listen(4127, '127.0.0.1', () => console.log('REVIEW_TEST_PROXY=http://localhost:4127; AI_ENTRY_INTERCEPTED'));
