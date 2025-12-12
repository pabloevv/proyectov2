import { useEffect } from 'react'
import { useLocation, useNavigate, Route, Routes } from 'react-router-dom'
import './App.css'
import NavBar from './navigation/NavBar'
import HomePage from './navigation/pages/Home'
import SearchPage from './navigation/pages/Search'
import CreatePage from './navigation/pages/Create'
import MapPage from './navigation/pages/Map'
import UserPage from './navigation/pages/User'
import { supabase } from './lib/supabaseClient'
import { useAuth } from './contexts/AuthContext'
import luggoLogo from './assets/images/icono LugGO/luggo.svg'
import OnboardingScreen from './ui/auth/OnboardingScreen'

function BrandStamp() {
  return (
    <div className="brand-stamp">
      <div className="brand-icon">
        <span className="brand-letter brand-letter-l">L</span>
        <span className="brand-letter brand-letter-g">G</span>
      </div>
      <span className="brand-label">LugGO</span>
    </div>
  )
}

function App() {
  const { user, loading, loginWithGoogle, profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    const testSupabase = async () => {
      const { data, error } = await supabase.from('places').select('*').limit(5)
      if (error) {
        console.error('Supabase test (places) failed:', error.message)
        return
      }
      console.info('Supabase test (places) ok. Sample rows:', data)
    }

    testSupabase()
  }, [])

  if (loading) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <p>Cargando tu sesión...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="auth-gate">
        <div className="auth-card">
          <img src={luggoLogo} alt="LugGO" className="auth-logo" />
          <h1>LugGo</h1>
          <p>Inicia sesión con Google para unirte y compartir reseñas.</p>
          <button className="primary" type="button" onClick={loginWithGoogle}>
            Entrar con Google
          </button>
        </div>
      </div>
    )
  }

  const needsOnboarding = Boolean(
    user && (!profile?.username || !profile?.full_name),
  )

  if (needsOnboarding) {
    return <OnboardingScreen />
  }

  return (
    <div className="app-shell">
      <main className="page-area">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/user" element={<UserPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>

      <NavBar activePath={location.pathname} onNavigate={navigate} />
      <BrandStamp />
    </div>
  )
}

export default App
