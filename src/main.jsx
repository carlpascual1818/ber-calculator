import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Trash2, Save, RefreshCcw, LogOut, Database, Store, CreditCard, Package, Calculator, FolderOpen, Lightbulb, AlertTriangle, CheckCircle2, Settings, TrendingUp, ShoppingCart } from 'lucide-react';
import { supabase, hasSupabase } from './lib/supabase';
import { calculateRows, calculateSuggestedPrices, calculateUpsell, calculateAbandoned, TARGET_MARGINS, SUGGESTED_MARGINS, BUNDLE_MODES } from './lib/calc';
import './styles.css';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'HKD', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'ILS', 'JPY'];

const DEFAULT_STATUS_RULES = [
  { id: 'rule-healthy', label: 'Healthy test', level: 'good', minBer: 0, maxBer: 1.40, text: 'Good room for cold testing. The bundle has enough room to absorb normal early learning noise.' },
  { id: 'rule-workable', label: 'Workable, watch CPP', level: 'ok', minBer: 1.41, maxBer: 1.80, text: 'Testable, but not comfortable. Watch CPP early and avoid scaling unless the creative is already showing signal.' },
  { id: 'rule-tight', label: 'Tight economics', level: 'warn', minBer: 1.81, maxBer: 2.40, text: 'Risky for cold testing. Improve price, COGS, fees, or use this mainly as an upsell/bundle after the main offer proves itself.' },
  { id: 'rule-hard', label: 'Hard to test cold', level: 'bad', minBer: 2.41, maxBer: 999, text: 'BEROAS is too high for a normal cold test. Fix the economics before spending hard, unless you already have proven creatives or very warm traffic.' }
];

const RECOMMENDATION_LEVELS = [
  { value: 'good', label: 'Green' },
  { value: 'ok', label: 'Blue' },
  { value: 'warn', label: 'Yellow' },
  { value: 'bad', label: 'Red' },
  { value: 'neutral', label: 'Grey' }
];

const DEFAULT_UPSELL_OFFERS = [
  { id: 'upsell-3x', label: '3x upsell', qty: 3, price: 29.95, srp: 44.95 },
  { id: 'upsell-1x', label: '1x downsell', qty: 1, price: 12.95, srp: 24.95 }
];

const DEFAULT_DISCOUNT_TIERS = [10, 15];

