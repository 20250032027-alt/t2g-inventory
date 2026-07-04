import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Download, Printer, ChevronDown } from 'lucide-react'
import * as XLSX from 'xlsx'

const CURRENT_MONTH = new Date().toISOString().slice(0, 7)

export default function Reports() {
  const [invoices, setInvoices] = useState([])
  const [returns, setReturns] = useState([])
  const [production, setProduction] = useState([])
  const [products, setProducts] = useState([])
  const [counterItems, setCounterItems] = useState([])
  const [allConsignInvoices, setAllConsignInvoices] = useState([])
  const [allCounterEntries, setAllCounterEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('summary')
  const [dateFrom, setDateFrom] = useState(CURRENT_MONTH + '-01')
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [filterProduct, setFilterProduct] = useState('all')

  useEffect(() => { fetchAll() }, [dateFrom, dateTo, filterProduct])

  async function fetchAll() {
    setLoading(true)
    let invQ = supabase.from('invoices')
      .select('*, invoice_items(*, products(id, name, unit, unit_price))')
      .gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: false })
    let retQ = supabase.from('return_entries')
      .select('*, products(name, unit)')
      .gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: false })
    let prodQ = supabase.from('production_entries')
      .select('*, products(name, unit)')
      .gte('date', dateFrom).lte('date', dateTo).order('date', { ascending: false })

    if (filterProduct !== 'all') {
      retQ = retQ.eq('product_id', filterProduct)
      prodQ = prodQ.eq('product_id', filterProduct)
    }

    const [{ data: invs }, { data: r }, { data: p }, { data: prods }, { data: cEntries }, { data: consignInvs }, { data: allCEntries }] = await Promise.all([
      invQ, retQ, prodQ,
      supabase.from('products').select('id, name, unit_price').order('name'),
      supabase.from('counter_entries')
        .select('*, counter_items(product_id, quantity, invoice_id, products(name, unit, unit_price), invoices(reference_no, client))')
        .gte('date', dateFrom).lte('date', dateTo)
        .order('date', { ascending: false }),
      supabase.from('invoices')
        .select('*, invoice_items(product_id, quantity, amount, products(id, name, unit, unit_price))')
        .eq('payment_type', 'Consign')
        .order('date', { ascending: false }),
      supabase.from('counter_entries')
        .select('invoice_id, counter_items(product_id, quantity)')
    ])

    let filteredInvs = invs || []
    if (filterProduct !== 'all') {
      filteredInvs = filteredInvs.filter(inv =>
        inv.invoice_items?.some(item => item.product_id === filterProduct)
      )
    }

    setInvoices(filteredInvs)
    setReturns(r || [])
    setProduction(p || [])
    setProducts(prods || [])
    setCounterItems(cEntries || [])
    setAllConsignInvoices(consignInvs || [])
    setAllCounterEntries(allCEntries || [])
    setLoading(false)
  }

  const fmt = (n) => `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
  const hasPrice = products.some(p => p.unit_price)

  // Flatten all invoice items for summary
  const allItems = invoices.flatMap(inv =>
    (inv.invoice_items || []).map(item => ({ ...item, invoice: inv }))
  )

  const summaryMap = {}
  allItems.forEach(item => {
    const key = item.products?.name || 'Unknown'
    if (!summaryMap[key]) summaryMap[key] = { product: key, unit: item.products?.unit, unit_price: item.products?.unit_price, total_sold: 0, cash: 0, credit: 0, consign: 0, paidGross: 0, paidActual: 0, consignGross: 0, consignActual: 0 }
    summaryMap[key].total_sold += Number(item.quantity)
    const pt = (item.invoice?.payment_type || 'Cash').toLowerCase()
    const price = item.products?.unit_price ? Number(item.products.unit_price) : 0
    const gross = Number(item.quantity) * price
    const actual = itemRevenue(item)
    if (pt === 'cash') { summaryMap[key].cash += Number(item.quantity); summaryMap[key].paidGross += gross; summaryMap[key].paidActual += actual }
    else if (pt === 'credit') { summaryMap[key].credit += Number(item.quantity); summaryMap[key].paidGross += gross; summaryMap[key].paidActual += actual }
    else if (pt === 'consign') { summaryMap[key].consign += Number(item.quantity); summaryMap[key].consignGross += gross; summaryMap[key].consignActual += actual }
  })
  returns.forEach(e => {
    const key = e.products?.name || 'Unknown'
    if (!summaryMap[key]) summaryMap[key] = { product: key, unit: e.products?.unit, unit_price: null, total_sold: 0, cash: 0, credit: 0, consign: 0, returns_back: 0, returns_loss: 0, paidGross: 0, paidActual: 0, consignGross: 0, consignActual: 0 }
    if (!summaryMap[key].returns_back) summaryMap[key].returns_back = 0
    if (!summaryMap[key].returns_loss) summaryMap[key].returns_loss = 0
    if (e.restore_stock) summaryMap[key].returns_back += Number(e.quantity)
    else summaryMap[key].returns_loss += Number(e.quantity)
  })
  // Countered quantities per product (from counter_entries in date range)
  const counteredMap = {}
  counterItems.forEach(entry => {
    (entry.counter_items || []).forEach(ci => {
      const key = ci.products?.name || 'Unknown'
      counteredMap[key] = (counteredMap[key] || 0) + Number(ci.quantity)
    })
  })

  // All-time countered per product (for remaining consign balance — unaffected by date filter)
  const allCounteredByProduct = {}
  allCounterEntries.forEach(entry => {
    (entry.counter_items || []).forEach(ci => {
      const pid = ci.product_id
      allCounteredByProduct[pid] = (allCounteredByProduct[pid] || 0) + Number(ci.quantity)
    })
  })
  // All-time consigned per product
  const allConsignedByProduct = {}
  allConsignInvoices.forEach(inv => {
    (inv.invoice_items || []).forEach(item => {
      allConsignedByProduct[item.product_id] = (allConsignedByProduct[item.product_id] || 0) + Number(item.quantity)
    })
  })

  const summaryRows = Object.values(summaryMap).map(r => ({
    ...r,
    returns_back: r.returns_back || 0,
    returns_loss: r.returns_loss || 0,
    countered: counteredMap[r.product] || 0,
  })).map(r => {
    // Find product id to look up all-time remaining (and fall back to current price if this row came only from returns)
    const prod = products.find(p => p.name === r.product)
    const pid = prod?.id
    const unit_price = r.unit_price || prod?.unit_price || null
    const totalConsigned = pid ? (allConsignedByProduct[pid] || 0) : 0
    const totalCountered = pid ? (allCounteredByProduct[pid] || 0) : 0
    // Sales Discount: gross sticker value (qty × unit price) minus what was actually charged (amount override), across every invoice line for this product
    const salesDiscount = (r.paidGross || 0) - (r.paidActual || 0) + (r.consignGross || 0) - (r.consignActual || 0)
    // Net Revenue: actual cash/credit collected (after discount), minus returns, plus consign that's been settled/countered this period
    const returnsValue = (r.returns_back + r.returns_loss) * Number(unit_price || 0)
    const settledConsignRevenue = r.countered * Number(unit_price || 0)
    const netRevenue = (r.paidActual || 0) - returnsValue + settledConsignRevenue
    return { ...r, unit_price, remainingConsign: Math.max(0, totalConsigned - totalCountered), salesDiscount, netRevenue }
  })

  // Revenue: prefer stored amount override, else qty × unit_price
  function itemRevenue(item) {
    if (item.amount != null) return Number(item.amount)
    const price = item.products?.unit_price
    return price ? Number(item.quantity) * Number(price) : 0
  }

  const totalSold = allItems.reduce((s, i) => s + Number(i.quantity), 0)
  const totalReturns = returns.reduce((s, e) => s + Number(e.quantity), 0)
  const totalProduced = production.reduce((s, e) => s + Number(e.quantity), 0)
  // Revenue (excl. Consign): real collected money. Consign sales are pending, tracked separately.
  const paidRevenue = allItems.filter(item => item.invoice?.payment_type !== 'Consign').reduce((s, item) => s + itemRevenue(item), 0)
  const rawConsignRevenue = allItems.filter(item => item.invoice?.payment_type === 'Consign').reduce((s, item) => s + itemRevenue(item), 0)
  // Settled consign: all counter entries within the date range (regardless of when the original consign invoice was created)
  const settledConsignRevenue = counterItems
    .flatMap(entry => entry.counter_items || [])
    .reduce((s, ci) => {
      return s + (ci.products?.unit_price ? Number(ci.quantity) * Number(ci.products.unit_price) : 0)
    }, 0)
  const effectivePaidRevenue = paidRevenue + settledConsignRevenue
  const pendingConsignRevenue = Math.max(0, rawConsignRevenue - settledConsignRevenue)

  function exportExcel() {
    const wb = XLSX.utils.book_new()
    if (mode === 'summary') {
      const rows = summaryRows.map(r => {
        const net = r.total_sold - r.returns_back - r.returns_loss
        const row = { 'Product': r.product, 'Unit': r.unit, 'Total Sold': r.total_sold, 'Cash': r.cash, 'Credit': r.credit, 'Consign': r.consign, 'Countered': r.countered, 'Remaining Consign': r.remainingConsign, 'Returns (Back)': r.returns_back, 'Returns (Loss)': r.returns_loss, 'Net Sold': net }
        if (r.unit_price) {
          row['Unit Price (₱)'] = r.unit_price
          row['Revenue (₱)'] = net * Number(r.unit_price)
          row['Sales Discount (₱)'] = r.salesDiscount
          row['Net Revenue (₱)'] = r.netRevenue
        }
        return row
      })
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sales Summary')
    } else {
      const invoiceRows = invoices.flatMap(inv =>
        (inv.invoice_items || []).map(item => {
          const row = { 'Date': inv.date, 'Reference #': inv.reference_no || '', 'Client': inv.client || '', 'Product': item.products?.name, 'Quantity': item.quantity, 'Unit': item.products?.unit, 'Channel': inv.channel, 'Payment Type': inv.payment_type, 'Notes': inv.notes || '' }
          if (item.products?.unit_price) {
            const gross = Number(item.quantity) * Number(item.products.unit_price)
            const net = itemRevenue(item)
            row['Amount (₱)'] = gross
            row['Sales Discount (₱)'] = gross - net
            row['Net Revenue (₱)'] = net
          }
          return row
        })
      )
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(invoiceRows), 'Sales Detail')
      const returnRows = returns.map(e => ({ 'Date': e.date, 'Reference #': e.reference_no || '', 'Client': e.client || '', 'Product': e.products?.name, 'Quantity': e.quantity, 'Unit': e.products?.unit, 'Reason': e.reason, 'Stock Action': e.restore_stock ? 'Returned to Stock' : 'Written Off', 'Notes': e.notes || '' }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(returnRows), 'Returns')
      const counterRows = counterItems.flatMap(entry =>
        (entry.counter_items || []).map(ci => ({
          'Date': entry.date,
          'Counter Ref #': entry.reference_no || '',
          'Consign Invoice': ci.invoices?.reference_no || '',
          'Client': ci.invoices?.client || '',
          'Product': ci.products?.name,
          'Qty Settled': ci.quantity,
          'Unit': ci.products?.unit,
          ...(ci.products?.unit_price ? { 'Amount (₱)': Number(ci.quantity) * Number(ci.products.unit_price) } : {})
        }))
      )
      if (counterRows.length > 0) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(counterRows), 'Countering')
    }
    if (mode === 'inout') {
      // IN: production entries
      const inRows = production.map(e => ({
        'Date': e.date,
        'Movement': 'IN',
        'Type': 'Production',
        'Product': e.products?.name,
        'Quantity': e.quantity,
        'Unit': e.products?.unit,
        'Notes': e.notes || '',
      }))
      // OUT: sales invoice items
      const outSalesRows = invoices.flatMap(inv =>
        (inv.invoice_items || []).map(item => ({
          'Date': inv.date,
          'Movement': 'OUT',
          'Type': `Sale (${inv.payment_type})`,
          'Product': item.products?.name,
          'Quantity': item.quantity,
          'Unit': item.products?.unit,
          'Ref / Client': `${inv.reference_no || ''} ${inv.client || ''}`.trim(),
        }))
      )
      // OUT: returns written off (stock not restored)
      const outReturnRows = returns.filter(e => !e.restore_stock).map(e => ({
        'Date': e.date,
        'Movement': 'OUT',
        'Type': 'Return (Written Off)',
        'Product': e.products?.name,
        'Quantity': e.quantity,
        'Unit': e.products?.unit,
        'Ref / Client': `${e.reference_no || ''} ${e.client || ''}`.trim(),
      }))
      // IN: returns restored to stock
      const inReturnRows = returns.filter(e => e.restore_stock).map(e => ({
        'Date': e.date,
        'Movement': 'IN',
        'Type': 'Return (Back to Stock)',
        'Product': e.products?.name,
        'Quantity': e.quantity,
        'Unit': e.products?.unit,
        'Ref / Client': `${e.reference_no || ''} ${e.client || ''}`.trim(),
      }))
      // SETTLED: countered consign sales invoices (paperwork settlement, not a new physical stock exit —
      // the goods already left as OUT when the consign invoice was created)
      const settledRows = counterItems.flatMap(entry =>
        (entry.counter_items || []).map(ci => ({
          'Date': entry.date,
          'Movement': 'SETTLED',
          'Type': 'Countered (Consign Settlement)',
          'Product': ci.products?.name,
          'Quantity': ci.quantity,
          'Unit': ci.products?.unit,
          'Ref / Client': `${entry.reference_no || ci.invoices?.reference_no || ''} ${ci.invoices?.client || ''}`.trim(),
        }))
      )
      const allMovements = [...inRows, ...inReturnRows, ...outSalesRows, ...outReturnRows, ...settledRows]
        .sort((a, b) => a['Date'].localeCompare(b['Date']))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(allMovements), 'Inventory In-Out')
    }
    XLSX.writeFile(wb, `T2G_Sales_Report_${dateFrom}_to_${dateTo}.xlsx`)
  }

  return (
    <div className="page">
      <div className="page-header no-print">
        <div><h1>Reports</h1><p className="page-desc">Sales and production summary for any date range.</p></div>
        <div className="report-actions">
          <button className="btn-ghost" onClick={() => window.print()}><Printer size={15} /> Print</button>
          <button className="btn-primary" onClick={exportExcel}><Download size={15} /> Export Excel</button>
        </div>
      </div>

      <div className="report-filters no-print">
        <div className="filter-group"><label>From</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></div>
        <div className="filter-group"><label>To</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></div>
        <div className="filter-group">
          <label>Product</label>
          <div className="select-wrap">
            <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)}>
              <option value="all">All Products</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronDown size={16} className="select-icon" />
          </div>
        </div>
        <div className="filter-group">
          <label>View</label>
          <div className="toggle-group">
            <button className={`toggle-btn ${mode === 'summary' ? 'toggle-active' : ''}`} onClick={() => setMode('summary')}>Summary</button>
            <button className={`toggle-btn ${mode === 'detailed' ? 'toggle-active' : ''}`} onClick={() => setMode('detailed')}>Detailed</button>
            <button className={`toggle-btn ${mode === 'inout' ? 'toggle-active' : ''}`} onClick={() => setMode('inout')}>In / Out</button>
          </div>
        </div>
      </div>

      <div className="print-only print-header">
        <div className="print-brand">T2G Inventory — Sales Report</div>
        <div className="print-meta">Period: {dateFrom} to {dateTo} &nbsp;|&nbsp; Generated: {new Date().toLocaleDateString()}</div>
      </div>

      {loading ? (
        <div className="skeleton-list">{[1,2,3].map(i => <div key={i} className="skeleton-row" />)}</div>
      ) : (
        <div>
          <div className="stat-grid" style={{marginBottom: 8}}>
            <div className="stat-card"><div className="stat-label">Total Produced</div><div className="stat-value">{totalProduced.toLocaleString()}</div></div>
            <div className="stat-card"><div className="stat-label">Total Sold</div><div className="stat-value">{totalSold.toLocaleString()}</div></div>
            <div className="stat-card"><div className="stat-label">Total Returns</div><div className="stat-value">{totalReturns.toLocaleString()}</div></div>
            <div className="stat-card"><div className="stat-label">Net Sold</div><div className="stat-value">{(totalSold - totalReturns).toLocaleString()}</div></div>
            {hasPrice && <div className="stat-card" style={{borderColor:'rgba(34,197,94,0.3)'}}><div className="stat-label" style={{color:'var(--green-text)'}}>Revenue (incl. Settled)</div><div className="stat-value" style={{color:'var(--green-text)'}}>{fmt(effectivePaidRevenue)}</div></div>}
            {hasPrice && pendingConsignRevenue > 0 && <div className="stat-card"><div className="stat-label" style={{opacity:0.6}}>Consign (pending)</div><div className="stat-value" style={{opacity:0.55}}>{fmt(pendingConsignRevenue)}</div></div>}
          </div>

          {mode === 'summary' ? (
            <>
              <h2 className="section-title" style={{marginTop:'28px',marginBottom:'12px'}}>Sales Summary by Product</h2>
              {summaryRows.length === 0 ? <div className="empty-state"><p>No data for this period.</p></div> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Product</th><th>Total Sold</th><th>Cash</th><th>Credit</th><th>Consign</th><th>Countered</th><th>Remaining</th><th>Returns (Back)</th><th>Returns (Loss)</th><th>Net Sold</th>{hasPrice && <th>Revenue</th>}</tr></thead>
                    <tbody>
                      {summaryRows.map((r, i) => {
                        const net = r.total_sold - r.returns_back - r.returns_loss
                        return (
                          <tr key={i}>
                            <td className="td-name">{r.product}</td>
                            <td className="td-qty">{r.total_sold.toLocaleString()} <span className="unit-label">{r.unit}</span></td>
                            <td className="td-qty">{r.cash.toLocaleString()}</td>
                            <td className="td-qty">{r.credit.toLocaleString()}</td>
                            <td className="td-qty">{r.consign.toLocaleString()}</td>
                            <td className="td-qty" style={{color: r.countered > 0 ? 'var(--green-text)' : undefined}}>{r.countered.toLocaleString()}</td>
                            <td className="td-qty" style={{color: r.remainingConsign > 0 ? 'var(--accent)' : 'var(--text-muted)', fontWeight: r.remainingConsign > 0 ? 600 : 400}}>{r.remainingConsign > 0 ? r.remainingConsign.toLocaleString() : '—'}</td>
                            <td className="td-qty">{r.returns_back.toLocaleString()}</td>
                            <td className="td-qty">{r.returns_loss.toLocaleString()}</td>
                            <td className="td-qty bold">{net.toLocaleString()} <span className="unit-label">{r.unit}</span></td>
                            {hasPrice && <td className="td-qty" style={{color:'var(--green-text)'}}>{r.unit_price ? fmt(net * Number(r.unit_price)) : '—'}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : mode === 'inout' ? (
            <>
              <h2 className="section-title" style={{marginTop:'28px',marginBottom:'4px'}}>Inventory In / Out</h2>
              <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:16}}>All stock movements for the selected period. IN = production + returns to stock. OUT = sales + written-off returns. SETTLED = consign sales countered (paperwork only — stock already left as OUT at the time of the consign invoice, not counted again here).</p>
              {(() => {
                // Build unified movement list
                const movements = []

                // IN: production
                production.forEach(e => movements.push({
                  date: e.date,
                  direction: 'IN',
                  type: 'Production',
                  product: e.products?.name || '—',
                  unit: e.products?.unit,
                  qty: Number(e.quantity),
                  ref: e.notes || '',
                  color: 'var(--green-text)',
                }))

                // IN: returns restored
                returns.filter(e => e.restore_stock).forEach(e => movements.push({
                  date: e.date,
                  direction: 'IN',
                  type: 'Return to Stock',
                  product: e.products?.name || '—',
                  unit: e.products?.unit,
                  qty: Number(e.quantity),
                  ref: e.client || e.reference_no || '',
                  color: 'var(--green-text)',
                }))

                // OUT: sales
                invoices.forEach(inv => {
                  ;(inv.invoice_items || []).forEach(item => {
                    movements.push({
                      date: inv.date,
                      direction: 'OUT',
                      type: `Sale · ${inv.payment_type}`,
                      product: item.products?.name || '—',
                      unit: item.products?.unit,
                      qty: Number(item.quantity),
                      ref: [inv.reference_no, inv.client].filter(Boolean).join(' · '),
                      color: inv.payment_type === 'Consign' ? 'var(--accent)' : 'var(--text-muted)',
                      price: item.amount != null ? Number(item.amount) : (item.products?.unit_price ? Number(item.quantity) * Number(item.products.unit_price) : null),
                      paymentType: inv.payment_type,
                    })
                  })
                })

                // OUT: returns written off
                returns.filter(e => !e.restore_stock).forEach(e => movements.push({
                  date: e.date,
                  direction: 'OUT',
                  type: 'Written Off',
                  product: e.products?.name || '—',
                  unit: e.products?.unit,
                  qty: Number(e.quantity),
                  ref: e.client || e.reference_no || '',
                  color: 'var(--red-text, #f87171)',
                }))

                // SETTLED: countered consign sales invoices — a paperwork settlement, not a new
                // physical stock exit (the stock already left as OUT when the consign invoice was made).
                // Shown for traceability only; excluded from IN/OUT/Net totals below.
                counterItems.forEach(entry => {
                  ;(entry.counter_items || []).forEach(ci => movements.push({
                    date: entry.date,
                    direction: 'SETTLED',
                    type: 'Countered · Consign Settlement',
                    product: ci.products?.name || '—',
                    unit: ci.products?.unit,
                    qty: Number(ci.quantity),
                    ref: [entry.reference_no || ci.invoices?.reference_no, ci.invoices?.client].filter(Boolean).join(' · '),
                    color: 'var(--accent)',
                  }))
                })

                // Sort by date desc
                movements.sort((a, b) => b.date.localeCompare(a.date))

                // Per-product running totals for summary (SETTLED rows are informational only, not counted)
                const productTotals = {}
                movements.forEach(m => {
                  if (m.direction !== 'IN' && m.direction !== 'OUT') return
                  if (!productTotals[m.product]) productTotals[m.product] = { in: 0, out: 0, unit: m.unit }
                  if (m.direction === 'IN') productTotals[m.product].in += m.qty
                  else productTotals[m.product].out += m.qty
                })

                const totalIn = movements.filter(m => m.direction === 'IN').reduce((s, m) => s + m.qty, 0)
                const totalOut = movements.filter(m => m.direction === 'OUT').reduce((s, m) => s + m.qty, 0)

                return movements.length === 0 ? (
                  <div className="empty-state"><p>No movements for this period.</p></div>
                ) : (
                  <>
                    {/* Summary strip */}
                    <div style={{display:'flex',gap:16,marginBottom:20,flexWrap:'wrap'}}>
                      <div className="stat-card" style={{flex:'0 0 auto',minWidth:140}}>
                        <div className="stat-label" style={{color:'var(--green-text)'}}>Total IN</div>
                        <div className="stat-value" style={{color:'var(--green-text)'}}>{totalIn.toLocaleString()}</div>
                      </div>
                      <div className="stat-card" style={{flex:'0 0 auto',minWidth:140}}>
                        <div className="stat-label">Total OUT</div>
                        <div className="stat-value">{totalOut.toLocaleString()}</div>
                      </div>
                      <div className="stat-card" style={{flex:'0 0 auto',minWidth:140}}>
                        <div className="stat-label">Net Movement</div>
                        <div className="stat-value" style={{color: totalIn - totalOut >= 0 ? 'var(--green-text)' : 'var(--red-text, #f87171)'}}>
                          {totalIn - totalOut >= 0 ? '+' : ''}{(totalIn - totalOut).toLocaleString()}
                        </div>
                      </div>
                    </div>

                    {/* Per-product breakdown */}
                    <div style={{marginBottom:20}}>
                      <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--text-muted)',marginBottom:8}}>By Product</div>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead><tr><th>Product</th><th style={{color:'var(--green-text)'}}>IN</th><th>OUT</th><th>Net</th></tr></thead>
                          <tbody>
                            {Object.entries(productTotals).sort((a,b) => a[0].localeCompare(b[0])).map(([name, t]) => (
                              <tr key={name}>
                                <td className="td-name">{name}</td>
                                <td className="td-qty" style={{color:'var(--green-text)'}}>{t.in.toLocaleString()} <span className="unit-label">{t.unit}</span></td>
                                <td className="td-qty">{t.out.toLocaleString()} <span className="unit-label">{t.unit}</span></td>
                                <td className="td-qty" style={{fontWeight:600,color: t.in-t.out >= 0 ? 'var(--green-text)' : 'var(--red-text, #f87171)'}}>
                                  {t.in-t.out >= 0 ? '+' : ''}{(t.in-t.out).toLocaleString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Full movement log */}
                    <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'0.06em',color:'var(--text-muted)',marginBottom:8}}>Movement Log</div>
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Direction</th>
                            <th>Type</th>
                            <th>Product</th>
                            <th>Qty</th>
                            <th>Ref / Client</th>
                            {hasPrice && <th>Amount</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {movements.map((m, i) => (
                            <tr key={i}>
                              <td className="td-mono">{m.date}</td>
                              <td>
                                <span className="badge" style={{
                                  background: m.direction === 'IN' ? 'rgba(34,197,94,0.12)' : m.direction === 'SETTLED' ? 'rgba(99,102,241,0.12)' : 'rgba(148,163,184,0.1)',
                                  color: m.direction === 'IN' ? 'var(--green-text)' : m.direction === 'SETTLED' ? 'var(--accent)' : 'var(--text-muted)',
                                  fontWeight: 700
                                }}>{m.direction}</span>
                              </td>
                              <td className="td-muted" style={{fontSize:12}}>{m.type}</td>
                              <td className="td-name">{m.product}</td>
                              <td className="td-qty" style={{color: m.color, fontWeight: 600}}>
                                {m.direction === 'OUT' ? '-' : m.direction === 'SETTLED' ? '' : '+'}{m.qty.toLocaleString()} <span className="unit-label">{m.unit}</span>
                              </td>
                              <td className="td-muted" style={{fontSize:12}}>{m.ref || '—'}</td>
                              {hasPrice && <td className="td-qty" style={{color:'var(--green-text)'}}>{m.price != null ? fmt(m.price) : '—'}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <h2 className="section-title" style={{marginTop:'28px',marginBottom:'12px'}}>Sales Detail</h2>
              {invoices.length === 0 ? <div className="empty-state"><p>No sales for this period.</p></div> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Ref #</th><th>Client</th><th>Product</th><th>Qty</th><th>Channel</th><th>Payment</th>{hasPrice && <th>Amount</th>}</tr></thead>
                    <tbody>
                      {invoices.flatMap(inv =>
                        (inv.invoice_items || []).map(item => (
                          <tr key={item.id}>
                            <td className="td-mono">{inv.date}</td>
                            <td className="td-muted">{inv.reference_no || '—'}</td>
                            <td className="td-name">{inv.client || '—'}</td>
                            <td>{item.products?.name}</td>
                            <td className="td-qty">{Number(item.quantity).toLocaleString()} <span className="unit-label">{item.products?.unit}</span></td>
                            <td><span className={`badge channel-${inv.channel?.toLowerCase()}`}>{inv.channel}</span></td>
                            <td><span className={`badge payment-${inv.payment_type?.toLowerCase()}`}>{inv.payment_type}</span></td>
                            {hasPrice && <td className="td-qty" style={{color:'var(--green-text)'}}>{item.products?.unit_price ? fmt(Number(item.quantity) * Number(item.products.unit_price)) : '—'}</td>}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              <h2 className="section-title" style={{marginTop:'32px',marginBottom:'12px'}}>Returns / Bad Orders</h2>
              {returns.length === 0 ? <div className="empty-state"><p>No returns for this period.</p></div> : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Date</th><th>Ref #</th><th>Client</th><th>Product</th><th>Qty</th><th>Reason</th><th>Stock Action</th></tr></thead>
                    <tbody>
                      {returns.map(e => (
                        <tr key={e.id}>
                          <td className="td-mono">{e.date}</td>
                          <td className="td-muted">{e.reference_no || '—'}</td>
                          <td className="td-name">{e.client || '—'}</td>
                          <td>{e.products?.name}</td>
                          <td className="td-qty">{Number(e.quantity).toLocaleString()} <span className="unit-label">{e.products?.unit}</span></td>
                          <td><span className="badge badge-amber">{e.reason}</span></td>
                          <td>{e.restore_stock ? <span className="badge badge-green">Back to Stock</span> : <span className="badge badge-red">Written Off</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h2 className="section-title" style={{marginTop:'32px',marginBottom:'12px'}}>Consign Reconciliation</h2>
              {allConsignInvoices.length === 0 ? <div className="empty-state"><p>No consign invoices found.</p></div> : (() => {
                // Build per-invoice, per-product countered totals from ALL counter history
                // Use ALL counter history (not date-filtered) so remaining is always accurate
                const counteredByInvProduct = {}
                allCounterEntries.forEach(entry => {
                  const invId = entry.invoice_id
                  if (!invId) return
                  ;(entry.counter_items || []).forEach(ci => {
                    const key = `${invId}__${ci.product_id}`
                    counteredByInvProduct[key] = (counteredByInvProduct[key] || 0) + Number(ci.quantity)
                  })
                })

                return (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Invoice Date</th>
                          <th>Ref #</th>
                          <th>Client</th>
                          <th>Product</th>
                          <th>Consigned</th>
                          <th style={{color:'var(--green-text)'}}>Countered</th>
                          <th>Remaining</th>
                          <th>Status</th>
                          {hasPrice && <th>Remaining Value</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {allConsignInvoices.flatMap(inv =>
                          (inv.invoice_items || []).map((item, idx) => {
                            const countered = counteredByInvProduct[`${inv.id}__${item.product_id}`] || 0
                            const consigned = Number(item.quantity)
                            const remaining = Math.max(0, consigned - countered)
                            const isSettled = remaining === 0
                            const price = item.products?.unit_price
                            const remainingValue = price ? remaining * Number(price) : null
                            return (
                              <tr key={`${inv.id}-${idx}`} style={{ opacity: isSettled ? 0.45 : 1 }}>
                                <td className="td-mono">{inv.date}</td>
                                <td className="td-muted">{inv.reference_no || '—'}</td>
                                <td className="td-name">{inv.client || '—'}</td>
                                <td>{item.products?.name}</td>
                                <td className="td-qty">{consigned.toLocaleString()} <span className="unit-label">{item.products?.unit}</span></td>
                                <td className="td-qty" style={{color: countered > 0 ? 'var(--green-text)' : 'var(--text-muted)'}}>{countered.toLocaleString()}</td>
                                <td className="td-qty" style={{fontWeight: remaining > 0 ? 600 : 400}}>{remaining.toLocaleString()}</td>
                                <td>
                                  {isSettled
                                    ? <span className="badge badge-green">Settled</span>
                                    : countered > 0
                                      ? <span className="badge badge-blue">Partial</span>
                                      : <span className="badge badge-amber">Pending</span>
                                  }
                                </td>
                                {hasPrice && <td className="td-qty" style={{color: remaining > 0 ? 'var(--accent)' : undefined}}>{remainingValue != null ? (remaining > 0 ? fmt(remainingValue) : '—') : '—'}</td>}
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )
              })()}
            </>
          )}
        </div>
      )}
    </div>
  )
}
