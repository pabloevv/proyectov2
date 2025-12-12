import AuthScreen from '../../ui/auth/AuthScreen'
import NotificationsPanel from '../../ui/auth/NotificationsPanel'
import './User.css'

function UserPage() {
  return (
    <div className="user-page">
      <div className="user-main">
        <AuthScreen />
      </div>
      <NotificationsPanel />
    </div>
  )
}

export default UserPage
