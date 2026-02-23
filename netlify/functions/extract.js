// Engine 1: Term Sheet Extraction — Optimized
// Two-pass parallel extraction, chunked documents, confidence flags, auto-retry

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// ─── PASS A: Deal metadata + Pricing terms ────────────────────
const PROMPT_A = `You are an expert energy procurement analyst extracting facts from a VPPA/PPA term sheet.

Return ONLY valid JSON — no prose, no markdown. Use null for absent fields.
For each term include a "confidence" field: "high" (explicitly stated), "medium" (implied or inferred), or "low" (guessed or unclear).
For each term also include a "snapshot" field: 2-4 words max capturing the key fact (e.g. "2% annually, Y2", "Hub-based, RT", "Seller bears", "30-day cure", "None stated"). If absent use "Not addressed".

{
  "deal": {
    "buyer": "exact company name or null",
    "seller": "exact developer/seller name or null",
    "project": "exact project name or null",
    "iso": "exactly one of: ERCOT, CAISO, PJM, MISO, SPP, ISO-NE, NYISO — or null",
    "settlementPoint": "exact hub, zone, or node name from the document — e.g. 'ERCOT North Hub', 'PJM Western Hub', 'CAISO NP15' — or null",
    "settlementType": "exactly one of: hub, zonal, nodal — or null",
    "technology": "Solar or Wind or null",
    "capacity": "e.g. 150 MWac or null",
    "strikePrice": number or null,
    "escalator": "e.g. 2% annually, CPI, none — or null",
    "term": "e.g. 15 years or null",
    "cod": "e.g. Q3 2027 or null",
    "vppaStructure": "exactly one of: Fixed for Floating, Upside Share, Discount to Market, Physical PPA, Other — or null",
    "vppaStructureNote": "one plain-English sentence describing the deal economics, or null",
    "buyerSharePct": "Buyer's contracted share of project output as a percentage, e.g. '100%', '60%' — or null if not stated",
    "buyerShareMW": "Buyer's contracted share in MW (ac), e.g. '90 MWac' — derive from capacity × pct if both known and MW not explicit, or null"
  },
  "terms": {
    "escalation": {
      "snapshot": "2-4 words e.g. '2% fixed, Y2+' or 'None'",
      "summary": "How does the strike price change over time? State the exact escalation rate or index (e.g. 2% fixed annually, CPI, none). When does it first apply — contract year 2 or after COD? Is there a cap or collar on escalation?",
      "confidence": "high|medium|low"
    },
    "interval": {
      "snapshot": "2-4 words e.g. 'Hourly, real-time' or '5-min, DA'",
      "summary": "What settlement interval — 5-minute, hourly, monthly? Day-ahead or real-time price? Which market and pricing node?",
      "confidence": "high|medium|low"
    },
    "negprice": {
      "snapshot": "2-4 words e.g. '$-5/MWh floor' or 'Buyer pays'",
      "summary": "What happens when electricity prices go negative? Is there a floor price, a curtailment threshold, or does buyer still pay seller the fixed price?",
      "confidence": "high|medium|low"
    },
    "basis": {
      "snapshot": "2-4 words e.g. 'Seller bears' or 'Buyer bears'",
      "summary": "Who bears the risk if the project node price differs from the hub price? Any basis differential interval provision, collar, or cap on basis exposure?",
      "confidence": "high|medium|low"
    },
    "marketdisrupt": {
      "snapshot": "2-4 words e.g. 'Substitute price' or 'Not addressed'",
      "summary": "What happens during a major market disruption — scarcity pricing, ISO emergency, force majeure pricing event? Any deemed generation or substitute price provisions?",
      "confidence": "high|medium|low"
    },
    "invoice": {
      "snapshot": "2-4 words e.g. 'Monthly, net-30' or 'Not specified'",
      "summary": "How often are invoices issued? When is payment due in days after invoice? Any late payment fees or interest rate on overdue amounts?",
      "confidence": "high|medium|low"
    }
  }
}`;

