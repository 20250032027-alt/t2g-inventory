import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Pencil, Trash2, Lock, Boxes } from 'lucide-react'
import { showToast } from '../components/Toast'

const ADMIN_PIN = '1234'

function PinModal({ onSuccess, onCancel, title }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  function handleSubmit(e) {
    e.preventDefault()
    if (pin === ADMIN_PIN) { onSuccess() }
    else { setError('Incorrect PIN. Try again.'); setPin(''); inputRef.current?.focus() }
  }
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} style={{ color: 'var(--amber)' }} />
            <h2>{title || 'Admin Required'}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-2)' }}>Enter the admin PIN to continue.</p>
          <div className="field-group" style={{ marginBottom: 12 }}>
            <label>Admin PIN</label>
            <input ref={inputRef} type="password" inputMode="numeric" maxLength={8} value={pin}
              onChange={e => { setPin(e.target.value); setError('') }} placeholder="••••" autoComplete="off" />
          </div>
          {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!pin}><Check size={15} /> Confirm</button>
          </div>
        </form>
      </div>
    </div>
  )
}

const UNITS = ['kg', 'g', 'L', 'ml', 'pc', 'sack', 'bag', 'box', 'roll', 'bottle', 'pack']

export default function RawMaterials() {
  const [materials, setMaterials] = useState([])
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterMaterial, setFilterMaterial] = useState('all')

  // Raw material catalog form (add/edit a material)
  const [showMatForm, setShowMatForm] = useState(false)
  const [editingMat, setEditingMat] = useState(null)
  const [matForm, setMatForm] = useState({ name: '', unit: 'kg', unit_cost: '', opening_stock: '' })
  const [matError, setMatError] = useState('')
  const [matSaving, setMatSaving] = useState(false)

  // Intake entry form
  const [showForm, setShowForm] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [form, setForm] = useState({ raw_material_id: '', quantity: '', date: today(), batch_notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Adjustment entry (PIN-gated manual correction, can be positive or negative)
  const [pinModal, setPinModal] = useState(false)
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ raw_material_id: '', quantity: '', date: today(), batch_notes: '' })
  const [adjustError, setAdjustError] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  function today() { return new Date().toISOString().split('T')[0] }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: mats }, { data: ents }] = await Promise.all([
      supabase.from('raw_materials').select('*').order('name'),
      supabase.from('raw_material_entries').select('*, raw_materials(name, unit)').order('date', { ascending: false }).limit(500),
    ])
    setMaterials(mats || [])
    setEntries(ents || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let rows = entries
    if (filterMaterial !== 'all') rows = rows.filter(e => e.raw_material_id === filterMaterial)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.raw_materials?.name?.toLowerCase().includes(q) ||
        e.batch_notes?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [entries, search, filterMaterial])

  // Running balance per raw material: opening_stock + cumulative signed entries in chronological order
  const { runningBalanceByEntry, currentBalanceByMaterial } = useMemo(() => {
    const openingMap = {}
    materials.forEach(m => { openingMap[m.id] = Number(m.opening_stock) || 0 })
    const chronological = [...entries].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    })
    const byEntry = {}
    const running = { ...openingMap }
    chronological.forEach(e => {
      running[e.raw_material_id] = (running[e.raw_material_id] ?? 0) + Number(e.quantity)
      byEntry[e.id] = running[e.raw_material_id]
    })
    return { runningBalanceByEntry: byEntry, currentBalanceByMaterial: running }
  }, [entries, materials])

  const selectedMaterial = materials.find(m => m.id === form.raw_material_id)
  const adjustSelectedMaterial = materials.find(m => m.id === adjustForm.raw_material_id)

  // --- Raw material catalog CRUD ---
  function openNewMaterial() {
    setMatForm({ name: '', unit: 'kg', unit_cost: '', opening_stock: '' })
    setEditingMat(null); setMatError(''); setShowMatForm(true)
  }
  function openEditMaterial(m) {
    setMatForm({
      name: m.name, unit: m.unit,
      unit_cost: m.unit_cost != null ? String(m.unit_cost) : '',
      opening_stock: m.opening_stock != null ? String(m.opening_stock) : '',
    })
    setEditingMat(m); setMatError(''); setShowMatForm(true)
  }
  async function handleMatSave(e) {
    e.preventDefault()
    if (!matForm.name.trim()) return setMatError('Material name is required.')
    setMatSaving(true); setMatError('')
    const payload = {
      name: matForm.name.trim(),
      unit: matForm.unit,
      unit_cost: matForm.unit_cost !== '' ? Number(matForm.unit_cost) : null,
      opening_stock: matForm.opening_stock !== '' ? Number(matForm.opening_stock) : 0,
    }
    const { error } = editingMat
      ? await supabase.from('raw_materials').update(payload).eq('id', editingMat.id)
      : await supabase.from('raw_materials').insert(payload)
    setMatSaving(false)
    if (error) return setMatError(error.message)
    setShowMatForm(false); setEditingMat(null); fetchAll()
    showToast(editingMat ? 'Raw material updated' : 'Raw material added')
  }
  async function handleMatDelete(id) {
    if (!confirm('Delete this raw material? This also removes its stock history and any assembly recipe lines using it.')) return
    await supabase.from('raw_materials').delete().eq('id', id)
    fetchAll()
  }

  // --- Intake entries ---
  function openNew() {
    setForm({ raw_material_id: materials[0]?.id || '', quantity: '', date: today(), batch_notes: '' })
    setError(''); setEditingEntry(null); setShowForm(true)
  }
  function openEdit(entry) {
    setEditingEntry(entry)
    setForm({
      raw_material_id: entry.raw_material_id,
      quantity: String(entry.quantity),
      date: entry.date,
      batch_notes: entry.batch_notes || '',
    })
    setError(''); setShowForm(true)
  }
  async function handleSave(e) {
    e.preventDefault()
    if (!form.raw_material_id) return setError('Select a raw material.')
    if (!form.quantity || isNaN(form.quantity) || Number(form.quantity) <= 0) return setError('Enter a valid quantity.')
    setSaving(true); setError('')
    const payload = {
      raw_material_id: form.raw_material_id, quantity: Number(form.quantity),
      date: form.date, batch_notes: form.batch_notes.trim() || null, entry_type: 'intake',
    }
    const { error } = editingEntry
      ? await supabase.from('raw_material_entries').update(payload).eq('id', editingEntry.id)
      : await supabase.from('raw_material_entries').insert(payload)
    setSaving(false)
    if (error) return setError(error.message)
    setShowForm(false); setEditingEntry(null); fetchAll()
    showToast(editingEntry ? 'Intake entry updated' : 'Raw material intake logged')
  }
  async function handleDelete(id) {
    if (!confirm('Remove this entry?')) return
    await supabase.from('raw_material_entries').delete().eq('id', id)
    fetchAll()
  }

  // --- Adjustment entries (PIN-gated) ---
  function requestAdjust() { setPinModal(true) }
  function handlePinSuccess() {
    setPinModal(false)
    setAdjustForm({ raw_material_id: materials[0]?.id || '', quantity: '', date: today(), batch_notes: '' })
    setAdjustError(''); setShowAdjustForm(true)
  }
  async function handleAdjustSave(e) {
    e.preventDefault()
    if (!adjustForm.raw_material_id) return setAdjustError('Select a raw material.')
    if (!adjustForm.quantity || isNaN(adjustForm.quantity) || Number(adjustForm.quantity) === 0) {
      return setAdjustError('Enter a non-zero quantity (positive to add stock, negative to remove).')
    }
    setAdjustSaving(true); setAdjustError('')
    const { error } = await supabase.from('raw_material_entries').insert({
      raw_material_id: adjustForm.raw_material_id, quantity: Number(adjustForm.quantity),
      date: adjustForm.date, batch_notes: adjustForm.batch_notes.trim() || null, entry_type: 'adjustment',
    })
    setAdjustSaving(false)
    if (error) return setAdjustError(error.message)
    setShowAdjustForm(false); fetchAll()
    showToast('Adjustment saved')
  }

  const totalFiltered = filtered.reduce((s, e) => s + Number(e.quantity), 0)

  function typeBadge(e) {
    if (e.entry_type === 'adjustment') return <span className="badge" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', fontWeight: 700 }}>Adjustment</span>
    if (e.entry_type === 'consumption') return <span className="badge badge-amber">Consumed (Production)</span>
    return <span className="td-muted">Intake</span>
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Raw Materials</h1>
          <p className="page-desc">Track raw material stock: log intake, view consumption from production, and running balances.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={requestAdjust}><Lock size={14} /> Adjustment</button>
          <button className="btn-ghost" onClick={openNewMaterial}><Plus size={16} /> New Material</button>
          <button className="btn-primary" onClick={openNew} disabled={materials.length === 0}><Plus size={16} /> Log Intake</button>
        </div>
      </div>

      {materials.length === 0 && !loading && (
        <div className="empty-state"><p>No raw materials yet. Click "New Material" to add your first one (e.g. Flour, Sugar, Packaging).</p></div>
      )}

      {materials.length > 0 && (
        <>
          <div className="table-filters">
            <div className="search-wrap">
              <Search size={15} className="search-icon" />
              <input className="search-input" placeholder="Search material or notes..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="select-wrap filter-select">
              <select value={filterMaterial} onChange={e => setFilterMaterial(e.target.value)}>
                <option value="all">All Materials</option>
                {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <ChevronDown size={15} className="select-icon" />
            </div>
            {filterMaterial !== 'all' && (
              <div className="filter-revenue">
                <span className="filter-revenue-label">Current Stock</span>
                <span className="filter-revenue-value">
                  {Number(currentBalanceByMaterial[filterMaterial] || 0).toLocaleString()} {materials.find(m => m.id === filterMaterial)?.unit}
                </span>
              </div>
            )}
            {filtered.length > 0 && (
              <div className="filter-revenue">
                <span className="filter-revenue-label">Filtered Net</span>
                <span className="filter-revenue-value">{totalFiltered.toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Material catalog with current stock at a glance */}
          <div className="table-wrap" style={{ marginBottom: 24 }}>
            <table className="data-table">
              <thead>
                <tr><th>Material</th><th>Unit</th><th>Unit Cost</th><th>Opening</th><th>Current Stock</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {materials.map(m => {
                  const stock = Number(currentBalanceByMaterial[m.id] ?? m.opening_stock ?? 0)
                  return (
                    <tr key={m.id}>
                      <td className="td-name">{m.name}</td>
                      <td><span className="badge">{m.unit}</span></td>
                      <td className="td-qty">{m.unit_cost != null ? `₱${Number(m.unit_cost).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'}</td>
                      <td className="td-qty">{(Number(m.opening_stock) || 0).toLocaleString()} <span className="unit-label">{m.unit}</span></td>
                      <td className="td-qty bold">{stock.toLocaleString()} <span className="unit-label">{m.unit}</span></td>
                      <td>{stock < 0 ? <span className="badge badge-red">Oversold</span> : stock < 10 ? <span className="badge badge-amber">Low</span> : <span className="badge badge-green">In Stock</span>}</td>
                      <td className="td-actions">
                        <button className="icon-btn" onClick={() => openEditMaterial(m)} title="Edit" style={{ marginRight: 2 }}><Pencil size={14} /></button>
                        <button className="icon-btn danger" onClick={() => handleMatDelete(m.id)} title="Delete"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loading ? (
        <div className="skeleton-list">{[1,2,3,4].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : materials.length === 0 ? null : filtered.length === 0 ? (
        <div className="empty-state"><p>{entries.length === 0 ? 'No stock movements yet.' : 'No results match your search.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Material</th><th>Quantity</th><th>Type</th><th>Running Balance</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="td-mono">{e.date}</td>
                  <td className="td-name">{e.raw_materials?.name}</td>
                  <td className="td-qty" style={{ color: Number(e.quantity) < 0 ? 'var(--red-text, #f87171)' : undefined }}>
                    {Number(e.quantity) > 0 ? '+' : ''}{Number(e.quantity).toLocaleString()} <span className="unit-label">{e.raw_materials?.unit}</span>
                  </td>
                  <td>{typeBadge(e)}</td>
                  <td className="td-qty">{Number(runningBalanceByEntry[e.id] ?? 0).toLocaleString()} <span className="unit-label">{e.raw_materials?.unit}</span></td>
                  <td className="td-muted">{e.batch_notes || '—'}</td>
                  <td className="td-actions">
                    {e.entry_type !== 'consumption' && (
                      <>
                        <button className="icon-btn" onClick={() => openEdit(e)} title="Edit" style={{ marginRight: 2 }}><Pencil size={14} /></button>
                        <button className="icon-btn danger" onClick={() => handleDelete(e.id)} title="Delete">×</button>
                      </>
                    )}
                    {e.entry_type === 'consumption' && <span className="td-muted" style={{ fontSize: 11 }}>via Production</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* New / Edit Material modal */}
      {showMatForm && (
        <div className="modal-overlay" onClick={() => { setShowMatForm(false); setEditingMat(null) }}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Boxes size={16} />
                <h2>{editingMat ? 'Edit Raw Material' : 'New Raw Material'}</h2>
              </div>
              <button className="icon-btn" onClick={() => { setShowMatForm(false); setEditingMat(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleMatSave} className="modal-form">
              <div className="field-group">
                <label>Material Name *</label>
                <input value={matForm.name} onChange={e => setMatForm({ ...matForm, name: e.target.value })} placeholder="e.g. Coconut Sap" />
              </div>
              <div className="field-group">
                <label>Unit *</label>
                <select value={matForm.unit} onChange={e => setMatForm({ ...matForm, unit: e.target.value })}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Unit Cost (₱)</label>
                  <input type="number" min="0" step="0.01" value={matForm.unit_cost} onChange={e => setMatForm({ ...matForm, unit_cost: e.target.value })} placeholder="0.00" />
                </div>
                <div className="field-group">
                  <label>Opening Stock</label>
                  <input type="number" min="0" step="any" value={matForm.opening_stock} onChange={e => setMatForm({ ...matForm, opening_stock: e.target.value })} placeholder="Stock before using this system" />
                </div>
              </div>
              {matError && <p className="form-error">{matError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => { setShowMatForm(false); setEditingMat(null) }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={matSaving}><Check size={15} /> {matSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Intake modal */}
      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingEntry(null) }}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEntry ? 'Edit Intake Entry' : 'Log Raw Material Intake'}</h2>
              <button className="icon-btn" onClick={() => { setShowForm(false); setEditingEntry(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-group">
                <label>Raw Material *</label>
                <div className="select-wrap">
                  <select value={form.raw_material_id} onChange={e => setForm({ ...form, raw_material_id: e.target.value })}>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Quantity * {selectedMaterial && <span className="unit-hint">({selectedMaterial.unit})</span>}</label>
                  <input type="number" min="0.01" step="any" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="0" />
                </div>
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
                </div>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <input value={form.batch_notes} onChange={e => setForm({ ...form, batch_notes: e.target.value })} placeholder="Optional notes, e.g. supplier or delivery receipt no." />
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

      {pinModal && (
        <PinModal title="Adjustment Entry" onSuccess={handlePinSuccess} onCancel={() => setPinModal(false)} />
      )}

      {showAdjustForm && (
        <div className="modal-overlay" onClick={() => setShowAdjustForm(false)}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Adjustment Entry</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                  Manual stock correction. Use a positive quantity to add stock, negative to remove it.
                </p>
              </div>
              <button className="icon-btn" onClick={() => setShowAdjustForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleAdjustSave} className="modal-form">
              <div className="field-group">
                <label>Raw Material *</label>
                <div className="select-wrap">
                  <select value={adjustForm.raw_material_id} onChange={e => setAdjustForm({ ...adjustForm, raw_material_id: e.target.value })}>
                    {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Quantity * {adjustSelectedMaterial && <span className="unit-hint">({adjustSelectedMaterial.unit})</span>}</label>
                  <input type="number" step="any" value={adjustForm.quantity} onChange={e => setAdjustForm({ ...adjustForm, quantity: e.target.value })} placeholder="e.g. -5 or 5" />
                </div>
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={adjustForm.date} onChange={e => setAdjustForm({ ...adjustForm, date: e.target.value })} />
                </div>
              </div>
              <div className="field-group">
                <label>Reason / Notes</label>
                <input value={adjustForm.batch_notes} onChange={e => setAdjustForm({ ...adjustForm, batch_notes: e.target.value })} placeholder="e.g. Physical count correction" />
              </div>
              {adjustError && <p className="form-error">{adjustError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowAdjustForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={adjustSaving}><Check size={15} /> {adjustSaving ? 'Saving...' : 'Save Adjustment'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
