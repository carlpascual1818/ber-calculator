import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Trash2, Save, RefreshCcw, LogOut, Database, Store, CreditCard, Package, Calculator, FolderOpen } from 'lucide-react';
import { supabase, hasSupabase } from './lib/supabase';
import { calculateRows, calculateSuggestedPrices, TARGET_MARGINS, SUGGESTED_MARGINS } from './lib/calc';
import './styles.css';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'HKD', 'CAD', 'AUD', 'CHF', 'SEK', 'NOK', 'DKK', 'MXN', 'ILS', 'JPY'];

const seed = {
  suppliers: [{ id: 'local-supplier-1', name: 'Default Supplier', cost_per_unit: 9.25, currency: 'USD', local: true }],
  processors: [{ id: 'local-processor-1', name: 'Shopify Payments', percent_fee: 3.9, fixed_fee: 2.33, fixed_fee_currency: 'HKD', conversion_fee_percent: 2, active: true, local: true }],
  markets: [{ id: 'local-market-1', name: 'Default Market', selling_currency: 'GBP', payout_currency: 'HKD', local: true }],
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
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [opexPercent, setOpexPercent] = useState(5.5);
  const [scenarioName, setScenarioName] = useState('Default Scenario');
  const [bundleOverrides, setBundleOverrides] = useState({});
  const [rows, setRows] = useState([]);
  const [suggestedPrices, setSuggestedPrices] = useState([]);
  const [busy, setBusy] = useState(false);

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

  const supplier = useMemo(() => suppliers.find(s => s.id === selectedSupplierId), [suppliers, selectedSupplierId]);
  const market = useMemo(() => markets.find(m => m.id === selectedMarketId), [markets, selectedMarketId]);
  const activeProcessorCount = processors.filter(p => p.active).length;

  useEffect(() => {
    let active = true;
    Promise.all([
      calculateRows({ supplier, market, processors, displayCurrency, opexPercent, bundleOverrides }),
      calculateSuggestedPrices({ supplier, market, processors, opexPercent, bundleOverrides })
    ])
      .then(([resultRows, resultSuggestions]) => {
        if (active) {
          setRows(resultRows);
          setSuggestedPrices(resultSuggestions);
        }
      })
      .catch(err => setMessage(err.message));
    return () => { active = false; };
  }, [supplier, market, processors, displayCurrency, opexPercent, bundleOverrides]);

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
      for (const result of [s, p, m, sc]) if (result.error) throw result.error;
      setSuppliers(s.data.length ? s.data : seed.suppliers);
      setProcessors(p.data.length ? p.data : seed.processors);
      setMarkets(m.data.length ? m.data : seed.markets);
      setScenarios(sc.data || []);
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
    setSelectedSupplierId(saved.suppliers[0]?.id || '');
    setSelectedMarketId(saved.markets[0]?.id || '');
  }

  function saveLocal(next) {
    if (hasSupabase) return;
    const data = { suppliers, processors, markets, scenarios, ...next };
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

  function applySuggestedPrices(margin) {
    setBundleOverrides(prev => {
      const next = { ...prev };
      for (const item of suggestedPrices) {
        const match = item.suggestions.find(s => s.margin === margin);
        if (!match) continue;
        next[item.qty] = { ...(next[item.qty] || {}), aov: String(match.price) };
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
        <button className="secondary" onClick={loadData}><RefreshCcw size={16}/> Refresh</button>
        {hasSupabase && <button className="secondary" onClick={() => supabase.auth.signOut()}><LogOut size={16}/> Sign out</button>}
      </div>
    </header>

    {message && <div className="notice">{message}</div>}
    {!hasSupabase && <div className="notice">Local mode: add Supabase env vars in Vercel to save data in the cloud.</div>}

    <section className="workflow panel">
      <WorkflowStep icon={<Package size={18}/>} title="1. Supplier" text="Add supplier cost and currency." />
      <WorkflowStep icon={<Store size={18}/>} title="2. Market" text="Set selling and payout currency." />
      <WorkflowStep icon={<CreditCard size={18}/>} title="3. Payments" text="Add fees and turn processors on/off." />
      <WorkflowStep icon={<Calculator size={18}/>} title="4. Price" text="Use suggested prices, then save." />
    </section>

    <section className="grid dashboard-grid">
      <StatusCard icon={<Package size={18}/>} label="Selected supplier" value={supplier?.name || 'None'} meta={`COGS currency: ${supplier?.currency || '-'}`} />
      <StatusCard icon={<Store size={18}/>} label="Selected market" value={market?.name || 'None'} meta={`${market?.selling_currency || '-'} sales → ${market?.payout_currency || '-'} payout`} />
      <StatusCard icon={<CreditCard size={18}/>} label="Active processors" value={String(activeProcessorCount)} meta="Averaged for planning" />
      <StatusCard icon={<Database size={18}/>} label="Results currency" value={displayCurrency} meta="Used for ROAS and CPP view" />
    </section>

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
          <PanelTitle title="Bundle pricing" subtitle="Enter bundle COGS, then use the suggested prices below." />
          <Field label="Selling price currency" compact><select value={market?.selling_currency || 'GBP'} onChange={e => updateSelectedMarketSellingCurrency(e.target.value)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></Field>
        </div>
        <div className="table-card">
          <table className="input-table">
            <thead><tr><th></th>{[1,2,3,4,5].map(q => <th key={q}>{q}x</th>)}</tr></thead>
            <tbody>
              <tr><td><strong>Bundle COGS</strong><span>{supplier?.currency || 'USD'}</span></td>{[1,2,3,4,5].map(q => <td key={q}><input type="number" step="0.01" value={bundleOverrides[q]?.cogs ?? ''} placeholder={String(Number(supplier?.cost_per_unit || 0) * q)} onChange={e => setBundle(q, 'cogs', e.target.value)} /></td>)}</tr>
              <tr><td><strong>Selling price</strong><span>{market?.selling_currency || 'GBP'}</span></td>{[1,2,3,4,5].map(q => <td key={q}><input type="number" step="0.01" value={bundleOverrides[q]?.aov ?? ''} placeholder={suggestedPrices.find(x => x.qty === q)?.suggestions.find(s => s.margin === 0.20)?.price?.toFixed(2) || '0.00'} onChange={e => setBundle(q, 'aov', e.target.value)} /></td>)}</tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section className="panel wide suggestion-panel">
      <div className="section-head wrap">
        <PanelTitle title={`Suggested prices in ${market?.selling_currency || 'selling currency'}`} subtitle="Prices are calculated from COGS, active processor fees, FX fee, and OpEx. Choose a target to fill the selling price row." />
        <div className="button-row">
          {SUGGESTED_MARGINS.map(m => <button key={m} onClick={() => applySuggestedPrices(m)}>{m === 0 ? 'Use break-even' : `Use ${Math.round(m*100)}%`}</button>)}
        </div>
      </div>
      <div className="table-card">
        <table className="suggestions">
          <thead><tr><th>Target pre-ad margin</th>{suggestedPrices.map(r => <th key={r.qty}>{r.qty}x</th>)}</tr></thead>
          <tbody>
            {SUGGESTED_MARGINS.map(m => <tr key={m}>
              <td>{m === 0 ? 'Break-even before ads' : `${Math.round(m*100)}% pre-ad margin`}</td>
              {suggestedPrices.map(r => <td key={r.qty}>{money(r.suggestions.find(s => s.margin === m)?.price || 0, market?.selling_currency || 'USD')}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="grid entity-grid">
      <EntityPanel title="Suppliers" subtitle="Manage supplier cost profiles." add={addSupplier} fields={['Name', '1x COGS', 'Currency', '']}>
        {suppliers.map(s => <div className="entity supplier-entity" key={s.id}>
          <input value={s.name} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { name: e.target.value })}/>
          <input type="number" step="0.01" value={s.cost_per_unit} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { cost_per_unit: Number(e.target.value) })}/>
          <select value={s.currency} onChange={e => updateEntity('suppliers', suppliers, setSuppliers, s.id, { currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
          <IconButton onClick={() => removeEntity('suppliers', suppliers, setSuppliers, s.id)} />
        </div>)}
      </EntityPanel>

      <EntityPanel title="Markets" subtitle="Manage selling and payout currencies." add={addMarket} fields={['Name', 'Selling', 'Payout', '']}>
        {markets.map(m => <div className="entity market-entity" key={m.id}>
          <input value={m.name} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { name: e.target.value })}/>
          <select value={m.selling_currency} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { selling_currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
          <select value={m.payout_currency} onChange={e => updateEntity('markets', markets, setMarkets, m.id, { payout_currency: e.target.value })}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select>
          <IconButton onClick={() => removeEntity('markets', markets, setMarkets, m.id)} />
        </div>)}
      </EntityPanel>
    </section>

    <section className="panel processors-panel">
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
    </section>

    <section className="panel wide results-panel">
      <PanelTitle title={`Results in ${displayCurrency}`} subtitle="Use BEROAS for Ads Manager ROAS checks. Use target CPP for daily buying decisions." />
      <div className="table-card">
        <table className="results">
          <thead><tr><th>Metric</th>{rows.map(r => <th key={r.qty}>{r.qty}x</th>)}</tr></thead>
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
  </main>;
}

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

createRoot(document.getElementById('root')).render(<App />);
