import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import './AuthScreen.css'

const OnboardingScreen = () => {
  const { user, profile, saveProfile } = useAuth()
  const [form, setForm] = useState({ username: '', fullName: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    setForm({
      username: profile?.username?.replace(/^@+/, '') ?? '',
      fullName: profile?.full_name ?? '',
    })
  }, [profile])

  const canSubmit = useMemo(() => {
    return !saving && form.username.trim() && form.fullName.trim()
  }, [form, saving])

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!user) return
    setSaving(true)
    setError('')
    setStatus('')
    try {
      await saveProfile({
        username: form.username,
        fullName: form.fullName,
      })
      setStatus('¡Perfecto! Ya puedes comentar y reseñar.')
    } catch (err) {
      setError(err?.message ?? 'No se pudo guardar tu usuario.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="auth-gate onboarding-shell">
      <div className="auth-card onboarding-card" aria-live="polite">
        <p className="muted small">Bienvenido a LugGo</p>
        <h1>Activa tu cuenta</h1>
        <p className="muted small onboarding-note">
          Completa tu usuario y nombre para poder comentar y publicar reseñas. El avatar puedes elegirlo
          después desde tu panel de Usuario.
        </p>
        <form className="onboarding-form" onSubmit={handleSubmit}>
          <label htmlFor="onboarding-username">Nombre de usuario (@)</label>
          <div className="username-input onboarding">
            <span aria-hidden="true">@</span>
            <input
              id="onboarding-username"
              placeholder="elige un alias"
              value={form.username}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, username: event.target.value }))
              }
            />
          </div>
          <label htmlFor="onboarding-fullname">Nombre completo</label>
          <input
            id="onboarding-fullname"
            type="text"
            placeholder="Cómo te verán"
            value={form.fullName}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, fullName: event.target.value }))
            }
          />
          {error && <p className="muted error">{error}</p>}
          {status && <p className="status-message">{status}</p>}
          <button className="primary" type="submit" disabled={!canSubmit}>
            {saving ? 'Guardando...' : 'Continuar'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default OnboardingScreen
