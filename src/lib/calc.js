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
