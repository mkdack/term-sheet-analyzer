// Engine 1: Term Sheet Extraction — Single-pass optimized
// One API call per chunk, fully parallel chunks, confidence flags, auto-retry

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const PROMPT = `You are an expert energy procurement analyst extracting facts from a VPPA/PPA term sheet.

Return ONLY valid JSON — no prose, no markdown. Use null for absent fields.
For each term include:
- "snapshot": 2-4 words capturing the key fact (e.g. "2% fixed, Y2", "Seller bears", "Monthly, net-30"). Use "Not addressed" if absent.
- "summary": plain-English explanation of the full term
- "confidence": "high" (explicitly stated), "medium" (implied/inferred), or "low" (guessed/unclear)

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
    "escalation": { "snapshot": "e.g. '2% fixed, Y2+' or 'None'", "summary": "How does the strike price escalate — rate or index, when first applies, any cap or collar.", "confidence": "high|medium|low" },
    "interval": { "snapshot": "e.g. 'Hourly, real-time'", "summary": "Settlement interval (5-min/hourly/monthly), day-ahead or real-time, pricing node.", "confidence": "high|medium|low" },
    "negprice": { "snapshot": "e.g. '$-5/MWh floor' or 'Buyer pays'", "summary": "What happens when prices go negative — floor, curtailment trigger, or buyer still pays fixed.", "confidence": "high|medium|low" },
    "basis": { "snapshot": "e.g. 'Seller bears' or 'Buyer bears'", "summary": "Who bears node-to-hub basis risk. Any collar or cap on exposure.", "confidence": "high|medium|low" },
    "scheduling": { "snapshot": "e.g. 'ISO dispatch' or 'Seller controls'", "summary": "Who controls project dispatch — seller, ISO, or buyer approval rights.", "confidence": "high|medium|low" },
    "curtailment": { "snapshot": "e.g. 'Seller bears' or 'Deemed gen'", "summary": "Economic curtailment — who bears lost revenue, any deemed generation.", "confidence": "high|medium|low" },
    "nonecocurtail": { "snapshot": "e.g. 'Seller bears' or 'Force majeure'", "summary": "Grid operator reliability curtailment — who bears the loss.", "confidence": "high|medium|low" },
    "interconnection": { "snapshot": "e.g. 'Signed, CP met' or 'Pending'", "summary": "Interconnection status, who pays network upgrades, whether it's a condition precedent.", "confidence": "high|medium|low" },
    "conditions": { "snapshot": "e.g. '3 CPs listed' or 'None'", "summary": "Conditions precedent that must be met before contract becomes binding.", "confidence": "high|medium|low" },
    "delay": { "snapshot": "e.g. '$10k/day, capped' or 'Not addressed'", "summary": "COD delay damages — rate per day and cap.", "confidence": "high|medium|low" },
    "permits": { "snapshot": "e.g. 'All obtained' or 'Pending, CP'", "summary": "Permitting status — obtained vs pending, whether it is a condition precedent.", "confidence": "high|medium|low" },
    "cod": { "snapshot": "e.g. 'IE certified' or 'Self-certified'", "summary": "How COD is defined and certified — who verifies, any independent engineer.", "confidence": "high|medium|low" },
    "availability": { "snapshot": "e.g. '95%, liquidated' or 'Not addressed'", "summary": "Mechanical availability guarantee — percentage and remedy if missed.", "confidence": "high|medium|low" },
    "production": { "snapshot": "e.g. 'Annual MWh, LD' or 'Not addressed'", "summary": "Annual energy production guarantee and consequence if missed.", "confidence": "high|medium|low" },
    "recs": { "snapshot": "e.g. 'Buyer gets all' or 'Seller retains'", "summary": "Who gets RECs, delivery mechanics, consequence of delivery failure.", "confidence": "high|medium|low" },
    "buyercredit": { "snapshot": "e.g. 'LOC, $5M' or 'Parent guaranty'", "summary": "Buyer credit support — type and amount.", "confidence": "high|medium|low" },
    "sellercredit": { "snapshot": "e.g. 'Sponsor guaranty' or 'SPV only'", "summary": "Seller credit support pre- and post-COD.", "confidence": "high|medium|low" },
    "forcemajeure": { "snapshot": "e.g. 'Broad, excl. payment' or 'Narrow'", "summary": "Force majeure definition breadth and whether it excuses payment.", "confidence": "high|medium|low" },
    "marketdisrupt": { "snapshot": "e.g. 'Substitute price' or 'Not addressed'", "summary": "Major market disruption treatment — scarcity pricing, deemed generation, substitute price.", "confidence": "high|medium|low" },
    "changeinlaw": { "snapshot": "e.g. 'Buyer bears' or 'Strike adjusts'", "summary": "Who bears impact of law or tax credit changes, whether strike price adjusts.", "confidence": "high|medium|low" },
    "reputation": { "snapshot": "e.g. 'Termination right' or 'Not addressed'", "summary": "Reputational harm exit rights — definition and which party.", "confidence": "high|medium|low" },
    "invoice": { "snapshot": "e.g. 'Monthly, net-30'", "summary": "Invoice frequency, payment due days, late payment fees.", "confidence": "high|medium|low" },
    "assignment": { "snapshot": "e.g. 'Consent required' or 'Lender carve-out'", "summary": "Assignment rights, consent required, lender security interest.", "confidence": "high|medium|low" },
    "default": { "snapshot": "e.g. '30-day cure' or 'No cross-default'", "summary": "Events of default, cure period, cross-default provisions.", "confidence": "high|medium|low" },
    "termination": { "snapshot": "e.g. 'Mark-to-market' or 'Fixed payment'", "summary": "Early termination payment calculation.", "confidence": "high|medium|low" },
    "govlaw": { "snapshot": "e.g. 'NY law, courts'", "summary": "Governing state law and dispute resolution venue.", "confidence": "high|medium|low" },
    "confidentiality": { "snapshot": "e.g. 'ESG ok, no press'", "summary": "Confidentiality scope — ESG reporting and press release rights.", "confidence": "high|medium|low" },
    "exclusivity": { "snapshot": "e.g. '60-day exclusivity' or 'None'", "summary": "Seller output exclusivity or negotiation exclusivity period.", "confidence": "high|medium|low" },
    "expenses": { "snapshot": "e.g. 'Each party pays' or 'Shared'", "summary": "Who pays legal fees, registry fees, independent engineer costs.", "confidence": "high|medium|low" },
    "incentives": { "snapshot": "e.g. 'Seller keeps ITC' or 'Shared'", "summary": "ITC/PTC ownership and transferability value, state incentive sharing.", "confidence": "high|medium|low" },
    "accounting": { "snapshot": "e.g. 'Hedge accounting' or 'Not addressed'", "summary": "Hedge accounting treatment or tax indemnity provisions.", "confidence": "high|medium|low" },
    "publicity": { "snapshot": "e.g. 'Mutual approval' or 'Buyer approval'", "summary": "Press release and logo use rights, approval process.", "confidence": "high|medium|low" }
  }
}`;