// ─── PASS B: All remaining terms ─────────────────────────────
const PROMPT_B = `You are an expert energy procurement analyst extracting facts from a VPPA/PPA term sheet.

Return ONLY valid JSON — no prose, no markdown. Use null for absent fields.
For each term include a "confidence" field: "high" (explicitly stated), "medium" (implied or inferred), or "low" (guessed or unclear).
For each term also include a "snapshot" field: 2-4 words max capturing the key fact (e.g. "ISO dispatch", "Seller bears", "30-day cure", "NY law, arbitration"). If absent use "Not addressed".

{
  "terms": {
    "scheduling": {
      "snapshot": "2-4 words e.g. 'ISO dispatch' or 'Seller controls'",
      "summary": "Who controls when the project generates — seller, ISO dispatch, or does buyer have approval rights?",
      "confidence": "high|medium|low"
    },
    "curtailment": {
      "snapshot": "2-4 words e.g. 'Seller bears' or 'Deemed gen'",
      "summary": "If the project is curtailed for economic reasons, who bears the lost revenue? Any deemed generation?",
      "confidence": "high|medium|low"
    },
    "nonecocurtail": {
      "snapshot": "2-4 words e.g. 'Seller bears' or 'Force majeure'",
      "summary": "If the grid operator curtails the project for reliability reasons, who bears the loss?",
      "confidence": "high|medium|low"
    },
    "interconnection": {
      "snapshot": "2-4 words e.g. 'Signed, CP met' or 'Pending, CP'",
      "summary": "What is the interconnection agreement status? Who pays for network upgrades? Is it a condition precedent?",
      "confidence": "high|medium|low"
    },
    "conditions": {
      "snapshot": "2-4 words e.g. '3 CPs listed' or 'None specified'",
      "summary": "What specific conditions must be met before the contract becomes binding? List each one.",
      "confidence": "high|medium|low"
    },
    "delay": {
      "snapshot": "2-4 words e.g. '$10k/day, capped' or 'Not addressed'",
      "summary": "What happens if the project misses COD? Are there delay damages per day? What is the rate and cap?",
      "confidence": "high|medium|low"
    },
    "availability": {
      "snapshot": "2-4 words e.g. '95%, liquidated' or 'Not addressed'",
      "summary": "Is there a mechanical availability guarantee? What percentage? What is the remedy if missed?",
      "confidence": "high|medium|low"
    },
    "production": {
      "snapshot": "2-4 words e.g. 'Annual MWh, LD' or 'Not addressed'",
      "summary": "Is there an annual energy production guarantee in MWh? What happens if the project falls short?",
      "confidence": "high|medium|low"
    },
    "permits": {
      "snapshot": "2-4 words e.g. 'All obtained' or 'Pending, CP'",
      "summary": "What is the permitting status? Which permits are obtained vs pending? Is it a condition precedent?",
      "confidence": "high|medium|low"
    },
    "cod": {
      "snapshot": "2-4 words e.g. 'IE certified' or 'Self-certified'",
      "summary": "How is commercial operation date defined and certified? Who verifies it? Any independent engineer?",
      "confidence": "high|medium|low"
    },
    "buyercredit": {
      "snapshot": "2-4 words e.g. 'LOC, $5M' or 'Parent guaranty'",
      "summary": "What credit support must the buyer provide — parent guaranty, letter of credit, or cash? What amount?",
      "confidence": "high|medium|low"
    },
    "sellercredit": {
      "snapshot": "2-4 words e.g. 'Sponsor guaranty' or 'SPV only'",
      "summary": "What credit support must the seller provide pre- and post-COD? Sponsor guaranty, LOC, or just the SPV?",
      "confidence": "high|medium|low"
    },
    "assignment": {
      "snapshot": "2-4 words e.g. 'Consent required' or 'Lender carve-out'",
      "summary": "Can either party assign this contract? What consent is required? Can lenders take security interest?",
      "confidence": "high|medium|low"
    },
    "forcemajeure": {
      "snapshot": "2-4 words e.g. 'Broad, excl. payment' or 'Narrow'",
      "summary": "What events qualify as force majeure? How broad is the definition? Does it excuse payment obligations?",
      "confidence": "high|medium|low"
    },
    "default": {
      "snapshot": "2-4 words e.g. '30-day cure' or 'No cross-default'",
      "summary": "What constitutes an event of default? How many days to cure? Any cross-default provisions?",
      "confidence": "high|medium|low"
    },
    "termination": {
      "snapshot": "2-4 words e.g. 'Mark-to-market' or 'Fixed payment'",
      "summary": "If the contract terminates early, who pays whom? How is the termination payment calculated?",
      "confidence": "high|medium|low"
    },
    "changeinlaw": {
      "snapshot": "2-4 words e.g. 'Buyer bears' or 'Strike adjusts'",
      "summary": "If laws or tax credits change, who bears the financial impact? Does the strike price adjust?",
      "confidence": "high|medium|low"
    },
    "reputation": {
      "snapshot": "2-4 words e.g. 'Termination right' or 'Not addressed'",
      "summary": "Can either party exit if the other causes reputational harm? How is that defined?",
      "confidence": "high|medium|low"
    },
    "recs": {
      "snapshot": "2-4 words e.g. 'Buyer gets all' or 'Seller retains'",
      "summary": "Who gets the RECs? How and when are they delivered? What happens if delivery fails?",
      "confidence": "high|medium|low"
    },
    "incentives": {
      "snapshot": "2-4 words e.g. 'Seller keeps ITC' or 'Transferable, shared'",
      "summary": "Who keeps ITC/PTC tax credits and transferability value? Any state or local incentive sharing?",
      "confidence": "high|medium|low"
    },
    "govlaw": {
      "snapshot": "2-4 words e.g. 'NY law, courts' or 'DE law, arbitration'",
      "summary": "What state law governs? Are disputes resolved in court or arbitration? Which venue?",
      "confidence": "high|medium|low"
    },
    "confidentiality": {
      "snapshot": "2-4 words e.g. 'ESG ok, no press' or 'Standard NDA'",
      "summary": "What must be kept confidential? Can the buyer use this deal for ESG reporting or press releases?",
      "confidence": "high|medium|low"
    },
    "exclusivity": {
      "snapshot": "2-4 words e.g. '60-day exclusivity' or 'None'",
      "summary": "Is the seller committed to selling all output to this buyer only? Any negotiation exclusivity period?",
      "confidence": "high|medium|low"
    },
    "expenses": {
      "snapshot": "2-4 words e.g. 'Each party pays' or 'Shared',",
      "summary": "Who pays legal fees, registry fees, and independent engineer costs?",
      "confidence": "high|medium|low"
    },
    "accounting": {
      "snapshot": "2-4 words e.g. 'Hedge accounting' or 'Not addressed'",
      "summary": "Any provisions about hedge accounting treatment or tax indemnities?",
      "confidence": "high|medium|low"
    },
    "publicity": {
      "snapshot": "2-4 words e.g. 'Mutual approval' or 'Buyer approval'",
      "summary": "Can either party issue press releases or use the other party's name or logo? What approval is needed?",
      "confidence": "high|medium|low"
    }
  }
}`;