function loadStored(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

const seed = {
  suppliers: [{ id: 'local-supplier-1', name: 'Default Supplier', cost_per_unit: 9.25, currency: 'USD', local: true }],
  processors: [{ id: 'local-processor-1', name: 'Shopify Payments', percent_fee: 3.9, fixed_fee: 2.33, fixed_fee_currency: 'HKD', conversion_fee_percent: 2, active: true, local: true }],
  markets: [{ id: 'local-market-1', name: 'Default Market', selling_currency: 'GBP', payout_currency: 'HKD', local: true }],
  pricePresets: [
    { id: 'local-preset-gbp', name: 'Default GBP SRP', currency: 'GBP', prices: { 1: 24.95, 2: 34.95, 3: 44.95, 4: 54.95, 5: 64.95 }, local: true },
    { id: 'local-preset-eur', name: 'Default EUR SRP', currency: 'EUR', prices: { 1: 29.95, 2: 39.95, 3: 49.95, 4: 59.95, 5: 69.95 }, local: true }
  ],
  scenarios: []
};

function App() {
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const [suppliers, setSuppliers] = useState([]);
  const [processors, setProcessors] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [pricePresets, setPricePresets] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [opexPercent, setOpexPercent] = useState(5.5);
  const [scenarioName, setScenarioName] = useState('Default Scenario');
  const [bundleOverrides, setBundleOverrides] = useState({});
  const [pricingMode, setPricingMode] = useState(() => loadStored('ber_pricing_mode', 'straight'));
  const [activeBundleIds, setActiveBundleIds] = useState(() => loadStored('ber_active_bundles', {}));
  const [customBundles, setCustomBundles] = useState(() => loadStored('ber_custom_bundles', { straight: [], bundle: [] }));
  const [newBundlePaid, setNewBundlePaid] = useState('');
  const [newBundleFree, setNewBundleFree] = useState('');
  const [rows, setRows] = useState([]);
  const [suggestedPrices, setSuggestedPrices] = useState([]);
  const [upsellOffers, setUpsellOffers] = useState(() => loadStored('ber_upsell_offers', DEFAULT_UPSELL_OFFERS));
  const [discountTiers, setDiscountTiers] = useState(() => loadStored('ber_abandoned_tiers', DEFAULT_DISCOUNT_TIERS));
  const [upsellRows, setUpsellRows] = useState([]);
  const [abandonedRows, setAbandonedRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState('calculator');
  const autoSrpAppliedRef = useRef('');
  const [recommendationRules, setRecommendationRules] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('ber_recommendation_rules')) || DEFAULT_STATUS_RULES;
    } catch {
      return DEFAULT_STATUS_RULES;
    }
  });

  useEffect(() => {
    if (!hasSupabase) {
      loadLocal();
      return;
    }
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => setSession(newSession));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!hasSupabase || session) loadData();
  }, [session]);

  const allBundlesForMode = useMemo(() => {
    const base = BUNDLE_MODES[pricingMode] || BUNDLE_MODES.straight;
    const custom = customBundles[pricingMode] || [];
    return [...base, ...custom];
  }, [pricingMode, customBundles]);
  const bundles = useMemo(() => {
    const active = activeBundleIds[pricingMode];
    if (!active || !active.length) return allBundlesForMode;
    const filtered = allBundlesForMode.filter(b => active.includes(b.id));
    return filtered.length ? filtered : allBundlesForMode;
  }, [allBundlesForMode, activeBundleIds, pricingMode]);

  function changePricingMode(mode) {
    setPricingMode(mode);
    localStorage.setItem('ber_pricing_mode', JSON.stringify(mode));
  }

  function toggleBundleActive(id) {
    setActiveBundleIds(prev => {
      const current = prev[pricingMode] || allBundlesForMode.map(b => b.id);
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      const updated = { ...prev, [pricingMode]: next };
      localStorage.setItem('ber_active_bundles', JSON.stringify(updated));
      return updated;
    });
  }

  function addCustomBundle() {
    const paid = Math.max(0, Math.floor(Number(newBundlePaid) || 0));
    const free = Math.max(0, Math.floor(Number(newBundleFree) || 0));
    if (paid <= 0 && free <= 0) return;
    const units = paid + free;
    const label = free > 0 ? `${paid}+${free}x` : `${paid}x`;
    const id = `custom-${paid}-${free}-${Date.now()}`;
    if (allBundlesForMode.some(b => b.label === label)) { setNewBundlePaid(''); setNewBundleFree(''); return; }
    setCustomBundles(prev => {
      const updated = { ...prev, [pricingMode]: [...(prev[pricingMode] || []), { id, label, units }] };
      localStorage.setItem('ber_custom_bundles', JSON.stringify(updated));
      return updated;
    });
    setNewBundlePaid('');
    setNewBundleFree('');
  }

  function removeCustomBundle(id) {
    setCustomBundles(prev => {
      const updated = { ...prev, [pricingMode]: (prev[pricingMode] || []).filter(b => b.id !== id) };
      localStorage.setItem('ber_custom_bundles', JSON.stringify(updated));
      return updated;
    });
    setActiveBundleIds(prev => {
      const current = prev[pricingMode];
      if (!current) return prev;
      const updated = { ...prev, [pricingMode]: current.filter(x => x !== id) };
      localStorage.setItem('ber_active_bundles', JSON.stringify(updated));
      return updated;
    });
  }

  const supplier = useMemo(() => suppliers.find(s => s.id === selectedSupplierId), [suppliers, selectedSupplierId]);
  const market = useMemo(() => markets.find(m => m.id === selectedMarketId), [markets, selectedMarketId]);
  const activeProcessorCount = processors.filter(p => p.active).length;
  const matchingPricePresets = useMemo(() => pricePresets.filter(p => p.currency === (market?.selling_currency || 'GBP')), [pricePresets, market]);
  const defaultPricePreset = useMemo(() => matchingPricePresets[0], [matchingPricePresets]);
  const recommendations = useMemo(() => buildRecommendations(rows, recommendationRules), [rows, recommendationRules]);


  useEffect(() => {
    if (!market?.selling_currency || !defaultPricePreset) return;
    const signature = `${market.id || 'market'}:${market.selling_currency}:${defaultPricePreset.id}`;
    if (autoSrpAppliedRef.current === signature) return;
    autoSrpAppliedRef.current = signature;
    setBundleOverrides(prev => {
      const next = { ...prev };
      for (const b of bundles) {
        const presetPrice = defaultPricePreset.prices?.[b.id];
        if (presetPrice === undefined || presetPrice === null || presetPrice === '') continue;
        next[b.id] = { ...(next[b.id] || {}), aov: String(presetPrice) };
      }
      return next;
    });
  }, [market?.id, market?.selling_currency, defaultPricePreset?.id, bundles]);

  useEffect(() => {
    let active = true;
    Promise.all([
      calculateRows({ supplier, market, processors, displayCurrency, opexPercent, bundleOverrides, bundles }),
      calculateSuggestedPrices({ supplier, market, processors, opexPercent, bundleOverrides, bundles })
    ])
      .then(([resultRows, resultSuggestions]) => {
        if (active) {
          setRows(resultRows);
          setSuggestedPrices(resultSuggestions);
        }
      })
      .catch(err => setMessage(err.message));
    return () => { active = false; };
  }, [supplier, market, processors, displayCurrency, opexPercent, bundleOverrides, bundles]);

  useEffect(() => {
    let active = true;
    Promise.all([
      calculateUpsell({ supplier, market, processors, displayCurrency, bundleOverrides, offers: upsellOffers }),
      calculateAbandoned({ supplier, market, processors, displayCurrency, bundleOverrides, discountTiers, bundles })
    ])
      .then(([upsell, abandoned]) => {
        if (active) {
          setUpsellRows(upsell);
          setAbandonedRows(abandoned);
        }
      })
      .catch(err => setMessage(err.message));
    return () => { active = false; };
  }, [supplier, market, processors, displayCurrency, bundleOverrides, upsellOffers, discountTiers, bundles]);

  async function handleAuth(e) {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const fn = authMode === 'signUp' ? supabase.auth.signUp : supabase.auth.signInWithPassword;
      const { error } = await fn.call(supabase.auth, { email, password });
      if (error) throw error;
      setMessage(authMode === 'signUp' ? 'Account created. Check email if confirmation is enabled.' : 'Signed in.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadData() {
    if (!hasSupabase) return loadLocal();
    setBusy(true);
    setMessage('');
    try {
      const [s, p, m, sc] = await Promise.all([
        supabase.from('suppliers').select('*').order('created_at'),
        supabase.from('payment_processors').select('*').order('created_at'),
        supabase.from('markets').select('*').order('created_at'),
        supabase.from('scenarios').select('*').order('created_at', { ascending: false })
      ]);
      const presetsResult = await supabase.from('price_presets').select('*').order('created_at');
      for (const result of [s, p, m, sc]) if (result.error) throw result.error;
      setSuppliers(s.data.length ? s.data : seed.suppliers);
      setProcessors(p.data.length ? p.data : seed.processors);
      setMarkets(m.data.length ? m.data : seed.markets);
      setScenarios(sc.data || []);
      setPricePresets(presetsResult.error ? seed.pricePresets : (presetsResult.data.length ? presetsResult.data : seed.pricePresets));
      setSelectedSupplierId((s.data[0] || seed.suppliers[0]).id);
      setSelectedMarketId((m.data[0] || seed.markets[0]).id);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  function loadLocal() {
    const saved = JSON.parse(localStorage.getItem('ber_local_data') || 'null') || seed;
    setSuppliers(saved.suppliers);
    setProcessors(saved.processors);
    setMarkets(saved.markets);
    setScenarios(saved.scenarios || []);
    setPricePresets(saved.pricePresets || seed.pricePresets);
    setSelectedSupplierId(saved.suppliers[0]?.id || '');
    setSelectedMarketId(saved.markets[0]?.id || '');
  }

  function saveLocal(next) {
    if (hasSupabase) return;
    const data = { suppliers, processors, markets, scenarios, pricePresets, ...next };
    localStorage.setItem('ber_local_data', JSON.stringify(data));
  }

  async function addSupplier() {
    const item = { name: 'New Supplier', cost_per_unit: 0, currency: 'USD' };
    if (hasSupabase) {
      const { data, error } = await supabase.from('suppliers').insert(item).select().single();
      if (error) return setMessage(error.message);
      setSuppliers([...suppliers, data]);
      setSelectedSupplierId(data.id);
    } else {
      const data = { ...item, id: crypto.randomUUID(), local: true };
      const next = [...suppliers, data]; setSuppliers(next); setSelectedSupplierId(data.id); saveLocal({ suppliers: next });
    }
  }

  async function addProcessor() {
    const item = { name: 'New Processor', percent_fee: 0, fixed_fee: 0, fixed_fee_currency: 'USD', conversion_fee_percent: 0, active: true };
    if (hasSupabase) {
      const { data, error } = await supabase.from('payment_processors').insert(item).select().single();
      if (error) return setMessage(error.message);
      setProcessors([...processors, data]);
    } else {
      const data = { ...item, id: crypto.randomUUID(), local: true };
      const next = [...processors, data]; setProcessors(next); saveLocal({ processors: next });
    }
  }

  async function addMarket() {
    const item = { name: 'New Market', selling_currency: 'GBP', payout_currency: 'HKD' };
    if (hasSupabase) {
      const { data, error } = await supabase.from('markets').insert(item).select().single();
      if (error) return setMessage(error.message);
      setMarkets([...markets, data]);
      setSelectedMarketId(data.id);
    } else {
      const data = { ...item, id: crypto.randomUUID(), local: true };
      const next = [...markets, data]; setMarkets(next); setSelectedMarketId(data.id); saveLocal({ markets: next });
    }
  }

  async function updateEntity(table, list, setter, id, patch) {
    const next = list.map(x => x.id === id ? { ...x, ...patch } : x);
    setter(next);
    saveLocal({ [table === 'payment_processors' ? 'processors' : table]: next });
    if (hasSupabase) {
      const { error } = await supabase.from(table).update(patch).eq('id', id);
      if (error) setMessage(error.message);
    }
  }

  async function removeEntity(table, list, setter, id) {
    const next = list.filter(x => x.id !== id);
    setter(next);
    saveLocal({ [table === 'payment_processors' ? 'processors' : table]: next });
    if (hasSupabase) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) setMessage(error.message);
    }
  }


  async function addPricePreset() {
    const currency = market?.selling_currency || 'GBP';
    const item = { name: `New ${currency} SRP`, currency, prices: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    if (hasSupabase) {
      const { data, error } = await supabase.from('price_presets').insert(item).select().single();
      if (error) return setMessage('Price presets table is missing. Run the price_presets migration SQL once, then try again.');
      setPricePresets([...pricePresets, data]);
    } else {
      const data = { ...item, id: crypto.randomUUID(), local: true };
      const next = [...pricePresets, data]; setPricePresets(next); saveLocal({ pricePresets: next });
    }
  }

  async function updatePricePreset(id, patch) {
    const next = pricePresets.map(x => x.id === id ? { ...x, ...patch } : x);
    setPricePresets(next);
    saveLocal({ pricePresets: next });
    if (hasSupabase) {
      const { error } = await supabase.from('price_presets').update(patch).eq('id', id);
      if (error) setMessage('Price presets table is missing. Run the price_presets migration SQL once, then try again.');
    }
  }

  async function removePricePreset(id) {
    const next = pricePresets.filter(x => x.id !== id);
    setPricePresets(next);
    saveLocal({ pricePresets: next });
    if (hasSupabase) {
      const { error } = await supabase.from('price_presets').delete().eq('id', id);
      if (error) setMessage(error.message);
    }
  }

  function applyPricePreset(preset) {
    setBundleOverrides(prev => {
      const next = { ...prev };
      for (const b of bundles) {
        next[b.id] = { ...(next[b.id] || {}), aov: String(preset.prices?.[b.id] || '') };
      }
      return next;
    });
  }

  async function saveScenario() {
    const item = { name: scenarioName, supplier_id: selectedSupplierId, market_id: selectedMarketId, display_currency: displayCurrency, opex_percent: Number(opexPercent), bundle_overrides: bundleOverrides };
    if (hasSupabase) {
      const { data, error } = await supabase.from('scenarios').insert(item).select().single();
      if (error) return setMessage(error.message);
      setScenarios([data, ...scenarios]);
    } else {
      const data = { ...item, id: crypto.randomUUID(), created_at: new Date().toISOString() };
      const next = [data, ...scenarios]; setScenarios(next); saveLocal({ scenarios: next });
    }
    setMessage('Scenario saved.');
  }

  function loadScenario(s) {
    setScenarioName(s.name);
    setSelectedSupplierId(s.supplier_id);
    setSelectedMarketId(s.market_id);
    setDisplayCurrency(s.display_currency);
    setOpexPercent(s.opex_percent);
    setBundleOverrides(s.bundle_overrides || {});
  }

  function setBundle(qty, field, value) {
    setBundleOverrides(prev => ({ ...prev, [qty]: { ...(prev[qty] || {}), [field]: value } }));
  }

  function updateSelectedMarketSellingCurrency(currency) {
    if (!market) return;
    updateEntity('markets', markets, setMarkets, market.id, { selling_currency: currency });
  }

  function saveRecommendationRules(next) {
    setRecommendationRules(next);
    localStorage.setItem('ber_recommendation_rules', JSON.stringify(next));
  }

  function addRecommendationRule() {
    const next = [
      ...recommendationRules,
      { id: crypto.randomUUID(), label: 'New status', level: 'neutral', minBer: 0, maxBer: 0, text: 'Write your recommendation here.' }
    ];
    saveRecommendationRules(next);
  }

  function updateRecommendationRule(id, patch) {
    const next = recommendationRules.map(rule => rule.id === id ? { ...rule, ...patch } : rule);
    saveRecommendationRules(next);
  }

  function removeRecommendationRule(id) {
    const next = recommendationRules.filter(rule => rule.id !== id);
    saveRecommendationRules(next.length ? next : DEFAULT_STATUS_RULES);
  }

  function resetRecommendationRules() {
    saveRecommendationRules(DEFAULT_STATUS_RULES);
  }

  function saveUpsellOffers(next) {
    setUpsellOffers(next);
    localStorage.setItem('ber_upsell_offers', JSON.stringify(next));
  }

  function addUpsellOffer() {
    saveUpsellOffers([...upsellOffers, { id: crypto.randomUUID(), label: 'New offer', qty: 1, price: 0, srp: 0 }]);
  }

  function updateUpsellOffer(id, patch) {
    saveUpsellOffers(upsellOffers.map(o => o.id === id ? { ...o, ...patch } : o));
  }

  function removeUpsellOffer(id) {
    const next = upsellOffers.filter(o => o.id !== id);
    saveUpsellOffers(next.length ? next : DEFAULT_UPSELL_OFFERS);
  }

  function saveDiscountTiers(next) {
    setDiscountTiers(next);
    localStorage.setItem('ber_abandoned_tiers', JSON.stringify(next));
  }

  function addDiscountTier() {
    saveDiscountTiers([...discountTiers, 20]);
  }

  function updateDiscountTier(index, value) {
    saveDiscountTiers(discountTiers.map((d, i) => i === index ? value : d));
  }

  function removeDiscountTier(index) {
    const next = discountTiers.filter((_, i) => i !== index);
    saveDiscountTiers(next.length ? next : [10]);
  }

  function applySuggestedPrices(margin) {
    setBundleOverrides(prev => {
      const next = { ...prev };
      for (const item of suggestedPrices) {
        const match = item.suggestions.find(s => s.margin === margin);
        if (!match) continue;
        next[item.id] = { ...(next[item.id] || {}), aov: String(match.price) };
      }
      return next;
    });
  }

  if (hasSupabase && !session) {
    return <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">BER</div>
        <h1>BER Pricing Calculator</h1>
        <p>Sign in to manage suppliers, markets, processors, and saved scenarios.</p>
        <form onSubmit={handleAuth} className="stack auth-form">
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button disabled={busy}>{authMode === 'signUp' ? 'Create account' : 'Sign in'}</button>
        </form>
        <button className="link" onClick={() => setAuthMode(authMode === 'signUp' ? 'signIn' : 'signUp')}>{authMode === 'signUp' ? 'Already have an account? Sign in' : 'Need an account? Create one'}</button>
        {message && <p className="message">{message}</p>}
      </section>
    </main>;
  }

  return <main className="app-shell">
    <header className="hero">
      <div>
        <div className="eyebrow">Pricing workspace</div>
        <h1>BER Pricing Calculator</h1>
        <p>Build reusable supplier, market, and processor profiles. Then create pricing scenarios without changing code.</p>
      </div>
      <div className="top-actions">
        <button className={activeTab === 'calculator' ? '' : 'secondary'} onClick={() => setActiveTab('calculator')}><Calculator size={16}/> BER</button>
        <button className={activeTab === 'upsell' ? '' : 'secondary'} onClick={() => setActiveTab('upsell')}><TrendingUp size={16}/> Upsell</button>
        <button className={activeTab === 'abandoned' ? '' : 'secondary'} onClick={() => setActiveTab('abandoned')}><ShoppingCart size={16}/> Abandoned checkout</button>
        <button className={activeTab === 'settings' ? '' : 'secondary'} onClick={() => setActiveTab('settings')}><Settings size={16}/> Settings</button>
        <button className="secondary" onClick={loadData}><RefreshCcw size={16}/> Refresh</button>
        {hasSupabase && <button className="secondary" onClick={() => supabase.auth.signOut()}><LogOut size={16}/> Sign out</button>}
      </div>
    </header>

    {message && <div className="notice">{message}</div>}
    {!hasSupabase && <div className="notice">Local mode: add Supabase env vars in Vercel to save data in the cloud.</div>}

    {activeTab === 'calculator' && <section className="workspace-bar panel">
      <div>
        <div className="eyebrow">Current setup</div>
        <h2>{scenarioName}</h2>
        <p>{supplier?.name || 'No supplier'} · {market?.name || 'No market'} · {activeProcessorCount} active processor{activeProcessorCount === 1 ? '' : 's'} · Results in {displayCurrency}</p>
      </div>
      <div className="workspace-actions">
        <button onClick={() => setActiveTab('settings')}><Settings size={16}/> Settings</button>
        <button className="secondary" onClick={saveScenario}><Save size={16}/> Save scenario</button>
      </div>
    </section>}

    {activeTab === 'settings' && <section className="settings-center panel wide">
      <div className="section-head wrap">
        <PanelTitle title="Settings" subtitle="Manage suppliers, markets, payment processors, SRP presets, and BEROAS status rules here. The calculator lives on its own tab." />
        <button className="secondary small" onClick={() => setActiveTab('calculator')}>Back to calculator</button>
      </div>

      <div className="settings-grid">
        <div className="settings-card">
          <EntityPanel title="Suppliers" subtitle="Supplier cost profiles and COGS currency." add={addSupplier} fields={['Name', '1x COGS', 'Currency', '']} noPanel>
            {suppliers.map(s => <div className="entity supplier-entity" key={s.id}>
              <input value={s.name} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { name: e.target.value })}/>
              <input type="number" step="0.01" value={s.cost_per_unit} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { cost_per_unit: Number(e.target.value) })}/>
              <select value={s.currency} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
              <IconButton onClick={() => removeEntity('suppliers', suppliers, setSuppliers, s.id)} />
            </div>)}
          </EntityPanel>
        </div>

        <div className="settings-card">
          <EntityPanel title="Markets" subtitle="Selling currency and payout currency by market." add={addMarket} fields={['Name', 'Selling', 'Payout', '']} noPanel>
            {markets.map(m => <div className="entity market-entity" key={m.id}>
              <input value={m.name} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { name: e.target.value })}/>
              <select value={m.selling_currency} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { selling_currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
              <select value={m.payout_currency} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { payout_currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
              <IconButton onClick={() => removeEntity('markets', markets, setMarkets, m.id)} />
            </div>)}
          </EntityPanel>
        </div>
      </div>

      <div className="settings-card settings-full">
        <EntityPanel title="Payment processors" subtitle="Turn processors on/off. Active processors are averaged for planning." add={addProcessor} fields={['Name', '% fee', 'Fixed', 'Fixed currency', 'FX %', 'Active', '']} noPanel>
          {processors.map(p => <div className="entity processor" key={p.id}>
            <input value={p.name} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { name: e.target.value })}/>
            <input type="number" step="0.01" value={p.percent_fee} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { percent_fee: Number(e.target.value) })} />
            <input type="number" step="0.01" value={p.fixed_fee} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { fixed_fee: Number(e.target.value) })} />
            <select value={p.fixed_fee_currency} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { fixed_fee_currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
            <input type="number" step="0.01" value={p.conversion_fee_percent} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { conversion_fee_percent: Number(e.target.value) })} />
            <label className="switch"><input type="checkbox" checked={p.active} onChange={e => updateEntity('payment_processors', processors, setProcessors, p.id, { active: e.target.checked })}/><span/></label>
            <IconButton onClick={() => removeEntity('payment_processors', processors, setProcessors, p.id)} />
          </div>)}
        </EntityPanel>
      </div>

      <div className="settings-card settings-full">
        <div className="section-head wrap">
          <PanelTitle title={`SRP presets for ${market?.selling_currency || 'selling currency'}`} subtitle="Manage default selling prices by currency. Add or edit presets here, not in code." />
          <button onClick={addPricePreset}><Plus size={16}/> Add SRP preset</button>
        </div>
        <div className="preset-list">
          {matchingPricePresets.length ? matchingPricePresets.map(preset => <div className="preset-row" key={preset.id}>
            <input value={preset.name} onChange={e => updatePricePreset(preset.id, { name: e.target.value })} />
            <select value={preset.currency} onChange={e => updatePricePreset(preset.id, { currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
            {bundles.map(b => <input key={b.id} type="number" step="0.01" value={preset.prices?.[b.id] ?? ''} placeholder={b.label} onChange={e => updatePricePreset(preset.id, { prices: { ...(preset.prices || {}), [b.id]: Number(e.target.value) } })} />)}
            <button className="secondary small" onClick={() => applyPricePreset(preset)}>Use SRP</button>
            <IconButton onClick={() => removePricePreset(preset.id)} />
          </div>) : <p className="empty-text">No SRP preset for this selling currency yet. Click Add SRP preset to create one.</p>}
        </div>
      </div>

      <div className="settings-card settings-full">
        <div className="section-head wrap">
          <PanelTitle title="BEROAS status rules" subtitle="Set your own launch recommendation ranges and messages." />
          <div className="button-row">
            <button className="secondary small" onClick={addRecommendationRule}><Plus size={16}/> Add status</button>
            <button className="secondary small" onClick={resetRecommendationRules}>Reset rules</button>
          </div>
        </div>
        <div className="status-rules">
          <div className="status-rule-header">
            <span>Status</span><span>From BEROAS</span><span>To BEROAS</span><span>Color</span><span>Recommendation text</span><span></span>
          </div>
          {recommendationRules.map(rule => <div className="status-rule-row" key={rule.id}>
            <input value={rule.label} onChange={e => updateRecommendationRule(rule.id, { label: e.target.value })} />
            <input type="number" step="0.01" value={rule.minBer} onChange={e => updateRecommendationRule(rule.id, { minBer: Number(e.target.value) })} />
            <input type="number" step="0.01" value={rule.maxBer} onChange={e => updateRecommendationRule(rule.id, { maxBer: Number(e.target.value) })} />
            <select value={rule.level} onChange={e => updateRecommendationRule(rule.id, { level: e.target.value })}>
              {RECOMMENDATION_LEVELS.map(level => <option key={level.value} value={level.value}>{level.label}</option>)}
            </select>
            <textarea value={rule.text} onChange={e => updateRecommendationRule(rule.id, { text: e.target.value })} />
            <IconButton onClick={() => removeRecommendationRule(rule.id)} />
          </div>)}
        </div>
      </div>
    </section>}

    {activeTab === 'upsell' && <>
    <section className="panel wide">
      <div className="section-head wrap">
        <PanelTitle title="Post-purchase upsells" subtitle="These run on an order you already won, so there is no ad cost. The only test is whether the offer clears variable cost. Change the quantity per offer with the Qty tier dropdown. Tiered COGS is pulled from the Bundle COGS row on the BER tab, so set your real per-tier supplier costs there to make 1x, 2x and 3x diverge." />
        <div className="head-controls">
          <Field label="Results currency" compact><select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <button onClick={addUpsellOffer}><Plus size={16}/> Add offer</button>
        </div>
      </div>
      <div className="offer-editor">
        <div className="offer-editor-header">
          <span>Offer name</span><span>Qty tier</span><span>Upsell price ({market?.selling_currency || 'GBP'})</span><span>SRP anchor ({market?.selling_currency || 'GBP'})</span><span></span>
        </div>
        {upsellOffers.map(o => <div className="offer-editor-row" key={o.id}>
          <input value={o.label} onChange={e => updateUpsellOffer(o.id, { label: e.target.value })} />
          <select value={o.qty} onChange={e => updateUpsellOffer(o.id, { qty: Number(e.target.value) })}>{[1,2,3,4,5].map(q => <option key={q} value={q}>{q}x</option>)}</select>
          <input type="number" step="0.01" value={o.price} onChange={e => updateUpsellOffer(o.id, { price: Number(e.target.value) })} />
          <input type="number" step="0.01" value={o.srp} onChange={e => updateUpsellOffer(o.id, { srp: Number(e.target.value) })} />
          <IconButton onClick={() => removeUpsellOffer(o.id)} />
        </div>)}
      </div>
    </section>

    <section className="panel wide">
      <PanelTitle title={`Upsell economics in ${displayCurrency}`} subtitle="Prices and SRP anchors are entered in your selling currency and converted to the results currency here, same as the BER tab. Net profit and margin are after tiered COGS and processor fees, with no ad cost applied." />
      <div className="recommendation-grid offer-grid">
        {upsellRows.map(r => {
          const level = r.netProfit > 0 ? 'good' : (r.netProfit < 0 ? 'bad' : 'neutral');
          const cur = r.currency || displayCurrency;
          return <div className={`recommendation-card ${level}`} key={r.id}>
            <div className="recommendation-top"><strong>{r.label}</strong><span>{r.qty}x</span></div>
            <div className="offer-headline">{pct(r.discountPct)} off SRP</div>
            <div className="offer-stats">
              <div><span>Upsell price</span><b>{money(r.price, cur)}</b></div>
              <div><span>SRP anchor</span><b>{money(r.srp, cur)}</b></div>
              <div><span>Tiered COGS</span><b>-{money(r.cogsSelling, cur)}</b></div>
              <div><span>Processor fee</span><b>-{money(r.fee, cur)}</b></div>
              <div className="offer-net"><span>Net profit</span><b>{money(r.netProfit, cur)}</b></div>
              <div><span>Net margin</span><b>{pct(r.margin)}</b></div>
            </div>
            <small>{r.netProfit > 0 ? `Clears variable cost with ${money(r.netProfit, cur)} to spare.` : (r.netProfit < 0 ? `Sells at a loss of ${money(Math.abs(r.netProfit), cur)} per take.` : 'Breaks even exactly.')}</small>
          </div>;
        })}
      </div>
    </section>
    </>}

    {activeTab === 'abandoned' && <>
    <section className="panel wide">
      <div className="section-head wrap">
        <PanelTitle title="Abandoned checkout recovery" subtitle="The ad spend that brought this shopper in is already gone, so it is not counted here. Recovery is incremental, and the only floor is variable cost (COGS plus fees), not your full break-even. OpEx is excluded for the same reason. Set the discount steps you plan to send in the flow." />
        <div className="head-controls">
          <Field label="Results currency" compact><select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <button onClick={addDiscountTier}><Plus size={16}/> Add discount step</button>
        </div>
      </div>
      <div className="tier-editor">
        {discountTiers.map((d, i) => <div className="tier-chip" key={i}>
          <input type="number" step="1" value={d} onChange={e => updateDiscountTier(i, Number(e.target.value))} />
          <span>% off</span>
          <button className="tier-remove" onClick={() => removeDiscountTier(i)} title="Remove">×</button>
        </div>)}
      </div>
    </section>

    <section className="panel wide">
      <PanelTitle title={`Discount room by bundle in ${displayCurrency}`} subtitle="Order values come from the Bundle pricing on the BER tab and are converted to the results currency here. Contribution is full-price profit with no discount. Break-even discount is the ceiling before a recovered order loses money. Your live 1x and 3x offers are highlighted." />
      <div className="table-card">
        <table className="calc-table">
          <thead><tr><th>Bundle</th><th>Order value</th><th>Contribution</th><th>Break-even discount</th>{discountTiers.map((d, i) => <th key={i}>{d}% off</th>)}</tr></thead>
          <tbody>
            {abandonedRows.map(r => {
              const cur = r.currency || displayCurrency;
              return <tr key={r.id} className={(r.id === '1' || r.id === '3') ? 'live-row' : ''}>
                <td>{r.label}{(r.id === '1' || r.id === '3') && <span className="live-pill">live</span>}</td>
                <td>{money(r.aov, cur)}</td>
                <td>{r.aov > 0 ? money(r.contribution, cur) : '—'}</td>
                <td>{r.aov > 0 ? pct(Math.max(0, r.breakEvenDiscount)) : '—'}</td>
                {r.tiers.map((t, i) => <td key={i} className={r.aov > 0 ? (t.profit >= 0 ? 'pos' : 'neg') : ''}>{r.aov > 0 ? money(t.profit, cur) : '—'}</td>)}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel wide">
      <PanelTitle title="Suggested flow cadence" subtitle="Timing is measured from the moment of abandonment. Lead with a plain reminder, sell trust before price, and only introduce a discount once they have ignored the first nudges." />
      <div className="flow-grid">
        <div className="flow-step"><div className="flow-num">1</div><div><h3>1 hour · no discount</h3><p>Simple reminder. Show the product, keep it warm.</p></div></div>
        <div className="flow-step"><div className="flow-num">2</div><div><h3>12 hours · no discount</h3><p>Handle objections. Reviews, guarantee, results.</p></div></div>
        <div className="flow-step"><div className="flow-num">3</div><div><h3>24 hours · first discount</h3><p>Introduce the smaller code with light urgency.</p></div></div>
        <div className="flow-step"><div className="flow-num">4</div><div><h3>48 hours · final discount</h3><p>Last chance. Code expiring, gentle scarcity.</p></div></div>
      </div>
    </section>
    </>}

    {activeTab === 'calculator' && <>
    <section className="grid setup-grid">
      <div className="panel scenario-panel">
        <PanelTitle title="Scenario setup" subtitle="This is the saved preset you will reload later." />
        <div className="form-grid three-cols">
          <Field label="Scenario name"><input value={scenarioName} onChange={e => setScenarioName(e.target.value)} /></Field>
          <Field label="Results currency"><select value={displayCurrency} onChange={e => setDisplayCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          <Field label="OpEx %"><input type="number" step="0.1" value={opexPercent} onChange={e => setOpexPercent(e.target.value)} /></Field>
          <Field label="Supplier"><select value={selectedSupplierId} onChange={e => setSelectedSupplierId(e.target.value)}>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="Market"><select value={selectedMarketId} onChange={e => setSelectedMarketId(e.target.value)}>{markets.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <div className="field action-field"><button onClick={saveScenario}><Save size={16}/> Save scenario</button></div>
        </div>
        <div className="saved-scenarios">
          <div className="mini-title"><FolderOpen size={15}/> Saved scenarios</div>
          {scenarios.length ? <div className="chips">{scenarios.map(s => <button key={s.id} className="chip" onClick={() => loadScenario(s)}>{s.name}</button>)}</div> : <p className="empty-text">No saved scenarios yet. Set up pricing and click Save scenario.</p>}
        </div>
      </div>

      <div className="panel inputs-panel">
        <div className="section-head wrap">
          <PanelTitle title="Bundle pricing" subtitle="Enter bundle COGS, then apply or edit selling prices." />
          <div className="head-controls">
            <Field label="Bundle style" compact>
              <select value={pricingMode} onChange={e => changePricingMode(e.target.value)}>
                <option value="straight">Straight (1x–6x)</option>
                <option value="bundle">Offers (1x, 1+1x, 2+1x…, or add your own)</option>
              </select>
            </Field>
            <Field label="Selling price currency" compact><select value={market?.selling_currency || 'GBP'} onChange={e => updateSelectedMarketSellingCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
          </div>
        </div>
        <div className="bundle-toggle-row">
          {allBundlesForMode.map(b => <label key={b.id} className="bundle-toggle-chip">
            <input type="checkbox" checked={bundles.some(x => x.id === b.id)} onChange={() => toggleBundleActive(b.id)} />
            {b.label}
            {b.id.startsWith('custom-') && <span onClick={(e) => { e.preventDefault(); removeCustomBundle(b.id); }} style={{ marginLeft: 6, cursor: 'pointer', opacity: 0.6 }}>×</span>}
          </label>)}
        </div>
        <div className="bundle-toggle-row" style={{ alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, opacity: 0.7 }}>Add bundle:</span>
          <input type="number" min="0" placeholder="Paid" value={newBundlePaid} onChange={e => setNewBundlePaid(e.target.value)} style={{ width: 60 }} />
          <span style={{ opacity: 0.6 }}>+</span>
          <input type="number" min="0" placeholder="Free" value={newBundleFree} onChange={e => setNewBundleFree(e.target.value)} style={{ width: 60 }} />
          <span style={{ opacity: 0.6 }}>free</span>
          <button className="chip" onClick={addCustomBundle}>Add</button>
        </div>
        <div className="table-card">
          <table className="input-table">
            <thead><tr><th></th>{bundles.map(b => <th key={b.id}>{b.label}</th>)}</tr></thead>
            <tbody>
              <tr><td><strong>Bundle COGS</strong><span>{supplier?.currency || 'USD'}</span></td>{bundles.map(b => <td key={b.id}><input type="number" step="0.01" value={bundleOverrides[b.id]?.cogs ?? ''} placeholder={String(Number(supplier?.cost_per_unit || 0) * b.units)} onChange={e => setBundle(b.id, 'cogs', e.target.value)} /></td>)}</tr>
              <tr><td><strong>Selling price</strong><span>{market?.selling_currency || 'GBP'}</span></td>{bundles.map(b => <td key={b.id}><input type="number" step="0.01" value={bundleOverrides[b.id]?.aov ?? ''} placeholder={suggestedPrices.find(x => x.id === b.id)?.suggestions.find(s => s.margin === 0.20)?.price?.toFixed(2) || '0.00'} onChange={e => setBundle(b.id, 'aov', e.target.value)} /></td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section className="panel wide suggestion-panel">
      <div className="section-head wrap">
        <PanelTitle title={`Suggested prices in ${market?.selling_currency || 'selling currency'}`} subtitle="Default SRP is applied automatically from Settings. Use these buttons only when you want economics-based pricing instead." />
        <div className="button-row">
          {defaultPricePreset && <button className="secondary" onClick={() => applyPricePreset(defaultPricePreset)}>Use default SRP</button>}
          {SUGGESTED_MARGINS.map(m => <button key={m} onClick={() => applySuggestedPrices(m)}>{m === 0 ? 'Use break-even' : `Use ${Math.round(m*100)}%`}</button>)}
        </div>
      </div>
      <div className="table-card">
        <table className="suggestions">
          <thead><tr><th>Target pre-ad margin</th>{suggestedPrices.map(r => <th key={r.id}>{r.label}</th>)}</tr></thead>
          <tbody>
            {SUGGESTED_MARGINS.map(m => <tr key={m}>
              <td>{m === 0 ? 'Break-even before ads' : `${Math.round(m*100)}% pre-ad margin`}</td>
              {suggestedPrices.map(r => <td key={r.id}>{money(r.suggestions.find(s => s.margin === m)?.price || 0, market?.selling_currency || 'USD')}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel wide results-panel">
      <PanelTitle title={`Results in ${displayCurrency}`} subtitle="Use BEROAS for Ads Manager ROAS checks. Use target CPP for daily buying decisions." />
      <div className="table-card">
        <table className="results">
          <thead><tr><th>Metric</th>{rows.map(r => <th key={r.id}>{r.label}</th>)}</tr></thead>
          <tbody>
            <Result label="Selling price" value={rows.map(r => money(r.aovDisplay, displayCurrency))} />
            <Result label="Payment fees" value={rows.map(r => money(-r.feeDisplay, displayCurrency))} />
            <Result label="Net sales" value={rows.map(r => money(r.netSales, displayCurrency))} />
            <Result label="COGS" value={rows.map(r => money(-r.cogsDisplay, displayCurrency))} />
            <Result label="Gross profit" value={rows.map(r => money(r.grossProfit, displayCurrency))} />
            <Result label="Gross profit %" value={rows.map(r => pct(r.grossProfitPct))} />
            <Result label="Operating expenses" value={rows.map(r => money(-r.opex, displayCurrency))} />
            <Result label="Pre-ad profit" value={rows.map(r => money(r.preAdProfit, displayCurrency))} />
            <Result label="Pre-ad profit %" value={rows.map(r => pct(r.preAdProfitPct))} />
            <Result label="BEROAS" value={rows.map(r => num(r.ber))} strong />
            {TARGET_MARGINS.map((m, i) => <React.Fragment key={m}>
              <Result label={`${Math.round(m*100)}% Target ROAS`} value={rows.map(r => num(r.targets[i]?.targetRoas))} />
              <Result label={`${Math.round(m*100)}% Target CPP`} value={rows.map(r => money(r.targets[i]?.targetCpp || 0, displayCurrency))} />
            </React.Fragment>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="panel wide recommendation-panel">
      <div className="section-head wrap">
        <PanelTitle title="Launch recommendation" subtitle="Based on your saved BEROAS status rules. Edit rules inside Settings." />
        <button className="secondary small" onClick={() => setActiveTab('settings')}><Settings size={16}/> Edit rules</button>
      </div>
      <div className="recommendation-grid">
        {recommendations.map(item => <div key={item.id} className={`recommendation-card ${item.level}`}>
          <div className="recommendation-top"><strong>{item.bundleLabel || `${item.qty}x`}</strong><span>{item.label}</span></div>
          <p>{item.text}</p>
          <small>BEROAS: {num(item.ber)} | Break-even CPP: {money(item.breakEvenCpp, displayCurrency)}</small>
        </div>)}
      </div>
    </section>
    </>}
  </main>;
}

function Instruction({ icon, title, text }) { return <div className="instruction"><div className="instruction-icon">{icon}</div><div><h3>{title}</h3><p>{text}</p></div></div>; }
function WorkflowStep({ icon, title, text }) { return <div className="workflow-step"><div className="step-icon">{icon}</div><div><h3>{title}</h3><p>{text}</p></div></div>; }
function StatusCard({ icon, label, value, meta }) { return <div className="status-card"><div className="status-icon">{icon}</div><div><p>{label}</p><h3>{value}</h3><span>{meta}</span></div></div>; }
function PanelTitle({ title, subtitle }) { return <div className="panel-title"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>; }
function Field({ label, children, compact }) { return <label className={compact ? 'field compact-field' : 'field'}><span>{label}</span>{children}</label>; }
function EntityPanel({ title, subtitle, add, children, fields, noPanel }) {
  const body = <><div className="section-head"><PanelTitle title={title} subtitle={subtitle}/><button onClick={add}><Plus size={16}/> Add</button></div>{fields && <div className="field-header">{fields.map((f, i) => <span key={`${f}-${i}`}>{f}</span>)}</div>}<div className="entity-list">{children}</div></>;
  return noPanel ? body : <div className="panel">{body}</div>;
}
function IconButton({ onClick }) { return <button className="icon" onClick={onClick} title="Delete"><Trash2 size={16}/></button>; }
function Result({ label, value, strong }) { return <tr className={strong ? 'strong-row' : ''}><td>{label}</td>{value.map((v, idx) => <td key={idx}>{v}</td>)}</tr>; }
function money(v, currency) { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(v || 0)); }
function pct(v) { return `${Number(v || 0).toFixed(2)}%`; }
function num(v) { return Number(v || 0).toFixed(2); }

function buildRecommendations(rows, rules = DEFAULT_STATUS_RULES) {
  const cleanRules = [...(rules || [])]
    .map(rule => ({
      ...rule,
      minBer: Number(rule.minBer || 0),
      maxBer: Number(rule.maxBer || 0)
    }))
    .sort((a, b) => a.minBer - b.minBer);

  return rows.map(r => {
    const ber = Number(r.ber || 0);
    const cpp = Number(r.preAdProfit || 0);
    if (!r.aovDisplay) {
      return { id: r.id, bundleLabel: r.label, qty: r.qty, ber, breakEvenCpp: cpp, level: 'neutral', label: 'No price yet', text: 'Add a selling price or apply an SRP preset first.' };
    }
    const match = cleanRules.find(rule => ber >= rule.minBer && ber <= rule.maxBer);
    if (!match) {
      return { id: r.id, bundleLabel: r.label, qty: r.qty, ber, breakEvenCpp: cpp, level: 'neutral', label: 'No matching status', text: 'No status rule covers this BEROAS range yet. Add or edit a rule below.' };
    }
    return {
      id: r.id,
      bundleLabel: r.label,
      qty: r.qty,
      ber,
      breakEvenCpp: cpp,
      level: match.level || 'neutral',
      label: match.label || 'Custom status',
      text: match.text || 'No recommendation text set.'
    };
  });
}

createRoot(document.getElementById('root')).render(<App />);