// ─── CHUNK LARGE DOCUMENTS ───────────────────────────────────
function chunkDocument(text, maxChars = 20000, overlap = 1500) {
  if (text.length <= maxChars) return [text];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.substring(start, end));
    if (end === text.length) break;
    start = end - overlap;
  }
  return chunks;
}

// ─── CALL HAIKU WITH RETRY ───────────────────────────────────
async function callHaiku(userContent, retryCount = 0) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 6000,
    system: PROMPT,
    messages: [{ role: 'user', content: userContent }]
  });

  const rawText = response.content?.[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    if (retryCount < 1) {
      console.warn('No JSON found, retrying...');
      return callHaiku(userContent + '\n\nCRITICAL: Return ONLY the JSON object. No other text.', retryCount + 1);
    }
    throw new Error('Model did not return valid JSON after retry');
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    if (retryCount < 1) {
      console.warn('JSON parse failed, retrying...');
      return callHaiku(userContent + '\n\nCRITICAL: Previous response had malformed JSON. Return ONLY valid parseable JSON.', retryCount + 1);
    }
    throw new Error('JSON parse failed after retry: ' + e.message);
  }
}

// ─── MERGE CHUNKED RESULTS ───────────────────────────────────
function mergeResults(results) {
  const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
  const merged = { deal: {}, terms: {} };

  for (const result of results) {
    if (!result.deal) continue;
    for (const [key, val] of Object.entries(result.deal)) {
      if (merged.deal[key] == null && val != null) merged.deal[key] = val;
    }
  }

  for (const result of results) {
    if (!result.terms) continue;
    for (const [key, val] of Object.entries(result.terms)) {
      if (!val || !val.summary) continue;
      const existing = merged.terms[key];
      if (!existing) {
        merged.terms[key] = val;
      } else {
        const existingRank = CONFIDENCE_RANK[existing.confidence] || 0;
        const newRank = CONFIDENCE_RANK[val.confidence] || 0;
        if (newRank > existingRank) merged.terms[key] = val;
      }
    }
  }

  return merged;
}

// ─── MAIN HANDLER ────────────────────────────────────────────
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { text } = body;
  if (!text || text.trim().length < 50) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Term sheet text is missing or too short' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  try {
    const chunks = chunkDocument(text);
    console.log(`Document: ${text.length} chars → ${chunks.length} chunk(s), 1 call each (was 2)`);

    const chunkResults = await Promise.all(
      chunks.map((chunk, i) =>
        callHaiku(`Extract all facts from this VPPA/PPA term sheet${chunks.length > 1 ? ` (section ${i + 1} of ${chunks.length})` : ''}:\n\n${chunk}`)
      )
    );

    const merged = mergeResults(chunkResults);

    if (!merged.deal || !merged.terms) throw new Error('Extraction produced no usable results');

    if (merged.deal.strikePrice != null) {
      merged.deal.strikePrice = parseFloat(merged.deal.strikePrice) || null;
    }

    const missing = Object.entries(merged.terms).filter(([, v]) => !v || !v.summary).map(([k]) => k);
    const lowConfidence = Object.entries(merged.terms).filter(([, v]) => v && v.confidence === 'low').map(([k]) => k);

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({
        ok: true,
        extraction: {
          deal: merged.deal,
          terms: merged.terms,
          missing,
          lowConfidence,
          meta: { chunks: chunks.length, docLength: text.length }
        }
      })
    };

  } catch (err) {
    console.error('Extraction error:', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Extraction failed', message: err.message }) };
  }
};
