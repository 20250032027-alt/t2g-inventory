import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { X, Check, ChevronDown, Search, Layers, Plus, Trash2 } from 'lucide-react'
import { showToast } from '../components/Toast'

export default function Assembly() {
  const [products, setProducts] = useState([])
  const [materials, setMaterials] = useState([])
  const [items, setItems] = useState([]) // all assembly_items
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  const [editingProduct, setEditingProduct] = useState(null) // product being edited
  const [recipeRows, setRecipeRows] = useState([]) // [{ raw_material_id, quantity_per_unit }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: mats }, { data: rows }] = await Promise.all([
      supabase.from('products').select('id, name, unit').order('name'),
      supabase.from('raw_materials').select('id, name, unit').order('name'),
      supabase.from('assembly_items').select('*'),
    ])
    setProducts(prods || [])
    setMaterials(mats || [])
    setItems(rows || [])
    setLoading(false)
  }

  const itemsByProduct = useMemo(() => {
    const map = {}
    items.forEach(it => {
      if (!map[it.product_id]) map[it.product_id] = []
      map[it.product_id].push(it)
    })
    return map
  }, [items])

  const materialName = (id) => materials.find(m => m.id === id)?.name || '—'
  const materialUnit = (id) => materials.find(m => m.id === id)?.unit || ''

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products
    const q = search.trim().toLowerCase()
    return products.filter(p => p.name?.toLowerCase().includes(q))
  }, [products, search])

  function openEditor(product) {
    setEditingProduct(product)
    const existing = itemsByProduct[product.id] || []
    setRecipeRows(existing.length
      ? existing.map(it => ({ raw_material_id: it.raw_material_id, quantity_per_unit: String(it.quantity_per_unit) }))
      : [{ raw_material_id: materials[0]?.id || '', quantity_per_unit: '' }]
    )
    setError('')
  }

  function addRow() {
    setRecipeRows(rows => [...rows, { raw_material_id: materials.find(m => !rows.some(r => r.raw_material_id === m.id))?.id || '', quantity_per_unit: '' }])
  }
  function removeRow(idx) {
    setRecipeRows(rows => rows.filter((_, i) => i !== idx))
  }
  function updateRow(idx, field, value) {
    setRecipeRows(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function handleSaveRecipe(e) {
    e.preventDefault()
    const cleanRows = recipeRows.filter(r => r.raw_material_id && r.quantity_per_unit !== '')
    if (cleanRows.some(r => isNaN(r.quantity_per_unit) || Number(r.quantity_per_unit) <= 0)) {
      return setError('Each quantity must be a positive number.')
    }
    const ids = cleanRows.map(r => r.raw_material_id)
    if (new Set(ids).size !== ids.length) {
      return setError('Each raw material can only appear once in a recipe.')
    }
    setSaving(true); setError('')

    // Replace: delete existing rows for this product, then insert the current set
    const { error: delErr } = await supabase.from('assembly_items').delete().eq('product_id', editingProduct.id)
    if (delErr) { setSaving(false); return setError(delErr.message) }

    if (cleanRows.length > 0) {
      const payload = cleanRows.map(r => ({
        product_id: editingProduct.id,
        raw_material_id: r.raw_material_id,
        quantity_per_unit: Number(r.quantity_per_unit),
      }))
      const { error: insErr } = await supabase.from('assembly_items').insert(payload)
      if (insErr) { setSaving(false); return setError(insErr.message) }
    }

    setSaving(false)
    setEditingProduct(null)
    fetchAll()
    showToast('Assembly recipe saved')
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Product Assembly</h1>
          <p className="page-desc">Define the recipe (bill of materials) for each product — how much of each raw material makes one unit.</p>
        </div>
      </div>

      {materials.length === 0 && !loading && (
        <div className="notice">Add raw materials first (Raw Materials page) before building a recipe here.</div>
      )}

      {products.length === 0 && !loading ? (
        <div className="empty-state"><p>No products yet. Add products first.</p></div>
      ) : (
        <>
          <div className="table-filters">
            <div className="search-wrap">
              <Search size={15} className="search-icon" />
              <input className="search-input" placeholder="Search product..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {loading ? (
            <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Product</th><th>Recipe</th><th></th></tr>
                </thead>
                <tbody>
                  {filteredProducts.map(p => {
                    const recipe = itemsByProduct[p.id] || []
                    return (
                      <tr key={p.id}>
                        <td className="td-name">{p.name}</td>
                        <td className="td-muted">
                          {recipe.length === 0
                            ? <span style={{ opacity: 0.6 }}>No recipe set</span>
                            : recipe.map(it => `${Number(it.quantity_per_unit).toLocaleString()} ${materialUnit(it.raw_material_id)} ${materialName(it.raw_material_id)}`).join(', ')}
                        </td>
                        <td className="td-actions">
                          <button className="btn-ghost" onClick={() => openEditor(p)} style={{ padding: '6px 12px' }}>
                            <Layers size={14} /> {recipe.length ? 'Edit Recipe' : 'Set Recipe'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editingProduct && (
        <div className="modal-overlay" onClick={() => setEditingProduct(null)}>
          <div className="modal modal-wide" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Recipe: {editingProduct.name}</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                  Raw materials needed to produce 1 {editingProduct.unit} of {editingProduct.name}.
                </p>
              </div>
              <button className="icon-btn" onClick={() => setEditingProduct(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSaveRecipe} className="modal-form">
              {materials.length === 0 ? (
                <p className="form-error">No raw materials exist yet. Add some on the Raw Materials page first.</p>
              ) : (
                <>
                  {recipeRows.map((row, idx) => (
                    <div className="field-row" key={idx} style={{ alignItems: 'flex-end' }}>
                      <div className="field-group" style={{ flex: 2 }}>
                        <label>Raw Material</label>
                        <div className="select-wrap">
                          <select value={row.raw_material_id} onChange={e => updateRow(idx, 'raw_material_id', e.target.value)}>
                            <option value="">Select...</option>
                            {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                          <ChevronDown size={16} className="select-icon" />
                        </div>
                      </div>
                      <div className="field-group" style={{ flex: 1 }}>
                        <label>Qty per unit {row.raw_material_id && <span className="unit-hint">({materialUnit(row.raw_material_id)})</span>}</label>
                        <input type="number" min="0.001" step="any" value={row.quantity_per_unit}
                          onChange={e => updateRow(idx, 'quantity_per_unit', e.target.value)} placeholder="0" />
                      </div>
                      <button type="button" className="icon-btn danger" onClick={() => removeRow(idx)} title="Remove" style={{ marginBottom: 4 }}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                  <button type="button" className="btn-ghost" onClick={addRow} style={{ alignSelf: 'flex-start' }}>
                    <Plus size={14} /> Add Ingredient
                  </button>
                </>
              )}
              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setEditingProduct(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving || materials.length === 0}>
                  <Check size={15} /> {saving ? 'Saving...' : 'Save Recipe'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
