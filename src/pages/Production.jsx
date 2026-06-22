import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search } from 'lucide-react'
import { showToast } from '../components/Toast'

export default function Production() {
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('all')
  const [form, setForm] = useState({ product_id: '', quantity: '', date: today(), batch_notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  function today() { return new Date().toISOString().split('T')[0] }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: ents }] = await Promise.all([
      supabase.from('products').select('id, name, unit').order('name'),
      supabase.from('production_entries').select('*, products(name, unit)').order('date', { ascending: false }).limit(500),
    ])
    setProducts(prods || [])
    setEntries(ents || [])
    setLoading(false)
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

  function openNew() {
    setForm({ product_id: products[0]?.id || '', quantity: '', date: today(), batch_notes: '' })
    setError(''); setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.product_id) return setError('Select a product.')
    if (!form.quantity || isNaN(form.quantity) || Number(form.quantity) <= 0) return setError('Enter a valid quantity.')
    setSaving(true); setError('')
    const { error } = await supabase.from('production_entries').insert({
      product_id: form.product_id, quantity: Number(form.quantity),
      date: form.date, batch_notes: form.batch_notes.trim() || null,
    })
    setSaving(false)
    if (error) return setError(error.message)
    setShowForm(false)
    fetchAll()
    showToast('Production batch logged')
  }

  async function handleDelete(id) {
    if (!confirm('Remove this production entry?')) return
    await supabase.from('production_entries').delete().eq('id', id)
    fetchAll()
  }

  const selectedProduct = products.find(p => p.id === form.product_id)
  const totalFiltered = filtered.reduce((s, e) => s + Number(e.quantity), 0)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Production</h1>
          <p className="page-desc">Record and search production batches by product or notes.</p>
        </div>
        <button className="btn-primary" onClick={openNew} disabled={products.length === 0}>
          <Plus size={16} /> Log Production
        </button>
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
              <tr><th>Date</th><th>Product</th><th>Quantity</th><th>Batch Notes</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map(e => (
                <tr key={e.id}>
                  <td className="td-mono">{e.date}</td>
                  <td className="td-name">{e.products?.name}</td>
                  <td className="td-qty">{Number(e.quantity).toLocaleString()} <span className="unit-label">{e.products?.unit}</span></td>
                  <td className="td-muted">{e.batch_notes || '—'}</td>
                  <td className="td-actions">
                    <button className="icon-btn danger" onClick={() => handleDelete(e.id)} title="Delete">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>Log Production</h2>
              <button className="icon-btn" onClick={() => setShowForm(false)}><X size={18} /></button>
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
                <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}><Check size={15} /> {saving ? 'Saving...' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
