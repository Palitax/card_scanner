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

  const startTime = performance.now();

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const result = await matchCandidates(body);

    const candidatesList = Array.isArray(result) ? result : (result.candidates || []);
    const status = result?.status || (candidatesList.length > 0 ? 'SUCCESS' : 'NO_MATCH');
    const apiMessage = result?.apiMessage || null;

    return res.status(200).json({
      success: true,
      query: {
        hasImage: Boolean(body.imageBase64),
        hasKey: Boolean(body.customApiKey),
        query: body.query || '',
        auctionHint: body.auctionHint || ''
      },
      count: candidatesList.length,
      candidates: candidatesList,
      status: status,
      apiMessage: apiMessage,
      durationMs: Math.round(performance.now() - startTime)
    });
  } catch (err) {
    console.error('[API /api/search-candidates Error]:', err);
    return res.status(500).json({
      success: false,
      error: err.message,
      candidates: [],
      status: 'EXCEPTION',
      apiMessage: err.message
    });
  }
}
