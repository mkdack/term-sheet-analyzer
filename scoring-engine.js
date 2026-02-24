/**
 * PPA Deal Scorecard — Deterministic Scoring Engine
 * Built from domain-expert specification v1.0
 *
 * Input:  Structured facts extracted by Haiku (see FACT_SCHEMA below)
 * Output: { termId: score (0–100), flags: [...], interactions: [...] }
 *
 * All scores clamped [0, 100]. Piecewise linear interpolation where specified.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function lerp(value, inLow, inHigh, outLow, outHigh) {
  if (inHigh === inLow) return outLow;
  return outLow + (value - inLow) / (inHigh - inLow) * (outHigh - outLow);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICING REFERENCE TABLE (validated Q4 2025 / Q1 2026)
// ─────────────────────────────────────────────────────────────────────────────

const STRIKE_THRESHOLDS = {
  ERCOT:  { Solar: { bf_low:40, bf_high:45, mkt_low:48, mkt_high:52, sf_low:55, sf_high:60, rf_high:72 },
             Wind:  { bf_low:45, bf_high:50, mkt_low:52, mkt_high:60, sf_low:60, sf_high:70, rf_high:84 } },
  CAISO:  { Solar: { bf_low:55, bf_high:62, mkt_low:70, mkt_high:80, sf_low:80, sf_high:90,  rf_high:108 },
             Wind:  { bf_low:55, bf_high:65, mkt_low:65, mkt_high:75, sf_low:75, sf_high:85,  rf_high:102 } },
  PJM:    { Solar: { bf_low:73, bf_high:81, mkt_low:85, mkt_high:95, sf_low:95, sf_high:110, rf_high:132 },
             Wind:  { bf_low:70, bf_high:80, mkt_low:80, mkt_high:92, sf_low:92, sf_high:105, rf_high:126 } },
  MISO:   { Solar: { bf_low:58, bf_high:65, mkt_low:65, mkt_high:75, sf_low:75, sf_high:85,  rf_high:102 },
             Wind:  { bf_low:50, bf_high:58, mkt_low:58, mkt_high:68, sf_low:68, sf_high:78,  rf_high:94  } },
  SPP:    { Solar: { bf_low:48, bf_high:55, mkt_low:55, mkt_high:65, sf_low:65, sf_high:75,  rf_high:90  },
             Wind:  { bf_low:40, bf_high:48, mkt_low:48, mkt_high:55, sf_low:55, sf_high:65,  rf_high:78  } },
  'ISO-NE': { Solar: { bf_low:63, bf_high:70, mkt_low:75, mkt_high:85, sf_low:85, sf_high:95, rf_high:114 } },
  ISONE:    { Solar: { bf_low:63, bf_high:70, mkt_low:75, mkt_high:85, sf_low:85, sf_high:95, rf_high:114 } },
  NYISO:  { Solar: { bf_low:58, bf_high:65, mkt_low:70, mkt_high:80, sf_low:80, sf_high:90,  rf_high:108 } },
};

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 1: PRICING & SETTLEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. strike — Fixed Price
 * @param {Object} f - facts
 * @param {number}  f.strikePrice       $/MWh
 * @param {string}  f.iso               ERCOT | CAISO | PJM | MISO | SPP | ISO-NE | NYISO
 * @param {string}  f.technology        Solar | Wind
 * @param {string}  f.assetType         new_build | existing
 * @param {number}  f.escalatorPct      annual % (default 0)
 */
function scoreStrike(f) {
  if (f.strikePrice == null) {
    return { score: 50, flag: 'Strike price not yet specified — score is placeholder.' };
  }

  const isoKey = (f.iso || 'ERCOT').toUpperCase().replace('-', '-');
  const techKey = f.technology && f.technology.toLowerCase() === 'wind' ? 'Wind' : 'Solar';
  const isoTable = STRIKE_THRESHOLDS[isoKey] || STRIKE_THRESHOLDS['ERCOT'];
  let t = isoTable[techKey];

  if (!t) {
    return { score: null, flag: 'Not scored — rare market offering (unsupported ISO/tech combination).' };
  }

  // Existing asset: multiply all thresholds by 0.75
  if (f.assetType === 'existing') {
    t = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v * 0.75]));
  }

  // Piecewise linear interpolation
  let base;
  const p = f.strikePrice;
  if (p <= t.bf_low)   base = 0;
  else if (p <= t.bf_high)  base = lerp(p, t.bf_low, t.bf_high, 0, 25);
  else if (p <= t.mkt_low)  base = lerp(p, t.bf_high, t.mkt_low, 25, 30);
  else if (p <= t.mkt_high) base = lerp(p, t.mkt_low, t.mkt_high, 30, 50);
  else if (p <= t.sf_low)   base = lerp(p, t.mkt_high, t.sf_low, 50, 55);
  else if (p <= t.sf_high)  base = lerp(p, t.sf_low, t.sf_high, 55, 75);
  else if (p <= t.rf_high)  base = lerp(p, t.sf_high, t.rf_high, 76, 100);
  else base = 100;

  // Escalator penalty
  const esc = f.escalatorPct || 0;
  let penalty = 0;
  if (esc === 0)              penalty = 0;
  else if (esc <= 1.0)        penalty = Math.round(esc / 0.5) * 3;
  else if (esc <= 2.0)        penalty = 6 + Math.round((esc - 1.0) / 0.5) * 4;
  else if (f.escalatorType === 'cpi')         penalty = 8;
  else if (f.escalatorType === 'cpi_spread')  penalty = 10;
  else if (esc > 2.0)         penalty = 15;

  return { score: clamp(base + penalty), flag: null };
}

/**
 * 2. floating — Settlement Point / Floating Price Reference
 * @param {string} f.settlementType    hub | zonal | nodal | not_specified
 * @param {string} f.addersIncluded    all_in | partial | excluded | not_specified
 * @param {number} f.nodeToHubSpread   $/MWh (optional)
 */
function scoreFloating(f) {
  const MATRIX = {
    hub:           { all_in: 5,  partial: 18, excluded: 35, not_specified: 40 },
    zonal:         { all_in: 5,  partial: 18, excluded: 35, not_specified: 40 },
    nodal:         { all_in: 55, partial: 62, excluded: 70, not_specified: 75 },
    not_specified: { all_in: 80, partial: 80, excluded: 80, not_specified: 80 },
  };

  const st = f.settlementType || 'not_specified';
  const ai = f.addersIncluded  || 'not_specified';
  const row = MATRIX[st] || MATRIX['not_specified'];
  const score = row[ai] !== undefined ? row[ai] : row['not_specified'];

  let flag = null;
  if (!f.settlementType) flag = 'Settlement point not defined — critical term missing.';

  // Node-to-hub spread warning (non-scoring)
  let spreadFlag = null;
  if ((st === 'hub' || st === 'zonal') && f.nodeToHubSpread != null) {
    if (f.nodeToHubSpread > 7)
      spreadFlag = `High developer basis risk — $${f.nodeToHubSpread}/MWh spread threatens project viability.`;
    else if (f.nodeToHubSpread > 3)
      spreadFlag = `Monitor developer basis exposure — $${f.nodeToHubSpread}/MWh node-to-hub spread.`;
  }

  return { score: clamp(score), flag, spreadFlag };
}

/**
 * 3. interval — Settlement Interval / Calculation Period
 * @param {string} f.settlementInterval  iso_native | hourly | monthly | annual | not_specified
 * @param {string} f.priceReference      real_time | day_ahead | not_specified
 */
function scoreInterval(f) {
  const BASE = {
    iso_native:    5,
    hourly:        30,
    monthly:       60,
    annual:        75,
    not_specified: 70,
  };
  const PRICE_MOD = { real_time: 0, day_ahead: 5, not_specified: 10 };

  const si = f.settlementInterval || 'not_specified';
  const pr = f.priceReference     || 'not_specified';
  const base = BASE[si] !== undefined ? BASE[si] : 70;
  const mod  = PRICE_MOD[pr] !== undefined ? PRICE_MOD[pr] : 10;

  let flag = null;
  if (!f.settlementInterval) flag = 'Settlement interval not defined — defaults typically favor seller.';

  // Cross-term flag for monthly/annual
  let negPriceFlag = null;
  if (si === 'monthly' || si === 'annual') {
    negPriceFlag = 'Aggregated settlement interval masks negative price hours.';
  }

  return { score: clamp(base + mod), flag, negPriceFlag };
}

/**
 * 4. negprice — Negative Price Provisions
 * @param {string} f.negPriceMechanism    zero_floor | seller_curtails | full_passthrough | not_specified
 * @param {number} f.hoursCap             hours/year or null
 * @param {number} f.priceFloor           $/MWh (negative value) or null
 * @param {boolean} f.annualAggregateCap  true/false
 */
