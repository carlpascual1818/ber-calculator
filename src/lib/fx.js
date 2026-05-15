const memoryCache = new Map();

export async function convertCurrency(amount, from, to) {
  const value = Number(amount || 0);
  if (!Number.isFinite(value)) return 0;
  if (!from || !to || from === to) return value;

  const key = `${from}_${to}`;
  if (memoryCache.has(key)) return value * memoryCache.get(key);

  const res = await fetch(`https://api.frankfurter.app/latest?amount=1&from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`FX lookup failed for ${from} to ${to}`);
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (!rate) throw new Error(`FX rate missing for ${from} to ${to}`);
  memoryCache.set(key, rate);
  return value * rate;
}

export async function getLatestRate(from, to) {
  if (!from || !to || from === to) return 1;
  const converted = await convertCurrency(1, from, to);
  return converted;
}
