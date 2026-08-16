/**
 * Card Scanner+ Local Development Server
 * Ultra-fast native HTTP server (Zero-dependency, sub-10ms response time)
 */

import http from 'http';
import { matchCandidates } from './services/card-matcher.js';

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  // Set CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // 1. Health Check: GET /api/health
  if (pathname === '/api/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'Card Scanner+ API (Local Server)',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // 2. Candidate Search: POST /api/search-candidates
  if (pathname === '/api/search-candidates' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => {
      bodyData += chunk;
    });

    req.on('end', async () => {
      try {
        const body = bodyData ? JSON.parse(bodyData) : {};
        const startTime = performance.now();
        const candidates = await matchCandidates(body);
        const duration = Math.round(performance.now() - startTime);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          query: body,
          count: candidates.length,
          candidates: candidates,
          durationMs: duration
        }));
      } catch (err) {
        console.error('[Server Error] POST /api/search-candidates:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
          candidates: []
        }));
      }
    });
    return;
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Card Scanner+ API Server running at http://localhost:${PORT}`);
  console.log(`⚡ Health Check:  http://localhost:${PORT}/api/health`);
  console.log(`🔍 Search Route:  POST http://localhost:${PORT}/api/search-candidates`);
  console.log(`======================================================\n`);
});
