import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Pencil, Lock, SlidersHorizontal } from 'lucide-react'
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

export default function Production() {
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [recipes, setRecipes] = useState([]) // assembly_items: { product_id, raw_material_id, quantity_per_unit }
  const [rawMaterials, setRawMaterials] = useState([])
  const [rawMaterialStock, setRawMaterialStock] = useState({}) // raw_material_id -> current stock
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('all')
  const [form, setForm] = useState({ product_id: '', quantity: '', date: today(), batch_notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)

  // Adjustment entry (PIN-gated manual correction, can be positive or negative)
  const [pinModal, setPinModal] = useState(false)
  const [showAdjustForm, setShowAdjustForm] = useState(false)
  const [adjustForm, setAdjustForm] = useState({ product_id: '', quantity: '', date: today(), batch_notes: '' })
  const [adjustError, setAdjustError] = useState('')
  const [adjustSaving, setAdjustSaving] = useState(false)

  function today() { return new Date().toISOString().split('T')[0] }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: ents }, { data: recipeRows }, { data: mats }, { data: matEntries }] = await Promise.all([
      supabase.from('products').select('id, name, unit').order('name'),
      supabase.from('production_entries').select('*, products(name, unit)').order('date', { ascending: false }).limit(500),
      supabase.from('assembly_items').select('*'),
      supabase.from('raw_materials').select('id, name, unit, opening_stock'),
      supabase.from('raw_material_entries').select('raw_material_id, quantity'),
    ])
    setProducts(prods || [])
    setEntries(ents || [])
    setRecipes(recipeRows || [])
    setRawMaterials(mats || [])

    // Current stock per raw material = opening_stock + sum of all signed entries
    const stockMap = {}
    ;(mats || []).forEach(m => { stockMap[m.id] = Number(m.opening_stock) || 0 })
    ;(matEntries || []).forEach(e => { stockMap[e.raw_material_id] = (stockMap[e.raw_material_id] ?? 0) + Number(e.quantity) })
    setRawMaterialStock(stockMap)

    setLoading(false)
  }

  function recipeFor(productId) {
    return recipes.filter(r => r.product_id === productId)
  }

  // Consume raw materials per recipe for a saved production entry.
  // Returns { error } on failure. Assumes any prior consumption rows for this entry are already removed.
  async function consumeRawMaterials(productionEntryId, productId, quantity, date) {
    const recipe = recipeFor(productId)
    if (recipe.length === 0) return { error: null }
    const rows = recipe.map(r => ({
      raw_material_id: r.raw_material_id,
      quantity: -(Number(r.quantity_per_unit) * Number(quantity)),
      date,
      batch_notes: 'Auto-consumed for production batch',
      entry_type: 'consumption',
      production_entry_id: productionEntryId,
    }))
    const { error } = await supabase.from('raw_material_entries').insert(rows)
    return { error }
  }

  // Warn (but don't block) if a production run would take any raw material below zero.
  function confirmStockIfShort(productId, quantity) {
    const recipe = recipeFor(productId)
    if (recipe.length === 0) return true
    const shortages = []
    recipe.forEach(r => {
      const need = Number(r.quantity_per_unit) * Number(quantity)
      const have = rawMaterialStock[r.raw_material_id] ?? 0
      if (need > have) {
        const mat = rawMaterials.find(m => m.id === r.raw_material_id)
        shortages.push(`${mat?.name || 'Material'}: need ${need.toLocaleString()} ${mat?.unit || ''}, have ${have.toLocaleString()} ${mat?.unit || ''}`)
      }
    })
    if (shortages.length === 0) return true
    return confirm(`This batch needs more raw material than is currently in stock:\n\n${shortages.join('\n')}\n\nSave anyway? Raw material stock will go negative.`)
  }

  const filtered = useMemo(() => {
    let rows = entries
    if (filterProduct !== 'all') rows = rows.filter(e => e.product_id === filterProduct)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.products?.name?.toLowerCase().includes(q) ||
        e.batch_notes?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [entries, search, filterProduct])

  // Running balance per product: cumulative total (production batches +/- adjustments) in
  // chronological order, so each row shows the balance as of that entry.
  const { runningBalanceByEntry, currentBalanceByProduct } = useMemo(() => {
    const chronological = [...entries].sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      return new Date(a.created_at || 0) - new Date(b.created_at || 0)
    })
    const byEntry = {}
    const running = {}
    chronological.forEach(e => {
      running[e.product_id] = (running[e.product_id] || 0) + Number(e.quantity)
      byEntry[e.id] = running[e.product_id]
    })
    return { runningBalanceByEntry: byEntry, currentBalanceByProduct: running }
  }, [entries])

  function openNew() {
    setForm({ product_id: products[0]?.id || '', quantity: '', date: today(), batch_notes: '' })
    setError(''); setShowForm(true)
  }

  function openEdit(entry) {
    setEditingEntry(entry)
    setForm({
      product_id: entry.product_id,
      quantity: String(entry.quantity),
      date: entry.date,
      batch_notes: entry.batch_notes || '',
    })
    setError(''); setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.product_id) return setError('Select a product.')
    if (!form.quantity || isNaN(form.quantity) || Number(form.quantity) <= 0) return setError('Enter a valid quantity.')

    if (!confirmStockIfShort(form.product_id, form.quantity)) return

    setSaving(true); setError('')
    const payload = {
      product_id: form.product_id, quantity: Number(form.quantity),
      date: form.date, batch_notes: form.batch_notes.trim() || null,
    }

    let entryId = editingEntry?.id
    let saveError
    if (editingEntry) {
      const { error } = await supabase.from('production_entries').update(payload).eq('id', editingEntry.id)
      saveError = error
      // Clear old auto-consumption rows for this entry before recomputing (recipe or quantity may have changed)
      if (!error) await supabase.from('raw_material_entries').delete().eq('production_entry_id', editingEntry.id).eq('entry_type', 'consumption')
    } else {
      const { data, error } = await supabase.from('production_entries').insert(payload).select().single()
      saveError = error
      entryId = data?.id
    }

    if (saveError) { setSaving(false); return setError(saveError.message) }

    if (!editingEntry?.is_adjustment && entryId) {
      const { error: consumeError } = await consumeRawMaterials(entryId, form.product_id, form.quantity, form.date)
      if (consumeError) {
        setSaving(false)
        return setError(`Production saved, but raw material consumption failed: ${consumeError.message}`)
      }
    }

    setSaving(false)
    setShowForm(false)
    setEditingEntry(null)
    fetchAll()
    showToast(editingEntry ? 'Production entry updated' : 'Production batch logged')
  }

  async function handleDelete(id) {
    if (!confirm('Remove this production entry?')) return
    await supabase.from('production_entries').delete().eq('id', id)
    fetchAll()
  }

  // Adjustment entry: PIN-gated, quantity can be negative (manual stock correction)
  function requestAdjust() { setPinModal(true) }
  function handlePinSuccess() {
    setPinModal(false)
    setAdjustForm({ product_id: products[0]?.id || '', quantity: '', date: today(), batch_notes: '' })
    setAdjustError('')
    setShowAdjustForm(true)
  }

  async function handleAdjustSave(e) {
    e.preventDefault()
    if (!adjustForm.product_id) return setAdjustError('Select a product.')
    if (!adjustForm.quantity || isNaN(adjustForm.quantity) || Number(adjustForm.quantity) === 0) {
      return setAdjustError('Enter a non-zero quantity (positive to add stock, negative to remove).')
    }
    setAdjustSaving(true); setAdjustError('')
    const { error } = await supabase.from('production_entries').insert({
      product_id: adjustForm.product_id,
      quantity: Number(adjustForm.quantity),
      date: adjustForm.date,
      batch_notes: adjustForm.batch_notes.trim() || null,
      is_adjustment: true,
    })
    setAdjustSaving(false)
    if (error) return setAdjustError(error.message)
    setShowAdjustForm(false)
    fetchAll()
    showToast('Adjustment entry recorded')
  }

  const selectedProduct = products.find(p => p.id === form.product_id)
  const adjustSelectedProduct = products.find(p => p.id === adjustForm.product_id)
  const totalFiltered = filtered.reduce((s, e) => s + Number(e.quantity), 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Production</h1>
          <p className="page-desc">Record and search production batches by product or notes.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-ghost" onClick={requestAdjust} disabled={products.length === 0}>
            <SlidersHorizontal size={16} /> Adjustment Entry
          </button>
          <button className="btn-primary" onClick={openNew} disabled={products.length === 0}>
            <Plus size={16} /> Log Production
          </button>
        </div>
      </div>

      {products.length === 0 && !loading && <div className="notice">Add products first before logging production.</div>}

      <div className="table-filters">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input className="search-input" placeholder="Search product or batch notes..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="select-wrap filter-select">
          <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
            <option value="all">All Products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown size={15} className="select-icon" />
        </div>
        {filterProduct !== 'all' && (
          <div className="filter-revenue">
            <span className="filter-revenue-label">Current Running Balance</span>
            <span className="filter-revenue-value">
              {Number(currentBalanceByProduct[filterProduct] || 0).toLocaleString()} {products.find(p => p.id === filterProduct)?.unit}
            </span>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="filter-revenue">
            <span className="filter-revenue-label">Filtered Total</span>
            <span className="filter-revenue-value">{totalFiltered.toLocaleString()}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="skeleton-list">{[1,2,3,4].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>{entries.length === 0 ? 'No production entries yet.' : 'No results match your search.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Product</th><th>Quantity</th><th>Type</th><th>Running Balance</th><th>Batch Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="td-mono">{e.date}</td>
                  <td className="td-name">{e.products?.name}</td>
                  <td className="td-qty" style={{ color: e.is_adjustment && Number(e.quantity) < 0 ? 'var(--red-text, #f87171)' : undefined }}>
                    {Number(e.quantity) > 0 ? '+' : ''}{Number(e.quantity).toLocaleString()} <span className="unit-label">{e.products?.unit}</span>
                  </td>
                  <td>
                    {e.is_adjustment
                      ? <span className="badge" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--accent)', fontWeight: 700 }}>Adjustment</span>
                      : <span className="td-muted">Production</span>}
                  </td>
                  <td className="td-qty">{Number(runningBalanceByEntry[e.id] ?? 0).toLocaleString()} <span className="unit-label">{e.products?.unit}</span></td>
                  <td className="td-muted">{e.batch_notes || '—'}</td>
                  <td className="td-actions">
                    <button className="icon-btn" onClick={() => openEdit(e)} title="Edit" style={{ marginRight: 2 }}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-btn danger" onClick={() => handleDelete(e.id)} title="Delete">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingEntry(null) }}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEntry ? 'Edit Production Entry' : 'Log Production'}</h2>
              <button className="icon-btn" onClick={() => { setShowForm(false); setEditingEntry(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-group">
                <label>Product *</label>
                <div className="select-wrap">
                  <select value={form.product_id} onChange={e => setForm({...form, product_id: e.target.value})}>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Quantity * {selectedProduct && <span className="unit-hint">({selectedProduct.unit})</span>}</label>
                  <input type="number" min="0.01" step="any" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} placeholder="0" />
                </div>
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
                </div>
              </div>
              <div className="field-group">
                <label>Batch Notes</label>
                <input value={form.batch_notes} onChange={e => setForm({...form, batch_notes: e.target.value})} placeholder="Optional notes about this batch" />
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

      {/* PIN gate for Adjustment Entry */}
      {pinModal && (
        <PinModal
          title="Adjustment Entry"
          onSuccess={handlePinSuccess}
          onCancel={() => setPinModal(false)}
        />
      )}

      {/* Adjustment Entry form */}
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
                <label>Product *</label>
                <div className="select-wrap">
                  <select value={adjustForm.product_id} onChange={e => setAdjustForm({...adjustForm, product_id: e.target.value})}>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Quantity * {adjustSelectedProduct && <span className="unit-hint">({adjustSelectedProduct.unit})</span>}</label>
                  <input type="number" step="any" value={adjustForm.quantity} onChange={e => setAdjustForm({...adjustForm, quantity: e.target.value})} placeholder="e.g. -5 or 5" />
                </div>
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={adjustForm.date} onChange={e => setAdjustForm({...adjustForm, date: e.target.value})} />
                </div>
              </div>
              <div className="field-group">
                <label>Reason / Notes</label>
                <input value={adjustForm.batch_notes} onChange={e => setAdjustForm({...adjustForm, batch_notes: e.target.value})} placeholder="e.g. Physical count correction" />
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
