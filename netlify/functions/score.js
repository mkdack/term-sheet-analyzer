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

Return ONLY valid JSON. Use null for truly unknown values. Use the exact enum strings shown. Do not add fields not in the schema.

{
  "deal": {
    "iso": "ERCOT|CAISO|PJM|MISO|SPP|ISO-NE|NYISO or null",
    "technology": "Solar|Wind or null",
    "assetType": "new_build|existing or null"
  },
  "strike": {
    "strikePrice": number or null,
    "escalatorPct": number (annual %) or null,
    "escalatorType": "fixed|cpi|cpi_spread or null",
    "iso": "ERCOT|CAISO|PJM|MISO|SPP|ISO-NE|NYISO or null",
    "technology": "Solar|Wind or null",
    "assetType": "new_build|existing or null",
    "settlementType": "hub|zonal|nodal|not_specified",
    "addersIncluded": "all_in|partial|excluded|not_specified"
  },
  "floating": {
    "settlementType": "hub|zonal|nodal|not_specified",
    "addersIncluded": "all_in|partial|excluded|not_specified",
    "priceReference": "real_time|day_ahead|not_specified",
    "nodeToHubSpread": number ($/MWh, if disclosed) or null
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
    "busbarTransfer": "present|absent|not_specified",
    "busbarTrigger": number ($/MWh threshold) or null,
    "busbarHoursCap": number or null
  },
  "scheduling": {
    "schedulingControl": "iso_dispatch|seller_schedules|buyer_approval|not_specified",
    "antiGaming": "present|absent|not_specified",
    "maintenanceCoordination": "buyer_consent|buyer_consultation|seller_discretion|not_specified",
    "outageNotification": "advance_notice|post_hoc|not_specified",
    "notificationWindowDays": number or null
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
  "basiscurtail": {
    "basisCurtailAllocation": "seller_bears_deemed|shared|buyer_bears|not_specified",
    "basisDeemedGenMethod": "weather_adjusted|capacity_factor|contractual_formula|not_specified"
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
    "cpDeadlineMonths": number or null,
    "sellerCPs": ["financing","permitting","interconnection","board_approval","other"] (list any that apply, or []),
    "buyerCPs": ["board_approval","financing","regulatory","other"] (list any that apply, or [])
  },
  "delay": {
    "guaranteedCOD": "yes|no|not_specified",
    "delayDamagesPresent": "yes|no|not_specified",
    "delayDamagesRate": number in $/MW/day (normalize if stated as flat $/day by dividing by project MW capacity) or null,
    "gracePeriodDays": number or null,
    "damagesCapStructure": "project_cost_pct|months_capped|both|none|not_specified",
    "damagesCapValue": number (if project_cost_pct: percentage of EPC/contract value e.g. 15 for 15%; if months_capped: number of months e.g. 12) or null,
    "longstopMonths": number or null,
    "buyerTerminationAtLongstop": "yes|no|not_specified",
    "excusedDelays": "narrow|moderate|broad|not_specified",
    "delaySecurityBacked": "yes|no|not_specified"
  },
  "availmech": {
    "availGuaranteePct": number (e.g. 95) or null,
    "measurementPeriod": "annual|rolling_2yr|not_specified",
    "ldFormula": "energy_and_rec|energy_only|none|not_specified",
    "recDamageAlternative": "multiplier_120pct|supplemental_recs|standard_100pct|none|not_specified",
    "exclusionScope": "narrow|standard|broad|not_specified",
    "terminationRight": "yes|no|not_specified"
  },
  "permit": {
    "permitStatus": "all_obtained|major_obtained|in_progress|not_started|not_specified",
    "permitAsCP": "yes|no|not_specified"
  },
  "cod": {
    "codDefinitionStrength": "tight_objective|moderate|loose_substantial|not_specified",
    "independentEngineer": "required|optional|none|not_specified",
    "buyerVerificationRight": "review_and_confirm|notice_only|seller_self_certifies|not_specified",
    "capacityThreshold": number (% of nameplate) or null,
    "partialCOD": "yes|no|not_specified",
    "performanceTest": "required|optional|not_specified",
    "documentaryDeliverables": "comprehensive|standard|minimal|not_specified"
  },
  "buyerpa": {
    "buyerCreditRating": "ig|non_ig|not_specified",
    "collateralType": "unsecured|parent_guaranty|lc|cash|lc_plus_mtm|cash_plus_mtm|not_specified",
    "coverageBasis": "3_months|6_months|not_specified",
    "thresholdStructure": "fixed|mtm_based|not_specified",
    "downgradeTrigger": "yes|no|not_specified",
    "downgradeCurePeriod": number (days) or null,
    "downgradeSubstitution": "yes|no|not_specified",
    "fixedAmountPerMW": number ($/MW) or null
  },
  "sellerpa": {
    "preCODCreditType": "ig_sponsor_guaranty|sponsor_guaranty|lc|cash|spv_only|not_specified",
    "completionGuaranty": "yes|no|not_specified",
    "postCODCreditType": "ig_sponsor_guaranty|sponsor_guaranty|lc|spv_only|none|not_specified",
    "creditSurvivesFinancing": "yes|no|not_specified",
    "downgradeTrigger": "yes|no|not_specified",
    "stepDownTiming": "post_cod|mid_term|end_term|not_specified",
    "preCODSizingPerMW": number ($/MW) or null,
    "postCODSizingPerMW": number ($/MW) or null
  },
  "invoice": {
    "invoiceFrequency": "monthly|quarterly|annual|not_specified",
    "paymentTermsDays": number or null,
    "latePaymentRate": "low|moderate|high|not_specified",
    "netting": "yes|no|not_specified",
    "trueUp": "annual|none|not_specified",
    "disputeMechanism": "pay_then_dispute|withhold_disputed|not_specified"
  },
  "assign": {
    "buyerAssignRight": "free|consent_not_unreasonably_withheld|consent_required|no_assignment|not_specified",
    "sellerAssignRight": "free|consent_not_unreasonably_withheld|consent_required|no_assignment|not_specified",
    "lenderAssignment": "permitted|consent_required|not_addressed|not_specified",
    "assigneeCreditRequirement": "yes|no|not_specified",
    "buyerAffiliateTransfer": "permitted|consent_required|not_specified",
    "sellerAffiliateTransfer": "permitted|consent_required|not_specified"
  },
  "fm": {
    "fmDefinitionScope": "narrow|standard|broad|not_specified",
    "paymentObligations": "excused|not_excused|not_specified",
    "fmDurationMonths": number or null,
    "terminationRight": "yes|no|not_specified",
    "transmissionCongestionExcluded": "yes|no|not_specified",
    "supplyChainExcluded": "yes|no|not_specified",
    "economicHardshipExcluded": "yes|no|not_specified",
    "equipmentFailureExcluded": "yes|no|not_specified",
    "codExtensionForFM": "yes|no|not_specified",
    "notificationRequirement": "strict|standard|not_specified",
    "pandemicTreatment": "fm|not_fm|not_specified"
  },
  "eod": {
    "paymentCureDays": number or null,
    "materialBreachCureDays": number or null,
    "crossDefault": "yes|no|not_specified",
    "bankruptcyEvent": "yes|no|not_specified",
    "eodTriggerStandard": "objective_test|subjective|not_specified",
    "cureExtensionRight": "yes|no|not_specified",
    "creditFailureAsEOD": "yes|no|not_specified",
    "downgradeAsEOD": "yes|no|not_specified",
    "abandonmentTrigger": "yes|no|not_specified",
    "longstopCODDefault": "yes|no|not_specified",
    "creditSupportCureDays": number or null
  },
  "eterm": {
    "terminationPaymentBasis": "mark_to_market|fixed_formula|negotiated|not_specified",
    "defaulterPays": "yes|no|not_specified",
    "capOnTerminationPayment": "yes|no|not_specified",
    "terminationStructure": "mark_to_market|fixed_formula|negotiated|not_specified",
    "valuationMethod": "market_quotation|loss|both|not_specified",
    "sellerPaymentCap": number or null,
    "preCODSellerPayment": "yes|no|not_specified",
    "discountRate": number (%) or null,
    "generationAssumptions": "p50|p90|contractual|not_specified",
    "disputeResolution": "expert|arbitration|litigation|not_specified",
    "preCODPostCODConsistency": "yes|no|not_specified"
  },
  "marketdisrupt": {
    "disruptionDefined": "yes|no|not_specified",
    "settlementTreatment": "suspend|fallback_average|fallback_last|settle_normal|not_specified",
    "terminationRight": "yes|no|not_specified",
    "terminationTriggerDays": number or null,
    "fallbackCapPrice": number or null,
    "disruptionEventCount": number (max events/year) or null
  },
  "changeinlaw": {
    "changeBearingParty": "buyer|seller|shared|not_specified",
    "strikeAdjustment": "automatic|negotiated|none|not_specified",
    "terminationRight": "yes|no|not_specified",
    "preCODProtection": "yes|no|not_specified",
    "postCODProtection": "yes|no|not_specified",
    "taxCreditTreatment": "buyer_bears|seller_bears|shared|not_specified",
    "tariffTreatment": "buyer_bears|seller_bears|shared|not_specified",
    "reopenerMechanism": "automatic|mutual_agreement|none|not_specified",
    "economicImpactStandard": "material|any|not_specified",
    "strikeFixed": "yes|no|not_specified",
    "financingTermsAsRelief": "yes|no|not_specified"
  },
  "reputation": {
    "reputationTerminationRight": "buyer_right|mutual|none|not_specified",
    "reputationEventDefinition": "objective_defined|subjective_buyer_discretion|not_defined|not_specified",
    "sellerComplianceReps": "comprehensive|standard|minimal|none|not_specified",
    "sellerAssignmentApproval": "buyer_approval_includes_reputation|creditworthiness_only|no_approval|not_specified",
    "communityOppositionProvision": "yes|no|not_specified"
  },
  "product": {
    "environmentalAttributes": "all_conveyed|partial_carveouts|not_defined|not_specified",
    "bundledStructure": "bundled|unbundled|not_specified",
    "capacityAncillaryTreatment": "all_to_buyer|seller_retains|split|not_specified",
    "projectSpecific": "yes|no|not_specified",
    "additionalityClaim": "supported|unsupported|not_specified",
    "storageHybridAddressed": "yes|no|not_applicable|not_specified",
    "settlementDefinitionClarity": "comprehensive|standard|minimal|not_specified",
    "futureAttributes": "buyer_retains|seller_retains|not_specified"
  },
  "recs": {
    "recOwnership": "buyer|seller|split|cash_only|not_specified",
    "recQuality": "same_tech_same_region|same_region_any_renewable|any_national_rec|not_specified",
    "deliveryMechanism": "transfer|certificate|not_specified",
    "recDefaultRemedy": "replacement|liquidated_damages|termination|none|not_specified",
    "vintageRequirement": "strict_match|loose_banking|not_specified",
    "registryAccount": "buyer_account|seller_transfers|not_addressed|not_specified"
  },
  "incentives": {
    "taxCreditAllocation": "buyer_shares_upside|seller_retains_strike_reflects|seller_retains_no_transparency|not_specified",
    "bonusCreditAllocation": "reflected_in_strike|shared|seller_retains|not_addressed|not_specified",
    "transferabilityValueSharing": "buyer_benefits|shared|seller_retains|not_addressed|not_specified",
    "incrementalIncentives": "buyer_shares|seller_retains|not_addressed|not_specified",
    "stateLocalIncentives": "reflected_in_strike|shared|seller_retains|not_addressed|not_specified",
    "incentiveTransparency": "seller_discloses|no_disclosure|not_specified"
  },
  "govlaw": {
    "governingLaw": "NY|DE|TX|CA|other|not_specified",
    "disputeResolution": "arbitration|mediation_then_arbitration|litigation|mediation_then_litigation|not_specified",
    "venue": "buyer_favorable|neutral|seller_favorable|not_specified",
    "juryWaiver": "yes|no|not_specified",
    "expertDetermination": "yes|no|not_specified"
  },
  "conf": {
    "confScope": "narrow_pricing_only|standard_all_terms|broad_existence_included|not_specified",
    "esgReportingCarveout": "yes|no|not_specified",
    "regulatoryFilingCarveout": "yes|no|not_specified",
    "affiliateDisclosure": "permitted|restricted|not_specified",
    "survivalPeriod": number (years) or null,
    "mutualObligation": "yes|no|not_specified"
  },
  "excl": {
    "sellerOutputExclusivity": "full_project_committed|partial_project|not_specified",
    "buyerExclusivity": "none|limited_same_iso|broad|not_specified",
    "attributeExclusivity": "all_to_buyer|some_retained|not_specified",
    "negotiationExclusivity": "none|time_limited|open_ended|not_specified"
  },
  "expenses": {
    "legalFees": "each_own|shared|buyer_bears|not_specified",
    "registryFees": "each_own|shared|buyer_bears|not_specified",
    "ieAndStudyCosts": "seller_bears|shared|buyer_bears|not_specified",
    "ongoingAdminCosts": "seller_bears|shared|buyer_bears|not_specified"
  },
  "acct": {
    "accountingRepresentations": "both_parties|buyer_only|none|not_specified",
    "hedgeAccountingLanguage": "explicit|implied|none|not_specified",
    "taxIndemnity": "mutual|one_way_buyer|none|not_specified",
    "changeInAccountingTreatment": "no_relief|reopener|termination_right|not_specified"
  },
  "publicity": {
    "jointAnnouncementRequired": "yes_mutual_approval|notification_only|no_restriction|not_specified",
    "buyerPublicityRight": "broad_esg_marketing|limited_with_approval|restricted|not_specified",
    "sellerUseOfBuyerName": "prohibited_without_consent|permitted_with_notice|unrestricted|not_specified",
    "logoTrademarkRestriction": "prior_written_consent|permitted|not_addressed|not_specified",
    "approvalProcess": "mutual|seller_approves|buyer_approves|none|not_specified"
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