function scoreNegPrice(f) {
  const BASE = {
    zero_floor:      5,
    seller_curtails: 30,
    full_passthrough:70,
    not_specified:   85,
  };

  const mech = f.negPriceMechanism || 'not_specified';
  let score = BASE[mech] !== undefined ? BASE[mech] : 85;

  // Modifiers only when seller_curtails or full_passthrough
  if (mech === 'seller_curtails' || mech === 'full_passthrough') {
    const h = f.hoursCap;
    if      (h != null && h <= 50)  score -= 10;
    else if (h != null && h <= 100) score -= 7;
    else if (h != null && h <= 200) score -= 4;
    else if (h != null && h > 500)  score += 5;

    const floor = f.priceFloor; // negative number
    if      (floor != null && floor >= -10) score -= 8;
    else if (floor != null && floor >= -25) score -= 5;
    else if (floor != null && floor >= -50) score -= 2;

    if (f.annualAggregateCap === true) score -= 5;
  }

  let flag = null;
  if (!f.negPriceMechanism) {
    flag = 'No negative price provisions found — buyer assumes unlimited downside. Critical gap in ERCOT and CAISO markets.';
  }

  return { score: clamp(score), flag };
}

/**
 * 5. invoice — Invoicing & Payment Terms
 * @param {string} f.invoiceFrequency   monthly | quarterly | annual | not_specified
 * @param {number} f.paymentTermsDays   number or null
 * @param {string} f.netting            yes | no | not_specified
 * @param {string} f.disputeMechanism   withhold_disputed | pay_then_dispute | not_specified
 * @param {string} f.latePaymentRate    low | moderate | high | not_specified
 * @param {string} f.trueUp             monthly | quarterly | annual | none | not_specified
 */
function scoreInvoice(f) {
  const FREQ_BASE = { monthly: 25, quarterly: 40, annual: 60, not_specified: 55 };
  let score = FREQ_BASE[f.invoiceFrequency || 'not_specified'] || 55;

  const days = f.paymentTermsDays;
  if      (days != null && days >= 60) score -= 10;
  else if (days != null && days >= 45) score -= 5;
  else if (days != null && days >= 30) score += 0;
  else if (days != null && days >= 15) score += 5;
  else if (days != null)               score += 10;
  else                                 score += 5;

  const NETTING = { yes: -5, no: 5, not_specified: 3 };
  const DISPUTE = { withhold_disputed: -5, pay_then_dispute: 5, not_specified: 3 };
  const LATE    = { low: -2, moderate: 0, high: 3, not_specified: 2 };
  const TRUEUP  = { monthly: -3, quarterly: 0, annual: 3, none: 5, not_specified: 3 };

  score += NETTING[f.netting || 'not_specified'] || 3;
  score += DISPUTE[f.disputeMechanism || 'not_specified'] || 3;
  score += LATE[f.latePaymentRate || 'not_specified'] || 2;
  score += TRUEUP[f.trueUp || 'not_specified'] || 3;

  let flag = null;
  if (!f.invoiceFrequency) flag = 'Invoicing and payment terms not defined — silence typically defaults to seller-favorable terms.';

  return { score: clamp(score), flag };
}

/**
 * 6. basis — Basis Risk Provisions
 * @param {string} f.basisAllocation     seller_bears | shared_collar | buyer_bears | not_specified
 * @param {string} f.busbarTransfer      present | absent | not_specified
 * @param {string} f.busbarTrigger       standard_node_plus_ppa | lower_threshold | not_specified
 * @param {number} f.busbarHoursCap      hours/year or null
 * @param {number} f.collarBand          $/MWh width or null
 */
function scoreBasis(f) {
  const BASE = { seller_bears: 10, shared_collar: 35, buyer_bears: 65, not_specified: 75 };
  let score = BASE[f.basisAllocation || 'not_specified'] || 75;

  // Collar band modifier (shared_collar only)
  if (f.basisAllocation === 'shared_collar') {
    const cb = f.collarBand;
    if      (cb != null && cb <= 3)  score -= 5;
    else if (cb != null && cb <= 7)  score += 0;
    else if (cb != null && cb <= 15) score += 5;
    else if (cb != null)             score += 10;
    else                             score += 5;
  }

  // Busbar transfer modifier
  const bt = f.busbarTransfer || 'not_specified';
  if (bt === 'absent') {
    // no mod
  } else if (bt === 'present') {
    const trigger = f.busbarTrigger || 'not_specified';
    if      (trigger === 'standard_node_plus_ppa') score += 8;
    else if (trigger === 'lower_threshold')        score += 15;
    else                                           score += 12;

    // Busbar hours cap
    const bhc = f.busbarHoursCap;
    if      (bhc != null && bhc <= 50)  score -= 3;
    else if (bhc != null && bhc <= 200) score += 0;
    else if (bhc != null)               score += 3;
    else                                score += 2;
  } else {
    score += 3;
  }

  let flag = null;
  if (!f.basisAllocation) flag = 'Basis risk allocation not defined — silence typically means buyer assumes all locational spread risk.';

  return { score: clamp(score), flag };
}

/**
 * 7. marketdisrupt — Market Disruption Events
 * @param {string}   f.disruptionDefined       yes | no | not_specified
 * @param {string}   f.settlementTreatment     suspend | fallback_average | fallback_last | settle_normal | not_specified
 * @param {number}   f.fallbackCapPrice        $/MWh or null
 * @param {string}   f.terminationRight        buyer | mutual | seller | none | not_specified
 * @param {number}   f.terminationTriggerDays  days or null
 * @param {number}   f.disruptionEventCount    count of defined events (0–5)
 */
