import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Pencil, Trash2, X, Check, Search } from 'lucide-react'
import { showToast } from '../components/Toast'

const UNITS = ['pc', 'pack', 'box', 'bottle', 'sachet', 'bag', 'tray', 'can', 'jar', 'pouch', 'kg', 'g', 'ml', 'L']

export default function Products() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', unit: 'pc', unit_price: '', opening_stock: '', description: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => { fetchProducts() }, [])

  async function fetchProducts() {
    setLoading(true)
    const { data } = await supabase.from('products').select('*').order('name')
    setProducts(data || [])
    setLoading(false)
  }

  function openNew() {
    setForm({ name: '', unit: 'pc', unit_price: '', opening_stock: '', description: '' })
    setEditingId(null); setError(''); setShowForm(true)
  }

  function openEdit(p) {
    setForm({
      name: p.name, unit: p.unit,
      unit_price: p.unit_price != null ? String(p.unit_price) : '',
      opening_stock: p.opening_stock != null ? String(p.opening_stock) : '',
      description: p.description || ''
    })
    setEditingId(p.id); setError(''); setShowForm(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Product name is required.')
    setSaving(true); setError('')

    const payload = {
      name: form.name.trim(),
      unit: form.unit,
      unit_price: form.unit_price !== '' ? Number(form.unit_price) : null,
      opening_stock: form.opening_stock !== '' ? Number(form.opening_stock) : 0,
      description: form.description.trim() || null,
    }

    const { error } = editingId
      ? await supabase.from('products').update(payload).eq('id', editingId)
      : await supabase.from('products').insert(payload)

    setSaving(false)
    if (error) return setError(error.message)
    setShowForm(false); fetchProducts(); showToast(editingId ? 'Product updated' : 'Product added')
  }

  async function handleDelete(id) {
    if (!confirm('Delete this product? This will also remove all related entries.')) return
    await supabase.from('products').delete().eq('id', id)
    fetchProducts()
  }

  const fmt = (n) => n != null ? `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—'

  const filteredProducts = products.filter(p => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return p.name?.toLowerCase().includes(q)
  })

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p className="page-desc">Manage your product catalog, pricing, and opening stock.</p>
        </div>
        <button className="btn-primary" onClick={openNew}><Plus size={16} /> Add Product</button>
      </div>

      {loading ? (
        <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : products.length === 0 ? (
        <div className="empty-state"><p>No products yet. Add your first product to get started.</p></div>
      ) : (
        <>
          <div className="table-filters">
            <div className="search-wrap">
              <Search size={15} className="search-icon" />
              <input className="search-input" placeholder="Search by name..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {filteredProducts.length === 0 ? (
            <div className="empty-state"><p>No products match "{search}".</p></div>
          ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Unit</th>
                <th>Unit Price</th>
                <th>Opening Stock</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(p => (
                <tr key={p.id}>
                  <td className="td-name">{p.name}</td>
                  <td><span className="badge">{p.unit}</span></td>
                  <td className="td-qty">{fmt(p.unit_price)}</td>
                  <td className="td-qty">{p.opening_stock > 0 ? `${p.opening_stock} ${p.unit}` : '—'}</td>
                  <td className="td-muted">{p.description || '—'}</td>
                  <td className="td-actions">
                    <button className="icon-btn" onClick={() => openEdit(p)} title="Edit"><Pencil size={15} /></button>
                    <button className="icon-btn danger" onClick={() => handleDelete(p.id)} title="Delete"><Trash2 size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => setShowForm(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit Product' : 'New Product'}</h2>
              <button className="icon-btn" onClick={() => setShowForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-group">
                <label>Product Name *</label>
                <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="e.g. Coco Sugar 200g" />
              </div>
              <div className="field-group">
                <label>Unit *</label>
                <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Unit Price (₱)</label>
                  <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => setForm({...form, unit_price: e.target.value})} placeholder="0.00" />
                </div>
                <div className="field-group">
                  <label>Opening Stock</label>
                  <input type="number" min="0" step="any" value={form.opening_stock} onChange={e => setForm({...form, opening_stock: e.target.value})} placeholder="Stock before using this system" />
                </div>
              </div>
              <div className="field-group">
                <label>Description</label>
                <input value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Optional notes" />
              </div>
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <Check size={15} /> {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
