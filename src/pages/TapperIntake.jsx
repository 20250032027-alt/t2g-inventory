import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Pencil, Trash2, Droplets, Users, CheckCircle2, Circle } from 'lucide-react'
import { showToast } from '../components/Toast'

const DEFAULT_RATE = 120

function today() { return new Date().toISOString().split('T')[0] }

export default function TapperIntake() {
  const [tappers, setTappers] = useState([])
  const [materials, setMaterials] = useState([])
  const [intakes, setIntakes] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('log') // 'log' | 'summary'

  // filters
  const [search, setSearch] = useState('')
  const [filterTapper, setFilterTapper] = useState('all')
  const [filterPaid, setFilterPaid] = useState('all') // all | paid | unpaid
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // tapper form
  const [showTapperForm, setShowTapperForm] = useState(false)
  const [editingTapper, setEditingTapper] = useState(null)
  const [tapperForm, setTapperForm] = useState({ name: '', contact: '' })
  const [tapperError, setTapperError] = useState('')
  const [tapperSaving, setTapperSaving] = useState(false)

  // intake form
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [form, setForm] = useState({
    tapper_id: '', raw_material_id: '', date: today(),
    sap_received_kg: '', recovery_kg: '', rate_per_kg: String(DEFAULT_RATE),
    is_paid: false, notes: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: taps }, { data: mats }, { data: rows }] = await Promise.all([
      supabase.from('tappers').select('*').order('name'),
      supabase.from('raw_materials').select('id, name, unit').order('name'),
      supabase.from('tapper_intakes').select('*, tappers(name), raw_materials(name, unit)').order('date', { ascending: false }).limit(500),
    ])
    setTappers(taps || [])
    setMaterials(mats || [])
    setIntakes(rows || [])
    setLoading(false)
  }

  // Default raw material: prefer one literally named "Coconut Sap", else first material
  const defaultMaterialId = useMemo(() => {
    const match = materials.find(m => m.name.trim().toLowerCase() === 'coconut sap')
    return (match || materials[0])?.id || ''
  }, [materials])

  const filtered = useMemo(() => {
    let rows = intakes
    if (filterTapper !== 'all') rows = rows.filter(r => r.tapper_id === filterTapper)
    if (filterPaid !== 'all') rows = rows.filter(r => filterPaid === 'paid' ? r.is_paid : !r.is_paid)
    if (dateFrom) rows = rows.filter(r => r.date >= dateFrom)
    if (dateTo) rows = rows.filter(r => r.date <= dateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r => r.tappers?.name?.toLowerCase().includes(q) || r.notes?.toLowerCase().includes(q))
    }
    return rows
  }, [intakes, filterTapper, filterPaid, dateFrom, dateTo, search])

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    sap: acc.sap + Number(r.sap_received_kg),
    recovery: acc.recovery + Number(r.recovery_kg),
    amount: acc.amount + Number(r.recovery_kg) * Number(r.rate_per_kg),
    unpaid: acc.unpaid + (r.is_paid ? 0 : Number(r.recovery_kg) * Number(r.rate_per_kg)),
  }), { sap: 0, recovery: 0, amount: 0, unpaid: 0 }), [filtered])

  // Summary report grouped by tapper (matches the paper report format)
  const summaryRows = useMemo(() => {
    const map = {}
    filtered.forEach(r => {
      const key = r.tapper_id
      if (!map[key]) map[key] = { name: r.tappers?.name || 'Unknown', sap: 0, recovery: 0, amount: 0 }
      map[key].sap += Number(r.sap_received_kg)
      map[key].recovery += Number(r.recovery_kg)
      map[key].amount += Number(r.recovery_kg) * Number(r.rate_per_kg)
    })
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  // --- Tapper CRUD ---
  function openNewTapper() {
    setTapperForm({ name: '', contact: '' }); setEditingTapper(null); setTapperError(''); setShowTapperForm(true)
  }
  function openEditTapper(t) {
    setTapperForm({ name: t.name, contact: t.contact || '' }); setEditingTapper(t); setTapperError(''); setShowTapperForm(true)
  }
  async function handleTapperSave(e) {
    e.preventDefault()
    if (!tapperForm.name.trim()) return setTapperError('Name is required.')
    setTapperSaving(true); setTapperError('')
    const payload = { name: tapperForm.name.trim(), contact: tapperForm.contact.trim() || null }
    const { error } = editingTapper
      ? await supabase.from('tappers').update(payload).eq('id', editingTapper.id)
      : await supabase.from('tappers').insert(payload)
    setTapperSaving(false)
    if (error) return setTapperError(error.message)
    setShowTapperForm(false); setEditingTapper(null); fetchAll()
    showToast(editingTapper ? 'Tapper updated' : 'Tapper added')
  }
  async function handleTapperDelete(id) {
    if (!confirm('Delete this tapper? Their intake history will also be removed.')) return
    await supabase.from('tappers').delete().eq('id', id)
    fetchAll()
  }

  // --- Intake CRUD ---
  function openNew() {
    if (tappers.length === 0) return
    setForm({
      tapper_id: tappers[0]?.id || '', raw_material_id: defaultMaterialId, date: today(),
      sap_received_kg: '', recovery_kg: '', rate_per_kg: String(DEFAULT_RATE), is_paid: false, notes: '',
    })
    setEditingEntry(null); setError(''); setShowForm(true)
  }
  function openEdit(entry) {
    setEditingEntry(entry)
    setForm({
      tapper_id: entry.tapper_id, raw_material_id: entry.raw_material_id || defaultMaterialId, date: entry.date,
      sap_received_kg: String(entry.sap_received_kg), recovery_kg: String(entry.recovery_kg),
      rate_per_kg: String(entry.rate_per_kg), is_paid: entry.is_paid, notes: entry.notes || '',
    })
    setError(''); setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.tapper_id) return setError('Select a tapper.')
    if (!form.raw_material_id) return setError('Select which raw material this recovery feeds into.')
    if (!form.sap_received_kg || isNaN(form.sap_received_kg) || Number(form.sap_received_kg) <= 0) return setError('Enter a valid sap received amount.')
    if (!form.recovery_kg || isNaN(form.recovery_kg) || Number(form.recovery_kg) <= 0) return setError('Enter a valid recovery amount.')
    if (Number(form.recovery_kg) > Number(form.sap_received_kg)) return setError('Recovery can\'t exceed sap received.')
    if (!form.rate_per_kg || isNaN(form.rate_per_kg) || Number(form.rate_per_kg) <= 0) return setError('Enter a valid rate.')

    setSaving(true); setError('')
    const payload = {
      tapper_id: form.tapper_id, raw_material_id: form.raw_material_id, date: form.date,
      sap_received_kg: Number(form.sap_received_kg), recovery_kg: Number(form.recovery_kg),
      rate_per_kg: Number(form.rate_per_kg), is_paid: form.is_paid,
      paid_date: form.is_paid ? (editingEntry?.paid_date || today()) : null,
      notes: form.notes.trim() || null,
    }

    let entryId = editingEntry?.id
    let saveError
    if (editingEntry) {
      const { error } = await supabase.from('tapper_intakes').update(payload).eq('id', editingEntry.id)
      saveError = error
      if (!error) await supabase.from('raw_material_entries').delete().eq('tapper_intake_id', editingEntry.id)
    } else {
      const { data, error } = await supabase.from('tapper_intakes').insert(payload).select().single()
      saveError = error
      entryId = data?.id
    }
    if (saveError) { setSaving(false); return setError(saveError.message) }

    const tapperName = tappers.find(t => t.id === form.tapper_id)?.name || 'Tapper'
    const { error: stockError } = await supabase.from('raw_material_entries').insert({
      raw_material_id: form.raw_material_id,
      quantity: Number(form.recovery_kg),
      date: form.date,
      batch_notes: `Sap intake — ${tapperName}`,
      entry_type: 'tapper_intake',
      tapper_intake_id: entryId,
    })
    if (stockError) {
      setSaving(false)
      return setError(`Intake saved, but raw material stock update failed: ${stockError.message}`)
    }

    setSaving(false); setShowForm(false); setEditingEntry(null); fetchAll()
    showToast(editingEntry ? 'Intake updated' : 'Sap intake logged')
  }

  async function handleDelete(id) {
    if (!confirm('Delete this intake entry? This will also remove the raw material stock it added.')) return
    await supabase.from('tapper_intakes').delete().eq('id', id)
    fetchAll()
  }

  async function togglePaid(entry) {
    await supabase.from('tapper_intakes').update({
      is_paid: !entry.is_paid,
      paid_date: !entry.is_paid ? today() : null,
    }).eq('id', entry.id)
    fetchAll()
  }

  const selectedMaterial = materials.find(m => m.id === form.raw_material_id)
  const computedAmount = (Number(form.recovery_kg) || 0) * (Number(form.rate_per_kg) || 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tapper Intake</h1>
          <p className="page-desc">Log coconut sap purchased from tappers. Payment is based on recovered (usable) kg, which also becomes raw material stock.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={openNewTapper}><Users size={14} /> New Tapper</button>
          <button className="btn-primary" onClick={openNew} disabled={tappers.length === 0}><Plus size={16} /> Log Intake</button>
        </div>
      </div>

      {tappers.length === 0 && !loading && (
        <div className="empty-state"><p>No tappers yet. Click "New Tapper" to add your first one.</p></div>
      )}
      {materials.length === 0 && !loading && tappers.length > 0 && (
        <div className="notice">No raw materials exist yet — add "Coconut Sap" on the Raw Materials page first so intake can feed stock.</div>
      )}

      {tappers.length > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card">
              <div className="stat-icon blue"><Droplets size={16} /></div>
              <div><div className="stat-label">Sap Received</div><div className="stat-value">{totals.sap.toLocaleString()} kg</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon green"><Droplets size={16} /></div>
              <div><div className="stat-label">Recovery</div><div className="stat-value">{totals.recovery.toLocaleString()} kg</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon amber"><Check size={16} /></div>
              <div><div className="stat-label">Total Amount</div><div className="stat-value">₱{totals.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon red"><X size={16} /></div>
              <div><div className="stat-label">Unpaid</div><div className="stat-value">₱{totals.unpaid.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div></div>
            </div>
          </div>

          <div className="table-filters">
            <div className="search-wrap">
              <Search size={15} className="search-icon" />
              <input className="search-input" placeholder="Search tapper or notes..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="select-wrap filter-select">
              <select value={filterTapper} onChange={e => setFilterTapper(e.target.value)}>
                <option value="all">All Tappers</option>
                {tappers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <ChevronDown size={15} className="select-icon" />
            </div>
            <div className="select-wrap filter-select">
              <select value={filterPaid} onChange={e => setFilterPaid(e.target.value)}>
                <option value="all">Paid & Unpaid</option>
                <option value="paid">Paid Only</option>
                <option value="unpaid">Unpaid Only</option>
              </select>
              <ChevronDown size={15} className="select-icon" />
            </div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ maxWidth: 150 }} />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ maxWidth: 150 }} />
            <div className="select-wrap filter-select">
              <select value={view} onChange={e => setView(e.target.value)}>
                <option value="log">Log View</option>
                <option value="summary">Summary by Tapper</option>
              </select>
              <ChevronDown size={15} className="select-icon" />
            </div>
          </div>

          {loading ? (
            <div className="skeleton-list">{[1,2,3,4].map(i => <div key={i} className="skeleton-row" />)}</div>
          ) : view === 'summary' ? (
            summaryRows.length === 0 ? <div className="empty-state"><p>No entries in this range.</p></div> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Names</th><th>kls in sap Receive</th><th>Kls of Recovery</th><th>Amount</th></tr></thead>
                  <tbody>
                    {summaryRows.map(r => (
                      <tr key={r.name}>
                        <td className="td-name">{r.name}</td>
                        <td className="td-qty">{r.sap.toLocaleString()}</td>
                        <td className="td-qty">{r.recovery.toLocaleString()}</td>
                        <td className="td-qty bold">₱{r.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 700 }}>
                      <td className="td-name">TOTAL</td>
                      <td className="td-qty">{totals.sap.toLocaleString()}</td>
                      <td className="td-qty">{totals.recovery.toLocaleString()}</td>
                      <td className="td-qty">₱{totals.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          ) : filtered.length === 0 ? (
            <div className="empty-state"><p>{intakes.length === 0 ? 'No sap intake logged yet.' : 'No results match your filters.'}</p></div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Tapper</th><th>Sap Received</th><th>Recovery</th><th>Rate</th><th>Amount</th><th>Paid</th><th>Notes</th><th></th></tr>
                </thead>
                <tbody>
                  {filtered.map(entry => {
                    const amount = Number(entry.recovery_kg) * Number(entry.rate_per_kg)
                    return (
                      <tr key={entry.id}>
                        <td className="td-mono">{entry.date}</td>
                        <td className="td-name">{entry.tappers?.name}</td>
                        <td className="td-qty">{Number(entry.sap_received_kg).toLocaleString()} kg</td>
                        <td className="td-qty">{Number(entry.recovery_kg).toLocaleString()} kg</td>
                        <td className="td-qty">₱{Number(entry.rate_per_kg).toLocaleString()}</td>
                        <td className="td-qty bold">₱{amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
                        <td>
                          <button className="icon-btn" onClick={() => togglePaid(entry)} title="Toggle paid status" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            {entry.is_paid
                              ? <span className="badge badge-green"><CheckCircle2 size={12} /> Paid</span>
                              : <span className="badge badge-amber"><Circle size={12} /> Unpaid</span>}
                          </button>
                        </td>
                        <td className="td-muted">{entry.notes || '—'}</td>
                        <td className="td-actions">
                          <button className="icon-btn" onClick={() => openEdit(entry)} title="Edit" style={{ marginRight: 2 }}><Pencil size={14} /></button>
                          <button className="icon-btn danger" onClick={() => handleDelete(entry.id)} title="Delete"><Trash2 size={14} /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Tappers list management */}
          <div style={{ marginTop: 28 }}>
            <h3 style={{ fontSize: 14, margin: '0 0 10px', color: 'var(--text-2)' }}>Tappers</h3>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Name</th><th>Contact</th><th></th></tr></thead>
                <tbody>
                  {tappers.map(t => (
                    <tr key={t.id}>
                      <td className="td-name">{t.name}</td>
                      <td className="td-muted">{t.contact || '—'}</td>
                      <td className="td-actions">
                        <button className="icon-btn" onClick={() => openEditTapper(t)} title="Edit" style={{ marginRight: 2 }}><Pencil size={14} /></button>
                        <button className="icon-btn danger" onClick={() => handleTapperDelete(t.id)} title="Delete"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* New/Edit Tapper modal */}
      {showTapperForm && (
        <div className="modal-overlay" onClick={() => { setShowTapperForm(false); setEditingTapper(null) }}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingTapper ? 'Edit Tapper' : 'New Tapper'}</h2>
              <button className="icon-btn" onClick={() => { setShowTapperForm(false); setEditingTapper(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleTapperSave} className="modal-form">
              <div className="field-group">
                <label>Name *</label>
                <input value={tapperForm.name} onChange={e => setTapperForm({ ...tapperForm, name: e.target.value })} placeholder="e.g. Jemrex Cinco" />
              </div>
              <div className="field-group">
                <label>Contact</label>
                <input value={tapperForm.contact} onChange={e => setTapperForm({ ...tapperForm, contact: e.target.value })} placeholder="Optional phone / address" />
              </div>
              {tapperError && <p className="form-error">{tapperError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => { setShowTapperForm(false); setEditingTapper(null) }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={tapperSaving}><Check size={15} /> {tapperSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log/Edit Intake modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingEntry(null) }}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEntry ? 'Edit Sap Intake' : 'Log Sap Intake'}</h2>
              <button className="icon-btn" onClick={() => { setShowForm(false); setEditingEntry(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-row">
                <div className="field-group">
                  <label>Tapper *</label>
                  <div className="select-wrap">
                    <select value={form.tapper_id} onChange={e => setForm({ ...form, tapper_id: e.target.value })}>
                      {tappers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="select-icon" />
                  </div>
                </div>
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
              </div>
              <div className="field-group">
                <label>Feeds Raw Material *</label>
                <div className="select-wrap">
                  <select value={form.raw_material_id} onChange={e => setForm({ ...form, raw_material_id: e.target.value })}>
                    <option value="">Select...</option>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Sap Received (kg) *</label>
                  <input type="number" min="0.01" step="any" value={form.sap_received_kg} onChange={e => setForm({ ...form, sap_received_kg: e.target.value })} placeholder="0" />
                </div>
                <div className="field-group">
                  <label>Recovery (kg) * {selectedMaterial && <span className="unit-hint">({selectedMaterial.unit})</span>}</label>
                  <input type="number" min="0.01" step="any" value={form.recovery_kg} onChange={e => setForm({ ...form, recovery_kg: e.target.value })} placeholder="0" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Rate (₱/kg) *</label>
                  <input type="number" min="0.01" step="any" value={form.rate_per_kg} onChange={e => setForm({ ...form, rate_per_kg: e.target.value })} />
                </div>
                <div className="field-group">
                  <label>Amount</label>
                  <input value={`₱${computedAmount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`} disabled />
                </div>
              </div>
              <div className="field-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_paid} onChange={e => setForm({ ...form, is_paid: e.target.checked })} style={{ width: 'auto' }} />
                  Already paid
                </label>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional" />
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => { setShowForm(false); setEditingEntry(null) }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}><Check size={15} /> {saving ? 'Saving...' : editingEntry ? 'Update' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
