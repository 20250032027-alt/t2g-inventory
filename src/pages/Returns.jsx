import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Pencil } from 'lucide-react'
import { showToast } from '../components/Toast'

const REASONS = ['Bad Order', 'Wrong Item', 'Damaged', 'Expired', 'Client Return', 'Other']

export default function Returns() {
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterReason, setFilterReason] = useState('all')
  const [form, setForm] = useState({
    product_id: '', quantity: '', date: today(),
    reason: 'Bad Order', restore_stock: true,
    reference_no: '', client: '', notes: ''
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)

  function today() { return new Date().toISOString().split('T')[0] }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: ents }] = await Promise.all([
      supabase.from('products').select('id, name, unit').order('name'),
      supabase.from('return_entries').select('*, products(name, unit)').order('date', { ascending: false }).limit(300),
    ])
    setProducts(prods || [])
    setEntries(ents || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let rows = entries
    if (filterReason !== 'all') rows = rows.filter(e => e.reason === filterReason)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.products?.name?.toLowerCase().includes(q) ||
        e.client?.toLowerCase().includes(q) ||
        e.reference_no?.toLowerCase().includes(q) ||
        e.reason?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [entries, search, filterReason])

  function openNew() {
    setEditingEntry(null)
    setForm({ product_id: products[0]?.id || '', quantity: '', date: today(), reason: 'Bad Order', restore_stock: true, reference_no: '', client: '', notes: '' })
    setError('')
    setShowForm(true)
  }

  function openEdit(entry) {
    setEditingEntry(entry)
    setForm({
      product_id: entry.product_id,
      quantity: String(entry.quantity),
      date: entry.date,
      reason: entry.reason || 'Bad Order',
      restore_stock: entry.restore_stock,
      reference_no: entry.reference_no || '',
      client: entry.client || '',
      notes: entry.notes || '',
    })
    setError('')
    setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.product_id) return setError('Select a product.')
    if (!form.quantity || isNaN(form.quantity) || Number(form.quantity) <= 0) return setError('Enter a valid quantity.')
    setSaving(true); setError('')
    const payload = {
      product_id: form.product_id, quantity: Number(form.quantity), date: form.date,
      reason: form.reason, restore_stock: form.restore_stock,
      reference_no: form.reference_no.trim() || null,
      client: form.client.trim() || null,
      notes: form.notes.trim() || null,
    }
    const { error } = editingEntry
      ? await supabase.from('return_entries').update(payload).eq('id', editingEntry.id)
      : await supabase.from('return_entries').insert(payload)
    setSaving(false)
    if (error) return setError(error.message)
    setShowForm(false)
    setEditingEntry(null)
    fetchAll()
    showToast(editingEntry ? 'Return entry updated' : 'Return logged successfully')
  }

  async function handleDelete(id) {
    if (!confirm('Remove this return entry?')) return
    await supabase.from('return_entries').delete().eq('id', id)
    fetchAll()
    showToast('Entry removed', 'error')
  }

  const selectedProduct = products.find(p => p.id === form.product_id)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Bad Orders / Returns</h1>
          <p className="page-desc">Log returned or bad order stock and track disposal or re-entry into inventory.</p>
        </div>
        <button className="btn-primary" onClick={openNew} disabled={products.length === 0}>
          <Plus size={16} /> Log Return
        </button>
      </div>

      <div className="table-filters">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input className="search-input" placeholder="Search client, product, reference..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="select-wrap filter-select">
          <select value={filterReason} onChange={e => setFilterReason(e.target.value)}>
            <option value="all">All Reasons</option>
            {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <ChevronDown size={15} className="select-icon" />
        </div>
      </div>

      {loading ? (
        <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <p>{entries.length === 0 ? 'No returns logged yet.' : 'No results match your search.'}</p>
          {entries.length === 0 && products.length > 0 && (
            <button className="btn-primary" style={{marginTop: 16}} onClick={openNew}>
              <Plus size={15} /> Log First Return
            </button>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>Date</th><th>Ref #</th><th>Client</th><th>Product</th><th>Qty</th><th>Reason</th><th>Stock Action</th><th>Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="td-mono">{e.date}</td>
                  <td className="td-muted">{e.reference_no || '—'}</td>
                  <td className="td-name">{e.client || '—'}</td>
                  <td>{e.products?.name}</td>
                  <td className="td-qty">{Number(e.quantity).toLocaleString()} <span className="unit-label">{e.products?.unit}</span></td>
                  <td><span className="badge badge-amber">{e.reason}</span></td>
                  <td>{e.restore_stock ? <span className="badge badge-green">Returned to Stock</span> : <span className="badge badge-red">Written Off</span>}</td>
                  <td className="td-muted">{e.notes || '—'}</td>
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
          <div className="modal modal-wide" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingEntry ? 'Edit Return / Bad Order' : 'Log Return / Bad Order'}</h2>
              <button className="icon-btn" onClick={() => { setShowForm(false); setEditingEntry(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-row">
                <div className="field-group">
                  <label>Reference / Invoice #</label>
                  <input value={form.reference_no} onChange={e => setForm({...form, reference_no: e.target.value})} placeholder="e.g. SI-2025-001" />
                </div>
                <div className="field-group">
                  <label>Client</label>
                  <input value={form.client} onChange={e => setForm({...form, client: e.target.value})} placeholder="Client name" />
                </div>
              </div>
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
                <label>Reason</label>
                <div className="select-wrap">
                  <select value={form.reason} onChange={e => setForm({...form, reason: e.target.value})}>
                    {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <ChevronDown size={16} className="select-icon" />
                </div>
              </div>
              <div className="field-group">
                <label>Stock Action</label>
                <div className="toggle-group">
                  <button type="button" className={`toggle-btn ${form.restore_stock ? 'toggle-active' : ''}`} onClick={() => setForm({...form, restore_stock: true})}>Return to Stock</button>
                  <button type="button" className={`toggle-btn ${!form.restore_stock ? 'toggle-active-red' : ''}`} onClick={() => setForm({...form, restore_stock: false})}>Write Off (Loss)</button>
                </div>
                <p className="field-hint">{form.restore_stock ? 'This quantity will be added back to available inventory.' : 'This quantity will be recorded as a loss and will not return to inventory.'}</p>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Optional details" />
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
