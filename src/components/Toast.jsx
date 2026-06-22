import { useEffect, useState } from 'react'
import { Check, X, AlertTriangle } from 'lucide-react'

let toastFn = null
export function showToast(message, type = 'success') {
  if (toastFn) toastFn(message, type)
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  useEffect(() => {
    toastFn = (message, type) => {
      const id = Date.now()
      setToasts(prev => [...prev, { id, message, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
    }
    return () => { toastFn = null }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />}
          <span>{t.message}</span>
          <button className="toast-close" onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
