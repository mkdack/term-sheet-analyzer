// Engine 2: Fact Mapper
// Takes Engine 1 plain-English summaries → maps to scoring engine fact schema → returns structured facts
// scoreAll() runs client-side against these facts

const Anthropic = require('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const MAPPER_PROMPT = `You are an expert energy procurement analyst. You will receive plain-English summaries of VPPA/PPA contract terms extracted from a term sheet. Your job is to map each summary to a structured fact schema used by a deterministic scoring engine.

Return ONLY valid JSON. Use null for unknown/unspecified values. Use the exact enum strings shown.

{
  "deal": {
    "iso": "ERCOT|CAISO|PJM|MISO|SPP|ISO-NE|NYISO or null",
    "technology": "Solar|Wind or null",
    "assetType": "new_build|existing or null"
  },
  "strike": {
    "strikePrice": number or null,
    "escalatorPct": number (annual %) or null,
    "escalatorType": "fixed|cpi|cpi_spread or null"
  },
  "floating": {
    "settlementType": "hub|zonal|nodal|not_specified",
    "addersIncluded": "all_in|partial|excluded|not_specified"
  },
  "interval": {
    "settlementInterval": "iso_native|hourly|monthly|annual|not_specified",
    "priceReference": "real_time|day_ahead|not_specified"
  },
  "negprice": {
    "negPriceMechanism": "zero_floor|seller_curtails|full_passthrough|not_specified",
    "hoursCap": number or null,
    "priceFloor": number (negative, e.g. -10) or null,
    "annualAggregateCap": true|false|null
  },
  "basis": {
    "basisAllocation": "seller_bears|shared_collar|buyer_bears|not_specified",
    "collarBand": number ($/MWh width) or null,
    "busbarTransfer": "present|absent|not_specified"
  },
  "scheduling": {
    "schedulingControl": "iso_dispatch|seller_schedules|buyer_approval|not_specified",
    "antiGaming": "present|absent|not_specified",
    "maintenanceCoordination": "buyer_consent|buyer_consultation|seller_discretion|not_specified"
  },
  "curtailment": {
    "econCurtailmentAllocation": "seller_bears_deemed|shared|buyer_bears|not_specified",
    "deemedGenMethod": "weather_adjusted|capacity_factor|contractual_formula|not_specified",
    "curtailmentCap": number (% of hours) or null
  },
  "nonecocurtail": {
    "nonEconCurtailAllocation": "seller_bears_deemed|shared|buyer_bears|not_specified",
    "nonEconDeemedGenMethod": "weather_adjusted|capacity_factor|contractual_formula|not_specified"
  },
  "ia": {
    "iaStatus": "fully_executed|facilities_study_complete|system_impact_complete|feasibility_stage|not_filed|not_specified",
    "networkUpgradeCosts": "defined_and_capped|defined_uncapped|undefined|not_specified",
    "iaAsCP": "yes|no|not_specified"
  },
  "cp": {
    "buyerCPCount": number (0-5),
    "sellerCPCount": number (0-5),
    "buyerTerminationRight": "yes|no|not_specified",
    "cpDeadlineMonths": number or null
  },
  "delay": {
    "guaranteedCOD": "yes|no|not_specified",
    "delayDamagesPresent": "yes|no|not_specified",
    "delayDamagesRate": number ($/day) or null,
    "gracePeriodDays": number or null,
    "damagesCapStructure": "both|none|months_capped|project_cost_pct|not_specified",
    "damagesCapValue": number or null,
    "longstopMonths": number or null,
    "buyerTerminationAtLongstop": "yes|no|not_specified",
    "excusedDelays": "narrow|moderate|broad|not_specified"
  },
  "availmech": {
    "availGuaranteePct": number (e.g. 95) or null,
    "shortfallRemedy": "deemed_generation|liquidated_damages|none|not_specified",
    "terminationRight": "yes|no|not_specified"
  },
  "availguaranteed": {
    "productionGuarantee": "yes|no|not_specified",
    "pValue": "P50|P75|P90|other|not_specified",
    "measurementPeriod": "annual|rolling_2yr|rolling_3yr|not_specified",
    "shortfallRemedy": "deemed_generation|make_whole|liquidated_damages|none|not_specified",
    "terminationRight": "yes|no|not_specified"
  },
  "permit": {
    "permitStatus": "all_obtained|major_obtained|in_progress|not_started|not_specified",
    "permitAsCP": "yes|no|not_specified"
  },
  "cod": {
    "codDefinitionStrength": "tight_objective|moderate|loose_substantial|not_specified",
    "independentEngineer": "required|optional|none|not_specified",
    "buyerVerificationRight": "review_and_confirm|notice_only|seller_self_certifies|not_specified"
  },
  "buyerpa": {
    "buyerCreditRating": "ig|non_ig|not_specified",
    "collateralType": "unsecured|parent_guaranty|lc|cash|lc_plus_mtm|cash_plus_mtm|not_specified",
    "coverageBasis": "3_months|6_months|not_specified"
  },
  "sellerpa": {
    "preCODCreditType": "ig_sponsor_guaranty|sponsor_guaranty|lc|cash|spv_only|not_specified",
    "completionGuaranty": "yes|no|not_specified",
    "postCODCreditType": "ig_sponsor_guaranty|sponsor_guaranty|lc|spv_only|none|not_specified"
  },
  "invoice": {
    "invoiceFrequency": "monthly|quarterly|annual|not_specified",
    "paymentTermsDays": number or null,
    "latePaymentRate": "low|moderate|high|not_specified"
  },
  "assign": {
    "buyerAssignRight": "free|consent_not_unreasonably_withheld|consent_required|no_assignment|not_specified",
    "sellerAssignRight": "free|consent_not_unreasonably_withheld|consent_required|no_assignment|not_specified",
    "lenderAssignment": "permitted|consent_required|not_addressed|not_specified"
  },
  "fm": {
    "fmDefinitionBreadth": "narrow|standard|broad|not_specified",
    "excusesPayment": "yes|no|not_specified",
    "fmDuration": "short|standard|long|not_specified"
  },
  "eod": {
    "paymentFailureCure": number (days) or null,
    "materialBreachCure": number (days) or null,
    "crossDefault": "yes|no|not_specified",
    "bankruptcyEvent": "yes|no|not_specified"
  },
  "eterm": {
    "terminationPaymentBasis": "mark_to_market|fixed_formula|negotiated|not_specified",
    "defaulterPays": "yes|no|not_specified",
    "capOnTerminationPayment": "yes|no|not_specified"
  },
  "marketdisrupt": {
    "disruptionDefined": "yes|no|not_specified",
    "settlementTreatment": "suspend|fallback_average|fallback_last|settle_normal|not_specified",
    "terminationRight": "buyer|mutual|seller|none|not_specified"
  },
  "changeinlaw": {
    "changeBearingParty": "buyer|seller|shared|not_specified",
    "strikeAdjustment": "automatic|negotiated|none|not_specified",
    "terminationRight": "buyer|mutual|seller|none|not_specified"
  },
  "reputation": {
    "reputationProvision": "present|absent|not_specified",
    "terminationRight": "buyer|mutual|seller|none|not_specified"
  },
  "recs": {
    "recOwnership": "buyer|seller|split|not_specified",
    "deliveryMechanism": "transfer|certificate|not_specified",
    "recDefaultRemedy": "replacement|liquidated_damages|termination|none|not_specified"
  },
  "incentives": {
    "itcOwnership": "seller|buyer|shared|not_specified",
    "transferabilitySharing": "yes|no|not_specified",
    "ptcOwnership": "seller|buyer|shared|not_specified"
  },
  "govlaw": {
    "governingState": "NY|DE|TX|CA|other|not_specified",
    "disputeResolution": "arbitration|litigation|not_specified"
  },
  "conf": {
    "esgDisclosureAllowed": "yes|no|not_specified",
    "pressReleaseRight": "mutual_approval|buyer_unilateral|seller_unilateral|none|not_specified"
  },
  "excl": {
    "exclusivityPresent": "yes|no|not_specified",
    "exclusivityDays": number or null
  },
  "expenses": {
    "legalFees": "each_party|shared|seller_pays|buyer_pays|not_specified",
    "registryFees": "each_party|shared|seller_pays|buyer_pays|not_specified"
  },
  "acct": {
    "hedgeAccountingIntent": "yes|no|not_specified"
  },
  "publicity": {
    "pressReleaseApproval": "mutual|buyer_approves|seller_approves|not_required|not_specified",
    "logoUseAllowed": "yes|no|not_specified"
  }
}`;

async function callHaiku(userContent, retryCount = 0) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 4000,
    system: MAPPER_PROMPT,
    messages: [{ role: 'user', content: userContent }]
  });

  const rawText = response.content?.[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    if (retryCount < 1) return callHaiku(userContent + '\n\nCRITICAL: Return ONLY the JSON object. No other text.', retryCount + 1);
    throw new Error('No JSON returned from mapper');
  }

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    if (retryCount < 1) return callHaiku(userContent + '\n\nCRITICAL: Return ONLY valid parseable JSON.', retryCount + 1);
    throw new Error('Mapper JSON parse failed: ' + e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { deal, terms } = body;
  if (!deal || !terms) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing deal or terms' }) };

  if (!process.env.ANTHROPIC_API_KEY) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'No API key' }) };

  // Build a concise summary of extracted terms for the mapper
  const termLines = Object.entries(terms)
    .map(([key, val]) => {
      if (!val || !val.summary) return `${key}: Not addressed`;
      return `${key}: ${val.summary}`;
    })
    .join('\n');

  const userMsg = `Deal context:
ISO: ${deal.iso || 'unknown'}
Technology: ${deal.technology || 'unknown'}
Strike Price: ${deal.strikePrice ? '$' + deal.strikePrice + '/MWh' : 'unknown'}
Escalator: ${deal.escalator || 'unknown'}
Settlement Point: ${deal.settlementPoint || 'unknown'} (${deal.settlementType || 'unknown'})

Term summaries:
${termLines}`;

  try {
    const facts = await callHaiku(userMsg);
    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ ok: true, facts })
    };
  } catch (err) {
    console.error('Mapper error:', err.message);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Mapping failed', message: err.message }) };
  }
};
