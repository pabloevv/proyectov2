import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import likeIcon from '../../assets/images/review-section/like.svg'
import dislikeIcon from '../../assets/images/review-section/dislike.svg'
import commentIcon from '../../assets/images/review-section/comment.svg'
import { formatLikesLabel, getRankByLikes } from '../../lib/rankings'
import './AuthScreen.css'
import '../../navigation/pages/Feed.css'

const fallbackImage =
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80'

const Stars = ({ value }) => (
  <div className="card-stars" aria-label={`${value} estrellas`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <span key={n} className={n <= value ? 'star filled' : 'star'}>
        ★
      </span>
    ))}
  </div>
)

const extractStoragePath = (url) => {
  if (!url) return null
  const clean = url.split('?')[0]
  const marker = '/storage/v1/object/public/'
  const idx = clean.indexOf(marker)
  if (idx === -1) return null
  return clean.slice(idx + marker.length)
}

const getSignedImageUrl = async (url) => {
  if (!url) return ''
  const path = extractStoragePath(url)
  if (!path) return url
  const [bucket, ...rest] = path.split('/')
  const objectPath = rest.join('/')
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600)
  if (error) {
    console.warn('No se pudo firmar la URL de la reseña', error)
    return url
  }
  return data?.signedUrl || url
}

const enrichCommentAvatar = async (comment) => {
  if (!comment?.profiles?.avatar_url) return comment
  const signed = await getSignedImageUrl(comment.profiles.avatar_url)
  return {
    ...comment,
    profiles: { ...comment.profiles, avatar_url: signed },
  }
}

const deleteReviewCascade = async (review) => {
  if (review.review_images?.length) {
    const files = review.review_images
      .map((img) => {
        const path = extractStoragePath(img.image_url)
        if (!path) return null
        const [bucket, ...rest] = path.split('/')
        return { bucket, objectPath: rest.join('/') }
      })
      .filter(Boolean)
    for (const file of files) {
      await supabase.storage.from(file.bucket).remove([file.objectPath])
    }
  }
  await supabase.from('review_hashtags').delete().eq('review_id', review.id)
  await supabase.from('review_comments').delete().eq('review_id', review.id)
  await supabase.from('votes').delete().eq('review_id', review.id)
  await supabase.from('review_images').delete().eq('review_id', review.id)
  await supabase.from('reviews').delete().eq('id', review.id)
}

