// Extract + score a single custom term from raw pasted text
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const PROMPT = `You are an expert energy procurement analyst specializing in VPPA/PPA contracts.
A user has pasted raw term sheet text for a specific contract provision they want analyzed.
Extract the key facts and score it from the BUYER's perspective (corporate offtaker).

Return ONLY valid JSON, no prose, no markdown:

{
  "label": "Clean 2-4 word label for this term if not provided, or clean up the user's label",
  "snapshot": "2-5 word summary of the key position (e.g. 'Seller bears, deemed gen' or '$10k/day cap')",
  "summary": "2-3 sentence plain English explanation of what this term says and what it means for the buyer",
  "score": <number 0-100 where 0=maximally buyer-favorable, 100=maximally buyer-unfavorable>,
  "scoreLabel": "Favorable|Mostly Favorable|Market|Unfavorable|Highly Unfavorable",
  "flag": "One sentence explaining WHY this score — what's good or bad about it for the buyer, or null if market standard"
}

Scoring guide:
- 0-25: Clearly protects or benefits the buyer
- 26-45: Leans buyer-favorable but not exceptional
- 46-55: Market standard, neither side has a clear edge
- 56-75: Seller-favorable, buyer has meaningful exposure
- 76-100: Significant buyer risk or missing critical protection`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid body' }) }; }

  const { label, text, dealContext } = body;
  if (!text || text.trim().length < 20) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Text too short' }) };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'No API key' }) };
  }

  const userMsg = `${label ? `Term label: "${label}"\n` : ''}${dealContext ? `Deal context: ${dealContext}\n` : ''}Raw term text:\n${text.trim()}`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: PROMPT,
      messages: [{ role: 'user', content: userMsg }]
    });

    const raw = response.content?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const result = JSON.parse(match[0]);

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Extraction failed', message: err.message }) };
  }
};
