import { convertCurrency } from './fx';

export const TARGET_MARGINS = [0.10, 0.15, 0.20, 0.30, 0.40];
export const SUGGESTED_MARGINS = [0, 0.10, 0.15, 0.20, 0.30, 0.40];

export async function calculateRows({ supplier, market, processors, displayCurrency, opexPercent, bundleOverrides }) {
  if (!supplier || !market || !displayCurrency) return [];

  const activeProcessors = processors.filter(p => p.active);
  const rows = [];

  for (let qty = 1; qty <= 5; qty++) {
    const override = bundleOverrides?.[qty] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * qty);
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
      qty,
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

export async function calculateSuggestedPrices({ supplier, market, processors, opexPercent, bundleOverrides }) {
  if (!supplier || !market) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const opexRate = Number(opexPercent || 0) / 100;
  const output = [];

  for (let qty = 1; qty <= 5; qty++) {
    const override = bundleOverrides?.[qty] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * qty);
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

    output.push({ qty, cogsSelling, suggestions });
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

export async function calculateUpsell({ supplier, market, processors, bundleOverrides, offers }) {
  if (!supplier || !market || !Array.isArray(offers)) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const output = [];

  for (const offer of offers) {
    const qty = Math.max(1, Number(offer.qty) || 1);
    const price = Number(offer.price) || 0;
    const srp = Number(offer.srp) || 0;
    const override = bundleOverrides?.[qty] || {};
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * qty);
    const cogsSelling = await convertCurrency(cogsInput, supplier.currency, market.selling_currency);

    const fee = price * feeProfile.variableRate + feeProfile.fixedFeeSelling;
    const netProfit = price - cogsSelling - fee;
    const margin = price > 0 ? (netProfit / price) * 100 : 0;
    const discountPct = srp > 0 ? ((srp - price) / srp) * 100 : 0;

    output.push({
      id: offer.id,
      label: offer.label || `${qty}x offer`,
      qty,
      price,
      srp,
      cogsSelling,
      fee,
      netProfit,
      margin,
      discountPct
    });
  }

  return output;
}

export async function calculateAbandoned({ supplier, market, processors, bundleOverrides, discountTiers }) {
  if (!supplier || !market) return [];

  const activeProcessors = processors.filter(p => p.active);
  const feeProfile = await averageProcessorFeeProfile({
    processors: activeProcessors,
    sellingCurrency: market.selling_currency,
    payoutCurrency: market.payout_currency
  });

  const variableRate = feeProfile.variableRate;
  const fixedFee = feeProfile.fixedFeeSelling;
  const tiers = Array.isArray(discountTiers) ? discountTiers : [];
  const output = [];

  for (let qty = 1; qty <= 5; qty++) {
    const override = bundleOverrides?.[qty] || {};
    const aov = numberOrDefault(override.aov, 0);
    const cogsInput = numberOrDefault(override.cogs, Number(supplier.cost_per_unit || 0) * qty);
    const cogsSelling = await convertCurrency(cogsInput, supplier.currency, market.selling_currency);

    const feeFull = aov * variableRate + fixedFee;
    const contribution = aov - cogsSelling - feeFull;
    const contributionPct = aov > 0 ? (contribution / aov) * 100 : 0;

    const breakEvenRevenue = (1 - variableRate) > 0 ? (cogsSelling + fixedFee) / (1 - variableRate) : 0;
    const breakEvenDiscount = aov > 0 ? (1 - breakEvenRevenue / aov) * 100 : 0;

    const tierResults = tiers.map(d => {
      const discount = Number(d) || 0;
      const revenue = aov * (1 - discount / 100);
      const fee = revenue * variableRate + fixedFee;
      const profit = revenue - cogsSelling - fee;
      const marginPct = revenue > 0 ? (profit / revenue) * 100 : 0;
      return { discount, revenue, profit, marginPct };
    });

    output.push({
      qty,
      aov,
      cogsSelling,
      feeFull,
      contribution,
      contributionPct,
      breakEvenDiscount,
      tiers: tierResults
    });
  }

  return output;
}
