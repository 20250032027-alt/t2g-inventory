import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Package, Factory, ShoppingBag,
  RotateCcw, BarChart2, LogOut, Menu, X, Handshake
} from 'lucide-react'

const NAV = [
  { id: 'inventory',   label: 'Inventory',          icon: LayoutDashboard },
  { id: 'products',    label: 'Products',            icon: Package },
  { id: 'production',  label: 'Production',          icon: Factory },
  { id: 'sales',       label: 'Sales',               icon: ShoppingBag },
  { id: 'returns',     label: 'Returns / Bad Orders',icon: RotateCcw },
  { id: 'countering',  label: 'Countering',          icon: Handshake },
  { id: 'reports',     label: 'Reports',             icon: BarChart2 },
]

const BOTTOM_NAV = [
  { id: 'inventory',  label: 'Inventory',  icon: LayoutDashboard },
  { id: 'production', label: 'Production', icon: Factory },
  { id: 'sales',      label: 'Sales',      icon: ShoppingBag },
  { id: 'reports',    label: 'Reports',    icon: BarChart2 },
]

export default function Layout({ page, setPage, children }) {
  const { user, signOut } = useAuth()
  const [mobileOpen, setMobileOpen] = useState(false)

  const currentLabel = NAV.find(n => n.id === page)?.label || ''

  return (
    <div className="app-layout">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-logo">T2G</span>
            <span className="brand-text">Inventory</span>
          </div>
          <button className="mobile-close icon-btn" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Overview</div>
          {NAV.slice(0, 2).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`}
              onClick={() => { setPage(id); setMobileOpen(false) }}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
          <div className="nav-section-label">Operations</div>
          {NAV.slice(2, 6).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`}
              onClick={() => { setPage(id); setMobileOpen(false) }}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
          <div className="nav-section-label">Analytics</div>
          {NAV.slice(6).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? 'nav-active' : ''}`}
              onClick={() => { setPage(id); setMobileOpen(false) }}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.email?.[0]?.toUpperCase()}</div>
            <span className="user-email">{user?.email}</span>
          </div>
          <button className="icon-btn" onClick={signOut} title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>

      {mobileOpen && <div className="sidebar-backdrop" onClick={() => setMobileOpen(false)} />}

      <div className="main-wrap">
        <header className="mobile-header">
          <button className="icon-btn" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
          <span className="mobile-page-title">{currentLabel}</span>
          <span className="brand-logo" style={{fontSize:'0.9rem'}}>T2G</span>
        </header>
        <main className="main-content">
          {children}
        </main>
        {/* Bottom nav for mobile */}
        <nav className="bottom-nav">
          {BOTTOM_NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`bottom-nav-item ${page === id ? 'bottom-nav-active' : ''}`}
              onClick={() => setPage(id)}>
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
