import { convertCurrency, getLatestRate } from './fx';

export const TARGET_MARGINS = [0.10, 0.15, 0.20, 0.30, 0.40];
export const SUGGESTED_MARGINS = [0, 0.10, 0.15, 0.20, 0.30, 0.40];

// Straight unit-count bundles (1x-6x). "units" drives both the label and the
// default COGS (cost_per_unit * units) when no manual override is entered.
export const STRAIGHT_BUNDLES = [1, 2, 3, 4, 5, 6].map(q => ({ id: String(q), label: `${q}x`, units: q }));

// "Buy X get Y free" style offers. units = total items shipped (paid + free),
// which is what COGS is based on, since you still have to source/ship the free units.
export const OFFER_BUNDLES = [
  { id: '1', label: '1x', units: 1 },
  { id: '1+1', label: '1+1x', units: 2 },
  { id: '2+1', label: '2+1x', units: 3 },
  { id: '2+2', label: '2+2x', units: 4 },
  { id: '3+1', label: '3+1x', units: 4 },
  { id: '3+2', label: '3+2x', units: 5 },
  { id: '3+3', label: '3+3x', units: 6 }
];

export const BUNDLE_MODES = { straight: STRAIGHT_BUNDLES, bundle: OFFER_BUNDLES };

export const DEFAULT_BUNDLES = STRAIGHT_BUNDLES;

export async function calculateRows({ supplier, market, processors, displayCurrency, opexPercent, bundleOverrides, bundles = DEFAULT_BUNDLES }) {
  if (!supplier || !market || !displayCurrency) return [];

  const activeProcessors = processors.filter(p => p.active);
  const rows = [];

  for (const bundle of bundles) {
    const { id, label, units } = bundle;
    const override = bundleOverrides?.[id] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * units);
    const aovInput = numberOrDefault(override.aov, 0);

    const cogsDisplay = await convertCurrency(cogsInput, supplier.currency, displayCurrency);
    const aovDisplay = await convertCurrency(aovInput, market.selling_currency, displayCurrency);

    const feeDisplay = await averageProcessorFee({
      processors: activeProcessors,
      aov: aovInput,
      sellingCurrency: market.selling_currency,
      payoutCurrency: market.payout_currency,
      displayCurrency
    });

    const netSales = aovDisplay - feeDisplay;
    const grossProfit = netSales - cogsDisplay;
    const opex = aovDisplay * (Number(opexPercent || 0) / 100);
    const preAdProfit = grossProfit - opex;
    const ber = safeDivide(aovDisplay, preAdProfit);

    const targets = TARGET_MARGINS.map(margin => {
      const cpp = preAdProfit - (netSales * margin);
      return {
        margin,
        targetCpp: cpp,
        targetRoas: safeDivide(aovDisplay, cpp)
      };
    });

    rows.push({
      id,
      label,
      units,
      qty: units,
      cogsInput,
      aovInput,
      cogsDisplay,
      aovDisplay,
      feeDisplay,
      netSales,
      grossProfit,
      grossProfitPct: safeDivide(grossProfit, netSales) * 100,
      opex,
      preAdProfit,
      preAdProfitPct: safeDivide(preAdProfit, netSales) * 100,
      ber,
      targets
    });
  }

  return rows;
}

export async function calculateSuggestedPrices({ supplier, market, processors, opexPercent, bundleOverrides, bundles = DEFAULT_BUNDLES }) {
  if (!supplier || !market) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const opexRate = Number(opexPercent || 0) / 100;
  const output = [];

  for (const bundle of bundles) {
    const { id, label, units } = bundle;
    const override = bundleOverrides?.[id] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * units);
    const cogsSelling = await convertCurrency(cogsInput, supplier.currency, market.selling_currency);

    const suggestions = SUGGESTED_MARGINS.map(margin => {
      const denominator = ((1 - margin) * (1 - feeProfile.variableRate)) - opexRate;
      const numerator = cogsSelling + ((1 - margin) * feeProfile.fixedFeeSelling);
      const price = denominator > 0 ? numerator / denominator : 0;

      return {
        margin,
        price: roundToCents(price)
      };
    });

    output.push({ id, label, units, qty: units, cogsSelling, suggestions });
  }

  return output;
}

async function averageProcessorFee({ processors, aov, sellingCurrency, payoutCurrency, displayCurrency }) {
  if (!processors.length || !Number(aov)) return 0;
  let total = 0;

  for (const p of processors) {
    const aovDisplay = await convertCurrency(aov, sellingCurrency, displayCurrency);
    const fixedDisplay = await convertCurrency(Number(p.fixed_fee || 0), p.fixed_fee_currency || displayCurrency, displayCurrency);
    const processing = aovDisplay * (Number(p.percent_fee || 0) / 100) + fixedDisplay;
    const conversion = sellingCurrency !== payoutCurrency
      ? aovDisplay * (Number(p.conversion_fee_percent || 0) / 100)
      : 0;
    total += processing + conversion;
  }

  return total / processors.length;
}