function scoreMarketDisrupt(f) {
  const defined = f.disruptionDefined || 'not_specified';
  const treatment = f.settlementTreatment || 'not_specified';

  const MATRIX = {
    yes: { suspend: 5, fallback_average: 15, fallback_last: 30, settle_normal: 65, not_specified: 50 },
    no:  { _: 80 },
    not_specified: { _: 80 },
  };

  let score;
  if (defined === 'yes') {
    score = MATRIX.yes[treatment] !== undefined ? MATRIX.yes[treatment] : 50;
  } else {
    score = 80;
  }

  const cap = f.fallbackCapPrice;
  if      (cap != null && cap <= 100)  score -= 5;
  else if (cap != null && cap <= 250)  score -= 3;
  else if (cap != null && cap <= 500)  score += 0;
  else if (cap != null)                score += 5;
  else                                 score += 3;

  const TERM_RIGHT = { buyer: -5, mutual: -3, seller: 5, none: 5, not_specified: 3 };
  score += TERM_RIGHT[f.terminationRight || 'not_specified'] || 3;

  const days = f.terminationTriggerDays;
  if      (days != null && days <= 3)  score -= 3;
  else if (days != null && days <= 7)  score += 0;
  else if (days != null && days <= 30) score += 3;
  else if (days != null)               score += 5;
  else                                 score += 3;

  const count = f.disruptionEventCount || 0;
  if      (count >= 4) score -= 3;
  else if (count >= 2) score += 0;
  else if (count === 1) score += 3;
  else                  score += 5;

  let flag = null;
  if (defined !== 'yes') {
    flag = 'No market disruption provisions — buyer is fully exposed to ISO emergency pricing. ERCOT Winter Storm Uri demonstrated catastrophic exposure.';
  }

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 2: CURTAILMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 8. scheduling — Scheduling Rights & Obligations
 */
function scoreScheduling(f) {
  const BASE = { iso_dispatch: 15, seller_schedules: 35, buyer_approval: 10, not_specified: 55 };
  let score = BASE[f.schedulingControl || 'not_specified'] || 55;

  const NOTIF = { advance_required: -5, best_efforts: 0, none: 5, not_specified: 3 };
  score += NOTIF[f.outageNotification || 'not_specified'] || 3;

  if (f.outageNotification === 'advance_required') {
    const w = f.notificationWindowDays;
    if      (w != null && w >= 30) score -= 3;
    else if (w != null && w >= 14) score -= 1;
    else if (w != null && w >= 7)  score += 0;
    else if (w != null)            score += 2;
    else                           score += 2;
  }

  const ANTI  = { present: -5, absent: 5, not_specified: 3 };
  const MAINT = { buyer_consent: -5, buyer_consultation: -2, seller_discretion: 5, not_specified: 3 };
  score += ANTI[f.antiGaming || 'not_specified'] || 3;
  score += MAINT[f.maintenanceCoordination || 'not_specified'] || 3;

  let flag = null;
  if (!f.schedulingControl) flag = 'Scheduling rights not defined — buyer lacks visibility into dispatch decisions.';

  return { score: clamp(score), flag };
}

/**
 * Helper — curtailment cap + deemed gen modifiers (shared by 9, 10, 11)
 */
function curtailmentModifiers(f, capField, deemedField) {
  let mod = 0;
  const cap = f[capField];
  if (cap != null && cap <= 3)   mod -= 5;
  else if (cap != null && cap <= 5)  mod += 0;
  else if (cap != null && cap <= 10) mod += 5;
  else if (cap != null)              mod += 10;
  else                               mod += 5;

  const DG = { weather_adjusted: -3, capacity_factor: 0, contractual_formula: 3, not_specified: 5 };
  mod += DG[f[deemedField] || 'not_specified'] || 5;
  return mod;
}

/**
 * 9. curtailment — Economic Curtailment
 */
function scoreCurtailment(f) {
  const BASE = { seller_bears_deemed: 10, shared: 40, buyer_bears: 65, not_specified: 75 };
  const alloc = f.econCurtailmentAllocation || 'not_specified';
  let score = BASE[alloc] || 75;

  if (alloc === 'shared') score += curtailmentModifiers(f, 'curtailmentCap', 'deemedGenMethod');
  if (alloc === 'seller_bears_deemed') {
    const DG = { weather_adjusted: -3, capacity_factor: 0, contractual_formula: 3, not_specified: 5 };
    score += DG[f.deemedGenMethod || 'not_specified'] || 5;
  }

  let flag = null;
  if (!f.econCurtailmentAllocation) flag = 'Economic curtailment risk allocation not defined — silence typically means buyer absorbs lost volume.';
  return { score: clamp(score), flag };
}

/**
 * 10. nonecocurtail — Non-Economic Curtailment
 */
function scoreNonEcoCurtail(f) {
  const BASE = { seller_bears_deemed: 15, shared: 35, buyer_bears: 60, not_specified: 70 };
  const alloc = f.nonEconCurtailAllocation || 'not_specified';
  let score = BASE[alloc] || 70;

  if (alloc === 'shared') score += curtailmentModifiers(f, 'nonEconCurtailCap', 'nonEconDeemedGenMethod');
  if (alloc === 'seller_bears_deemed') {
    const DG = { weather_adjusted: -3, capacity_factor: 0, contractual_formula: 3, not_specified: 5 };
    score += DG[f.nonEconDeemedGenMethod || 'not_specified'] || 5;
  }

  let flag = null;
  if (!f.nonEconCurtailAllocation) flag = 'Non-economic curtailment not addressed — buyer likely absorbs volume loss from transmission congestion.';
  return { score: clamp(score), flag };
}

/**
 * 11. basiscurtail — Basis-Related Curtailment
 */
function scoreBasisCurtail(f) {
  const BASE = { seller_bears_deemed: 10, shared: 40, buyer_bears: 70, not_specified: 78 };
  const alloc = f.basisCurtailAllocation || 'not_specified';
  let score = BASE[alloc] || 78;

  if (alloc === 'shared') score += curtailmentModifiers(f, 'basisCurtailCap', 'basisDeemedGenMethod');
  if (alloc === 'seller_bears_deemed') {
    const DG = { weather_adjusted: -3, capacity_factor: 0, contractual_formula: 3, not_specified: 5 };
    score += DG[f.basisDeemedGenMethod || 'not_specified'] || 5;
  }

  let flag = null;
  if (!f.basisCurtailAllocation) flag = 'Basis curtailment not addressed — seller can curtail during basis blowouts with no buyer compensation.';
  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 3: PROJECT DEVELOPMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 12. ia — Interconnection Agreement Status
 */
function scoreIA(f) {
  const BASE = {
    fully_executed: 5, facilities_study_complete: 20, system_impact_complete: 35,
    feasibility_stage: 55, not_filed: 85, not_specified: 70,
  };
  let score = BASE[f.iaStatus || 'not_specified'] || 70;

  const NUC = { defined_and_capped: -3, defined_uncapped: 0, undefined: 5, not_specified: 3 };
  const IACP = { yes: -5, no: 5, not_specified: 3 };
  score += NUC[f.networkUpgradeCosts || 'not_specified'] || 3;
  score += IACP[f.iaAsCP || 'not_specified'] || 3;

  let flag = null;
  if (!f.iaStatus) flag = 'IA status not disclosed — buyer cannot assess grid connection risk.';

  // Cross-term flag if early stage and not a CP
  let cpFlag = null;
  if ((f.iaStatus === 'feasibility_stage' || f.iaStatus === 'not_filed') && f.iaAsCP !== 'yes') {
    cpFlag = 'Early-stage IA not listed as condition precedent.';
  }

  return { score: clamp(score), flag, cpFlag };
}

/**
 * 13. cp — Conditions Precedent
 */
function scoreCP(f) {
  const COUNT_BASE = { 5: 5, 4: 12, 3: 22, 2: 35, 1: 50, 0: 80 };
  const count = Array.isArray(f.buyerCPs) ? f.buyerCPs.length : (f.buyerCPCount || 0);
  let score = COUNT_BASE[Math.min(count, 5)] !== undefined ? COUNT_BASE[Math.min(count, 5)] : 80;

  const TERM = { yes: -5, no: 10, not_specified: 5 };
  score += TERM[f.buyerTerminationRight || 'not_specified'] || 5;

  const months = f.cpDeadlineMonths;
  if      (months != null && months <= 6)  score -= 5;
  else if (months != null && months <= 12) score += 0;
  else if (months != null && months <= 18) score += 3;
  else if (months != null && months <= 24) score += 5;
  else if (months != null)                 score += 10;
  else                                     score += 8;

  const sellerCPs = Array.isArray(f.sellerCPs) ? f.sellerCPs.length : (f.sellerCPCount || 0);
  score += Math.min(sellerCPs, 3) * 2;

  const NOTICE = { required: -3, not_required: 3, not_specified: 2 };
  score += NOTICE[f.cpSatisfactionNotice || 'not_specified'] || 2;

  let flag = null;
  if (count === 0) flag = 'No conditions precedent — buyer is contractually committed from execution regardless of project status.';

  return { score: clamp(score), flag };
}

/**
 * 14. delay — Project Delay Provisions
 */
function scoreDelay(f) {
  const MATRIX = {
    yes:  { yes: 10, no: 45, not_specified: 30 },
    no:   { yes: 35, no: 75, not_specified: 60 },
    not_specified: { not_specified: 80 },
  };

  const gCOD = f.guaranteedCOD || 'not_specified';
  const dDP  = f.delayDamagesPresent || 'not_specified';
  const row  = MATRIX[gCOD] || MATRIX['not_specified'];
  let score  = (row[dDP] !== undefined ? row[dDP] : row['not_specified']) || 80;

  // Damages rate
  if (dDP === 'yes') {
    const tech = (f.technology || 'solar').toLowerCase();
    const rate = f.delayDamagesRate;
    if (tech === 'wind') {
      if      (rate != null && rate >= 3200) score -= 5;
      else if (rate != null && rate >= 2000) score += 0;
      else if (rate != null && rate >= 1500) score += 5;
      else if (rate != null)                 score += 10;
      else                                   score += 5;
    } else {
      if      (rate != null && rate >= 2200) score -= 5;
      else if (rate != null && rate >= 1400) score += 0;
      else if (rate != null && rate >= 1000) score += 5;
      else if (rate != null)                 score += 10;
      else                                   score += 5;
    }
  }

  const grace = f.gracePeriodDays;
  if      (grace != null && grace <= 30) score -= 3;
  else if (grace != null && grace <= 60) score += 0;
  else if (grace != null && grace <= 90) score += 3;
  else if (grace != null)                score += 7;
  else                                   score += 5;

  const CAP = {
    both: 0, none: -5, not_specified: 3,
    project_cost_pct: (v) => v <= 8 ? -2 : v <= 12 ? 0 : -3,
    months_capped:    (v) => v <= 12 ? 3 : v <= 18 ? 0 : -2,
  };
  const capStruct = f.damagesCapStructure || 'not_specified';
  if (capStruct === 'both') score += 0;
  else if (capStruct === 'none') score -= 5;
  else if (capStruct === 'project_cost_pct' && f.damagesCapValue != null)
    score += typeof CAP.project_cost_pct === 'function' ? CAP.project_cost_pct(f.damagesCapValue) : 0;
  else if (capStruct === 'months_capped' && f.damagesCapValue != null)
    score += typeof CAP.months_capped === 'function' ? CAP.months_capped(f.damagesCapValue) : 0;
  else score += 3;

  const ls = f.longstopMonths;
  if      (ls != null && ls <= 12) score -= 5;
  else if (ls != null && ls <= 18) score -= 2;
  else if (ls != null && ls <= 24) score += 0;
  else if (ls != null)             score += 5;
  else                             score += 8;

  const BTERM = { yes: -5, no: 10, not_specified: 5 };
  const SEC   = { both: -3, lc: -2, parent_guaranty: 0, none: 8, not_specified: 5 };
  const EXC   = { narrow: -3, moderate: 0, broad: 7, not_specified: 5 };
  score += BTERM[f.buyerTerminationAtLongstop || 'not_specified'] || 5;
  score += SEC[f.delaySecurityBacked || 'not_specified'] || 5;
  score += EXC[f.excusedDelays || 'not_specified'] || 5;

  let flag = null;
  if (gCOD === 'not_specified' && dDP === 'not_specified') flag = 'No delay provisions — buyer has no protection if project misses COD.';

  return { score: clamp(score), flag };
}

/**
 * 15. availmech — Mechanical Availability Guarantee
 */
function scoreAvailMech(f) {
  const tech = (f.technology || 'solar').toLowerCase();
  const pct  = f.availGuaranteePct;

  let base;
  if (pct == null) {
    base = 78;
  } else if (tech === 'wind') {
    if      (pct >= 97) base = 5;
    else if (pct >= 96) base = 15;
    else if (pct >= 95) base = 30;
    else if (pct >= 94) base = 42;
    else if (pct >= 93) base = 55;
    else if (pct >= 92) base = 65;
    else                base = 82;
  } else { // solar
    if      (pct >= 99) base = 0;
    else if (pct >= 98) base = 10;
    else if (pct >= 97) base = 25;
    else if (pct >= 96) base = 40;
    else if (pct >= 95) base = 55;
    else                base = 80;
  }

  const MEAS = { time_based: 0, energy_weighted: tech === 'wind' ? -5 : -3, not_specified: 3 };
  const REMEDY = { deemed_generation: -5, liquidated_damages: -3, none: 15, not_specified: 8 };
  const EXCL   = { narrow: -3, standard: 0, broad: 5, not_specified: 5 };
  const TRIGHT = { yes: -5, no: 8, not_specified: 5 };
  let score = base;
  score += MEAS[f.measurementMethod || 'not_specified'] || 3;
  score += REMEDY[f.shortfallRemedy || 'not_specified'] || 8;
  score += EXCL[f.exclusionScope || 'not_specified'] || 5;
  score += TRIGHT[f.terminationRight || 'not_specified'] || 5;

  const maint = f.maintenanceCapDays;
  if      (maint != null && maint <= 15) score -= 3;
  else if (maint != null && maint <= 30) score += 0;
  else if (maint != null && maint <= 45) score += 3;
  else if (maint != null)                score += 5;
  else                                   score += 3;

  let flag = null;
  if (pct == null) flag = 'No mechanical availability guarantee — buyer has no assurance of project uptime.';

  return { score: clamp(score), flag };
}

/**
 * 16. availguaranteed — Energy Production Guarantee
 */
function scoreAvailGuaranteed(f) {
  const tech = (f.technology || 'solar').toLowerCase();
  const pg   = f.productionGuarantee || 'not_specified';
  const pval = f.pValue || 'not_specified';

  const MATRIX = {
    yes: { P50: 10, P75: 45, P90: 65, other: 50, not_specified: 40 },
    no:  { _: 82 },
    not_specified: { _: 80 },
  };

  let score;
  if (pg === 'yes') score = (MATRIX.yes[pval] !== undefined ? MATRIX.yes[pval] : 40);
  else score = 80;

  const PERIOD = {
    annual:     tech === 'wind' ? -5 : -3,
    rolling_2yr: tech === 'wind' ? 0  : 2,
    rolling_3yr: tech === 'wind' ? 3  : 5,
    not_specified: 3,
  };
  const RES    = { yes: -3, no: 8, not_specified: 5 };
  const REMEDY = { deemed_generation: -5, make_whole: -4, liquidated_damages: -2, none: 15, not_specified: 8 };
  const EXCESS = { buyer_receives_all: -3, capped: 3, clawback: 8, not_specified: 2 };
  const TRIGHT = { yes: -5, no: 8, not_specified: 5 };

  score += PERIOD[f.measurementPeriod || 'not_specified'] || 3;
  score += RES[f.resourceNormalized || 'not_specified'] || 5;
  score += REMEDY[f.shortfallRemedy || 'not_specified'] || 8;
  score += EXCESS[f.excessGenTreatment || 'not_specified'] || 2;
  score += TRIGHT[f.terminationRight || 'not_specified'] || 5;

  let flag = null;
  if (pg !== 'yes') flag = 'No energy production guarantee — buyer has no protection against plant underperformance.';

  return { score: clamp(score), flag };
}

/**
 * 17. permit — Permitting Status
 */
function scorePermit(f) {
  const BASE = { all_obtained: 5, major_obtained: 18, in_progress: 40, not_started: 70, not_specified: 65 };
  let score = BASE[f.permitStatus || 'not_specified'] || 65;

  const CP = { yes: -5, no: 5, not_specified: 3 };
  score += CP[f.permitAsCP || 'not_specified'] || 3;

  let flag = null;
  if (!f.permitStatus) flag = 'Permitting status not disclosed.';

  let cpFlag = null;
  if ((f.permitStatus === 'in_progress' || f.permitStatus === 'not_started') && f.permitAsCP !== 'yes') {
    cpFlag = 'Early-stage permitting not listed as condition precedent.';
  }

  return { score: clamp(score), flag, cpFlag };
}

/**
 * 18. cod — COD Definition
 */
function scoreCOD(f) {
  const BASE = { tight_objective: 8, moderate: 30, loose_substantial: 58, not_specified: 70 };
  let score = BASE[f.codDefinitionStrength || 'not_specified'] || 70;

  const CAP_T = f.capacityThreshold;
  if      (CAP_T != null && CAP_T === 100) score -= 5;
  else if (CAP_T != null && CAP_T >= 97)   score -= 3;
  else if (CAP_T != null && CAP_T >= 95)   score += 0;
  else if (CAP_T != null && CAP_T >= 90)   score += 5;
  else if (CAP_T != null)                  score += 10;
  else                                     score += 5;

  const PERF   = { full_capacity_demo: -5, nameplate_only: 3, none: 8, not_specified: 5 };
  const DOCS   = { comprehensive: -5, partial: 0, minimal: 5, not_specified: 5 };
  const VERIFY = { review_and_confirm: -5, notice_only: 2, seller_self_certifies: 7, not_specified: 5 };
  const IE     = { required: -5, optional: 0, none: 5, not_specified: 3 };
  const PART   = { not_allowed: -3, allowed_with_conditions: 2, allowed_unrestricted: 8, not_specified: 5 };

  score += PERF[f.performanceTest || 'not_specified'] || 5;
  score += DOCS[f.documentaryDeliverables || 'not_specified'] || 5;
  score += VERIFY[f.buyerVerificationRight || 'not_specified'] || 5;
  score += IE[f.independentEngineer || 'not_specified'] || 3;
  score += PART[f.partialCOD || 'not_specified'] || 5;

  let flag = null;
  if (!f.codDefinitionStrength) flag = 'COD definition not specified — seller controls when the contract clock starts.';

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 4: CREDIT & COLLATERAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 19. buyerpa — Buyer Performance Assurance
 */
function scoreBuyerPA(f) {
  const MATRIX = {
    ig: {
      unsecured: 5, parent_guaranty: 15, lc: 30, cash: 45,
      lc_plus_mtm: 55, cash_plus_mtm: 70, not_specified: 40,
    },
    non_ig: {
      unsecured: 20, parent_guaranty: 25, lc: 35, cash: 50,
      lc_plus_mtm: 55, cash_plus_mtm: 70, not_specified: 50,
    },
    not_specified: { not_specified: 60 },
  };

  const credit = f.buyerCreditRating || 'not_specified';
  const collat = f.collateralType    || 'not_specified';
  const row    = MATRIX[credit] || MATRIX['not_specified'];
  let score    = row[collat] !== undefined ? row[collat] : (row['not_specified'] || 60);

  // Collateral sizing (technology + coverage)
  const tech   = (f.technology || 'solar').toLowerCase();
  const cover  = f.coverageBasis || 'not_specified';
  const amt    = f.fixedAmountPerMW;
  if (amt != null) {
    let tier;
    if (tech === 'wind') {
      tier = cover === '6_months'
        ? [28500, 47500, 66500]
        : [57000, 95000, 133000];
    } else {
      tier = cover === '6_months'
        ? [22500, 37500, 52500]
        : [45000, 75000, 105000];
    }
    if      (amt <= tier[0]) score -= 5;
    else if (amt <= tier[1]) score += 0;
    else if (amt <= tier[2]) score += 5;
    else                     score += 10;
  } else { score += 3; }

  const DT  = { sub_ig_only: -3, multiple_tiers: 5, none: -5, not_specified: 3 };
  const DC  = { yes: -3, no: 5, not_specified: 3 };
  const TT  = { threshold: -5, independent_amount: 5, not_specified: 3 };
  score += DT[f.downgradeTrigger || 'not_specified'] || 3;

  const dcp = f.downgradeCurePeriod;
  if      (dcp != null && dcp >= 30) score -= 3;
  else if (dcp != null && dcp >= 15) score += 0;
  else if (dcp != null && dcp >= 10) score += 2;
  else if (dcp != null)              score += 5;
  else                               score += 3;

  const DS  = { guaranty_allowed: -3, lc_only: 0, cash_only: 5, not_specified: 3 };
  score += DS[f.downgradeSubstitution || 'not_specified'] || 3;
  score += TT[f.thresholdStructure || 'not_specified'] || 3;

  let flag = null;
  if (!f.collateralType) flag = 'Buyer credit support not defined.';

  return { score: clamp(score), flag };
}

/**
 * 20. sellerpa — Seller Performance Assurance
 */
function scoreSellerPA(f) {
  const MATRIX = {
    ig_sponsor_guaranty: { yes: 5,  no: 15 },
    sponsor_guaranty:    { yes: 12, no: 28 },
    lc:                  { yes: 18, no: 35 },
    cash:                { yes: 15, no: 32 },
    spv_only:            { yes: 55, no: 78 },
    not_specified:       { not_specified: 72 },
  };

  const preCOD = f.preCODCreditType || 'not_specified';
  const compG  = f.completionGuaranty || 'not_specified';
  const row    = MATRIX[preCOD] || MATRIX['not_specified'];
  let score    = row[compG] !== undefined ? row[compG] : (row['not_specified'] || 72);

  // Pre-COD sizing
  const tech = (f.technology || 'solar').toLowerCase();
  const preAmt = f.preCODSizingPerMW;
  if (preAmt != null) {
    const tiers = tech === 'wind'
      ? [158000, 75000, 27000, 15000]
      : [113000, 50000, 18000, 10000];
    if      (preAmt >= tiers[0]) score -= 5;
    else if (preAmt >= tiers[1]) score -= 3;
    else if (preAmt >= tiers[2]) score += 0;
    else if (preAmt >= tiers[3]) score += 5;
    else                         score += 10;
  } else { score += 5; }

  // Post-COD sizing
  const postAmt = f.postCODSizingPerMW;
  if (postAmt != null) {
    const ptiers = tech === 'wind'
      ? [95000, 57000, 25000, 5000]
      : [75000, 45000, 20000, 5000];
    if      (postAmt >= ptiers[0]) score -= 5;
    else if (postAmt >= ptiers[1]) score -= 3;
    else if (postAmt >= ptiers[2]) score += 0;
    else if (postAmt >= ptiers[3]) score += 2;
    else                           score += 5;
  } else { score += 3; }

  const SURV = { yes: -5, no: 8, not_specified: 5 };
  const POST = { ig_sponsor_guaranty: -5, sponsor_guaranty: -3, lc: -2, spv_only: 3, none: 5, not_specified: 3 };
  const STEP = { after_all_cod_tests: -3, at_cod: 0, at_mechanical_completion: 5, at_financial_close: 10, not_specified: 5 };
  const DT   = { yes: -3, no: 3, not_specified: 2 };

  score += SURV[f.creditSurvivesFinancing || 'not_specified'] || 5;
  score += POST[f.postCODCreditType || 'not_specified'] || 3;
  score += STEP[f.stepDownTiming || 'not_specified'] || 5;
  score += DT[f.downgradeTrigger || 'not_specified'] || 2;

  let flag = null;
  if (!f.preCODCreditType) flag = 'Seller credit support not defined — buyer has no visibility into credit backing the project.';

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 5: CONTRACT TERMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 21. assign — Assignment Rights
 */
function scoreAssign(f) {
  const BUYER = { free: 0, consent_not_unreasonably_withheld: 8, consent_required: 18, no_assignment: 30, not_specified: 25 };
  const SELLER = { no_assignment: 0, consent_required: 8, consent_not_unreasonably_withheld: 18, free: 35, not_specified: 20 };

  let score = (BUYER[f.buyerAssignRight || 'not_specified'] || 25) + (SELLER[f.sellerAssignRight || 'not_specified'] || 20);

  const BA = { permitted: -3, not_permitted: 3, not_specified: 2 };
  const SA = { permitted: 3, not_permitted: -3, not_specified: 2 };
  const LA = { permitted: 0, consent_required: 3, not_addressed: 5, not_specified: 3 };
  const AC = { must_meet_original_standards: -5, no_requirement: 5, not_specified: 3 };

  score += BA[f.buyerAffiliateTransfer || 'not_specified'] || 2;
  score += SA[f.sellerAffiliateTransfer || 'not_specified'] || 2;
  score += LA[f.lenderAssignment || 'not_specified'] || 3;
  score += AC[f.assigneeCreditRequirement || 'not_specified'] || 3;

  let flag = null;
  if (!f.buyerAssignRight) flag = 'Assignment provisions not defined.';

  return { score: clamp(score), flag };
}

/**
 * 22. fm — Force Majeure
 */
function scoreFM(f) {
  const MATRIX = {
    narrow_objective: { continue: 5, excused: 25, not_specified: 15 },
    moderate:         { continue: 20, excused: 40, not_specified: 32 },
    broad_subjective: { continue: 40, excused: 65, not_specified: 55 },
    not_specified:    { not_specified: 60 },
  };

  const scope   = f.fmDefinitionScope  || 'not_specified';
  const payment = f.paymentObligations || 'not_specified';
  const row = MATRIX[scope] || MATRIX['not_specified'];
  let score = row[payment] !== undefined ? row[payment] : (row['not_specified'] || 60);

  const SC  = { yes: -5, no: 7, not_specified: 4 };
  const EH  = { yes: -3, no: 8, not_specified: 4 };
  const EF  = { yes: -3, no: 5, not_specified: 3 };
  const TC  = { yes: -2, no: 5, not_specified: 3 };
  const PAN = { excluded: -3, performance_based_only: 0, broad_inclusion: 5, not_specified: 3 };
  const TR  = { buyer: -5, mutual: -2, seller: 5, none: 8, not_specified: 5 };
  const NOT = { prompt_with_mitigation: -3, notice_only: 0, none: 5, not_specified: 3 };
  const COD_EXT = { no: -5, limited: 0, automatic: 7, not_specified: 4 };

  score += SC[f.supplyChainExcluded || 'not_specified'] || 4;
  score += EH[f.economicHardshipExcluded || 'not_specified'] || 4;
  score += EF[f.equipmentFailureExcluded || 'not_specified'] || 3;
  score += TC[f.transmissionCongestionExcluded || 'not_specified'] || 3;
  score += PAN[f.pandemicTreatment || 'not_specified'] || 3;
  score += TR[f.terminationRight || 'not_specified'] || 5;
  score += NOT[f.notificationRequirement || 'not_specified'] || 3;
  score += COD_EXT[f.codExtensionForFM || 'not_specified'] || 4;

  const dur = f.fmDurationMonths;
  if      (dur != null && dur <= 12) score -= 5;
  else if (dur != null && dur <= 18) score -= 2;
  else if (dur != null && dur <= 24) score += 0;
  else if (dur != null)              score += 5;
  else                               score += 8;

  let flags = [];
  if (!f.fmDefinitionScope) flags.push('Force majeure not defined — broad FM weakens delay, availability, production guarantee, and curtailment provisions simultaneously.');
  if (f.economicHardshipExcluded === 'no') flags.push('Commercial impracticability included as FM.');
  if (f.equipmentFailureExcluded === 'no') flags.push('Equipment failure included as standalone FM.');
  if (f.transmissionCongestionExcluded === 'no') flags.push('Transmission congestion included as FM.');
  if (f.codExtensionForFM === 'automatic') flags.push('Automatic COD extension for any FM event.');
  if (f.terminationRight === 'none' && (dur == null || dur > 24)) flags.push('Open-ended FM with no termination right.');

  return { score: clamp(score), flag: flags[0] || null, flags };
}

/**
 * 23. eod — Events of Default
 */
function scoreEOD(f) {
  const MATRIX = {
    yes: { objective_test: 5, subjective: 18, none: 30, not_specified: 25 },
    no:  { objective_test: 30, subjective: 42, none: 65, not_specified: 55 },
    not_specified: { not_specified: 60 },
  };

  const longstop = f.longstopCODDefault || 'not_specified';
  const abandon  = f.abandonmentTrigger || 'not_specified';
  const row  = MATRIX[longstop] || MATRIX['not_specified'];
  let score  = row[abandon] !== undefined ? row[abandon] : (row['not_specified'] || 60);

  const PC  = f.paymentCureDays;
  if      (PC != null && PC <= 2)  score -= 3;
  else if (PC != null && PC <= 5)  score += 0;
  else if (PC != null && PC <= 10) score += 3;
  else if (PC != null)             score += 5;
  else                             score += 3;

  const CSC = f.creditSupportCureDays;
  if      (CSC != null && CSC <= 2)  score -= 3;
  else if (CSC != null && CSC <= 5)  score -= 1;
  else if (CSC != null && CSC <= 10) score += 0;
  else if (CSC != null)              score += 5;
  else                               score += 3;

  const MB = f.materialBreachCureDays;
  if      (MB != null && MB <= 30)  score -= 3;
  else if (MB != null && MB <= 60)  score += 0;
  else if (MB != null && MB <= 90)  score += 3;
  else if (MB != null)              score += 7;
  else                              score += 3;

  const CURE = { none: -3, limited: 0, unlimited_diligent_pursuit: 7, not_specified: 3 };
  const CD   = { broad: -5, limited: -2, none: 5, not_specified: 3 };
  const DG   = { no_collateral_posting: -3, yes_eod: 5, not_specified: 2 };
  const CF   = { yes: -3, no: 5, not_specified: 3 };
  const TRIG = { objective: -5, mixed: 0, subjective_mae: 7, not_specified: 4 };

  score += CURE[f.cureExtensionRight || 'not_specified'] || 3;
  score += CD[f.crossDefault || 'not_specified'] || 3;
  score += DG[f.downgradeAsEOD || 'not_specified'] || 2;
  score += CF[f.creditFailureAsEOD || 'not_specified'] || 3;
  score += TRIG[f.eodTriggerStandard || 'not_specified'] || 4;

  let flag = null;
  if (!f.longstopCODDefault) flag = 'Events of default not defined — buyer has no trigger to exit a non-performing deal.';

  return { score: clamp(score), flag };
}

/**
 * 24. eterm — Early Termination & Termination Payment
 */
function scoreETerm(f) {
  const MATRIX = {
    two_way_mtm:     { full_replacement_value: 5, return_of_security_only: 35, none: 55, not_specified: 30 },
    two_way_formula: { full_replacement_value: 12, return_of_security_only: 38, none: 58, not_specified: 35 },
    one_way_buyer_pays: { _: 75 },
    walk_away:          { _: 80 },
    not_specified:      { not_specified: 65 },
  };

  const struct  = f.terminationStructure  || 'not_specified';
  const preCOD  = f.preCODSellerPayment   || 'not_specified';
  const row = MATRIX[struct] || MATRIX['not_specified'];
  let score = row[preCOD] !== undefined ? row[preCOD] : (row['_'] || row['not_specified'] || 65);

  const CAP  = { uncapped: -5, fixed_cap: 3, capped_at_credit_support: 10, not_specified: 5 };
  const VAL  = { dealer_quotes: -5, objective_forward_curve: -3, independent_expert: -2, sole_discretion: 10, not_specified: 5 };
  const DISP = { independent_expert: -3, arbitration: -1, none: 5, not_specified: 3 };
  const DR   = { market_consistent: -3, contractually_defined_reasonable: 0, high_or_seller_determined: 5, not_specified: 3 };
  const GA   = { objective_capacity_factor: -3, historical_actual: -1, seller_determined: 5, not_specified: 3 };
  const CONS = { same_structure: -2, different: 3, not_specified: 2 };

  score += CAP[f.sellerPaymentCap || 'not_specified'] || 5;
  score += VAL[f.valuationMethod || 'not_specified'] || 5;
  score += DISP[f.disputeResolution || 'not_specified'] || 3;
  score += DR[f.discountRate || 'not_specified'] || 3;
  score += GA[f.generationAssumptions || 'not_specified'] || 3;
  score += CONS[f.preCODPostCODConsistency || 'not_specified'] || 2;

  let flags = [];
  if (!f.terminationStructure) flags.push('Termination payment not defined — this is the single biggest economic protection term.');
  if (struct === 'walk_away') flags.push('Walk-away termination — buyer has no recovery on early exit.');
  if (struct === 'one_way_buyer_pays') flags.push('One-way termination — buyer pays seller but not vice versa.');

  return { score: clamp(score), flag: flags[0] || null, flags };
}

/**
 * 25. changeinlaw — Change in Law
 */
function scoreChangeInLaw(f) {
  const MATRIX = {
    yes_regardless:          { seller_absorbs: 5,  relief_only_discriminatory: 15, strike_reprices: null, not_specified: 12 },
    relief_for_illegality_only:{ seller_absorbs: 10, relief_only_discriminatory: 22, strike_reprices: null, not_specified: 20 },
    reopener_defined_events: { seller_absorbs: 25, relief_only_discriminatory: 35, strike_reprices: 50, not_specified: 40 },
    strike_adjusts:          { seller_absorbs: 40, relief_only_discriminatory: 50, strike_reprices: 68, not_specified: 58 },
    not_specified:           { not_specified: 60 },
  };

  const sf = f.strikeFixed || 'not_specified';
  const tc = f.taxCreditTreatment || 'not_specified';
  const row = MATRIX[sf] || MATRIX['not_specified'];
  let score = (row[tc] !== null && row[tc] !== undefined) ? row[tc] : (row['not_specified'] || 60);

  const TAR  = { seller_absorbs: -3, not_change_in_law: -3, change_in_law_relief: 7, not_specified: 4 };
  const EIS  = { illegality_impossibility: -5, discriminatory_project_specific: -2, broad_material_adverse: 8, not_specified: 4 };
  const REOP = { none: -5, negotiate_then_terminate: 0, automatic_adjustment: 8, not_specified: 4 };
  const PRE  = { seller_obligated: -5, termination_if_illegal: 0, broad_relief: 7, not_specified: 4 };
  const POST = { illegality_only: -3, targeted_relief: 0, broad_relief: 5, not_specified: 3 };
  const FIN  = { excluded: -3, included: 7, not_specified: 4 };

  score += TAR[f.tariffTreatment || 'not_specified'] || 4;
  score += EIS[f.economicImpactStandard || 'not_specified'] || 4;
  score += REOP[f.reopenerMechanism || 'not_specified'] || 4;
  score += PRE[f.preCODProtection || 'not_specified'] || 4;
  score += POST[f.postCODProtection || 'not_specified'] || 3;
  score += FIN[f.financingTermsAsRelief || 'not_specified'] || 4;

  let flags = [];
  if (!f.strikeFixed) flags.push('Change in law not defined — critical gap in current IRA + tariff environment.');
  if (tc === 'strike_reprices') flags.push('Strike score should be interpreted as starting point — automatic repricing for tax credit changes.');
  if (f.tariffTreatment === 'change_in_law_relief') flags.push('Tariffs included as change-in-law relief — seller can reprice for tariff cost increases.');

  return { score: clamp(score), flag: flags[0] || null, flags };
}

/**
 * 26. reputation — Reputational Provisions
 */
function scoreReputation(f) {
  const BASE = { buyer_right: 10, mutual: 25, none: 55, not_specified: 50 };
  let score = BASE[f.reputationTerminationRight || 'not_specified'] || 50;

  const SCR = { comprehensive: -5, standard: 0, minimal: 3, none: 8, not_specified: 5 };
  const RED = { objective_defined: -3, subjective_buyer_discretion: -5, not_defined: 5, not_specified: 3 };
  const SAA = { buyer_approval_includes_reputation: -3, creditworthiness_only: 2, no_approval: 5, not_specified: 3 };
  const COP = { addressed: -3, not_addressed: 3, not_specified: 2 };

  score += SCR[f.sellerComplianceReps || 'not_specified'] || 5;
  score += RED[f.reputationEventDefinition || 'not_specified'] || 3;
  score += SAA[f.sellerAssignmentApproval || 'not_specified'] || 3;
  score += COP[f.communityOppositionProvision || 'not_specified'] || 2;

  let flag = null;
  if (!f.reputationTerminationRight) flag = 'No reputational provisions — buyer has no exit right for ESG violations or community opposition.';

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 6: ENVIRONMENTAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 27. product — Contracted Product Definition
 */
function scoreProduct(f) {
  const MATRIX = {
    all_conveyed:   { bundled: 5,  unbundled: 20, not_specified: 15 },
    partial_carveouts: { bundled: 35, unbundled: 50, not_specified: 45 },
    not_defined:    { bundled: 55, unbundled: 70, not_specified: 65 },
    not_specified:  { not_specified: 60 },
  };

  const ea = f.environmentalAttributes || 'not_specified';
  const bs = f.bundledStructure || 'not_specified';
  const row = MATRIX[ea] || MATRIX['not_specified'];
  let score = row[bs] !== undefined ? row[bs] : (row['not_specified'] || 60);

  const FUT  = { included: -5, excluded: 7, not_addressed: 5, not_specified: 4 };
  const PS   = { yes: -3, portfolio_generic: 3, not_specified: 2 };
  const CAT  = { buyer_shares: -5, seller_retains_explicit: 0, seller_retains_silent: 5, not_specified: 4 };
  const STH  = { yes: -3, no: 7, not_applicable: 0, not_specified: 4 };
  const ADD  = { new_build: -3, existing: 2, not_addressed: 3, not_specified: 2 };
  const SDC  = { clear_hub_node: -3, vague: 5, not_defined: 8, not_specified: 5 };

  score += FUT[f.futureAttributes || 'not_specified'] || 4;
  score += PS[f.projectSpecific || 'not_specified'] || 2;
  score += CAT[f.capacityAncillaryTreatment || 'not_specified'] || 4;
  score += STH[f.storageHybridAddressed || 'not_specified'] || 4;
  score += ADD[f.additionalityClaim || 'not_specified'] || 2;
  score += SDC[f.settlementDefinitionClarity || 'not_specified'] || 5;

  let flag = null;
  if (!f.environmentalAttributes) flag = 'Product not defined — buyer cannot assess what they\'re getting for the strike price.';

  return { score: clamp(score), flag };
}

/**
 * 28. recs — REC Delivery & Mechanics
 */
function scoreRECs(f) {
  const MATRIX = {
    yes: { same_tech_same_region: 5, same_region_any_renewable: 15, any_national_rec: 35, not_specified: 25 },
    cash_only: { _: 40 },
    none: { _: 72 },
    not_specified: { _: 65 },
  };

  const ro = f.replacementObligation || 'not_specified';
  const rq = f.replacementQuality    || 'not_specified';
  const row = MATRIX[ro] || MATRIX['not_specified'];
  let score = row[rq] !== undefined ? row[rq] : (row['_'] || row['not_specified'] || 65);

  const DEL  = { monthly: -5, quarterly: -3, annual: 0, long_lag: 5, not_specified: 3 };
  const VIN  = { strict_match: -3, loose_banking: 5, not_specified: 3 };
  const REG  = { yes_seller_transfers: -5, yes_buyer_responsible: 3, not_specified: 5 };
  const DAM  = { full_replacement_cost: -5, market_value_cash: -3, fixed_ld: 3, capped_below_market: 7, none: 10, not_specified: 5 };
  const FEES = { seller_pays: -2, buyer_pays: 2, not_specified: 1 };

  score += DEL[f.deliveryTiming || 'not_specified'] || 3;
  score += VIN[f.vintageMatching || 'not_specified'] || 3;
  score += REG[f.registryExplicit || 'not_specified'] || 5;
  score += DAM[f.shortfallDamages || 'not_specified'] || 5;
  score += FEES[f.transferFees || 'not_specified'] || 1;

  let flag = null;
  if (!f.replacementObligation) flag = 'REC mechanics not defined — buyer cannot guarantee annual decarbonization claims.';

  return { score: clamp(score), flag };
}

/**
 * 29. incentives — Tax Credits, Grants & Incentive Allocation
 */
function scoreIncentives(f) {
  const BASE = {
    buyer_shares_upside: 5,
    seller_retains_strike_reflects: 20,
    seller_retains_no_transparency: 50,
    not_specified: 55,
  };
  let score = BASE[f.taxCreditAllocation || 'not_specified'] || 55;

  const BONUS  = { reflected_in_strike: -5, shared: -3, seller_retains: 3, not_addressed: 5, not_specified: 4 };
  const TRANS  = { buyer_benefits: -5, shared: -3, seller_retains: 3, not_addressed: 5, not_specified: 4 };
  const INCR   = { buyer_shares: -5, seller_retains: 3, not_addressed: 5, not_specified: 4 };
  const STATE  = { reflected_in_strike: -3, shared: -2, seller_retains: 2, not_addressed: 4, not_specified: 3 };
  const TRANSP = { seller_discloses: -5, no_disclosure: 5, not_specified: 3 };

  score += BONUS[f.bonusCreditAllocation || 'not_specified'] || 4;
  score += TRANS[f.transferabilityValueSharing || 'not_specified'] || 4;
  score += INCR[f.incrementalIncentives || 'not_specified'] || 4;
  score += STATE[f.stateLocalIncentives || 'not_specified'] || 3;
  score += TRANSP[f.incentiveTransparency || 'not_specified'] || 3;

  let flag = null;
  if (!f.taxCreditAllocation) flag = 'Incentive allocation not defined — in the current IRA environment, undefined allocation likely means seller captures all upside.';

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY 7: LEGAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 30. govlaw — Governing Law & Dispute Resolution
 */
function scoreGovLaw(f) {
  const BASE = { new_york: 15, delaware: 18, buyer_home_state: 10, project_state: 30, other: 40, not_specified: 50 };
  let score = BASE[f.governingLaw || 'not_specified'] || 50;

  const DR   = { arbitration: -3, mediation_then_arbitration: -5, litigation: 0, mediation_then_litigation: -2, not_specified: 5 };
  const VEN  = { buyer_favorable: -5, neutral: 0, seller_favorable: 5, not_specified: 3 };
  const JURY = { yes: -3, no: 3, not_specified: 2 };
  const EXP  = { yes_for_technical: -5, no: 3, not_specified: 2 };

  score += DR[f.disputeResolution || 'not_specified'] || 5;
  score += VEN[f.venue || 'not_specified'] || 3;
  score += JURY[f.juryWaiver || 'not_specified'] || 2;
  score += EXP[f.expertDetermination || 'not_specified'] || 2;

  let flag = null;
  if (!f.governingLaw) flag = 'Governing law not defined — creates procedural uncertainty.';

  return { score: clamp(score), flag };
}

/**
 * 31. conf — Confidentiality Provisions
 */
function scoreConf(f) {
  const BASE = { narrow_pricing_only: 15, standard_all_terms: 30, broad_existence_included: 55, not_specified: 45 };
  let score = BASE[f.confScope || 'not_specified'] || 45;

  const ESG  = { explicit: -5, implied: -2, none: 8, not_specified: 5 };
  const REG  = { yes: -3, no: 5, not_specified: 3 };
  const AFF  = { permitted: -3, not_permitted: 3, not_specified: 2 };
  const SUR  = { two_years_or_less: -3, three_to_five_years: 0, indefinite: 5, not_specified: 3 };
  const MUT  = { mutual: -2, buyer_only: 5, not_specified: 3 };

  score += ESG[f.esgReportingCarveout || 'not_specified'] || 5;
  score += REG[f.regulatoryFilingCarveout || 'not_specified'] || 3;
  score += AFF[f.affiliateDisclosure || 'not_specified'] || 2;
  score += SUR[f.survivalPeriod || 'not_specified'] || 3;
  score += MUT[f.mutualObligation || 'not_specified'] || 3;

  let flag = null;
  if (!f.confScope) flag = 'Confidentiality not defined — clarify ESG reporting carveouts.';

  return { score: clamp(score), flag };
}

/**
 * 32. excl — Exclusivity Provisions
 */
function scoreExcl(f) {
  const BASE = { full_project_committed: 10, partial_project: 40, not_specified: 55 };
  let score = BASE[f.sellerOutputExclusivity || 'not_specified'] || 55;

  const BEXCL = { none: -5, limited_same_iso: 3, broad: 10, not_specified: 3 };
  const AEXCL = { all_to_buyer: -3, some_retained: 5, not_specified: 3 };
  const NEXCL = { none: 0, time_limited: 2, open_ended: 7, not_specified: 2 };

  score += BEXCL[f.buyerExclusivity || 'not_specified'] || 3;
  score += AEXCL[f.attributeExclusivity || 'not_specified'] || 3;
  score += NEXCL[f.negotiationExclusivity || 'not_specified'] || 2;

  let flag = null;
  if (!f.sellerOutputExclusivity) flag = 'Exclusivity not defined.';

  return { score: clamp(score), flag };
}

/**
 * 33. expenses — Transaction Expenses & Cost Allocation
 */
function scoreExpenses(f) {
  const BASE = { each_own: 20, shared: 30, buyer_bears: 60, not_specified: 35 };
  let score = BASE[f.legalFees || 'not_specified'] || 35;

  const ADMIN = { seller_bears: -5, shared: 0, buyer_bears: 5, not_specified: 3 };
  const REG   = { seller_pays: -3, shared: 0, buyer_pays: 3, not_specified: 2 };
  const IE    = { seller_bears: -5, shared: 0, buyer_bears: 5, not_specified: 3 };

  score += ADMIN[f.ongoingAdminCosts || 'not_specified'] || 3;
  score += REG[f.registryFees || 'not_specified'] || 2;
  score += IE[f.ieAndStudyCosts || 'not_specified'] || 3;

  let flag = null;
  if (!f.legalFees) flag = 'Expense allocation not defined — market standard is each party bears its own.';

  return { score: clamp(score), flag };
}

/**
 * 34. acct — Accounting & Tax Treatment
 */
function scoreAcct(f) {
  const BASE = { both_parties: 15, buyer_only: 30, none: 50, not_specified: 45 };
  let score = BASE[f.accountingRepresentations || 'not_specified'] || 45;

  const HEDGE = { supportive_structure: -5, neutral: 0, problematic_features: 10, not_specified: 3 };
  const TAX   = { mutual: -3, one_way_buyer: 5, none: 3, not_specified: 2 };
  const CHNG  = { no_relief: 0, reopener: -3, termination_right: -5, not_specified: 3 };

  score += HEDGE[f.hedgeAccountingLanguage || 'not_specified'] || 3;
  score += TAX[f.taxIndemnity || 'not_specified'] || 2;
  score += CHNG[f.changeInAccountingTreatment || 'not_specified'] || 3;

  let flag = null;
  if (!f.accountingRepresentations) flag = 'Accounting and tax not addressed — consult advisors for hedge accounting eligibility.';

  return { score: clamp(score), flag };
}

/**
 * 35. publicity — Public Announcements & Marketing
 */
function scorePublicity(f) {
  const BASE = { yes_mutual_approval: 15, notification_only: 35, no_restriction: 55, not_specified: 45 };
  let score = BASE[f.jointAnnouncementRequired || 'not_specified'] || 45;

  const BPR  = { broad_esg_marketing: -5, limited_with_approval: 0, restricted: 8, not_specified: 3 };
  const SBN  = { prohibited_without_consent: -5, permitted_with_notice: 2, unrestricted: 8, not_specified: 5 };
  const LOGO = { prior_written_consent: -3, permitted: 5, not_addressed: 5, not_specified: 3 };
  const APPR = { prior_written_consent: -3, reasonable_advance_notice: 0, no_process: 5, not_specified: 3 };

  score += BPR[f.buyerPublicityRight || 'not_specified'] || 3;
  score += SBN[f.sellerUseOfBuyerName || 'not_specified'] || 5;
  score += LOGO[f.logoTrademarkRestriction || 'not_specified'] || 3;
  score += APPR[f.approvalProcess || 'not_specified'] || 3;

  let flag = null;
  if (!f.jointAnnouncementRequired) flag = 'Publicity not defined — clarify buyer ESG marketing rights and seller brand use restrictions.';

  return { score: clamp(score), flag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS-TERM INTERACTION FLAGS
// ─────────────────────────────────────────────────────────────────────────────

function checkInteractions(scores, facts) {
  const flags = [];

  const s = scores;

  if (s.buyerpa != null && s.sellerpa != null && Math.abs(s.buyerpa - s.sellerpa) > 30)
    flags.push({ terms: ['buyerpa','sellerpa'], message: 'Significant asymmetry between buyer and seller credit support.' });

  if (s.eod < 25 && s.eterm > 50)
    flags.push({ terms: ['eod','eterm'], message: 'Strong default triggers but weak termination payment mechanics.' });

  if (s.eod > 50 && s.eterm < 25)
    flags.push({ terms: ['eod','eterm'], message: 'Strong termination mechanics but weak default triggers.' });

  if (s.fm > 50 && s.delay > 50)
    flags.push({ terms: ['fm','delay'], message: 'Broad FM combined with weak delay provisions — seller can excuse delays liberally.' });

  if (s.curtailment > 50 && s.nonecocurtail > 50 && s.basiscurtail > 50)
    flags.push({ terms: ['curtailment','nonecocurtail','basiscurtail'], message: 'Buyer bears majority of curtailment risk across all three categories — cumulative volume loss exposure is significant.' });

  if ((s.availmech < 50) !== (s.availguaranteed < 50))
    flags.push({ terms: ['availmech','availguaranteed'], message: 'Both mechanical availability and production guarantee needed — one without the other is incomplete protection.' });

  if (s.product < 25 && s.recs > 50)
    flags.push({ terms: ['product','recs'], message: 'Complete product definition but weak REC delivery mechanics.' });

  if (s.negprice > 60 && s.marketdisrupt > 60)
    flags.push({ terms: ['negprice','marketdisrupt'], message: 'Combined lack of negative price protection and market disruption provisions — unlimited bilateral exposure.' });

  if (s.floating > 55 && (facts.floating?.settlementType === 'nodal') && s.basis > 55)
    flags.push({ terms: ['floating','basis'], message: 'Nodal settlement with buyer bearing basis risk — double exposure.' });

  if (facts.changeinlaw?.strikeFixed === 'strike_adjusts')
    flags.push({ terms: ['changeinlaw','strike'], message: 'Strike score is a starting point only — change-in-law provisions allow price adjustment.' });

  if (s.sellerpa > 60 && facts.eod?.creditFailureAsEOD === 'yes')
    flags.push({ terms: ['sellerpa','eod'], message: 'Credit failure EOD exists but seller credit support is weak — trigger may be meaningless.' });

  return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENGINE — scoreAll
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score all 35 terms from structured facts object.
 *
 * @param {Object} facts - Structured facts from Haiku extraction
 * @returns {Object} { scores, termFlags, interactions, unusualProvisions, missingProtections }
 */
function scoreAll(facts) {
  const f = facts || {};

  // Shared context
  const ctx = {
    iso:        f.deal?.iso        || 'ERCOT',
    technology: f.deal?.technology || f.deal?.tech || 'Solar',
    assetType:  f.deal?.assetType  || 'new_build',
  };

  // Score each term
  const results = {
    strike:        scoreStrike({ ...ctx, ...f.strike }),
    floating:      scoreFloating(f.floating || {}),
    interval:      scoreInterval(f.interval || {}),
    negprice:      scoreNegPrice(f.negprice || {}),
    invoice:       scoreInvoice(f.invoice || {}),
    basis:         scoreBasis(f.basis || {}),
    marketdisrupt: scoreMarketDisrupt(f.marketdisrupt || {}),
    scheduling:    scoreScheduling(f.scheduling || {}),
    curtailment:   scoreCurtailment(f.curtailment || {}),
    nonecocurtail: scoreNonEcoCurtail(f.nonecocurtail || {}),
    basiscurtail:  scoreBasisCurtail(f.basiscurtail || {}),
    ia:            scoreIA(f.ia || {}),
    cp:            scoreCP(f.cp || {}),
    delay:         scoreDelay({ ...ctx, ...f.delay }),
    availmech:     scoreAvailMech({ ...ctx, ...f.availmech }),
    availguaranteed: scoreAvailGuaranteed({ ...ctx, ...f.availguaranteed }),
    permit:        scorePermit(f.permit || {}),
    cod:           scoreCOD(f.cod || {}),
    buyerpa:       scoreBuyerPA({ ...ctx, ...f.buyerpa }),
    sellerpa:      scoreSellerPA({ ...ctx, ...f.sellerpa }),
    assign:        scoreAssign(f.assign || {}),
    fm:            scoreFM(f.fm || {}),
    eod:           scoreEOD(f.eod || {}),
    eterm:         scoreETerm(f.eterm || {}),
    changeinlaw:   scoreChangeInLaw(f.changeinlaw || {}),
    reputation:    scoreReputation(f.reputation || {}),
    product:       scoreProduct(f.product || {}),
    recs:          scoreRECs(f.recs || {}),
    incentives:    scoreIncentives(f.incentives || {}),
    govlaw:        scoreGovLaw(f.govlaw || {}),
    conf:          scoreConf(f.conf || {}),
    excl:          scoreExcl(f.excl || {}),
    expenses:      scoreExpenses(f.expenses || {}),
    acct:          scoreAcct(f.acct || {}),
    publicity:     scorePublicity(f.publicity || {}),
  };

  // Extract flat scores and flags
  const scores = {};
  const termFlags = {};
  for (const [term, result] of Object.entries(results)) {
    if (result.score == null) {
      scores[term] = 50; // unsupported combo
    } else {
      scores[term] = result.score;
    }
    const flags = result.flags || (result.flag ? [result.flag] : []);
    if (flags.length > 0) termFlags[term] = flags;
  }

  // Cross-term interactions
  const interactions = checkInteractions(scores, f);

  return {
    scores,
    termFlags,
    interactions,
    _debug: { facts: f }
  };
}

// Export for Node (Netlify functions) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { scoreAll, scoreStrike, STRIKE_THRESHOLDS };
} else {
  window.ScoringEngine = { scoreAll, scoreStrike, STRIKE_THRESHOLDS };
}