const AuthScreen = () => {
  const { user, profile, loading, loginWithGoogle, logout, saveProfile } = useAuth()
  const [formState, setFormState] = useState({ username: '', fullName: '', avatarUrl: '' })
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadFeedback, setUploadFeedback] = useState('')
  const [storageKey, setStorageKey] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const [cleanupStatus, setCleanupStatus] = useState('')
  const [wipingReviews, setWipingReviews] = useState(false)
  const [wipeStatus, setWipeStatus] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropSrc, setCropSrc] = useState('')
  const [cropScale, setCropScale] = useState(1)
  const [cropMinScale, setCropMinScale] = useState(1)
  const [cropPos, setCropPos] = useState({ x: 0, y: 0 })
  const [cropFile, setCropFile] = useState(null)
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 })
  const [localAvatarUrl, setLocalAvatarUrl] = useState('')
  const [userReviews, setUserReviews] = useState([])
  const [reviewsLoading, setReviewsLoading] = useState(false)
  const [reviewsError, setReviewsError] = useState('')
  const [selectedReviewIds, setSelectedReviewIds] = useState(new Set())
  const [deletingReviews, setDeletingReviews] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [followStats, setFollowStats] = useState({ followers: 0, following: 0 })
  const [followStatsLoading, setFollowStatsLoading] = useState(false)
  const draggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const posStartRef = useRef({ x: 0, y: 0 })
  const imageRef = useRef(null)

  const stripCache = (url) => {
    if (!url) return ''
    return url.split('?')[0]
  }

  const extractStorageKey = (url) => {
    if (!url) return ''

    try {
      const parsed = new URL(stripCache(url))
      const prefix = '/storage/v1/object/public/profile/'
      const idx = parsed.pathname.indexOf(prefix)
      if (idx >= 0) {
        return parsed.pathname.slice(idx + prefix.length)
      }
    } catch (error) {
      console.warn('No se pudo extraer el storage key de la URL del avatar', error)
    }

    return ''
  }

  useEffect(() => {
    const cleanUrl = stripCache(profile?.avatar_url)
    const cacheBustedProfile = cleanUrl ? `${cleanUrl}?v=${Date.now()}` : ''

    setLocalAvatarUrl('')

    setFormState({
      username: profile?.username?.replace(/^@+/, '') ?? '',
      fullName: profile?.full_name ?? '',
      avatarUrl: cleanUrl ?? '',
    })

    const key = extractStorageKey(cleanUrl)
    setStorageKey(key)
    setPreviewUrl(cacheBustedProfile)
  }, [profile])

  useEffect(() => {
    setPreviewUrl(formState.avatarUrl)
  }, [formState.avatarUrl])

  useEffect(() => {
    if (!user?.id) {
      setUserReviews([])
      return
    }
    const fetchReviews = async () => {
      setReviewsLoading(true)
      setReviewsError('')
      const { data, error } = await supabase
        .from('reviews')
        .select(
          `
          id, content, rating, created_at,
          places:places!reviews_place_id_fkey (name, address),
          review_images (image_url),
          votes (type),
          review_comments (
            id, content, created_at,
            profiles:profiles!review_comments_user_id_fkey (username, full_name, avatar_url)
          )
        `,
        )
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) {
        setReviewsError(error.message)
      } else {
        const enriched = await Promise.all(
          (data || []).map(async (review) => {
            if (review.review_images?.length) {
              const signedImages = await Promise.all(
                review.review_images.map(async (img) => ({
                  ...img,
                  image_url: await getSignedImageUrl(img.image_url),
                })),
              )
              const signedComments = await Promise.all(
                (review.review_comments || []).map((comment) => enrichCommentAvatar(comment)),
              )
              return { ...review, review_images: signedImages, review_comments: signedComments }
            }
            const signedComments = await Promise.all(
              (review.review_comments || []).map((comment) => enrichCommentAvatar(comment)),
            )
            return { ...review, review_comments: signedComments }
          }),
        )
        setUserReviews(enriched)
        setSelectedReviewIds(new Set())
      }
      setReviewsLoading(false)
    }

    fetchReviews()
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) {
      setFollowStats({ followers: 0, following: 0 })
      setFollowStatsLoading(false)
      return
    }

    let cancelled = false

    const loadFollowStats = async () => {
      setFollowStatsLoading(true)
      try {
        const followersQuery = supabase
          .from('followers')
          .select('id', { count: 'exact', head: true })
          .eq('followed_id', user.id)
        const followingQuery = supabase
          .from('followers')
          .select('id', { count: 'exact', head: true })
          .eq('follower_id', user.id)

        const [followersResult, followingResult] = await Promise.all([followersQuery, followingQuery])

        if (followersResult.error) throw followersResult.error
        if (followingResult.error) throw followingResult.error

        if (!cancelled) {
          setFollowStats({
            followers: followersResult.count || 0,
            following: followingResult.count || 0,
          })
        }
      } catch (err) {
        console.warn('No se pudieron cargar las estadísticas de seguidores', err)
        if (!cancelled) {
          setFollowStats({ followers: 0, following: 0 })
        }
      } finally {
        if (!cancelled) {
          setFollowStatsLoading(false)
        }
      }
    }

    loadFollowStats()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const toggleReviewSelection = (id) => {
    setSelectedReviewIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleDeleteSelected = async () => {
    if (!selectedReviewIds.size) return
    const confirmDelete = window.confirm(
      '¿Seguro que quieres borrar esta(s) reseña(s)? Esto significará que no volverán a verlas ni tú ni los otros usuarios.',
    )
    if (!confirmDelete) return
    setDeletingReviews(true)
    setDeleteError('')
    try {
      const reviewsToDelete = userReviews.filter((review) => selectedReviewIds.has(review.id))
      for (const review of reviewsToDelete) {
        await deleteReviewCascade(review)
      }
      setUserReviews((prev) => prev.filter((review) => !selectedReviewIds.has(review.id)))
      setSelectedReviewIds(new Set())
    } catch (error) {
      setDeleteError(error?.message ?? 'No se pudieron borrar las reseñas seleccionadas.')
    } finally {
      setDeletingReviews(false)
    }
  }
  useEffect(() => {
    if (cropScale < cropMinScale) {
      setCropScale(cropMinScale)
    }
  }, [cropMinScale, cropScale])

  useEffect(() => {
    if (localAvatarUrl) {
      setPreviewUrl(localAvatarUrl)
      return
    }

    const loadPreview = async () => {
      if (storageKey) {
        const { data, error } = await supabase.storage
          .from('profile')
          .createSignedUrl(storageKey, 86400) // 24h

        if (!error && data?.signedUrl) {
          setPreviewUrl(data.signedUrl)
          return
        }
      }

      if (formState.avatarUrl) {
        setPreviewUrl(`${formState.avatarUrl}?v=${Date.now()}`)
      }
    }

    loadPreview()
  }, [storageKey, formState.avatarUrl, localAvatarUrl])

  const fileInputRef = useRef(null)
  const triggerFilePicker = () => fileInputRef.current?.click()

  const handle = profile?.username?.replace(/^@+/, '').toLowerCase()
  const adminHandles = ['admin1912']
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()
  const adminId = import.meta.env.VITE_ADMIN_ID || ''
  const isAdmin =
    adminHandles.includes(handle) ||
    ((profile?.email || profile?.user_email || '').toLowerCase() === adminEmail && adminEmail) ||
    (profile?.id && adminId && profile.id === adminId)
  const isProfileComplete = Boolean(profile?.username && profile?.full_name)
  const placeholderInitial = (
    profile?.full_name ||
    profile?.username?.replace(/^@+/, '') ||
    'L'
  )
    .charAt(0)
    .toUpperCase()
  const reviewCount = userReviews.length
  const followerCount = followStatsLoading ? '...' : followStats.followers
  const followingCount = followStatsLoading ? '...' : followStats.following
  const totalLikes = useMemo(() => {
    return userReviews.reduce((acc, review) => {
      const likes = review.votes?.filter((vote) => vote.type === 'like').length || 0
      return acc + likes
    }, 0)
  }, [userReviews])
  const rankInfo = useMemo(() => getRankByLikes(totalLikes), [totalLikes])
  const rankLikesLabel = formatLikesLabel(totalLikes)

  useEffect(() => {
    setSettingsOpen(!isProfileComplete)
  }, [isProfileComplete])

  const handleSubmit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setStatus('Guardando perfil...')

    try {
      await saveProfile(formState)
      setStatus('Perfil actualizado con éxito')
    } catch (error) {
      setStatus(error?.message ?? 'Hubo un problema al guardar el perfil')
    } finally {
      setSaving(false)
    }
  }

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0]
    if (!file || !user) return

    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const cropSize = 480
        const minScale = Math.max(cropSize / img.width, cropSize / img.height) * 0.7
        setImageDims({ w: img.width, h: img.height })
        setCropMinScale(minScale)
        setCropScale(minScale)
        setCropPos({ x: 0, y: 0 })
        setCropSrc(reader.result)
        setCropFile(file)
        setCropOpen(true)
      }
      img.src = reader.result
      imageRef.current = img
    }
    reader.readAsDataURL(file)
  }

  const listFilesRecursively = async (bucket, path = '') => {
    const { data, error } = await supabase.storage.from(bucket).list(path, {
      limit: 100,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    })

    if (error) {
      throw error
    }

    const files = []

    for (const item of data || []) {
      const currentPath = path ? `${path}/${item.name}` : item.name

      if (item.metadata) {
        files.push(currentPath)
      } else {
        const nested = await listFilesRecursively(bucket, currentPath)
        files.push(...nested)
      }
    }

    return files
  }

  const clearBucket = async (bucket) => {
    const files = await listFilesRecursively(bucket)

    if (!files.length) {
      return { removed: 0 }
    }

    const { error } = await supabase.storage.from(bucket).remove(files)

    if (error) {
      throw error
    }

    return { removed: files.length }
  }

  const extractResennasPath = (url) => {
    if (!url) return null
    try {
      const clean = url.split('?')[0]
      const marker = '/storage/v1/object/public/resennas/'
      const idx = clean.indexOf(marker)
      if (idx >= 0) {
        return clean.slice(idx + marker.length)
      }
      // si ya viene como path sin dominio
      if (clean.startsWith('resennas/')) {
        return clean.replace(/^resennas\//, '')
      }
    } catch (error) {
      console.warn('No se pudo extraer path de resennas', error)
    }
    return null
  }

  const handleWipeReviews = async () => {
    if (!isAdmin) return
    const confirmed = window.confirm(
      '¿Seguro que deseas borrar TODAS las reseñas, votos, comentarios y fotos? Esta acción es irreversible.',
    )
    if (!confirmed) return

    setWipingReviews(true)
    setWipeStatus('Eliminando reseñas y archivos...')
    try {
      // Obtener IDs de reseñas
      const { data: reviewRows, error: reviewsErr } = await supabase
        .from('reviews')
        .select('id')
      if (reviewsErr) throw reviewsErr
      const reviewIds = (reviewRows || []).map((r) => r.id)

      // Limpiar storage primero (si hay imágenes)
      if (reviewIds.length) {
        const { data: images, error: imgErr } = await supabase
          .from('review_images')
          .select('image_url')
          .in('review_id', reviewIds)
        if (imgErr) throw imgErr

        const paths = (images || [])
          .map((row) => extractResennasPath(row.image_url))
          .filter(Boolean)
        if (paths.length) {
          await supabase.storage.from('resennas').remove(paths)
        }
      }

      // Borrar datos con filtros (Supabase exige WHERE)
      if (reviewIds.length) {
        const deletes = [
          supabase.from('review_hashtags').delete().in('review_id', reviewIds),
          supabase.from('review_comments').delete().in('review_id', reviewIds),
          supabase.from('votes').delete().in('review_id', reviewIds),
          supabase.from('review_images').delete().in('review_id', reviewIds),
          supabase.from('reviews').delete().in('id', reviewIds),
        ]
        for (const step of deletes) {
          const { error } = await step
          if (error) throw error
        }
      }

      // Limpieza extra del bucket (por si quedó algo)
      await clearBucket('resennas')

      setWipeStatus('Listo: reseñas, votos, comentarios e imágenes limpiados.')
    } catch (error) {
      setWipeStatus(error?.message ?? 'No se pudo limpiar las reseñas.')
    } finally {
      setWipingReviews(false)
    }
  }

  const handleCleanup = async () => {
    setCleaning(true)
    setCleanupStatus('Limpiando buckets profile y resennas...')

    try {
      const [profileResult, reviewsResult] = await Promise.all([
        clearBucket('profile'),
        clearBucket('resennas'),
      ])

      setCleanupStatus(
        `Limpieza completada. profile: ${profileResult.removed} archivos, resennas: ${reviewsResult.removed} archivos.`,
      )
    } catch (error) {
      setCleanupStatus(error?.message ?? 'No se pudo limpiar el almacenamiento.')
    } finally {
      setCleaning(false)
    }
  }

  const handleCropMouseDown = (event) => {
    draggingRef.current = true
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    posStartRef.current = { ...cropPos }
  }

  const handleCropMouseMove = (event) => {
    if (!draggingRef.current) return
    const dx = event.clientX - dragStartRef.current.x
    const dy = event.clientY - dragStartRef.current.y
    setCropPos({ x: posStartRef.current.x + dx, y: posStartRef.current.y + dy })
  }

  const handleCropMouseUp = () => {
    draggingRef.current = false
  }

  const handleCropSave = async () => {
    if (!cropFile || !imageRef.current) {
      setCropOpen(false)
      return
    }

    setUploading(true)
    setUploadFeedback('Guardando imagen recortada...')

    try {
      const folderPrefix = `profiles/${user.id}`

      // limpia archivos previos en la carpeta del usuario antes de subir
      const { data: existing, error: listError } = await supabase.storage
        .from('profile')
        .list(folderPrefix, { limit: 100 })

      if (listError) {
        throw listError
      }

      if (existing && existing.length) {
        const pathsToRemove = existing.map((item) => `${folderPrefix}/${item.name}`)
        await supabase.storage.from('profile').remove(pathsToRemove)
      }

      const fileExt = cropFile.name.split('.').pop()
      const sanitizedExt = fileExt && fileExt.length <= 5 ? fileExt.toLowerCase() : 'png'
      const filePath = `profiles/${user.id}/avatar-${Date.now()}.${sanitizedExt}`

      const cropSize = 480
      const canvas = document.createElement('canvas')
      canvas.width = cropSize
      canvas.height = cropSize
      const ctx = canvas.getContext('2d')

      ctx.save()
      ctx.beginPath()
      ctx.arc(cropSize / 2, cropSize / 2, cropSize / 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()

      const img = imageRef.current
      const drawWidth = img.width * cropScale
      const drawHeight = img.height * cropScale
      const drawX = (cropSize - drawWidth) / 2 + cropPos.x
      const drawY = (cropSize - drawHeight) / 2 + cropPos.y

      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight)
      ctx.restore()

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95))
      if (!blob) {
        throw new Error('No se pudo preparar la imagen.')
      }

      const { error: uploadError } = await supabase.storage
        .from('profile')
        .upload(filePath, blob, { upsert: true })

      if (uploadError) {
        throw uploadError
      }

      const dataUrl = canvas.toDataURL('image/png', 0.95)

      const {
        data: { publicUrl },
      } = supabase.storage.from('profile').getPublicUrl(filePath)

      const cacheBusted = `${publicUrl}?v=${Date.now()}`

      setFormState((prev) => ({ ...prev, avatarUrl: publicUrl }))
      setStorageKey(filePath)
      setPreviewUrl(cacheBusted)
      setLocalAvatarUrl(cacheBusted)

      // Persistir inmediatamente los cambios de perfil para evitar botón extra
      const saved = await saveProfile({
        username: formState.username,
        fullName: formState.fullName,
        avatarUrl: publicUrl,
      })

      const finalPreview = saved?.avatar_url
        ? `${stripCache(saved.avatar_url)}?v=${Date.now()}`
        : cacheBusted
      setPreviewUrl(finalPreview)
      setLocalAvatarUrl(finalPreview)
      await new Promise((resolve) => {
        const img = new Image()
        img.onload = resolve
        img.onerror = resolve
        img.src = finalPreview
      })

      setUploadFeedback('Imagen guardada en el bucket profile.')

    } catch (error) {
      setUploadFeedback(error?.message ?? 'No se pudo subir la imagen.')
    } finally {
      setUploading(false)
      setCropOpen(false)
      setCropFile(null)
      setCropSrc('')
    }
  }

  const openSettingsPanel = () => setSettingsOpen(true)
  const closeSettingsPanel = () => isProfileComplete && setSettingsOpen(false)

  return (
    <section className="auth-screen">
      <div className="profile-shell">
        <div className="profile-summary">
          <div className="avatar-display">
            <button className="avatar-button" type="button" onClick={triggerFilePicker}>
              {previewUrl ? (
                <img src={previewUrl} alt="Avatar de perfil" />
              ) : (
                <span className="avatar-placeholder">{placeholderInitial}</span>
              )}
              <span className="avatar-plus" aria-hidden="true">
                +
              </span>
              <span className="sr-only">Cambiar foto de perfil</span>
            </button>
            {rankInfo?.frame && (
              <img src={rankInfo.frame} alt="" aria-hidden="true" className="rank-frame" />
            )}
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />
          </div>

          <div className="profile-info">
          <div className="profile-top-row">
              <p className="profile-username">{profile?.username ?? '@configura-tu-user'}</p>
              <div className="profile-buttons">
                <button className="secondary" type="button" onClick={openSettingsPanel}>
                  Editar perfil
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Abrir configuración"
                  onClick={openSettingsPanel}
                >
                  <span aria-hidden="true">⚙️</span>
                </button>
                {isAdmin && (
                  <button
                    className="danger-outline"
                    type="button"
                    onClick={handleCleanup}
                    disabled={cleaning || wipingReviews}
                  >
                    {cleaning ? 'Limpiando...' : 'Limpiar storage'}
                  </button>
                )}
              </div>
            </div>

            <div className="profile-stats">
              <span>
                <strong>{reviewCount}</strong> reseñas
              </span>
              <span>
                <strong>{followerCount}</strong> seguidores
              </span>
              <span>
                <strong>{followingCount}</strong> seguidos
              </span>
            </div>
            <span className="rank-chip large">
              {rankInfo?.label || 'Rookie'} · {rankLikesLabel} likes
            </span>

            <div className="profile-name-block">
              <p className="profile-fullname">{profile?.full_name ?? 'Agrega tu nombre'}</p>
              <p className="profile-handle muted small">{profile?.username ?? '@pendiente'}</p>
            </div>
          </div>
        </div>

        {isAdmin && cleanupStatus && <p className="muted small admin-status">{cleanupStatus}</p>}
        {isAdmin && wipeStatus && <p className="muted small admin-status">{wipeStatus}</p>}

        <div className={`settings-panel ${settingsOpen ? 'open' : ''}`}>
          <div className="panel-header">
            <div>
              <p className="muted small">Configuración</p>
              <h3>Editar perfil</h3>
            </div>
            {isProfileComplete && (
              <button className="text-link" type="button" onClick={closeSettingsPanel}>
                Cerrar
              </button>
            )}
          </div>

          <form className="profile-form" onSubmit={handleSubmit}>
            <label htmlFor="username">Usuario (@)</label>
            <div className="username-input">
              <span aria-hidden="true">@</span>
              <input
                id="username"
                placeholder="ejemplo"
                value={formState.username}
                onChange={(event) =>
                  setFormState((prev) => ({ ...prev, username: event.target.value }))
                }
              />
            </div>

            <label htmlFor="fullName">Nombre</label>
            <input
              id="fullName"
              type="text"
              placeholder="Cómo te verán"
              value={formState.fullName}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, fullName: event.target.value }))
              }
            />

            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </button>

            {status && <p className="status-message">{status}</p>}
          </form>

          <div className="settings-footer">
            <button className="text-link logout" onClick={logout} type="button">
              Cerrar sesión
            </button>

            {isAdmin && (
              <div className="admin-actions">
                <button
                  className="danger"
                  type="button"
                  onClick={handleCleanup}
                  disabled={cleaning || wipingReviews}
                >
                  {cleaning ? 'Limpiando...' : 'Limpiar buckets profile y resennas'}
                </button>
                <button
                  className="danger"
                  type="button"
                  onClick={handleWipeReviews}
                  disabled={wipingReviews || cleaning}
                >
                  {wipingReviews ? 'Borrando reseñas...' : 'Borrar reseñas + votos + fotos'}
                </button>
                {cleanupStatus && <p className="muted small">{cleanupStatus}</p>}
                {wipeStatus && <p className="muted small">{wipeStatus}</p>}
              </div>
            )}
          </div>
        </div>

        <section className="user-reviews">
          <div className="user-reviews-header">
            <div>
              <p className="muted small">Actividad</p>
              <h3>Mis reseñas</h3>
            </div>
            <span className="muted small">
              {userReviews.length} {userReviews.length === 1 ? 'reseña' : 'reseñas'}
            </span>
          </div>
          {selectedReviewIds.size > 0 && (
            <div className="user-review-toolbar">
              <p>{selectedReviewIds.size} seleccionada(s)</p>
              <button
                className="danger"
                type="button"
                onClick={handleDeleteSelected}
                disabled={deletingReviews}
              >
                {deletingReviews ? 'Borrando...' : 'Eliminar seleccionadas'}
              </button>
            </div>
          )}
          {deleteError && <p className="muted error">{deleteError}</p>}
          {reviewsLoading && <p className="muted">Cargando reseñas...</p>}
          {reviewsError && <p className="muted error">{reviewsError}</p>}
          {!reviewsLoading && !reviewsError && userReviews.length === 0 && (
            <p className="muted">Aún no has publicado reseñas. ¡El mapa te espera!</p>
          )}
          {!reviewsLoading && !reviewsError && userReviews.length > 0 && (
            <div className="user-review-grid">
              {userReviews.map((review) => {
                const likeCount =
                  review.votes?.filter((vote) => vote.type === 'like').length || 0
                const dislikeCount =
                  review.votes?.filter((vote) => vote.type === 'dislike').length || 0
                const commentCount = review.review_comments?.length || 0
                const isSelected = selectedReviewIds.has(review.id)
                const reviewImage = review.review_images?.[0]?.image_url || fallbackImage
                return (
                  <article key={review.id} className={`review-card user-review-card ${isSelected ? 'selected' : ''}`}>
                    <div className="review-image">
                      <img src={reviewImage} alt={review.places?.name || 'Lugar'} />
                      <div className="review-meta-top">
                        <div className="author">
                          <div className="author-avatar">
                            {previewUrl || profile?.avatar_url ? (
                              <img
                                src={previewUrl || profile?.avatar_url}
                                alt={profile?.username || 'avatar'}
                              />
                            ) : (
                              <span className="avatar-fallback">{placeholderInitial}</span>
                            )}
                            {rankInfo?.frame && (
                              <img src={rankInfo.frame} alt="" aria-hidden="true" className="rank-frame" />
                            )}
                          </div>
                          <div>
                            <p className="author-name">{profile?.full_name || profile?.username || 'Usuario'}</p>
                            <p className="author-handle">{profile?.username || ''}</p>
                          </div>
                        </div>
                        <span className="created">
                          {new Date(review.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <label className="review-checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleReviewSelection(review.id)}
                          aria-label="Seleccionar reseña"
                        />
                        <span />
                      </label>
                    </div>
                    <div className="review-body">
                      <h3>{review.places?.name || 'Lugar sin nombre'}</h3>
                      <p className="description">{review.content || 'Sin descripción'}</p>
                      <Stars value={review.rating || 0} />
                      <div className="actions">
                        <div className="action-row">
                          <button type="button" className="pill like" disabled>
                            <img src={likeIcon} alt="" aria-hidden="true" />
                            <span>{likeCount}</span>
                          </button>
                          <button type="button" className="pill dislike" disabled>
                            <img src={dislikeIcon} alt="" aria-hidden="true" />
                            <span>{dislikeCount}</span>
                          </button>
                          <div className="comment-block">
                            <button type="button" className="pill comment" disabled>
                              <img src={commentIcon} alt="" aria-hidden="true" />
                              <span>{commentCount}</span>
                            </button>
                            <input type="text" disabled placeholder="Comentarios visibles abajo" />
                          </div>
                        </div>
                        {commentCount > 0 && (
                          <div className="comments-panel static">
                            {review.review_comments?.map((comment) => (
                              <div key={comment.id} className="comment-row">
                                <div className="comment-avatar">
                                  {comment.profiles?.avatar_url ? (
                                    <img
                                      src={comment.profiles.avatar_url}
                                      alt={comment.profiles.username || 'avatar'}
                                    />
                                  ) : (
                                    <span>
                                      {(comment.profiles?.username || 'U')
                                        .replace(/^@+/, '')
                                        .charAt(0)
                                        .toUpperCase()}
                                    </span>
                                  )}
                                </div>
                                <div className="comment-body">
                                  <div className="comment-meta">
                                    <span className="comment-user">
                                      {comment.profiles?.full_name || comment.profiles?.username || 'Usuario'}
                                    </span>
                                    {comment.profiles?.username && (
                                      <span className="comment-handle">{comment.profiles.username}</span>
                                    )}
                                    <span className="comment-date">
                                      {new Date(comment.created_at).toLocaleDateString()}
                                    </span>
                                  </div>
                                  <p className="comment-text">{comment.content}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
      {cropOpen && (
        <div
          className="crop-overlay"
          onMouseMove={handleCropMouseMove}
          onMouseUp={handleCropMouseUp}
          onMouseLeave={handleCropMouseUp}
        >
          <div className="crop-backdrop" />
          <div className="crop-card">
            <h3>Ajusta tu foto</h3>
            <p className="muted small">Arrastra para mover · Usa el deslizador para acercar/alejar</p>
            <div
              className="crop-stage"
              onMouseDown={handleCropMouseDown}
              role="presentation"
            >
              {cropSrc && (
                <img
                  src={cropSrc}
                  alt="Recorte de avatar"
                  style={{
                    transform: `translate(calc(-50% + ${cropPos.x}px), calc(-50% + ${cropPos.y}px)) scale(${cropScale})`,
                  }}
                />
              )}
              <div className="crop-mask" />
            </div>

            <label className="muted small" htmlFor="cropScale">
              Zoom
            </label>
            <input
              id="cropScale"
              type="range"
              min={cropMinScale}
              max={cropMinScale * 4}
              step="0.01"
              value={cropScale}
              onChange={(e) => setCropScale(Math.max(Number(e.target.value), cropMinScale))}
            />

            <div className="crop-actions">
              <button className="text-link" type="button" onClick={() => setCropOpen(false)}>
                Cancelar
              </button>
              <button className="primary" type="button" onClick={handleCropSave} disabled={uploading}>
                {uploading ? 'Guardando...' : 'Guardar foto de perfil'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default AuthScreen
