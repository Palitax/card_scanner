/**
 * Vercel Serverless Function: POST /api/search-candidates
 */

import { matchCandidates } from '../services/card-matcher.js';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const candidates = await matchCandidates(body);

    return res.status(200).json({
      success: true,
      query: body,
      count: candidates.length,
      candidates: candidates
    });
  } catch (err) {
    console.error('[API /api/search-candidates Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      candidates: []
    });
  }
}
