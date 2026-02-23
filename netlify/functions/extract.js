// Engine 1: Term Sheet Extraction
// Uses @anthropic-ai/sdk — no raw fetch needed

const Anthropic = require('@anthropic-ai/sdk');

const SYSTEM_PROMPT = `You are an expert energy procurement analyst. Your job is to read a VPPA or PPA term sheet and restate every term in plain, simple English that a non-lawyer can understand.

Do not score, evaluate, or judge anything. Just describe what the document says.

Return ONLY valid JSON — no prose, no markdown fences — in this exact structure:

{
  "deal": {
    "buyer": "company name or null",
    "seller": "developer/seller name or null",
    "project": "project name or null",
    "iso": "ERCOT, CAISO, PJM, MISO, SPP, ISO-NE, or NYISO — or null",
    "settlementPoint": "The specific hub, zone, or node name used for settlement — e.g. 'ERCOT North Hub', 'PJM Western Hub', 'CAISO NP15', or a specific project node name. Extract the exact name from the document, or null if not specified.",
    "settlementType": "hub or zonal or nodal or null — which level of the grid is used for price settlement",
    "technology": "Solar or Wind or null",
    "capacity": "e.g. 150 MWac or null",
    "strikePrice": number or null,
    "term": "e.g. 15 years or null",
    "cod": "e.g. Q3 2027 or null",
    "vppaStructure": "Exactly one of: Fixed for Floating, Upside Share, Discount to Market, Physical PPA, or Other. Fixed for Floating means buyer pays a fixed strike and receives the floating market price. Upside Share means seller shares revenue above a threshold with buyer. Discount to Market means strike is set at a discount to forward market prices. Physical PPA means actual electrons delivered. Use Other if it does not fit any of these.",
    "vppaStructureNote": "One sentence explaining the specific economics of how this deal structure works based on what the document says, or null"
  },
  "terms": {
    "strike":          "What is the fixed price per MWh? Any escalation clause? Fixed or floating component?",
    "settlement":      "How is settlement calculated — hub, zonal, or nodal price? What index is used?",
    "interval":        "What settlement interval — 5-minute, hourly, monthly? Day-ahead or real-time price?",
    "negprice":        "What happens when electricity prices go negative? Is there a floor or does buyer pay seller?",
    "invoice":         "How often are invoices issued? When is payment due? Any late payment fees?",
    "basis":           "Who bears the risk if the project node price differs from the hub price?",
    "marketdisrupt":   "What happens if the market has a major disruption — scarcity pricing, ISO emergencies?",
    "scheduling":      "Who controls when the project generates — seller, ISO dispatch, or buyer approval required?",
    "curtailment":     "If the project is curtailed for economic reasons, who bears the lost revenue?",
    "nonecocurtail":   "If the grid operator curtails the project for reliability reasons, who bears the loss?",
    "basiscurtail":    "If curtailment is caused by congestion or basis issues, who bears the loss?",
    "interconnection": "What is the status of the grid interconnection agreement? Who pays for network upgrades?",
    "conditions":      "What conditions must be met before the contract becomes binding?",
    "delay":           "What happens if the project is late — are there delay damages, and who pays?",
    "availability":    "Is there a mechanical availability guarantee? What happens if it is missed?",
    "production":      "Is there an energy production guarantee — a minimum MWh commitment per year?",
    "permits":         "What is the permitting status? Is it a condition the deal requires before closing?",
    "cod":             "How is commercial operation date defined? Who certifies that the project has reached COD?",
    "buyercredit":     "What credit support must the buyer provide — guaranty, letter of credit, or cash?",
    "sellercredit":    "What credit support must the seller provide — sponsor guaranty, LOC, or just the project company?",
    "assignment":      "Can either party assign or transfer this contract? Under what conditions?",
    "forcemajeure":    "What events excuse performance — how broad is the definition?",
    "default":         "What constitutes an event of default? How long does a party have to fix it?",
    "termination":     "If the contract ends early, who pays whom and how is the payment calculated?",
    "changeinlaw":     "If laws or regulations change — including tax credits — who bears the financial impact?",
    "reputation":      "Can either party exit the deal if the other causes reputational harm?",
    "recs":            "Who gets the renewable energy certificates? How and when are they delivered?",
    "incentives":      "Who keeps tax credits (ITC/PTC), transferability value, and state incentives?",
    "govlaw":          "What state law governs this contract? Are disputes resolved in court or arbitration?",
    "confidentiality": "What must be kept confidential? Can the buyer use this deal for ESG reporting?",
    "exclusivity":     "Is the seller committed to selling all output to this buyer? Any buyer restrictions?",
    "expenses":        "Who pays legal fees, registry fees, and independent engineer costs?",
    "accounting":      "Any provisions about hedge accounting treatment or tax indemnities?",
    "publicity":       "Can either party issue press releases or use the other party's name or logo?"
  },
  "missing": ["list only the term keys from above that are completely absent from the document"]
}

Rules:
- If a term is in the document, describe it in 1-3 plain sentences. Be specific — use actual numbers and names from the document.
- If a term is not mentioned, use null and add the key to missing[].
- Never use legal jargon without explaining it immediately.
- Never say "the agreement states" — just state the fact directly.
- Use specific numbers: "$70/MWh" not "a fixed price". "15 years" not "a long term".`;

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }) };
  }

  // Trim long documents — Haiku handles ~15k chars comfortably
  const trimmed = text.length > 15000
    ? text.substring(0, 13000) + '\n\n[Document truncated for processing — first 13,000 characters shown]\n\n' + text.substring(text.length - 1500)
    : text;

  try {
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Extract and summarize every term from this VPPA/PPA term sheet in plain English:\n\n${trimmed}`
      }]
    });

    const rawText = message.content?.[0]?.text || '';

    // Strip any markdown fences if model adds them
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', rawText.substring(0, 500));
      throw new Error('Model did not return valid JSON');
    }

    const result = JSON.parse(jsonMatch[0]);

    if (!result.deal || !result.terms) {
      throw new Error('Response missing required deal or terms fields');
    }

    // Normalize strike price to number
    if (result.deal.strikePrice != null) {
      result.deal.strikePrice = parseFloat(result.deal.strikePrice) || null;
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, extraction: result })
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