async function averageProcessorFeeProfile({ processors, sellingCurrency, payoutCurrency }) {
  if (!processors.length) return { variableRate: 0, fixedFeeSelling: 0 };

  let variableRate = 0;
  let fixedFeeSelling = 0;

  for (const p of processors) {
    const processingRate = Number(p.percent_fee || 0) / 100;
    const conversionRate = sellingCurrency !== payoutCurrency
      ? Number(p.conversion_fee_percent || 0) / 100
      : 0;
    variableRate += processingRate + conversionRate;
    fixedFeeSelling += await convertCurrency(Number(p.fixed_fee || 0), p.fixed_fee_currency || sellingCurrency, sellingCurrency);
  }

  return {
    variableRate: variableRate / processors.length,
    fixedFeeSelling: fixedFeeSelling / processors.length
  };
}

function numberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== '' && value !== null && value !== undefined ? parsed : fallback;
}

function safeDivide(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return 0;
  return a / b;
}

function roundToCents(value) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.round(value * 100) / 100;
}

export async function calculateUpsell({ supplier, market, processors, displayCurrency, bundleOverrides, offers }) {
  if (!supplier || !market || !Array.isArray(offers)) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const displayCur = displayCurrency || market.selling_currency;
  const sellingToDisplay = await getLatestRate(market.selling_currency, displayCur);
  const fixedFeeDisplay = feeProfile.fixedFeeSelling * sellingToDisplay;
  const output = [];

  for (const offer of offers) {
    const qty = Math.max(1, Number(offer.qty) || 1);
    const priceSelling = Number(offer.price) || 0;
    const srpSelling = Number(offer.srp) || 0;
    const override = bundleOverrides?.[qty] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * qty);
    const cogsDisplay = await convertCurrency(cogsInput, supplier.currency, displayCur);

    const price = priceSelling * sellingToDisplay;
    const srp = srpSelling * sellingToDisplay;
    const fee = price * feeProfile.variableRate + fixedFeeDisplay;
    const netProfit = price - cogsDisplay - fee;
    const margin = price > 0 ? (netProfit / price) * 100 : 0;
    const discountPct = srpSelling > 0 ? ((srpSelling - priceSelling) / srpSelling) * 100 : 0;

    output.push({
      id: offer.id,
      label: offer.label || `${qty}x offer`,
      qty,
      currency: displayCur,
      price,
      srp,
      cogsSelling: cogsDisplay,
      fee,
      netProfit,
      margin,
      discountPct
    });
  }

  return output;
}

export async function calculateAbandoned({ supplier, market, processors, displayCurrency, bundleOverrides, discountTiers, bundles = DEFAULT_BUNDLES }) {
  if (!supplier || !market) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const variableRate = feeProfile.variableRate;
  const displayCur = displayCurrency || market.selling_currency;
  const sellingToDisplay = await getLatestRate(market.selling_currency, displayCur);
  const fixedFee = feeProfile.fixedFeeSelling * sellingToDisplay;
  const tiers = Array.isArray(discountTiers) ? discountTiers : [];
  const output = [];

  for (const bundle of bundles) {
    const { id, label, units } = bundle;
    const override = bundleOverrides?.[id] || {};
    const aov = numberOrDefault(override.aov, 0) * sellingToDisplay;
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * units);
    const cogsDisplay = await convertCurrency(cogsInput, supplier.currency, displayCur);

    const feeFull = aov * variableRate + fixedFee;
    const contribution = aov - cogsDisplay - feeFull;
    const contributionPct = aov > 0 ? (contribution / aov) * 100 : 0;

    const breakEvenRevenue = (1 - variableRate) > 0 ? (cogsDisplay + fixedFee) / (1 - variableRate) : 0;
    const breakEvenDiscount = aov > 0 ? (1 - breakEvenRevenue / aov) * 100 : 0;

    const tierResults = tiers.map(d => {
      const discount = Number(d) || 0;
      const revenue = aov * (1 - discount / 100);
      const fee = revenue * variableRate + fixedFee;
      const profit = revenue - cogsDisplay - fee;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      return { discount, revenue, profit, marginPct };
    });

    output.push({
      id,
      label,
      units,
      qty: units,
      currency: displayCur,
      aov,
      cogsSelling: cogsDisplay,
      feeFull,
      contribution,
      contributionPct,
      breakEvenDiscount,
      tiers: tierResults
    });
  }

  return output;
}
