// extract-a.js — sourceText build 1771967607
const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const PROMPT_A = `You are an expert energy procurement analyst extracting facts from a VPPA/PPA term sheet.
Return ONLY valid JSON — no prose, no markdown. Use null for absent fields.
For each term include "snapshot" (2-4 words), "summary" (plain English), "confidence" (high/medium/low), and "sourceText" (the exact verbatim sentence(s) from the document for this term, 1-3 sentences max, or null if not addressed).

{
  "deal": {
    "buyer": "exact company name or null",
    "seller": "exact developer/seller name or null",
    "project": "exact project name or null",
    "iso": "exactly one of: ERCOT, CAISO, PJM, MISO, SPP, ISO-NE, NYISO — or null",
    "settlementPoint": "exact hub, zone, or node name — e.g. 'ERCOT North Hub' — or null",
    "settlementType": "exactly one of: hub, zonal, nodal — or null",
    "technology": "Solar or Wind or null",
    "capacity": "e.g. 150 MWac or null",
    "strikePrice": number or null,
    "escalator": "e.g. 2% annually, CPI, none — or null",
    "term": "e.g. 15 years or null",
    "cod": "e.g. Q3 2027 or null",
    "vppaStructure": "exactly one of: Fixed for Floating, Upside Share, Discount to Market, Physical PPA, Other — or null",
    "vppaStructureNote": "one plain-English sentence describing the deal economics, or null",
    "buyerSharePct": "buyer contracted share as percentage e.g. '100%' — or null",
    "buyerShareMW": "buyer contracted share in MWac — derive from capacity x pct if not explicit — or null"
  },
  "terms": {
    "escalation": { "snapshot": "e.g. '2% fixed, Y2+' or 'None'", "summary": "How strike price escalates — rate or index, when first applies, any cap or collar.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "interval": { "snapshot": "e.g. 'Hourly, real-time'", "summary": "Settlement interval, day-ahead or real-time, pricing node.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "negprice": { "snapshot": "e.g. '$-5/MWh floor' or 'Buyer pays'", "summary": "What happens when prices go negative.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "basis": { "snapshot": "e.g. 'Seller bears' or 'Seller bears, with election right' or 'Buyer bears'", "summary": "Who bears node-to-hub basis risk. Note any seller election right to reprice to nodal. Any collar or cap.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "scheduling": { "snapshot": "e.g. 'ISO dispatch' or 'Seller controls'", "summary": "Who controls project dispatch.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "curtailment": { "snapshot": "e.g. 'Seller bears' or 'Deemed gen'", "summary": "Economic curtailment — who bears lost revenue, any deemed generation.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "nonecocurtail": { "snapshot": "e.g. 'Seller bears' or 'Force majeure'", "summary": "Reliability curtailment — who bears the loss.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "invoice": { "snapshot": "e.g. 'Monthly, net-30'", "summary": "Invoice frequency, payment due days, late payment fees.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "buyercredit": { "snapshot": "e.g. 'LOC, $5M' or 'Parent guaranty'", "summary": "Buyer credit support — type and amount.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" },
    "sellercredit": { "snapshot": "e.g. 'Sponsor guaranty' or 'SPV only'", "summary": "Seller credit support pre- and post-COD.", "confidence": "high|medium|low", "sourceText": "verbatim excerpt or null" }
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
    const result = await callHaiku(PROMPT_A, `Extract facts from this VPPA/PPA term sheet:\n\n${text.substring(0, 20000)}`);
    if (result.deal?.strikePrice != null) result.deal.strikePrice = parseFloat(result.deal.strikePrice) || null;
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Extraction failed', message: err.message }) };
  }
};
