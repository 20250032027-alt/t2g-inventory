import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Package, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight, RotateCcw } from 'lucide-react'

export default function Inventory({ setPage }) {
  const [stock, setStock] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterLow, setFilterLow] = useState(false)

  useEffect(() => { fetchStock() }, [])

  async function fetchStock() {
    setLoading(true)
    const [{ data: products }, { data: production }, { data: items }, { data: returns }, { data: cItems }, { data: consignInvs }] = await Promise.all([
      supabase.from('products').select('id, name, unit, unit_price, opening_stock').order('name'),
      supabase.from('production_entries').select('product_id, quantity'),
      supabase.from('invoice_items').select('product_id, quantity, amount, invoices(id, payment_type)'),
      supabase.from('return_entries').select('product_id, quantity, restore_stock, invoice_id'),
      supabase.from('counter_items').select('product_id, quantity, invoice_id'),
      supabase.from('invoices').select('id, invoice_items(product_id, quantity, amount)').eq('payment_type', 'Consign'),
    ])

    const priceMap = {}
    ;(products || []).forEach(p => { priceMap[p.id] = p.unit_price })

    // Actual amount an invoice line was sold for (respects any discount/premium override), not list price.
    function lineRevenue(item) {
      if (item.amount != null) return Number(item.amount)
      const price = priceMap[item.product_id]
      return price ? Number(item.quantity) * Number(price) : 0
    }

    // The real per-unit rate a specific consign invoice's product line was sold at —
    // used to value settled/returned quantities accurately instead of the product's current list price.
    const consignInvoiceIds = new Set((consignInvs || []).map(i => i.id))
    function invoiceLineRate(invoiceId, productId) {
      const inv = (consignInvs || []).find(i => i.id === invoiceId)
      if (!inv) return null
      const lines = (inv.invoice_items || []).filter(it => it.product_id === productId)
      const totalQty = lines.reduce((s, it) => s + Number(it.quantity), 0)
      if (totalQty === 0) return null
      const totalAmt = lines.reduce((s, it) => s + lineRevenue(it), 0)
      return totalAmt / totalQty
    }
    function valueAt(invoiceId, productId, qty) {
      const rate = invoiceId ? invoiceLineRate(invoiceId, productId) : null
      const fallback = priceMap[productId] ? Number(priceMap[productId]) : 0
      return Number(qty) * (rate != null ? rate : fallback)
    }

    // Settled consign per product, valued at each settlement's real originating invoice rate.
    // Only settlements tied to an invoice that's currently Consign count (same rule as Sales/Reports).
    const settledMap = {}
    ;(cItems || []).filter(ci => consignInvoiceIds.has(ci.invoice_id)).forEach(ci => {
      settledMap[ci.product_id] = (settledMap[ci.product_id] || 0) + valueAt(ci.invoice_id, ci.product_id, ci.quantity)
    })

    // Consigned stock returned unsold comes off the pending balance like a settlement would,
    // but is never counted as revenue (it was never sold).
    const returnedConsignMap = {}
    ;(returns || []).filter(e => e.invoice_id && consignInvoiceIds.has(e.invoice_id)).forEach(e => {
      returnedConsignMap[e.product_id] = (returnedConsignMap[e.product_id] || 0) + valueAt(e.invoice_id, e.product_id, e.quantity)
    })

    // ALL returns per product, split by whether they came from a consign sale (linked to a consign
    // invoice) or not, and by whether the stock went back on the shelf or was written off.
    const returnsSplit = {}
    ;(returns || []).forEach(e => {
      const r = returnsSplit[e.product_id] || (returnsSplit[e.product_id] = {
        consignQty: 0, otherQty: 0, consignValue: 0, otherValue: 0, restoredQty: 0, writtenOffQty: 0,
      })
      const qty = Number(e.quantity)
      if (e.invoice_id) { r.consignQty += qty; r.consignValue += valueAt(e.invoice_id, e.product_id, qty) }
      else { r.otherQty += qty; r.otherValue += valueAt(null, e.product_id, qty) }
      if (e.restore_stock) r.restoredQty += qty
      else r.writtenOffQty += qty
    })

    const prodMap = {}, salesMap = {}, returnMap = {}, revenueMap = {}, consignRevenueMap = {}
    ;(production || []).forEach(e => { prodMap[e.product_id] = (prodMap[e.product_id] || 0) + Number(e.quantity) })
    ;(items || []).forEach(e => {
      salesMap[e.product_id] = (salesMap[e.product_id] || 0) + Number(e.quantity)
      const rev = lineRevenue(e)
      if (e.invoices?.payment_type === 'Consign') {
        consignRevenueMap[e.product_id] = (consignRevenueMap[e.product_id] || 0) + rev
      } else {
        revenueMap[e.product_id] = (revenueMap[e.product_id] || 0) + rev
      }
    })
    ;(returns || []).filter(e => e.restore_stock).forEach(e => {
      returnMap[e.product_id] = (returnMap[e.product_id] || 0) + Number(e.quantity)
    })

    const emptySplit = { consignQty: 0, otherQty: 0, consignValue: 0, otherValue: 0, restoredQty: 0, writtenOffQty: 0 }
    const result = (products || []).map(p => {
      const opening = Number(p.opening_stock) || 0
      const produced = prodMap[p.id] || 0
      const sold = salesMap[p.id] || 0
      const returned = returnMap[p.id] || 0
      const settled = settledMap[p.id] || 0
      const returnedConsign = returnedConsignMap[p.id] || 0
      const rawConsign = consignRevenueMap[p.id] || 0
      const split = returnsSplit[p.id] || emptySplit
      return {
        ...p,
        total_produced: produced,
        total_sold: sold,
        total_returned: returned, // restocked only — this is what feeds the stock formula below
        returns: split,           // ALL returns, split consign / not consign
        stock: opening + produced - sold + returned,
        // Revenue includes Cash/Credit + settled consign
        revenue: p.unit_price ? (revenueMap[p.id] || 0) + settled : null,
        // Only the unsettled, un-returned portion is still genuinely pending
        consignRevenue: Math.max(0, rawConsign - settled - returnedConsign),
      }
    })

    setStock(result)
    setLoading(false)
  }

  const totalProducts = stock.length
  const totalProduced = stock.reduce((s, p) => s + p.total_produced, 0)
  const totalSold = stock.reduce((s, p) => s + p.total_sold, 0)
  const totalRevenue = stock.reduce((s, p) => s + (p.revenue || 0), 0)
  const totalConsignRevenue = stock.reduce((s, p) => s + (p.consignRevenue || 0), 0)
  const retTotals = stock.reduce((t, p) => ({
    consignQty: t.consignQty + p.returns.consignQty,
    otherQty: t.otherQty + p.returns.otherQty,
    consignValue: t.consignValue + p.returns.consignValue,
    otherValue: t.otherValue + p.returns.otherValue,
    restoredQty: t.restoredQty + p.returns.restoredQty,
    writtenOffQty: t.writtenOffQty + p.returns.writtenOffQty,
  }), { consignQty: 0, otherQty: 0, consignValue: 0, otherValue: 0, restoredQty: 0, writtenOffQty: 0 })
  const totalReturnsQty = retTotals.consignQty + retTotals.otherQty
  const hasAnyPrice = stock.some(p => p.unit_price)
  const alertCount = stock.filter(p => p.stock < 10).length
  const displayStock = filterLow ? stock.filter(p => p.stock < 10) : stock
  const fmt = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const statCards = [
    { label: 'Products', value: totalProducts, icon: <Package size={18} />, iconClass: '', page: 'products', hint: 'Manage catalog' },
    { label: 'Total Produced', value: totalProduced.toLocaleString(), icon: <TrendingUp size={18} />, iconClass: 'green', page: 'production', hint: 'View log' },
    { label: 'Total Sold', value: totalSold.toLocaleString(), icon: <TrendingDown size={18} />, iconClass: 'amber', page: 'sales', hint: 'View log' },
    { label: 'Total Returns', value: totalReturnsQty.toLocaleString(), icon: <RotateCcw size={18} />, iconClass: '', page: 'returns', hint: 'View log' },
    { label: 'Low / Out of Stock', value: alertCount, icon: <AlertTriangle size={18} />, iconClass: alertCount > 0 ? 'red' : '', page: null, hint: alertCount > 0 ? 'Click to filter' : 'All good', action: () => setFilterLow(f => !f) },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Inventory</h1>
          <p className="page-desc">Current stock levels across all products.</p>
        </div>
        {filterLow && <button className="btn-ghost" onClick={() => setFilterLow(false)}>Show All</button>}
      </div>

      <div className="stat-grid">
        {statCards.map(card => (
          <button key={card.label}
            className={`stat-card stat-card-btn ${card.page === null && alertCount === 0 ? 'stat-card-inert' : ''} ${filterLow && card.page === null ? 'stat-card-active' : ''}`}
            onClick={() => { if (card.action) { card.action(); return; } if (card.page) setPage(card.page) }}>
            <div className="stat-card-top">
              <div className={`stat-icon ${card.iconClass}`}>{card.icon}</div>
              <span className="stat-card-hint">{card.hint} <ArrowUpRight size={11} /></span>
            </div>
            <div className="stat-value">{card.value}</div>
            <div className="stat-label">{card.label}</div>
          </button>
        ))}
      </div>

      {hasAnyPrice && (
        <div className="revenue-banner">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span className="revenue-label">Revenue (incl. Settled)</span>
            <span className="revenue-value">{fmt(totalRevenue)}</span>
          </div>
          {totalConsignRevenue > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="revenue-label" style={{ opacity: 0.6 }}>Consign (pending)</span>
              <span className="revenue-value" style={{ opacity: 0.55, fontSize: '0.9em' }}>{fmt(totalConsignRevenue)}</span>
            </div>
          )}
        </div>
      )}

      {totalReturnsQty > 0 && (
        <div className="revenue-banner" style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }} title="Returns linked to a consign invoice (unsold consigned stock coming back), valued at the rate that invoice line was sold at.">
            <span className="revenue-label" style={{ opacity: 0.8 }}>Returns · from consign sales</span>
            <span className="revenue-value" style={{ fontSize: '1.1em' }}>{retTotals.consignQty.toLocaleString()} <span style={{ fontSize: '0.6em', opacity: 0.6 }}>units</span></span>
            {hasAnyPrice && <span style={{ fontSize: 11, opacity: 0.6 }}>{fmt(retTotals.consignValue)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }} title="Returns not linked to a consign invoice (cash/credit sales, bad orders, etc.), valued at the product's current price.">
            <span className="revenue-label" style={{ opacity: 0.8 }}>Returns · not from consign</span>
            <span className="revenue-value" style={{ fontSize: '1.1em' }}>{retTotals.otherQty.toLocaleString()} <span style={{ fontSize: '0.6em', opacity: 0.6 }}>units</span></span>
            {hasAnyPrice && <span style={{ fontSize: 11, opacity: 0.6 }}>{fmt(retTotals.otherValue)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span className="revenue-label" style={{ opacity: 0.6 }}>All returns</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{retTotals.restoredQty.toLocaleString()} back in stock</span>
            <span style={{ fontSize: 12, opacity: 0.7 }}>{retTotals.writtenOffQty.toLocaleString()} written off</span>
          </div>
        </div>
      )}

      {filterLow && <div className="notice">Showing {displayStock.length} product{displayStock.length !== 1 ? 's' : ''} with low or negative stock.</div>}

      {loading ? (
        <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : displayStock.length === 0 ? (
        <div className="empty-state"><p>{filterLow ? 'No low-stock products.' : 'No products found.'}</p></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Product</th><th>Opening</th><th>Produced</th>
                <th>Sold</th><th title="Returns that went back on the shelf (this is what adds to Current Stock)">Returned to Stock</th><th title="Every return, whether restocked or written off">All Returns</th><th>Current Stock</th>
                {hasAnyPrice && <th>Revenue</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {displayStock.map(p => (
                <tr key={p.id}>
                  <td className="td-name">{p.name}</td>
                  <td className="td-qty">{(Number(p.opening_stock)||0).toLocaleString()} <span className="unit-label">{p.unit}</span></td>
                  <td className="td-qty">{p.total_produced.toLocaleString()} <span className="unit-label">{p.unit}</span></td>
                  <td className="td-qty">{p.total_sold.toLocaleString()} <span className="unit-label">{p.unit}</span></td>
                  <td className="td-qty">{p.total_returned.toLocaleString()} <span className="unit-label">{p.unit}</span></td>
                  <td className="td-qty">
                    {(p.returns.consignQty + p.returns.otherQty).toLocaleString()} <span className="unit-label">{p.unit}</span>
                    {(p.returns.consignQty + p.returns.otherQty) > 0 && (
                      <div style={{ opacity: 0.6, fontSize: '0.78em' }}>
                        consign {p.returns.consignQty.toLocaleString()} · other {p.returns.otherQty.toLocaleString()}
                        {p.returns.writtenOffQty > 0 && <> · {p.returns.writtenOffQty.toLocaleString()} written off</>}
                      </div>
                    )}
                  </td>
                  <td className="td-qty bold">{p.stock.toLocaleString()} <span className="unit-label">{p.unit}</span></td>
                  {hasAnyPrice && (
                    <td className="td-qty" style={{color:'var(--green-text)'}}>
                      {p.revenue != null ? fmt(p.revenue) : <span className="td-muted">—</span>}
                      {p.consignRevenue > 0 && (
                        <div style={{ opacity: 0.55, fontSize: '0.8em' }}>+{fmt(p.consignRevenue)} pending</div>
                      )}
                    </td>
                  )}
                  <td>{p.stock < 0 ? <span className="badge badge-red">Oversold</span> : p.stock < 10 ? <span className="badge badge-amber">Low</span> : <span className="badge badge-green">In Stock</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
