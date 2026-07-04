import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Check, X, Search, ChevronRight, Trash2, Lock, Plus, Pencil } from 'lucide-react'
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

function today() { return new Date().toISOString().split('T')[0] }
function fmt(n) { return n != null ? `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : '—' }

export default function Countering() {
  const [consignInvoices, setConsignInvoices] = useState([])
  const [counterLogs, setCounterLogs] = useState([])
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  // FIFO entry form
  const [showFifoForm, setShowFifoForm] = useState(false)
  const [fifoClient, setFifoClient] = useState('')
  const [fifoDate, setFifoDate] = useState(today())
  const [fifoRef, setFifoRef] = useState('')
  const [fifoNotes, setFifoNotes] = useState('')
  const [fifoQtys, setFifoQtys] = useState({})
  const [fifoPreview, setFifoPreview] = useState(null)
  const [fifoError, setFifoError] = useState('')
  const [saving, setSaving] = useState(false)

  // Audit view
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [pinModal, setPinModal] = useState(null)

  // Edit counter entry
  const [editingCounter, setEditingCounter] = useState(null)
  const [editDate, setEditDate] = useState('')
  const [editRef, setEditRef] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editQtys, setEditQtys] = useState({}) // keyed by counter_item id
  const [editError, setEditError] = useState('')

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: invs }, { data: logs }, { data: prods }] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, invoice_items(*, products(id, name, unit, unit_price))')
        .eq('payment_type', 'Consign')
        .order('date', { ascending: true }), // oldest first for FIFO
      supabase
        .from('counter_entries')
        .select('*, counter_items(id, product_id, quantity, invoice_id, products(name, unit))')
        .order('date', { ascending: false }),
      supabase.from('products').select('id, name, unit, unit_price').order('name'),
    ])
    setConsignInvoices(invs || [])
    setCounterLogs(logs || [])
    setProducts(prods || [])
    setLoading(false)
  }

  // How much has been countered for a given product on a given invoice
  function getCounteredQty(invoiceId, productId) {
    return counterLogs
      .flatMap(log => log.counter_items || [])
      .filter(item => item.invoice_id === invoiceId && item.product_id === productId)
      .reduce((s, item) => s + Number(item.quantity), 0)
  }

  // Unique clients from all consign invoices (for the dropdown)
  const consignClients = useMemo(() => {
    const seen = new Set()
    return consignInvoices
      .map(inv => inv.client)
      .filter(c => c && !seen.has(c) && seen.add(c))
      .sort()
  }, [consignInvoices])

  // Per product: list of invoices with remaining consign balance, ordered oldest→newest (FIFO)
  // When a client is selected, only their invoices contribute
  const fifoStock = useMemo(() => {
    const stock = {}
    const invoicesToUse = fifoClient
      ? consignInvoices.filter(inv => inv.client === fifoClient)
      : consignInvoices
    for (const inv of invoicesToUse) {
      for (const item of (inv.invoice_items || [])) {
        const pid = item.product_id
        const countered = getCounteredQty(inv.id, pid)
        const remaining = Number(item.quantity) - countered
        if (remaining <= 0) continue
        if (!stock[pid]) stock[pid] = []
        stock[pid].push({ invoice: inv, item, remaining })
      }
    }
    return stock
  }, [consignInvoices, counterLogs, fifoClient])

  // Total available per product across all consign invoices
  const availableByProduct = useMemo(() => {
    const avail = {}
    for (const [pid, batches] of Object.entries(fifoStock)) {
      avail[pid] = batches.reduce((s, b) => s + b.remaining, 0)
    }
    return avail
  }, [fifoStock])

  // Products that have any consign stock pending
  const pendingProducts = useMemo(() =>
    products.filter(p => (availableByProduct[p.id] || 0) > 0),
    [products, availableByProduct]
  )

  // Compute FIFO allocation: given qty per product, return list of { invoice_id, product_id, qty }
  function computeFifoAllocation(qtys) {
    const allocations = [] // { invoice_id, product_id, quantity }
    const errors = []

    for (const [pid, qtyStr] of Object.entries(qtys)) {
      const qty = Number(qtyStr)
      if (!qty || qty <= 0) continue

      const avail = availableByProduct[pid] || 0
      const prod = products.find(p => p.id === pid)
      if (qty > avail) {
        errors.push(`${prod?.name}: only ${avail} ${prod?.unit} available in consign stock (tried to sell ${qty})`)
        continue
      }

      // Distribute FIFO
      let remaining = qty
      for (const batch of (fifoStock[pid] || [])) {
        if (remaining <= 0) break
        const take = Math.min(remaining, batch.remaining)
        allocations.push({ invoice_id: batch.invoice.id, product_id: pid, quantity: take })
        remaining -= take
      }
    }

    return { allocations, errors }
  }

  function handleQtyChange(productId, value) {
    setFifoQtys(prev => ({ ...prev, [productId]: value }))
    setFifoPreview(null)
    setFifoError('')
  }

  function handlePreview() {
    const activeQtys = Object.fromEntries(
      Object.entries(fifoQtys).filter(([, v]) => v !== '' && Number(v) > 0)
    )
    if (Object.keys(activeQtys).length === 0) {
      setFifoError('Enter a sold quantity for at least one product.')
      return
    }
    const { allocations, errors } = computeFifoAllocation(activeQtys)
    if (errors.length > 0) {
      setFifoError(errors.join('\n'))
      setFifoPreview(null)
      return
    }
    setFifoError('')
    setFifoPreview(allocations)
  }

  async function handleFifoSave(e) {
    e.preventDefault()
    if (!fifoPreview) { handlePreview(); return }
    if (fifoPreview.length === 0) { setFifoError('Nothing to save.'); return }

    setSaving(true); setFifoError('')

    // 1. One counter_entry header (no invoice_id — spans multiple invoices)
    const { data: entry, error: entryErr } = await supabase
      .from('counter_entries')
      .insert({ invoice_id: null, date: fifoDate, reference_no: fifoRef.trim() || null, notes: fifoNotes.trim() || null })
      .select().single()

    if (entryErr) { setSaving(false); setFifoError(entryErr.message); return }

    // 2. Insert counter_items, each with its invoice_id from FIFO allocation
    const { error: itemsErr } = await supabase
      .from('counter_items')
      .insert(fifoPreview.map(a => ({
        counter_entry_id: entry.id,
        product_id: a.product_id,
        quantity: a.quantity,
        invoice_id: a.invoice_id,
      })))

    setSaving(false)
    if (itemsErr) { setFifoError(itemsErr.message); return }

    showToast('Sales recorded. Consign stock updated (FIFO).')
    setShowFifoForm(false)
    setFifoQtys({})
    setFifoPreview(null)
    setFifoRef('')
    setFifoNotes('')
    setFifoDate(today())
    fetchAll()
  }

  function openFifoForm() {
    setFifoClient('')
    setFifoQtys({})
    setFifoPreview(null)
    setFifoError('')
    setFifoDate(today())
    setFifoRef('')
    setFifoNotes('')
    setShowFifoForm(true)
  }

  // Audit: per-invoice status
  function invoiceStatus(inv) {
    const items = inv.invoice_items || []
    if (items.length === 0) return { label: 'No Items', cls: '', pct: 0 }
    const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0)
    const totalCountered = items.reduce((s, i) => s + getCounteredQty(inv.id, i.product_id), 0)
    const pct = totalQty > 0 ? Math.round((totalCountered / totalQty) * 100) : 0
    if (pct === 0) return { label: 'Pending', cls: 'badge-amber', pct }
    if (pct >= 100) return { label: 'Fully Settled', cls: 'badge-green', pct }
    return { label: 'Partial', cls: 'badge-blue', pct }
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function requestDeleteCounter(log) { setPinModal({ action: 'delete', log }) }
  function requestEditCounter(log) { setPinModal({ action: 'edit', log }) }
  function handlePinSuccess() {
    const { action, log } = pinModal
    setPinModal(null)
    if (action === 'delete') handleDeleteCounter(log)
    if (action === 'edit') openEditCounter(log)
  }
  async function handleDeleteCounter(log) {
    await supabase.from('counter_entries').delete().eq('id', log.id)
    showToast('Counter entry deleted. Consign balance restored.')
    fetchAll()
  }

  // The most this counter_item's quantity can be edited up to, without exceeding
  // what was actually consigned on its invoice (accounting for what OTHER
  // counter entries have already drawn from that same invoice/product).
  function maxAllowedForCounterItem(ci) {
    const inv = consignInvoices.find(i => i.id === ci.invoice_id)
    const invItem = inv?.invoice_items?.find(it => it.product_id === ci.product_id)
    if (!invItem) return Number(ci.quantity)
    const totalCountered = getCounteredQty(ci.invoice_id, ci.product_id)
    const otherCountered = totalCountered - Number(ci.quantity)
    return Math.max(0, Number(invItem.quantity) - otherCountered)
  }

  function openEditCounter(log) {
    setEditingCounter(log)
    setEditDate(log.date)
    setEditRef(log.reference_no || '')
    setEditNotes(log.notes || '')
    const qtys = {}
    ;(log.counter_items || []).forEach(ci => { qtys[ci.id] = String(ci.quantity) })
    setEditQtys(qtys)
    setEditError('')
  }

  async function handleEditSave(e) {
    e.preventDefault()
    const items = editingCounter.counter_items || []
    for (const ci of items) {
      const val = editQtys[ci.id]
      if (val === '' || isNaN(val) || Number(val) <= 0) {
        setEditError(`Enter a valid quantity for ${ci.products?.name}.`)
        return
      }
      const max = maxAllowedForCounterItem(ci)
      if (Number(val) > max) {
        setEditError(`${ci.products?.name}: max ${max} ${ci.products?.unit} available for this invoice (tried ${val}).`)
        return
      }
    }
    setSaving(true); setEditError('')

    const { error: headerErr } = await supabase
      .from('counter_entries')
      .update({ date: editDate, reference_no: editRef.trim() || null, notes: editNotes.trim() || null })
      .eq('id', editingCounter.id)

    if (headerErr) { setSaving(false); setEditError(headerErr.message); return }

    for (const ci of items) {
      const newQty = Number(editQtys[ci.id])
      if (newQty === Number(ci.quantity)) continue
      const { error: itemErr } = await supabase
        .from('counter_items')
        .update({ quantity: newQty })
        .eq('id', ci.id)
      if (itemErr) { setSaving(false); setEditError(itemErr.message); return }
    }

    setSaving(false)
    setEditingCounter(null)
    showToast('Counter entry updated.')
    fetchAll()
  }

  // Summary stats
  const hasPrice = products.some(p => p.unit_price)

  const totalConsignValue = consignInvoices.reduce((s, inv) =>
    s + (inv.invoice_items || []).reduce((ss, item) => {
      const price = item.products?.unit_price
      return ss + (price ? Number(item.quantity) * Number(price) : 0)
    }, 0), 0)

  const totalCounteredValue = counterLogs.reduce((s, log) =>
    s + (log.counter_items || []).reduce((ss, item) => {
      const prod = products.find(p => p.id === item.product_id)
      return ss + (prod?.unit_price ? Number(item.quantity) * Number(prod.unit_price) : 0)
    }, 0), 0)

  const totalPendingUnits = Object.values(availableByProduct).reduce((s, v) => s + v, 0)

  // Audit table filtered by search
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return [...consignInvoices].sort((a, b) => b.date.localeCompare(a.date))
    return [...consignInvoices]
      .filter(inv => inv.client?.toLowerCase().includes(q) || inv.reference_no?.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [consignInvoices, search])

  // FIFO preview: group allocations by product for display
  const previewByProduct = useMemo(() => {
    if (!fifoPreview) return {}
    const map = {}
    for (const a of fifoPreview) {
      if (!map[a.product_id]) map[a.product_id] = []
      const inv = consignInvoices.find(i => i.id === a.invoice_id)
      map[a.product_id].push({ ...a, ref: inv?.reference_no || inv?.date || a.invoice_id.slice(0, 8) })
    }
    return map
  }, [fifoPreview, consignInvoices])

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Countering</h1>
          <p className="page-desc">Record consign sales — stock is settled oldest invoice first (FIFO).</p>
        </div>
        <button className="btn-primary" onClick={openFifoForm} disabled={pendingProducts.length === 0}>
          <Plus size={16} /> Record Sales
        </button>
      </div>

      {/* Summary banner */}
      {consignInvoices.length > 0 && (
        <div className="revenue-banner">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="revenue-label">Pending Units</span>
            <span className="revenue-value" style={{ opacity: 0.7 }}>{totalPendingUnits.toLocaleString()}</span>
          </div>
          {hasPrice && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="revenue-label">Total Consign Out</span>
              <span className="revenue-value" style={{ opacity: 0.6 }}>{fmt(totalConsignValue)}</span>
            </div>
          )}
          {hasPrice && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="revenue-label">Settled → Revenue</span>
              <span className="revenue-value" style={{ color: 'var(--green-text)' }}>{fmt(totalCounteredValue)}</span>
            </div>
          )}
          {hasPrice && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="revenue-label">Still Pending</span>
              <span className="revenue-value" style={{ opacity: 0.55, fontSize: '0.9em' }}>{fmt(totalConsignValue - totalCounteredValue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Pending stock per product quick-view */}
      {pendingProducts.length > 0 && (
        <div>
          <div className="section-title" style={{ marginBottom: 10 }}>Pending Consign Stock</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {pendingProducts.map(p => (
              <div key={p.id} style={{
                background: 'var(--amber-dim)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 'var(--r)', padding: '8px 14px',
                display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {(availableByProduct[p.id] || 0).toLocaleString()} <span style={{ fontSize: 11, fontWeight: 500 }}>{p.unit}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit view */}
      <div>
        <div className="section-title" style={{ marginBottom: 10 }}>Consign Invoice Ledger</div>
        <div className="table-filters" style={{ marginBottom: 12 }}>
          <div className="search-wrap">
            <Search size={15} className="search-icon" />
            <input className="search-input" placeholder="Search client or reference..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p>No consign invoices found. Create a Consign invoice in Sales first.</p></div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Date</th>
                  <th>Ref #</th>
                  <th>Client</th>
                  <th>Products</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => {
                  const status = invoiceStatus(inv)
                  const expanded = expandedIds.has(inv.id)
                  return [
                    <tr key={inv.id} className="invoice-summary-row" style={{ cursor: 'pointer' }} onClick={() => toggleExpand(inv.id)}>
                      <td>
                        <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>
                          <ChevronRight size={14} />
                        </span>
                      </td>
                      <td className="td-mono">{inv.date}</td>
                      <td className="td-muted">{inv.reference_no || '—'}</td>
                      <td className="td-name">{inv.client || '—'}</td>
                      <td className="td-muted">{(inv.invoice_items || []).length} product{(inv.invoice_items || []).length !== 1 ? 's' : ''}</td>
                      <td>
                        <span className={`badge ${status.cls}`}>{status.label}</span>
                        {status.pct > 0 && status.pct < 100 && (
                          <span style={{ fontSize: 11, marginLeft: 6, opacity: 0.5 }}>{status.pct}%</span>
                        )}
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`${inv.id}-detail`} className="invoice-detail-row">
                        <td></td>
                        <td colSpan={5} style={{ padding: '0 0 14px 0' }}>
                          <div className="invoice-detail">
                            <table className="detail-table">
                              <thead>
                                <tr>
                                  <th>Product</th>
                                  <th>Consigned</th>
                                  <th>Settled</th>
                                  <th>Remaining</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(inv.invoice_items || []).map(item => {
                                  const countered = getCounteredQty(inv.id, item.product_id)
                                  const remaining = Number(item.quantity) - countered
                                  return (
                                    <tr key={item.id}>
                                      <td>{item.products?.name}</td>
                                      <td className="td-qty">{Number(item.quantity).toLocaleString()} <span className="unit-label">{item.products?.unit}</span></td>
                                      <td className="td-qty" style={{ color: countered > 0 ? 'var(--green-text)' : undefined }}>
                                        {countered.toLocaleString()} <span className="unit-label">{item.products?.unit}</span>
                                      </td>
                                      <td className="td-qty" style={{ opacity: remaining === 0 ? 0.4 : 1 }}>
                                        {remaining.toLocaleString()} <span className="unit-label">{item.products?.unit}</span>
                                        {remaining === 0 && <span style={{ marginLeft: 6, fontSize: 11 }}>✓</span>}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>

                            {/* Counter history for this invoice */}
                            {counterLogs.filter(l => (l.counter_items || []).some(ci => ci.invoice_id === inv.id)).length > 0 && (
                              <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 6 }}>
                                  Settlement History
                                </div>
                                {counterLogs
                                  .filter(l => (l.counter_items || []).some(ci => ci.invoice_id === inv.id))
                                  .map(log => {
                                    const relevantItems = (log.counter_items || []).filter(ci => ci.invoice_id === inv.id)
                                    return (
                                      <div key={log.id} style={{ fontSize: 12, color: 'var(--text-2)', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                                        <span className="td-mono" style={{ marginRight: 4, flexShrink: 0 }}>{log.date}</span>
                                        {log.reference_no && (
                                          <span className="td-muted" style={{ flexShrink: 0 }}>{log.reference_no}</span>
                                        )}
                                        <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', flex: 1 }}>
                                          {relevantItems.map(ci => (
                                            <span key={ci.product_id}>
                                              {ci.products?.name}: <strong style={{ color: 'var(--green-text)' }}>{Number(ci.quantity).toLocaleString()} {ci.products?.unit}</strong>
                                            </span>
                                          ))}
                                        </span>
                                        {log.notes && <span style={{ opacity: 0.5, flexShrink: 0 }}>· {log.notes}</span>}
                                        <button
                                          className="icon-btn"
                                          style={{ marginLeft: 'auto', flexShrink: 0 }}
                                          title="Edit counter entry (Admin)"
                                          onClick={e => { e.stopPropagation(); requestEditCounter(log) }}
                                        ><Pencil size={12} /></button>
                                        <button
                                          className="icon-btn danger"
                                          style={{ flexShrink: 0 }}
                                          title="Delete counter entry (Admin)"
                                          onClick={e => { e.stopPropagation(); requestDeleteCounter(log) }}
                                        ><Trash2 size={12} /></button>
                                      </div>
                                    )
                                  })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pin modal */}
      {pinModal && (
        <PinModal
          title={pinModal.action === 'edit' ? 'Edit Counter Entry' : 'Delete Counter Entry'}
          onSuccess={handlePinSuccess}
          onCancel={() => setPinModal(null)}
        />
      )}

      {/* Edit Counter Entry Form */}
      {editingCounter && (
        <div className="modal-overlay" onClick={() => setEditingCounter(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Edit Counter Entry</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                  Adjust settled quantities. Each is capped by what's still available on its original invoice.
                </p>
              </div>
              <button className="icon-btn" onClick={() => setEditingCounter(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSave} className="modal-form">
              <div className="field-row">
                <div className="field-group">
                  <label>Date</label>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
                </div>
                <div className="field-group">
                  <label>Reference / Invoice #</label>
                  <input value={editRef} onChange={e => setEditRef(e.target.value)} placeholder="e.g. SI-2025-001" />
                </div>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional" />
              </div>

              <div className="lines-section">
                <div className="lines-header">
                  <span className="lines-title">Settled Quantities</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(editingCounter.counter_items || []).map(ci => {
                    const inv = consignInvoices.find(i => i.id === ci.invoice_id)
                    const max = maxAllowedForCounterItem(ci)
                    return (
                      <div key={ci.id} className="counter-row" style={{ alignItems: 'center' }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>
                          {ci.products?.name}
                          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 400 }}>
                            {inv?.reference_no || inv?.date || 'Invoice'}
                          </div>
                        </div>
                        <div className="td-qty" style={{ fontSize: 13 }}>Max {max} <span className="unit-label">{ci.products?.unit}</span></div>
                        <input
                          type="number"
                          min="0.01"
                          max={max}
                          step="any"
                          value={editQtys[ci.id] ?? ''}
                          onChange={e => setEditQtys(prev => ({ ...prev, [ci.id]: e.target.value }))}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {editError && <p className="form-error">{editError}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setEditingCounter(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}><Check size={15} /> {saving ? 'Saving...' : 'Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FIFO Entry Form */}
      {showFifoForm && (
        <div className="modal-overlay" onClick={() => setShowFifoForm(false)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Record Sales</h2>
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-2)' }}>
                  Enter quantities sold. Stock is settled from the oldest consign invoice first (FIFO).
                </p>
              </div>
              <button className="icon-btn" onClick={() => setShowFifoForm(false)}><X size={18} /></button>
            </div>
            <form onSubmit={handleFifoSave} className="modal-form">
              {/* Step 1: Client */}
              <div className="field-group">
                <label>Client *</label>
                <div className="select-wrap">
                  <select
                    value={fifoClient}
                    onChange={e => { setFifoClient(e.target.value); setFifoQtys({}); setFifoPreview(null); setFifoError('') }}
                    required
                  >
                    <option value="">— Select a client —</option>
                    {consignClients.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-3)' }}>▾</span>
                </div>
                {fifoClient && (
                  <p className="field-hint">
                    Showing pending consign stock for <strong>{fifoClient}</strong> — settled oldest invoice first.
                  </p>
                )}
              </div>

              <div className="field-row">
                <div className="field-group">
                  <label>Sale Date</label>
                  <input type="date" value={fifoDate} onChange={e => { setFifoDate(e.target.value); setFifoPreview(null) }} />
                </div>
                <div className="field-group">
                  <label>Reference / Invoice #</label>
                  <input value={fifoRef} onChange={e => setFifoRef(e.target.value)} placeholder="e.g. SI-2025-001" />
                </div>
              </div>
              <div className="field-group">
                <label>Notes</label>
                <input value={fifoNotes} onChange={e => setFifoNotes(e.target.value)} placeholder="Optional" />
              </div>

              {fifoClient && (
              <div className="lines-section">
                <div className="lines-header">
                  <span className="lines-title">Quantities Sold</span>
                </div>

                {pendingProducts.length === 0 ? (
                  <div style={{ padding: '12px 0', color: 'var(--text-3)', fontSize: 13 }}>
                    No pending consign stock for {fifoClient}.
                  </div>
                ) : (
                  <>
                <div className="counter-row" style={{ padding: '0 0 8px', fontSize: 11, color: 'var(--text-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <span>Product</span>
                  <span>Available</span>
                  <span>Sold Today</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {pendingProducts.map(p => {
                    const avail = availableByProduct[p.id] || 0
                    const qty = fifoQtys[p.id] || ''
                    const qtyNum = Number(qty)
                    const overLimit = qty !== '' && qtyNum > avail
                    const preview = previewByProduct[p.id]
                    return (
                      <div key={p.id}>
                        <div className="counter-row" style={{ alignItems: 'center' }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{p.name}</div>
                          <div className="td-qty" style={{ fontSize: 13 }}>
                            {avail.toLocaleString()} <span className="unit-label">{p.unit}</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={avail}
                            step="any"
                            value={qty}
                            onChange={e => handleQtyChange(p.id, e.target.value)}
                            placeholder={`Max ${avail}`}
                            style={overLimit ? { borderColor: 'var(--red)' } : {}}
                          />
                        </div>
                        {preview && (
                          <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 8, flexWrap: 'wrap', paddingLeft: 2 }}>
                            <span style={{ color: 'var(--green-text)', fontWeight: 600 }}>FIFO:</span>
                            {preview.map((a, i) => (
                              <span key={i}>{a.ref} → <strong style={{ color: 'var(--green-text)' }}>{a.quantity.toLocaleString()}</strong></span>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                  </>
                )}
              </div>
              )}

              {fifoError && (
                <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--r-sm)', padding: '10px 14px', fontSize: 13, color: 'var(--red)', whiteSpace: 'pre-line' }}>
                  {fifoError}
                </div>
              )}

              {/* Preview summary */}
              {fifoPreview && (
                <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 'var(--r-sm)', padding: '12px 16px', fontSize: 13 }}>
                  <div style={{ fontWeight: 700, color: 'var(--green-text)', marginBottom: 6 }}>FIFO Allocation Preview</div>
                  {Object.entries(previewByProduct).map(([pid, allocs]) => {
                    const prod = products.find(p => p.id === pid)
                    return (
                      <div key={pid} style={{ marginBottom: 4, color: 'var(--text-2)' }}>
                        <strong style={{ color: 'var(--text)' }}>{prod?.name}</strong>:&nbsp;
                        {allocs.map((a, i) => (
                          <span key={i}>{i > 0 ? ' + ' : ''}{a.ref} ({a.quantity.toLocaleString()} {prod?.unit})</span>
                        ))}
                      </div>
                    )
                  })}
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>Confirm below to apply these to the consign ledger.</div>
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowFifoForm(false)}>Cancel</button>
                {!fifoPreview ? (
                  <button type="button" className="btn-primary" onClick={handlePreview} disabled={!fifoClient || pendingProducts.length === 0}>
                    <Check size={15} /> Preview FIFO
                  </button>
                ) : (
                  <button type="submit" className="btn-primary" disabled={saving}>
                    <Check size={15} /> {saving ? 'Saving...' : 'Confirm & Save'}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
