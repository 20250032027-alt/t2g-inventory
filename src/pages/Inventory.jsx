import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Package, TrendingUp, TrendingDown, AlertTriangle, ArrowUpRight } from 'lucide-react'

export default function Inventory({ setPage }) {
  const [stock, setStock] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterLow, setFilterLow] = useState(false)

  useEffect(() => { fetchStock() }, [])

  async function fetchStock() {
    setLoading(true)
    const [{ data: products }, { data: production }, { data: items }, { data: returns }, { data: cItems }] = await Promise.all([
      supabase.from('products').select('id, name, unit, unit_price, opening_stock').order('name'),
      supabase.from('production_entries').select('product_id, quantity'),
      supabase.from('invoice_items').select('product_id, quantity, amount, invoices(id, payment_type)'),
      supabase.from('return_entries').select('product_id, quantity, restore_stock'),
      supabase.from('counter_items').select('product_id, quantity, invoice_id'),
    ])

    const priceMap = {}
    ;(products || []).forEach(p => { priceMap[p.id] = p.unit_price })

    // Settled consign per product (from counter_items)
    const settledMap = {}
    ;(cItems || []).forEach(ci => {
      const price = priceMap[ci.product_id]
      const rev = price ? Number(ci.quantity) * Number(price) : 0
      settledMap[ci.product_id] = (settledMap[ci.product_id] || 0) + rev
    })

    const prodMap = {}, salesMap = {}, returnMap = {}, revenueMap = {}, consignRevenueMap = {}
    ;(production || []).forEach(e => { prodMap[e.product_id] = (prodMap[e.product_id] || 0) + Number(e.quantity) })
    ;(items || []).forEach(e => {
      salesMap[e.product_id] = (salesMap[e.product_id] || 0) + Number(e.quantity)
      const price = priceMap[e.product_id]
      const rev = e.amount != null ? Number(e.amount) : (price ? Number(e.quantity) * Number(price) : 0)
      if (e.invoices?.payment_type === 'Consign') {
        consignRevenueMap[e.product_id] = (consignRevenueMap[e.product_id] || 0) + rev
      } else {
        revenueMap[e.product_id] = (revenueMap[e.product_id] || 0) + rev
      }
    })
    ;(returns || []).filter(e => e.restore_stock).forEach(e => {
      returnMap[e.product_id] = (returnMap[e.product_id] || 0) + Number(e.quantity)
    })

    const result = (products || []).map(p => {
      const opening = Number(p.opening_stock) || 0
      const produced = prodMap[p.id] || 0
      const sold = salesMap[p.id] || 0
      const returned = returnMap[p.id] || 0
      const settled = settledMap[p.id] || 0
      const rawConsign = consignRevenueMap[p.id] || 0
      return {
        ...p,
        total_produced: produced,
        total_sold: sold,
        total_returned: returned,
        stock: opening + produced - sold + returned,
        // Revenue includes Cash/Credit + settled consign
        revenue: p.unit_price ? (revenueMap[p.id] || 0) + settled : null,
        consignRevenue: Math.max(0, rawConsign - settled), // only unsettled portion is pending
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
  const hasAnyPrice = stock.some(p => p.unit_price)
  const alertCount = stock.filter(p => p.stock < 10).length
  const displayStock = filterLow ? stock.filter(p => p.stock < 10) : stock
  const fmt = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`

  const statCards = [
    { label: 'Products', value: totalProducts, icon: <Package size={18} />, iconClass: '', page: 'products', hint: 'Manage catalog' },
    { label: 'Total Produced', value: totalProduced.toLocaleString(), icon: <TrendingUp size={18} />, iconClass: 'green', page: 'production', hint: 'View log' },
    { label: 'Total Sold', value: totalSold.toLocaleString(), icon: <TrendingDown size={18} />, iconClass: 'amber', page: 'sales', hint: 'View log' },
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
                <th>Sold</th><th>Returned</th><th>Current Stock</th>
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
