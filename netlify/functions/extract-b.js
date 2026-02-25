// extract-b.js — sourceText build 1771967607
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const PROMPT_B = `You are an expert energy procurement analyst extracting facts from a VPPA/PPA term sheet.
Return ONLY valid JSON — no prose, no markdown. Use null for absent fields.
For each term include "snapshot" (2-4 words), "summary" (plain English), "confidence" (high/medium/low), and "sourceText" (the exact verbatim sentence(s) from the document for this term, 1-3 sentences max, or null if not addressed).

{
  "terms": {
    "interconnection": { "snapshot": "e.g. 'Signed, CP met' or 'Pending'", "summary": "Interconnection status, network upgrade costs, condition precedent.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "conditions": { "snapshot": "e.g. '3 CPs listed' or 'None'", "summary": "Conditions precedent before contract becomes binding.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "delay": { "snapshot": "e.g. '$10k/day, capped' or 'Not addressed'", "summary": "COD delay damages — rate per day and cap.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "permits": { "snapshot": "e.g. 'All obtained' or 'Pending, CP'", "summary": "Permitting status — obtained vs pending, condition precedent.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "cod": { "snapshot": "e.g. 'IE certified' or 'Self-certified'", "summary": "How COD is defined and certified.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "availability": { "snapshot": "e.g. '95%, annual, energy+REC LDs' or 'Not addressed'", "summary": "Mechanical availability guarantee — percentage, measurement period (annual vs rolling 2yr), LD formula (energy+REC or energy only or none), and REC damage treatment.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "recs": { "snapshot": "e.g. 'Buyer gets all' or 'Seller retains'", "summary": "Who gets RECs, delivery mechanics, failure consequence.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "forcemajeure": { "snapshot": "e.g. 'Broad, excl. payment' or 'Narrow'", "summary": "Force majeure definition breadth and whether it excuses payment.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "marketdisrupt": { "snapshot": "e.g. 'Substitute price' or 'Not addressed'", "summary": "Major market disruption treatment — scarcity pricing, substitute price.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "changeinlaw": { "snapshot": "e.g. 'Buyer bears' or 'Strike adjusts'", "summary": "Who bears impact of law or tax credit changes.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "reputation": { "snapshot": "e.g. 'Termination right' or 'Not addressed'", "summary": "Reputational harm exit rights.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "assignment": { "snapshot": "e.g. 'Consent required' or 'Lender carve-out'", "summary": "Assignment rights, consent required, lender security interest.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "default": { "snapshot": "e.g. '30-day cure' or 'No cross-default'", "summary": "Events of default, cure period, cross-default provisions.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "termination": { "snapshot": "e.g. 'Mark-to-market' or 'Fixed payment'", "summary": "Early termination payment calculation.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "govlaw": { "snapshot": "e.g. 'NY law, courts'", "summary": "Governing law and dispute resolution.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "confidentiality": { "snapshot": "e.g. 'ESG ok, no press'", "summary": "Confidentiality scope — ESG and press release rights.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "exclusivity": { "snapshot": "e.g. '60-day exclusivity' or 'None'", "summary": "Exclusivity period.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "expenses": { "snapshot": "e.g. 'Each party pays' or 'Shared'", "summary": "Who pays legal, registry, and IE costs.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "incentives": { "snapshot": "e.g. 'Seller keeps ITC' or 'Shared'", "summary": "ITC/PTC ownership and transferability.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "accounting": { "snapshot": "e.g. 'Hedge accounting' or 'Not addressed'", "summary": "Hedge accounting or tax indemnity provisions.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "publicity": { "snapshot": "e.g. 'Mutual approval' or 'Buyer approval'", "summary": "Press release and logo use approval process.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" }
  }
}`;

async function callHaiku(prompt, userContent, retryCount = 0) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 3500,
    system: prompt,
    messages: [{ role: 'user', content: userContent }]
  });
  const rawText = response.content?.[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    if (retryCount < 1) return callHaiku(prompt + '\n\nCRITICAL: Return ONLY the JSON object.', userContent, retryCount + 1);
    throw new Error('No JSON returned');
  }
  try { return JSON.parse(jsonMatch[0]); }
  catch (e) {
    if (retryCount < 1) return callHaiku(prompt + '\n\nCRITICAL: Return ONLY valid parseable JSON.', userContent, retryCount + 1);
    throw new Error('JSON parse failed: ' + e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid body' }) }; }
  const { text } = body;
  if (!text || text.trim().length < 50) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Text too short' }) };
  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'No API key' }) };
  try {
    const result = await callHaiku(PROMPT_B, `Extract facts from this VPPA/PPA term sheet:\n\n${text.substring(0, 20000)}`);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Extraction failed', message: err.message }) };
  }
};
