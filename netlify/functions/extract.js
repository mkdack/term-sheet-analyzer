// Engine 1: Term Sheet Extraction
// Takes raw term sheet text, returns structured plain-English summaries
// Model: claude-haiku-4-5 — fast, cheap, mechanical extraction task

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = `You are an expert energy procurement analyst. Your job is to read a VPPA or PPA term sheet and restate every term in plain, simple English that a non-lawyer can understand.

Do not score, evaluate, or judge anything. Just describe what the document says.

Return ONLY valid JSON in this exact structure — no prose, no markdown:

{
  "deal": {
    "buyer": "company name or null",
    "seller": "developer/seller name or null",
    "project": "project name or null",
    "iso": "ERCOT, CAISO, PJM, MISO, SPP, ISO-NE, or NYISO — or null",
    "technology": "Solar or Wind or null",
    "capacity": "e.g. 150 MWac or null",
    "strikePrice": number or null,
    "term": "e.g. 15 years or null",
    "cod": "e.g. Q3 2027 or null",
    "structure": "Virtual PPA or Physical PPA or null"
  },
  "terms": {
    "strike":         "Plain English: what is the price, any escalation, fixed or floating component?",
    "settlement":     "Plain English: how is settlement calculated — hub, zonal, or nodal? What price index?",
    "interval":       "Plain English: what settlement interval — 5-min, hourly, monthly? Day-ahead or real-time?",
    "negprice":       "Plain English: what happens when prices go negative? Does buyer pay seller, or is there a floor?",
    "invoice":        "Plain English: how often are invoices issued, when is payment due, any late fees?",
    "basis":          "Plain English: who bears the risk if the project's node price differs from the hub price?",
    "marketdisrupt":  "Plain English: what happens if the market has a disruption event — ERCOT scarcity pricing, ISO emergencies?",
    "scheduling":     "Plain English: who controls when the project generates — seller, ISO dispatch, or buyer approval?",
    "curtailment":    "Plain English: if the project is curtailed for economic reasons, who bears the lost revenue?",
    "nonecocurtail":  "Plain English: if the grid operator curtails the project for reliability reasons, who bears the loss?",
    "basiscurtail":   "Plain English: if curtailment is caused by congestion or basis issues, who bears the loss?",
    "interconnection":"Plain English: what is the status of the interconnection agreement, and who bears network upgrade costs?",
    "conditions":     "Plain English: what conditions must be met before the contract becomes binding?",
    "delay":          "Plain English: what happens if the project is late — are there delay damages, and who pays?",
    "availability":   "Plain English: is there a mechanical availability guarantee, and what happens if it's missed?",
    "production":     "Plain English: is there an energy production guarantee — a minimum MWh commitment per year?",
    "permits":        "Plain English: what is the permitting status, and is it a condition precedent?",
    "cod":            "Plain English: how is commercial operation date defined, and who certifies it?",
    "buyercredit":    "Plain English: what credit support must the buyer provide — guaranty, letter of credit, cash?",
    "sellercredit":   "Plain English: what credit support must the seller provide — sponsor guaranty, LOC, or just the SPV?",
    "assignment":     "Plain English: can either party assign or transfer this contract, and under what conditions?",
    "forcemajeure":   "Plain English: what events excuse performance — how broad is the definition?",
    "default":        "Plain English: what constitutes an event of default, and how long to cure?",
    "termination":    "Plain English: if the contract terminates early, who pays whom and how is the payment calculated?",
    "changeinlaw":    "Plain English: if laws or regulations change — including tax credits — who bears the impact?",
    "reputation":     "Plain English: can either party exit if the other causes reputational harm?",
    "recs":           "Plain English: who gets the renewable energy certificates, how are they delivered?",
    "incentives":     "Plain English: who keeps tax credits (ITC/PTC), transferability value, state incentives?",
    "govlaw":         "Plain English: what state's law governs, and how are disputes resolved — court or arbitration?",
    "confidentiality":"Plain English: what must be kept confidential, and can the buyer use this deal for ESG reporting?",
    "exclusivity":    "Plain English: is the seller committed to selling all output to buyer, any buyer restrictions?",
    "expenses":       "Plain English: who pays legal fees, registry fees, independent engineer costs?",
    "accounting":     "Plain English: any provisions about hedge accounting treatment or tax indemnities?",
    "publicity":      "Plain English: can either party issue press releases or use the other's name/logo?"
  },
  "missing": ["list of term keys above that are not addressed at all in the document"]
}

Rules:
- If a term is addressed in the document, describe what it says in 1-3 plain sentences.
- If a term is not mentioned at all, use null and add the key to "missing".
- Never use legal jargon without immediately explaining it.
- Never say "the agreement states" — just state the fact directly.
- Numbers should be specific: "$70/MWh" not "a fixed price".`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }) };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { text } = body;
  if (!text || text.trim().length < 50) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Term sheet text is too short or missing' }) };
  }

  // Trim to 15k chars — Haiku handles this comfortably within its context window
  const trimmed = text.length > 15000
    ? text.substring(0, 13000) + '\n...[document continues — truncated for processing]...\n' + text.substring(text.length - 2000)
    : text;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: `Extract and summarize every term from this VPPA/PPA term sheet in plain English:\n\n${trimmed}`
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    const rawText = data.content?.[0]?.text || '';

    // Parse JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Model did not return valid JSON');

    const result = JSON.parse(jsonMatch[0]);

    // Validate structure
    if (!result.deal || !result.terms) throw new Error('Response missing required fields');

    // Normalize numeric strikePrice
    if (result.deal.strikePrice != null) {
      result.deal.strikePrice = parseFloat(result.deal.strikePrice) || null;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, extraction: result })
    };

  } catch (err) {
    console.error('Extraction error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Extraction failed', message: err.message })
    };
  }
};
