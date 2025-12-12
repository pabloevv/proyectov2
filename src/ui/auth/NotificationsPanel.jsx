import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import './AuthScreen.css'

const notificationTypeLabels = {
  comment: 'Comentario',
  vote: 'Me gusta',
  follow: 'Nuevo seguidor',
}

const formatNotificationType = (type) => notificationTypeLabels[type] || 'Actividad'

const formatNotificationTimestamp = (value) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}

const NotificationsPanel = () => {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [notificationsLoading, setNotificationsLoading] = useState(false)
  const [notificationsError, setNotificationsError] = useState('')

  useEffect(() => {
    if (!user?.id) {
      setNotifications([])
      setNotificationsError('')
      setNotificationsLoading(false)
      return
    }

    let mounted = true
    const loadNotifications = async () => {
      setNotificationsLoading(true)
      setNotificationsError('')
      const { data, error } = await supabase
        .from('notifications')
        .select('id,type,message,is_read,created_at')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (!mounted) return
      if (error) {
        setNotificationsError(error.message)
      } else {
        setNotifications(data || [])
      }
      setNotificationsLoading(false)
    }

    loadNotifications()

    const channel = supabase
      .channel(`notifications_user_${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          if (!mounted) return
          if (payload.eventType === 'INSERT') {
            setNotifications((prev) => [payload.new, ...prev].slice(0, 20))
          } else if (payload.eventType === 'UPDATE') {
            setNotifications((prev) => prev.map((item) => (item.id === payload.new.id ? payload.new : item)))
          } else if (payload.eventType === 'DELETE') {
            setNotifications((prev) => prev.filter((item) => item.id !== payload.old.id))
          }
        },
      )
      .subscribe()

    return () => {
      mounted = false
      channel.unsubscribe()
    }
  }, [user?.id])

  const handleDismissNotification = async (notificationId) => {
    try {
      await supabase.from('notifications').delete().eq('id', notificationId)
    } catch (error) {
      console.warn('No se pudo eliminar la notificación', error)
    }
  }

  return (
    <aside className="notifications-panel">
      <div className="notifications-header">
        <p className="muted small">Centro de actividad</p>
        <h3>Notificaciones</h3>
      </div>
      <div className="notifications-list">
        {notificationsLoading && <p className="muted small">Cargando notificaciones...</p>}
        {notificationsError && <p className="muted error">{notificationsError}</p>}
        {!notificationsLoading && !notificationsError && notifications.length === 0 && (
          <p className="muted small">No hay notificaciones recientes.</p>
        )}
        {notifications.map((notification) => (
          <article
            key={notification.id}
            className={`notification-item ${notification.is_read ? 'read' : 'unread'}`}
          >
            <div className="notification-body">
              <p className="notification-type">{formatNotificationType(notification.type)}</p>
              <p className="notification-message">
                {notification.message || 'Actividad reciente en tu cuenta'}
              </p>
              <span className="notification-date">
                {formatNotificationTimestamp(notification.created_at)}
              </span>
            </div>
            <button
              className="notification-dismiss"
              type="button"
              aria-label="Eliminar notificación"
              onClick={() => handleDismissNotification(notification.id)}
            >
              ×
            </button>
          </article>
        ))}
      </div>
    </aside>
  )
}

export default NotificationsPanel
