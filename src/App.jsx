import { useState } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'
import Inventory from './pages/Inventory'
import Products from './pages/Products'
import TapperIntake from './pages/TapperIntake'
import RawMaterials from './pages/RawMaterials'
import Assembly from './pages/Assembly'
import Production from './pages/Production'
import Sales from './pages/Sales'
import Returns from './pages/Returns'
import Reports from './pages/Reports'
import Countering from './pages/Countering'
import ToastContainer from './components/Toast'

function AppInner() {
  const { user, loading } = useAuth()
  const [page, setPage] = useState('inventory')

  if (loading) return <div className="splash"><div className="splash-logo">T2G</div></div>
  if (!user) return <Login />

  const pages = {
    inventory:  <Inventory setPage={setPage} />,
    products:   <Products />,
    tapperintake: <TapperIntake />,
    rawmaterials: <RawMaterials />,
    assembly:   <Assembly />,
    production: <Production />,
    sales:      <Sales />,
    returns:    <Returns />,
    countering: <Countering />,
    reports:    <Reports />,
  }

  return (
    <>
      <ToastContainer />
      <Layout page={page} setPage={setPage}>
        {pages[page] || <Inventory setPage={setPage} />}
      </Layout>
    </>
  )
}

export default function App() {
  return <AuthProvider><AppInner /></AuthProvider>
}
