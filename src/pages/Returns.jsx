import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Pencil, Trash2 } from 'lucide-react'
import { showToast } from '../components/Toast'

const REASONS = ['Bad Order', 'Wrong Item', 'Damaged', 'Expired', 'Client Return', 'Other']

function emptyLine(defaultProductId) {
  return {
    product_id: defaultProductId || '', quantity: '', reason: 'Bad Order',
    restore_stock: true, is_consigned: false, invoice_id: '',
  }
}

export default function Returns() {
  const [entries, setEntries] = useState([])
  const [products, setProducts] = useState([])
  const [consignInvoices, setConsignInvoices] = useState([])
  const [counterItems, setCounterItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filterReason, setFilterReason] = useState('all')
  const [form, setForm] = useState({
    reference_no: '', client: '', date: today(), notes: '',
    lines: [emptyLine()],
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)

  // Local calendar date (NOT UTC) — toISOString() returns the wrong date for early-morning
  // hours in the Philippines (UTC+8), silently misdating entries logged before ~8am.
  function today() {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: ents }, { data: invs }, { data: cItems }] = await Promise.all([
      supabase.from('products').select('id, name, unit').order('name'),
      supabase.from('return_entries').select('*, products(name, unit), invoices(reference_no, client, date)').order('date', { ascending: false }),
      supabase.from('invoices').select('*, invoice_items(product_id, quantity)').eq('payment_type', 'Consign').order('date', { ascending: false }),
      supabase.from('counter_items').select('invoice_id, product_id, quantity'),
    ])
    setProducts(prods || [])
    setEntries(ents || [])
    setConsignInvoices(invs || [])
    setCounterItems(cItems || [])
    setLoading(false)
  }

  // How much of an invoice's product qty has already been settled as sold (counter_items)
  function getCounteredQty(invoiceId, productId) {
    return counterItems
      .filter(ci => ci.invoice_id === invoiceId && ci.product_id === productId)
      .reduce((s, ci) => s + Number(ci.quantity), 0)
  }

  // How much has already been returned against this invoice/product (excluding the entry being edited)
  function getReturnedQty(invoiceId, productId, excludeId) {
    return entries
      .filter(e => e.invoice_id === invoiceId && e.product_id === productId && e.id !== excludeId)
      .reduce((s, e) => s + Number(e.quantity), 0)
  }

  // Remaining consign balance still pending with the client for this invoice/product
  function remainingForInvoiceProduct(invoiceId, productId, excludeId) {
    const inv = consignInvoices.find(i => i.id === invoiceId)
    const item = inv?.invoice_items?.find(it => it.product_id === productId)
    if (!item) return 0
    const countered = getCounteredQty(invoiceId, productId)
    const returned = getReturnedQty(invoiceId, productId, excludeId)
    return Math.max(0, Number(item.quantity) - countered - returned)
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
    setForm({
      reference_no: '', client: '', date: today(), notes: '',
      lines: [emptyLine(products[0]?.id)],
    })
    setError('')
    setShowForm(true)
  }

  // Editing an existing entry always edits just that one row/line — multi-line "Add Line" is
  // only for creating several returns from the same event at once, not for bulk-editing later.
  function openEdit(entry) {
    setEditingEntry(entry)
    setForm({
      reference_no: entry.reference_no || '',
      client: entry.client || '',
      date: entry.date,
      notes: entry.notes || '',
      lines: [{
        product_id: entry.product_id,
        quantity: String(entry.quantity),
        reason: entry.reason || 'Bad Order',
        restore_stock: entry.restore_stock,
        is_consigned: !!entry.invoice_id,
        invoice_id: entry.invoice_id || '',
      }],
    })
    setError('')
    setShowForm(true)
  }

  function addLine() {
    setForm(f => ({ ...f, lines: [...f.lines, emptyLine(products[0]?.id)] }))
  }

  function removeLine(i) {
    setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))
  }

  function updateLine(i, field, value) {
    setForm(f => {
      const lines = [...f.lines]
      const line = { ...lines[i], [field]: value }
      // Mirror the old single-line behavior: toggling "consigned" or changing the invoice
      // clears the product choice, since the product list narrows to that invoice's items.
      if (field === 'is_consigned') {
        line.invoice_id = ''
        line.product_id = value ? '' : (products[0]?.id || '')
      }
      if (field === 'invoice_id') {
        line.product_id = ''
      }
      lines[i] = line
      return { ...f, lines }
    })
  }

  function productOptionsForLine(line) {
    if (!line.is_consigned) return products
    return (consignInvoices.find(i => i.id === line.invoice_id)?.invoice_items || [])
      .map(it => products.find(p => p.id === it.product_id))
      .filter(Boolean)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (form.lines.length === 0) return setError('Add at least one product line.')

    // Validate each line, tracking how much of each invoice/product's remaining balance
    // has already been claimed by an earlier line in this same submission.
    const claimedByKey = {}
    for (const [i, line] of form.lines.entries()) {
      const n = i + 1
      if (!line.product_id) return setError(`Line ${n}: select a product.`)
      if (!line.quantity || isNaN(line.quantity) || Number(line.quantity) <= 0) return setError(`Line ${n}: enter a valid quantity.`)
      if (line.is_consigned) {
        if (!line.invoice_id) return setError(`Line ${n}: select which consign invoice this return is from.`)
        const key = `${line.invoice_id}::${line.product_id}`
        const alreadyClaimed = claimedByKey[key] || 0
        const max = remainingForInvoiceProduct(line.invoice_id, line.product_id, editingEntry?.id) - alreadyClaimed
        if (Number(line.quantity) > max) {
          return setError(`Line ${n}: only ${Math.max(0, max).toLocaleString()} still pending with the client on this invoice for this product.`)
        }
        claimedByKey[key] = alreadyClaimed + Number(line.quantity)
      }
    }

    setSaving(true); setError('')

    const sharedFields = {
      date: form.date,
      reference_no: form.reference_no.trim() || null,
      client: form.client.trim() || null,
      notes: form.notes.trim() || null,
    }

    if (editingEntry) {
      const line = form.lines[0]
      const payload = {
        ...sharedFields,
        product_id: line.product_id, quantity: Number(line.quantity),
        reason: line.reason, restore_stock: line.restore_stock,
        invoice_id: line.is_consigned ? line.invoice_id : null,
      }
      const { error } = await supabase.from('return_entries').update(payload).eq('id', editingEntry.id)
      setSaving(false)
      if (error) return setError(error.message)
      showToast('Return entry updated')
    } else {
      const rows = form.lines.map(line => ({
        ...sharedFields,
        product_id: line.product_id, quantity: Number(line.quantity),
        reason: line.reason, restore_stock: line.restore_stock,
        invoice_id: line.is_consigned ? line.invoice_id : null,
      }))
      const { error } = await supabase.from('return_entries').insert(rows)
      setSaving(false)
      if (error) return setError(error.message)
      showToast(rows.length > 1 ? `${rows.length} returns logged successfully` : 'Return logged successfully')
    }

    setShowForm(false)
    setEditingEntry(null)
    fetchAll()
  }

  async function handleDelete(id) {
    if (!confirm('Remove this return entry?')) return
    const { error } = await supabase.from('return_entries').delete().eq('id', id)
    if (error) { showToast(`Delete failed: ${error.message}`, 'error'); return }
    fetchAll()
    showToast('Entry removed')
  }

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
              <tr><th>Date</th><th>Ref #</th><th>Client</th><th>Product</th><th>Qty</th><th>Reason</th><th>Stock Action</th><th>Consign</th><th>Notes</th><th></th></tr>
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
                  <td>{e.invoice_id
                    ? <span className="badge badge-blue" title={e.invoices?.client}>{e.invoices?.reference_no || 'Consigned'}</span>
                    : <span className="td-muted">—</span>}</td>
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
                  <label>Reference / Delivery #</label>
                  <input value={form.reference_no} onChange={e => setForm({...form, reference_no: e.target.value})} placeholder="e.g. SI-2025-001" />
                </div>
                <div className="field-group">
                  <label>Client</label>
                  <input value={form.client} onChange={e => setForm({...form, client: e.target.value})} placeholder="Client name" />
                </div>
              </div>
              <div className="field-group">
                <label>Date *</label>
                <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{maxWidth: 200}} />
              </div>

              <div className="lines-section" style={{marginTop: 4}}>
                <div className="lines-header">
                  <span className="lines-title">Products Being Returned</span>
                  {!editingEntry && (
                    <button type="button" className="btn-ghost btn-sm" onClick={addLine}>
                      <Plus size={14} /> Add Line
                    </button>
                  )}
                </div>

                {form.lines.map((line, i) => {
                  const selectedProduct = products.find(p => p.id === line.product_id)
                  return (
                    <div key={i} style={{
                      border: '1px solid var(--border, #333)', borderRadius: 10,
                      padding: 14, marginBottom: 12, position: 'relative',
                    }}>
                      {!editingEntry && form.lines.length > 1 && (
                        <button type="button" className="icon-btn danger" onClick={() => removeLine(i)} title="Remove line"
                          style={{ position: 'absolute', top: 10, right: 10 }}>
                          <Trash2 size={14} />
                        </button>
                      )}

                      <div className="field-group" style={{marginBottom: 10}}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                          <input type="checkbox" checked={line.is_consigned}
                            onChange={e => updateLine(i, 'is_consigned', e.target.checked)}
                            style={{ width: 'auto' }} />
                          This is unsold consigned stock coming back from a client
                        </label>
                      </div>

                      {line.is_consigned && (
                        <div className="field-group" style={{marginBottom: 10}}>
                          <label>Consign Invoice *</label>
                          <div className="select-wrap">
                            <select value={line.invoice_id} onChange={e => updateLine(i, 'invoice_id', e.target.value)}>
                              <option value="">Select invoice...</option>
                              {consignInvoices.map(inv => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.reference_no || inv.id.slice(0, 8)} — {inv.client || 'No client'} ({inv.date})
                                </option>
                              ))}
                            </select>
                            <ChevronDown size={16} className="select-icon" />
                          </div>
                        </div>
                      )}

                      <div className="field-row" style={{marginBottom: 10}}>
                        <div className="field-group">
                          <label>Product *</label>
                          <div className="select-wrap">
                            <select value={line.product_id} onChange={e => updateLine(i, 'product_id', e.target.value)} disabled={line.is_consigned && !line.invoice_id}>
                              <option value="">{line.is_consigned && !line.invoice_id ? 'Select an invoice first' : 'Select...'}</option>
                              {productOptionsForLine(line).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <ChevronDown size={16} className="select-icon" />
                          </div>
                          {line.is_consigned && line.invoice_id && line.product_id && (
                            <p className="field-hint">
                              {remainingForInvoiceProduct(line.invoice_id, line.product_id, editingEntry?.id).toLocaleString()} still pending with the client for this product on this invoice.
                            </p>
                          )}
                        </div>
                        <div className="field-group">
                          <label>Quantity * {selectedProduct && <span className="unit-hint">({selectedProduct.unit})</span>}</label>
                          <input type="number" min="0.01" step="any" value={line.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} placeholder="0" />
                        </div>
                      </div>

                      <div className="field-row" style={{marginBottom: 10}}>
                        <div className="field-group">
                          <label>Reason</label>
                          <div className="select-wrap">
                            <select value={line.reason} onChange={e => updateLine(i, 'reason', e.target.value)}>
                              {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <ChevronDown size={16} className="select-icon" />
                          </div>
                        </div>
                        <div className="field-group">
                          <label>Stock Action</label>
                          <div className="toggle-group">
                            <button type="button" className={`toggle-btn ${line.restore_stock ? 'toggle-active' : ''}`} onClick={() => updateLine(i, 'restore_stock', true)}>Return to Stock</button>
                            <button type="button" className={`toggle-btn ${!line.restore_stock ? 'toggle-active-red' : ''}`} onClick={() => updateLine(i, 'restore_stock', false)}>Write Off</button>
                          </div>
                        </div>
                      </div>
                      <p className="field-hint" style={{margin: 0}}>{line.restore_stock ? 'Added back to available inventory.' : 'Recorded as a loss — will not return to inventory.'}</p>
                    </div>
                  )
                })}
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
