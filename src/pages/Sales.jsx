import { useEffect, useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, X, Check, ChevronDown, Search, Trash2, ChevronRight, Pencil, Lock } from 'lucide-react'
import { showToast } from '../components/Toast'

const CHANNELS = ['Shopee', 'Direct', 'Export', 'Other']
const PAYMENT_TYPES = ['Cash', 'Credit', 'Consign']
const ADMIN_PIN = '1234'

function emptyLine() {
  return { product_id: '', quantity: '', amount: '', productSearch: '' }
}

// PIN modal component
function PinModal({ onSuccess, onCancel, title }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e) {
    e.preventDefault()
    if (pin === ADMIN_PIN) {
      onSuccess()
    } else {
      setError('Incorrect PIN. Try again.')
      setPin('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 340 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={16} style={{ color: 'var(--accent)' }} />
            <h2>{title || 'Admin Required'}</h2>
          </div>
          <button className="icon-btn" onClick={onCancel}><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px' }}>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
            Enter the admin PIN to continue.
          </p>
          <div className="field-group" style={{ marginBottom: 12 }}>
            <label>Admin PIN</label>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={e => { setPin(e.target.value); setError('') }}
              placeholder="••••"
              autoComplete="off"
            />
          </div>
          {error && <p className="form-error" style={{ marginBottom: 12 }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={!pin}>
              <Check size={15} /> Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Sales() {
  const [invoices, setInvoices] = useState([])
  const [products, setProducts] = useState([])
  const [counterItems, setCounterItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [filterProduct, setFilterProduct] = useState('all')
  const [filterPayment, setFilterPayment] = useState('all')
  const [form, setForm] = useState({
    reference_no: '', client: '', date: today(),
    channel: 'Direct', payment_type: 'Cash', notes: '',
    lines: []
  })
  const [editingInvoice, setEditingInvoice] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [pinModal, setPinModal] = useState(null)
  const [clientSuggestions, setClientSuggestions] = useState([])
  const [showClientSuggestions, setShowClientSuggestions] = useState(false)
  const clientInputRef = useRef(null)
  const clientSuggestRef = useRef(null)
  const [openProductSuggestLine, setOpenProductSuggestLine] = useState(null)
  const [suggestActiveIndex, setSuggestActiveIndex] = useState(-1)
  const suggestListRef = useRef(null)

  useEffect(() => {
    if (!suggestListRef.current || suggestActiveIndex < 0) return
    const item = suggestListRef.current.children[suggestActiveIndex]
    item?.scrollIntoView({ block: 'nearest' })
  }, [suggestActiveIndex])

  function today() { return new Date().toISOString().split('T')[0] }

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: prods }, { data: invs }, { data: cItems }] = await Promise.all([
      supabase.from('products').select('id, name, unit, unit_price').order('name'),
      supabase.from('invoices')
        .select('*, invoice_items(*, products(id, name, unit, unit_price))')
        .order('date', { ascending: false })
        .limit(300),
      supabase.from('counter_items').select('product_id, quantity, invoice_id, invoices(payment_type)'),
    ])
    setProducts(prods || [])
    setInvoices(invs || [])
    setCounterItems(cItems || [])
    setLoading(false)
  }

  function openNew() {
    const prods = products
    setEditingInvoice(null)
    setForm({
      reference_no: '', client: '', date: today(),
      channel: 'Direct', payment_type: 'Cash', notes: '',
      lines: [emptyLine(prods)]
    })
    setError('')
    setShowForm(true)
  }

  function openEdit(inv) {
    setEditingInvoice(inv)
    setForm({
      reference_no: inv.reference_no || '',
      client: inv.client || '',
      date: inv.date,
      channel: inv.channel,
      payment_type: inv.payment_type,
      notes: inv.notes || '',
      lines: (inv.invoice_items || []).map(item => ({
        id: item.id,
        product_id: item.product_id,
        quantity: String(item.quantity),
        // amount: stored override, or empty meaning "use auto"
        amount: item.amount != null ? String(item.amount) : '',
        productSearch: item.products?.name || '',
      }))
    })
    setError('')
    setShowForm(true)
  }

  function addLine() {
    setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))
  }

  function removeLine(i) {
    setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }))
  }

  function updateLine(i, field, value) {
    setForm(f => {
      const lines = [...f.lines]
      lines[i] = { ...lines[i], [field]: value }
      return { ...f, lines }
    })
  }

  // Product name autocomplete for invoice lines
  function getProductSuggestions(value) {
    const q = (value || '').trim().toLowerCase()
    if (!q) return products
    return products.filter(p => p.name?.toLowerCase().includes(q))
  }

  function updateLineSearch(i, value) {
    setForm(f => {
      const lines = [...f.lines]
      lines[i] = { ...lines[i], productSearch: value }
      return { ...f, lines }
    })
    setOpenProductSuggestLine(i)
    setSuggestActiveIndex(-1)
  }

  function handleLineSearchKeyDown(e, i) {
    if (openProductSuggestLine !== i) return
    const suggestions = getProductSuggestions(form.lines[i]?.productSearch)
    if (!suggestions.length) return
    if (e.key === 'ArrowDown' || e.key === 'Tab') {
      e.preventDefault()
      setSuggestActiveIndex(idx => Math.min(idx + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSuggestActiveIndex(idx => Math.max(idx - 1, 0))
    } else if (e.key === 'Enter') {
      const target = suggestActiveIndex >= 0 ? suggestions[suggestActiveIndex] : suggestions[0]
      if (target) { e.preventDefault(); selectLineProduct(i, target) }
    } else if (e.key === 'Escape') {
      setOpenProductSuggestLine(null)
      setSuggestActiveIndex(-1)
    }
  }

  // Selecting a suggestion brings the product's unit & price along with it (used for qty/amount auto-calc)
  function selectLineProduct(i, product) {
    setForm(f => {
      const lines = [...f.lines]
      lines[i] = { ...lines[i], product_id: product.id, productSearch: product.name, amount: '' }
      return { ...f, lines }
    })
    setOpenProductSuggestLine(null)
    setSuggestActiveIndex(-1)
  }

  // On blur, snap the text back to the selected product's name if what's typed doesn't match anything
  function handleLineSearchBlur(i) {
    setTimeout(() => {
      setForm(f => {
        const lines = [...f.lines]
        const line = lines[i]
        if (!line) return f
        const prod = products.find(p => p.id === line.product_id)
        lines[i] = { ...line, productSearch: prod?.name || '' }
        return { ...f, lines }
      })
      setOpenProductSuggestLine(null)
    }, 120)
  }

  // Effective amount for a line: manual override if set, else qty × unit_price
  function effectiveAmount(line) {
    if (line.amount !== '' && line.amount != null && !isNaN(line.amount)) {
      return Number(line.amount)
    }
    const prod = products.find(p => p.id === line.product_id)
    if (prod?.unit_price && line.quantity && !isNaN(line.quantity)) {
      return Number(line.quantity) * Number(prod.unit_price)
    }
    return null
  }

  async function handleSave(e) {
    e.preventDefault()
    if (form.lines.length === 0) return setError('Add at least one product.')
    for (const line of form.lines) {
      if (!line.product_id) return setError('Select a product for each line.')
      if (!line.quantity || isNaN(line.quantity) || Number(line.quantity) <= 0)
        return setError('Enter a valid quantity for each line.')
      if (line.amount !== '' && (isNaN(line.amount) || Number(line.amount) < 0))
        return setError('Enter a valid amount for each line.')
    }
    setSaving(true); setError('')

    const buildItems = (invoiceId) => form.lines.map(l => ({
      invoice_id: invoiceId,
      product_id: l.product_id,
      quantity: Number(l.quantity),
      // only save amount if user actually typed one
      amount: l.amount !== '' && !isNaN(l.amount) ? Number(l.amount) : null,
    }))

    if (editingInvoice) {
      const { error: invErr } = await supabase.from('invoices').update({
        reference_no: form.reference_no.trim() || null,
        client: normalizeClient(form.client) || null,
        date: form.date,
        channel: form.channel,
        payment_type: form.payment_type,
        notes: form.notes.trim() || null,
      }).eq('id', editingInvoice.id)

      if (invErr) { setSaving(false); return setError(invErr.message) }

      await supabase.from('invoice_items').delete().eq('invoice_id', editingInvoice.id)
      const { error: itemErr } = await supabase.from('invoice_items').insert(buildItems(editingInvoice.id))

      setSaving(false)
      if (itemErr) return setError(itemErr.message)
      showToast('Invoice updated.')
    } else {
      const { data: inv, error: invErr } = await supabase.from('invoices').insert({
        reference_no: form.reference_no.trim() || null,
        client: normalizeClient(form.client) || null,
        date: form.date,
        channel: form.channel,
        payment_type: form.payment_type,
        notes: form.notes.trim() || null,
      }).select().single()

      if (invErr) { setSaving(false); return setError(invErr.message) }

      const { error: itemErr } = await supabase.from('invoice_items').insert(buildItems(inv.id))
      setSaving(false)
      if (itemErr) return setError(itemErr.message)
    }

    setShowForm(false)
    setEditingInvoice(null)
    fetchAll()
  }

  async function handleDelete(inv) {
    await supabase.from('invoices').delete().eq('id', inv.id)
    showToast('Invoice deleted.')
    fetchAll()
  }

  function requestEdit(inv) { setPinModal({ action: 'edit', invoice: inv }) }
  function requestDelete(inv) { setPinModal({ action: 'delete', invoice: inv }) }

  function handlePinSuccess() {
    const { action, invoice } = pinModal
    setPinModal(null)
    if (action === 'edit') openEdit(invoice)
    if (action === 'delete') handleDelete(invoice)
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const filtered = useMemo(() => {
    let rows = invoices
    if (filterPayment !== 'all') rows = rows.filter(i => i.payment_type === filterPayment)
    if (filterProduct !== 'all') rows = rows.filter(i =>
      i.invoice_items?.some(item => item.product_id === filterProduct)
    )
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(i =>
        i.client?.toLowerCase().includes(q) ||
        i.reference_no?.toLowerCase().includes(q) ||
        i.invoice_items?.some(item => item.products?.name?.toLowerCase().includes(q))
      )
    }
    return rows
  }, [invoices, search, filterProduct, filterPayment])

  // Sorted unique client names from existing invoices
  // Normalize client name: trim + title case so "ororama" and "ORORAMA" are the same
  function normalizeClient(name) {
    if (!name) return ''
    return name.trim().replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  }

  const knownClients = useMemo(() => {
    const seen = new Map()
    invoices.forEach(i => {
      if (!i.client) return
      const normalized = normalizeClient(i.client)
      if (!seen.has(normalized.toLowerCase())) seen.set(normalized.toLowerCase(), normalized)
    })
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [invoices])

  function getClientSuggestions(value) {
    if (!value.trim()) return knownClients
    const q = value.toLowerCase()
    return knownClients.filter(c => c.toLowerCase().includes(q))
  }

  function handleClientChange(value) {
    setForm(f => ({ ...f, client: value }))
    setClientSuggestions(getClientSuggestions(value))
    setShowClientSuggestions(true)
  }

  function selectClient(name) {
    setForm(f => ({ ...f, client: name }))
    setShowClientSuggestions(false)
    clientInputRef.current?.focus()
  }

  // Close suggestions if clicking outside
  useEffect(() => {
    function handleClick(e) {
      if (
        !clientInputRef.current?.contains(e.target) &&
        !clientSuggestRef.current?.contains(e.target)
      ) {
        setShowClientSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const fmt = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  const hasPrice = products.some(p => p.unit_price)

  // Revenue: prefer stored amount override, else qty × unit_price
  function itemRevenue(item) {
    if (item.amount != null) return Number(item.amount)
    const price = item.products?.unit_price
    return price ? Number(item.quantity) * Number(price) : 0
  }

  function invoiceRevenue(inv) {
    return (inv.invoice_items || []).reduce((s, item) => s + itemRevenue(item), 0)
  }

  // How much of a given product on a given invoice has been countered/settled
  function getCounteredQtyForItem(invoiceId, productId) {
    return counterItems
      .filter(ci => ci.invoice_id === invoiceId && ci.product_id === productId)
      .reduce((s, ci) => s + Number(ci.quantity), 0)
  }

  // Settlement status for Consign invoices (Cash/Credit are settled at the point of sale, no concept applies)
  function invoiceSettlementStatus(inv) {
    if (inv.payment_type !== 'Consign') return null
    const items = inv.invoice_items || []
    if (items.length === 0) return null
    const totalQty = items.reduce((s, i) => s + Number(i.quantity), 0)
    const totalCountered = items.reduce((s, i) => s + getCounteredQtyForItem(inv.id, i.product_id), 0)
    const pct = totalQty > 0 ? Math.round((totalCountered / totalQty) * 100) : 0
    if (pct === 0) return { label: 'Pending', cls: 'badge-amber', pct }
    if (pct >= 100) return { label: 'Fully Settled', cls: 'badge-green', pct }
    return { label: 'Partial', cls: 'badge-blue', pct }
  }

  function invoiceSummary(inv) {
    const items = inv.invoice_items || []
    if (items.length === 0) return '—'
    if (items.length === 1) {
      const p = items[0].products
      return `${Number(items[0].quantity).toLocaleString()} ${p?.unit || ''} ${p?.name || ''}`
    }
    return `${items.length} products`
  }

  // Settled consign: counter_items that drew from invoices in the current filtered view
  const filteredInvoiceIds = new Set(filtered.map(inv => inv.id))
  const settledConsignRevenue = counterItems
    .filter(ci => filteredInvoiceIds.has(ci.invoice_id))
    .reduce((s, ci) => {
      const prod = products.find(p => p.id === ci.product_id)
      return s + (prod?.unit_price ? Number(ci.quantity) * Number(prod.unit_price) : 0)
    }, 0)

  const paidRevenue = filtered.filter(inv => inv.payment_type !== 'Consign').reduce((s, inv) => s + invoiceRevenue(inv), 0)
  const rawConsignRevenue = filtered.filter(inv => inv.payment_type === 'Consign').reduce((s, inv) => s + invoiceRevenue(inv), 0)
  // settled consign moves into real revenue; only unsettled portion stays pending
  const effectivePaidRevenue = paidRevenue + settledConsignRevenue
  const pendingConsignRevenue = Math.max(0, rawConsignRevenue - settledConsignRevenue)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Sales</h1>
          <p className="page-desc">Record multi-product invoices and search by client or reference.</p>
        </div>
        <button className="btn-primary" onClick={openNew} disabled={products.length === 0}>
          <Plus size={16} /> New Invoice
        </button>
      </div>

      {products.length === 0 && !loading && <div className="notice">Add products first before logging sales.</div>}

      <div className="table-filters">
        <div className="search-wrap">
          <Search size={15} className="search-icon" />
          <input className="search-input" placeholder="Search client, product, reference..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="select-wrap filter-select">
          <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
            <option value="all">All Products</option>
            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <ChevronDown size={15} className="select-icon" />
        </div>
        <div className="select-wrap filter-select">
          <select value={filterPayment} onChange={e => setFilterPayment(e.target.value)}>
            <option value="all">All Payments</option>
            {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <ChevronDown size={15} className="select-icon" />
        </div>
        {hasPrice && filtered.length > 0 && (
          <div className="filter-revenue" style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="filter-revenue-label">Revenue (incl. Settled)</span>
              <span className="filter-revenue-value">{fmt(effectivePaidRevenue)}</span>
            </div>
            {pendingConsignRevenue > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span className="filter-revenue-label" style={{ opacity: 0.6 }}>Consign (pending)</span>
                <span className="filter-revenue-value" style={{ opacity: 0.55, fontSize: '0.9em' }}>{fmt(pendingConsignRevenue)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="skeleton-list">{[1,2,3,4].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state"><p>{invoices.length === 0 ? 'No invoices yet.' : 'No results match your search.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{width: 32}}></th>
                <th>Date</th>
                <th>Ref #</th>
                <th>Client</th>
                <th>Items</th>
                <th>Channel</th>
                <th>Payment</th>
                {hasPrice && <th>Total</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(inv => {
                const expanded = expandedIds.has(inv.id)
                const rev = invoiceRevenue(inv)
                const settlement = invoiceSettlementStatus(inv)
                return [
                  <tr key={inv.id} className="invoice-summary-row" onClick={() => toggleExpand(inv.id)} style={{cursor: 'pointer'}}>
                    <td>
                      <span className={`expand-icon ${expanded ? 'expanded' : ''}`}>
                        <ChevronRight size={14} />
                      </span>
                    </td>
                    <td className="td-mono">{inv.date}</td>
                    <td className="td-muted">{inv.reference_no || '—'}</td>
                    <td className="td-name">{inv.client || '—'}</td>
                    <td className="td-muted">{invoiceSummary(inv)}</td>
                    <td><span className={`badge channel-${inv.channel?.toLowerCase()}`}>{inv.channel}</span></td>
                    <td>
                      <span className={`badge payment-${inv.payment_type?.toLowerCase()}`}>{inv.payment_type}</span>
                      {settlement && (
                        <span className={`badge ${settlement.cls}`} style={{ marginLeft: 6 }}>
                          {settlement.label}{settlement.pct > 0 && settlement.pct < 100 ? ` ${settlement.pct}%` : ''}
                        </span>
                      )}
                    </td>
                    {hasPrice && <td className="td-qty" style={{color: rev > 0 ? 'var(--green-text)' : undefined}}>{rev > 0 ? fmt(rev) : '—'}</td>}
                    <td className="td-actions" onClick={e => e.stopPropagation()}>
                      <button className="icon-btn" onClick={() => requestEdit(inv)} title="Edit (Admin)" style={{ marginRight: 2 }}>
                        <Pencil size={14} />
                      </button>
                      <button className="icon-btn danger" onClick={() => requestDelete(inv)} title="Delete (Admin)">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>,
                  expanded && (
                    <tr key={`${inv.id}-detail`} className="invoice-detail-row">
                      <td></td>
                      <td colSpan={hasPrice ? 7 : 6} style={{padding: '0 0 12px 0'}}>
                        <div className="invoice-detail">
                          <table className="detail-table">
                            <thead>
                              <tr>
                                <th>Product</th>
                                <th>Quantity</th>
                                {hasPrice && <th>Unit Price</th>}
                                {hasPrice && <th>Amount</th>}
                                {inv.payment_type === 'Consign' && <th>Settled</th>}
                                {inv.payment_type === 'Consign' && <th>Remaining</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {(inv.invoice_items || []).map(item => {
                                const autoAmt = item.products?.unit_price
                                  ? Number(item.quantity) * Number(item.products.unit_price)
                                  : null
                                const displayAmt = item.amount != null ? Number(item.amount) : autoAmt
                                const isOverride = item.amount != null && autoAmt != null && Number(item.amount) !== autoAmt
                                const countered = inv.payment_type === 'Consign' ? getCounteredQtyForItem(inv.id, item.product_id) : null
                                const remaining = countered != null ? Number(item.quantity) - countered : null
                                return (
                                  <tr key={item.id}>
                                    <td>{item.products?.name}</td>
                                    <td className="td-qty">{Number(item.quantity).toLocaleString()} <span className="unit-label">{item.products?.unit}</span></td>
                                    {hasPrice && <td className="td-qty">{item.products?.unit_price ? fmt(item.products.unit_price) : '—'}</td>}
                                    {hasPrice && (
                                      <td className="td-qty">
                                        {displayAmt != null ? (
                                          <span style={{color: 'var(--green-text)'}}>
                                            {fmt(displayAmt)}
                                            {isOverride && (
                                              <span style={{
                                                fontSize: 10,
                                                marginLeft: 5,
                                                color: 'var(--accent)',
                                                background: 'var(--accent-subtle, rgba(99,102,241,0.12))',
                                                borderRadius: 4,
                                                padding: '1px 5px',
                                                fontWeight: 600,
                                                letterSpacing: '0.02em'
                                              }}>discounted</span>
                                            )}
                                          </span>
                                        ) : '—'}
                                      </td>
                                    )}
                                    {inv.payment_type === 'Consign' && (
                                      <td className="td-qty" style={{ color: countered > 0 ? 'var(--green-text)' : undefined }}>
                                        {countered.toLocaleString()} <span className="unit-label">{item.products?.unit}</span>
                                      </td>
                                    )}
                                    {inv.payment_type === 'Consign' && (
                                      <td className="td-qty" style={{ opacity: remaining === 0 ? 0.4 : 1 }}>
                                        {remaining.toLocaleString()} <span className="unit-label">{item.products?.unit}</span>
                                        {remaining === 0 && <span style={{ marginLeft: 6, fontSize: 11 }}>✓</span>}
                                      </td>
                                    )}
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          {inv.notes && <p className="invoice-notes">Notes: {inv.notes}</p>}
                        </div>
                      </td>
                      <td></td>
                    </tr>
                  )
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {pinModal && (
        <PinModal
          title={pinModal.action === 'edit' ? 'Edit Invoice' : 'Delete Invoice'}
          onSuccess={handlePinSuccess}
          onCancel={() => setPinModal(null)}
        />
      )}

      {showForm && (
        <div className="modal-overlay" onClick={() => { setShowForm(false); setEditingInvoice(null) }}>
          <div className="modal modal-wide" onClick={ev => ev.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingInvoice ? 'Edit Invoice' : 'New Invoice'}</h2>
              <button className="icon-btn" onClick={() => { setShowForm(false); setEditingInvoice(null) }}><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="modal-form">
              <div className="field-row">
                <div className="field-group">
                  <label>Reference / Invoice #</label>
                  <input value={form.reference_no} onChange={e => setForm({...form, reference_no: e.target.value})} placeholder="e.g. SI-2025-001" />
                </div>
                <div className="field-group" style={{ position: 'relative' }}>
                  <label>Client</label>
                  <input
                    ref={clientInputRef}
                    value={form.client}
                    onChange={e => handleClientChange(e.target.value)}
                    onFocus={() => {
                      setClientSuggestions(getClientSuggestions(form.client))
                      setShowClientSuggestions(true)
                    }}
                    placeholder="Client name"
                    autoComplete="off"
                  />
                  {showClientSuggestions && clientSuggestions.length > 0 && (
                    <ul ref={clientSuggestRef} style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 50,
                      margin: '2px 0 0',
                      padding: 0,
                      listStyle: 'none',
                      background: 'var(--surface, #1e1e1e)',
                      border: '1px solid var(--border, #333)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                      maxHeight: 200,
                      overflowY: 'auto',
                    }}>
                      {clientSuggestions.map(name => (
                        <li
                          key={name}
                          onMouseDown={() => selectClient(name)}
                          style={{
                            padding: '9px 14px',
                            cursor: 'pointer',
                            fontSize: 13,
                            borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--hover, rgba(255,255,255,0.06))'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <span style={{ fontSize: 11, opacity: 0.45 }}>↩</span>
                          {name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Date *</label>
                  <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
                </div>
                <div className="field-group">
                  <label>Channel</label>
                  <div className="select-wrap">
                    <select value={form.channel} onChange={e => setForm({...form, channel: e.target.value})}>
                      {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <ChevronDown size={16} className="select-icon" />
                  </div>
                </div>
              </div>
              <div className="field-row">
                <div className="field-group">
                  <label>Payment Type</label>
                  <div className="select-wrap">
                    <select value={form.payment_type} onChange={e => setForm({...form, payment_type: e.target.value})}>
                      {PAYMENT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <ChevronDown size={16} className="select-icon" />
                  </div>
                </div>
                <div className="field-group">
                  <label>Notes</label>
                  <input value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Optional" />
                </div>
              </div>

              <div className="lines-section">
                <div className="lines-header">
                  <span className="lines-title">Products</span>
                  <button type="button" className="btn-ghost btn-sm" onClick={addLine}>
                    <Plus size={14} /> Add Line
                  </button>
                </div>

                {/* Column headers for lines */}
                {hasPrice && (
                  <div className="line-row line-row-priced" style={{
                    padding: '0 0 4px 0',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    <span>Product</span>
                    <span>Qty</span>
                    <span className="line-amount-header">Amount <span style={{fontWeight:400, textTransform:'none', opacity:0.7}}>(override)</span></span>
                    <span className="line-remove-header"></span>
                  </div>
                )}

                <div className="lines-list">
                  {form.lines.map((line, i) => {
                    const prod = products.find(p => p.id === line.product_id)
                    const autoAmt = prod?.unit_price && line.quantity && !isNaN(line.quantity)
                      ? Number(line.quantity) * Number(prod.unit_price)
                      : null
                    const manualAmt = line.amount !== '' && !isNaN(line.amount) ? Number(line.amount) : null
                    const displayCalc = manualAmt != null ? manualAmt : autoAmt

                    return (
                      <div key={i} className={`line-row ${hasPrice ? 'line-row-priced' : ''}`}>
                        <div className="line-product" style={{ position: 'relative' }}>
                          <input
                            type="text"
                            value={line.productSearch ?? ''}
                            onChange={e => updateLineSearch(i, e.target.value)}
                            onFocus={() => { setOpenProductSuggestLine(i); setSuggestActiveIndex(-1) }}
                            onBlur={() => handleLineSearchBlur(i)}
                            onKeyDown={e => handleLineSearchKeyDown(e, i)}
                            placeholder="Type to search products..."
                            autoComplete="off"
                          />
                          {openProductSuggestLine === i && (() => {
                            const suggestions = getProductSuggestions(line.productSearch)
                            if (suggestions.length === 0) return null
                            return (
                              <ul ref={suggestListRef} style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                right: 0,
                                zIndex: 50,
                                margin: '2px 0 0',
                                padding: 0,
                                listStyle: 'none',
                                background: 'var(--surface, #1e1e1e)',
                                border: '1px solid var(--border, #333)',
                                borderRadius: 8,
                                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                                maxHeight: 220,
                                overflowY: 'auto',
                              }}>
                                {suggestions.map((p, idx) => (
                                  <li
                                    key={p.id}
                                    onMouseDown={() => selectLineProduct(i, p)}
                                    onMouseEnter={() => setSuggestActiveIndex(idx)}
                                    style={{
                                      padding: '9px 14px',
                                      cursor: 'pointer',
                                      fontSize: 13,
                                      borderBottom: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      gap: 8,
                                      background: idx === suggestActiveIndex ? 'var(--hover, rgba(255,255,255,0.10))' : 'transparent',
                                    }}
                                  >
                                    <span>{p.name}</span>
                                    <span style={{ opacity: 0.6, fontSize: 11, whiteSpace: 'nowrap', marginLeft: 8 }}>
                                      {p.unit}{p.unit_price ? ` · ${fmt(p.unit_price)}` : ''}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )
                          })()}
                        </div>
                        <div className="line-qty">
                          <input
                            type="number" min="0.01" step="any"
                            value={line.quantity}
                            onChange={e => updateLine(i, 'quantity', e.target.value)}
                            placeholder={prod ? `Qty (${prod.unit})` : 'Qty'}
                          />
                        </div>
                        {hasPrice && (
                          <div className="line-amount" style={{ position: 'relative' }}>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={line.amount}
                              onChange={e => updateLine(i, 'amount', e.target.value)}
                              placeholder={autoAmt != null ? `Auto: ${fmt(autoAmt)}` : 'Amount'}
                              style={{
                                width: '100%',
                                borderColor: manualAmt != null ? 'var(--accent)' : undefined,
                              }}
                            />
                            {manualAmt != null && autoAmt != null && manualAmt !== autoAmt && (
                              <span style={{
                                position: 'absolute',
                                right: 8,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                fontSize: 9,
                                color: 'var(--accent)',
                                fontWeight: 700,
                                pointerEvents: 'none',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em'
                              }}>disc.</span>
                            )}
                          </div>
                        )}
                        <button type="button" className="icon-btn danger line-remove" onClick={() => removeLine(i)} disabled={form.lines.length === 1}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>

                {hasPrice && form.lines.some(l => effectiveAmount(l) != null) && (
                  <div className="lines-total">
                    Total: <strong>{fmt(form.lines.reduce((s, l) => s + (effectiveAmount(l) ?? 0), 0))}</strong>
                  </div>
                )}
              </div>

              {error && <p className="form-error">{error}</p>}
              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => { setShowForm(false); setEditingInvoice(null) }}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  <Check size={15} /> {saving ? 'Saving...' : editingInvoice ? 'Update Invoice' : 'Save Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