// ─── CHUNK LARGE DOCUMENTS ───────────────────────────────────
// Split document into overlapping chunks so no term gets cut off
function chunkDocument(text, maxChars = 12000, overlap = 1000) {
  if (text.length <= maxChars) return [text];

  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.substring(start, end));
    if (end === text.length) break;
    start = end - overlap; // overlap to avoid cutting mid-sentence
  }
  return chunks;
}

// ─── CALL HAIKU WITH RETRY ───────────────────────────────────
async function callHaiku(systemPrompt, userContent, retryCount = 0) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }]
  });

  const rawText = response.content?.[0]?.text || '';

  // Strip markdown fences if model adds them
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    if (retryCount < 1) {
      console.warn('No JSON found, retrying with stricter prompt...');
      return callHaiku(
        systemPrompt + '\n\nCRITICAL: Your previous response did not contain valid JSON. Return ONLY the JSON object. No other text whatsoever.',
        userContent,
        retryCount + 1
      );
    }
    throw new Error('Model did not return valid JSON after retry');
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    if (retryCount < 1) {
      console.warn('JSON parse failed, retrying...');
      return callHaiku(
        systemPrompt + '\n\nCRITICAL: Your previous response contained malformed JSON. Return ONLY valid, parseable JSON.',
        userContent,
        retryCount + 1
      );
    }
    throw new Error('JSON parse failed after retry: ' + e.message);
  }
}

// ─── MERGE CHUNKED RESULTS ───────────────────────────────────
// When document spans multiple chunks, merge results — prefer high-confidence answers
function mergeResults(results) {
  const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };

  const merged = { deal: {}, terms: {} };

  // Merge deal fields — take first non-null value found
  for (const result of results) {
    if (!result.deal) continue;
    for (const [key, val] of Object.entries(result.deal)) {
      if (merged.deal[key] == null && val != null) {
        merged.deal[key] = val;
      }
    }
  }

  // Merge terms — prefer higher confidence answers
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
        if (newRank > existingRank) {
          merged.terms[key] = val;
        }
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
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { text } = body;
  if (!text || text.trim().length < 50) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Term sheet text is missing or too short' }) };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };
  }

  try {
    const chunks = chunkDocument(text);
    console.log(`Document: ${text.length} chars → ${chunks.length} chunk(s)`);

    // For each chunk, run Pass A and Pass B in parallel
    const chunkPromises = chunks.map(async (chunk, i) => {
      const userMsg = `Extract all facts from this VPPA/PPA term sheet${chunks.length > 1 ? ` (section ${i + 1} of ${chunks.length})` : ''}:\n\n${chunk}`;
      const [passA, passB] = await Promise.all([
        callHaiku(PROMPT_A, userMsg),
        callHaiku(PROMPT_B, userMsg)
      ]);
      // Combine both passes into one result object
      return {
        deal: passA.deal || {},
        terms: { ...(passA.terms || {}), ...(passB.terms || {}) }
      };
    });

    const chunkResults = await Promise.all(chunkPromises);

    // Merge all chunk results
    const merged = mergeResults(chunkResults);

    if (!merged.deal || !merged.terms) {
      throw new Error('Extraction produced no usable results');
    }

    // Normalize strike price to number
    if (merged.deal.strikePrice != null) {
      merged.deal.strikePrice = parseFloat(merged.deal.strikePrice) || null;
    }

    // Build missing list — terms with null summary
    const missing = Object.entries(merged.terms)
      .filter(([, v]) => !v || !v.summary)
      .map(([k]) => k);

    // Build low-confidence list for UI flagging
    const lowConfidence = Object.entries(merged.terms)
      .filter(([, v]) => v && v.confidence === 'low')
      .map(([k]) => k);

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
          meta: {
            chunks: chunks.length,
            docLength: text.length
          }
        }
      })
    };

  } catch (err) {
    console.error('Extraction error:', err.message);
    return {
      statusCode: 500,
      headers: HEADERS,
      body: JSON.stringify({ error: 'Extraction failed', message: err.message })
    };
  }
};
