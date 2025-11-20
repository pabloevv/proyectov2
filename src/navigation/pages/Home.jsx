import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../contexts/AuthContext'
import likeIcon from '../../assets/images/review-section/like.svg'
import dislikeIcon from '../../assets/images/review-section/dislike.svg'
import commentIcon from '../../assets/images/review-section/comment.svg'
import { getRankByLikes } from '../../lib/rankings'
import './Feed.css'

const fallbackImage =
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=900&q=80'

const extractStoragePath = (url) => {
  if (!url) return null
  if (url.startsWith('http')) {
    const marker = '/storage/v1/object/public/'
    const idx = url.indexOf(marker)
    if (idx === -1) return null
    return url.slice(idx + marker.length)
  }
  return url
}

const getSignedUrlIfNeeded = async (url) => {
  if (!url) return ''
  const path = extractStoragePath(url)
  if (!path) return url
  const [bucket, ...rest] = path.split('/')
  const objectPath = rest.join('/')
  try {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(objectPath, 3600)
    return data?.signedUrl || url
  } catch (error) {
    console.warn('No se pudo firmar la URL de storage', error)
    return url
  }
}

const enrichCommentAvatar = async (comment) => {
  if (!comment?.profiles?.avatar_url) return comment
  const signed = await getSignedUrlIfNeeded(comment.profiles.avatar_url)
  return {
    ...comment,
    profiles: { ...comment.profiles, avatar_url: signed },
  }
}

const enrichReviewAvatars = async (review) => {
  const signedProfileAvatar = review.profiles?.avatar_url
    ? await getSignedUrlIfNeeded(review.profiles.avatar_url)
    : review.profiles?.avatar_url
  const enrichedComments = await Promise.all(
    (review.review_comments || []).map((comment) => enrichCommentAvatar(comment)),
  )
  return {
    ...review,
    profiles: review.profiles ? { ...review.profiles, avatar_url: signedProfileAvatar || '' } : null,
    review_comments: enrichedComments,
  }
}

const deleteReviewCascade = async (review) => {
  // Elimina imágenes de storage (bucket resennas)
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

function Stars({ value }) {
  return (
    <div className="card-stars" aria-label={`${value} estrellas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={n <= value ? 'star filled' : 'star'}>
          ★
        </span>
      ))}
    </div>
  )
}

function ReviewCard({
  review,
  onVote,
  onComment,
  onToggleComments,
  onLoadComments,
  commentsOpen,
  commentsLoading,
  commentDraft,
  setCommentDraft,
  canInteract,
  currentUserAvatar,
  currentUsername,
  currentUserId,
  totalLikes,
  isFollowing,
  onFollowToggle,
  isAdmin,
  onAdminDelete,
}) {
  const [photoUrl, setPhotoUrl] = useState(fallbackImage)
  const [avatarUrl, setAvatarUrl] = useState('')
  const author = useMemo(() => review.profiles || {}, [review.profiles])
  const authorAvatar = author.avatar_url || ''
  const rankInfo = useMemo(() => getRankByLikes(totalLikes), [totalLikes])
  const authorInitial = useMemo(() => {
    const seed = (author.full_name || author.username || 'U').replace(/^@+/, '')
    return seed.charAt(0).toUpperCase()
  }, [author.full_name, author.username])
  const place = review.places || {}
  const tags = review.review_hashtags?.map((rh) => rh.hashtags?.tag).filter(Boolean) || []
  const created = new Date(review.created_at).toLocaleDateString()
  const votes = review.votes || []
  const commentsList = review.review_comments || []

  const likeCount = votes.filter((v) => v.type === 'like').length
  const dislikeCount = votes.filter((v) => v.type === 'dislike').length
  const commentsCount = commentsList?.length || 0

  useEffect(() => {
    const photo = review.review_images?.[0]?.image_url
    const avatar = authorAvatar

    const loadImages = async () => {
      try {
        if (photo) {
          const signedPhoto = await getSignedUrlIfNeeded(photo)
          setPhotoUrl(signedPhoto || photo)
        }
        if (avatar) {
          const signedAvatar = await getSignedUrlIfNeeded(avatar)
          setAvatarUrl(signedAvatar || avatar)
        }
      } catch {
        setPhotoUrl(photo || fallbackImage)
        setAvatarUrl(avatar || '')
      }
    }

    loadImages()
  }, [review, authorAvatar])

  return (
    <article className="review-card">
      <div className="review-image">
        <img src={photoUrl} alt={place.name || 'Lugar'} loading="lazy" />
        <div className="review-meta-top">
          <div className="author">
            <div className="author-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={author.username || 'avatar'} />
              ) : (
                <span className="avatar-fallback">{authorInitial}</span>
              )}
              {rankInfo?.frame && (
                <img src={rankInfo.frame} alt="" aria-hidden="true" className="rank-frame" />
              )}
            </div>
            <div>
              <p className="author-name">{author.full_name || author.username || 'Usuario'}</p>
              <p className="author-handle">{author.username || 'user'}</p>
            </div>
          </div>
          <span className="created">{created}</span>
        </div>
      </div>

      <div className="review-body">
        <h3>{place.name || 'Lugar sin nombre'}</h3>
        <p className="description">{review.content || 'Sin descripción'}</p>
        <Stars value={review.rating || 0} />
        {tags.length > 0 && (
          <div className="tags">
            {tags.map((t) => (
              <span key={t}>#{t}</span>
            ))}
          </div>
        )}
        <div className="actions">
          <div className="action-row">
            <button
              type="button"
              className="pill like"
              onClick={() => onVote(review.id, 'like')}
              disabled={!canInteract}
            >
              <img src={likeIcon} alt="" aria-hidden="true" />
              <span>{likeCount}</span>
            </button>
            <button
              type="button"
              className="pill dislike"
              onClick={() => onVote(review.id, 'dislike')}
              disabled={!canInteract}
            >
              <img src={dislikeIcon} alt="" aria-hidden="true" />
              <span>{dislikeCount}</span>
            </button>
            <div className="comment-block">
            <button
              type="button"
              className="pill comment"
              onClick={() => {
                onToggleComments(review.id)
                  onLoadComments(review.id)
                }}
                disabled={commentsLoading}
              >
                <img src={commentIcon} alt="" aria-hidden="true" />
                <span>{commentsCount}</span>
              </button>
              {canInteract && author?.id && author?.id !== currentUserId && (
                <button
                  type="button"
                  className="follow-btn"
                  onClick={() => onFollowToggle(author.id, isFollowing)}
                >
                  {isFollowing ? 'Dejar de seguir' : 'Seguir'}
                </button>
              )}
              <input
                type="text"
                placeholder="Comenta..."
                value={commentDraft || ''}
                onChange={(e) => setCommentDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onComment(review.id, commentDraft?.trim() || '')
                  }
                }}
                disabled={!canInteract}
              />
            </div>
            {isAdmin && (
              <div className="admin-actions-row">
                <button
                  type="button"
                  className="danger-outline small"
                  onClick={() => onAdminDelete(review)}
                >
                  Borrar reseña (admin)
                </button>
              </div>
            )}
          </div>
          {commentsOpen && (
            <div className="comments-panel">
              {commentsLoading && <p className="muted small">Cargando comentarios...</p>}
              {!commentsLoading && commentsList?.length === 0 && (
                <p className="muted small">Sé el primero en comentar.</p>
              )}
              {!commentsLoading &&
                commentsList?.map((c) => (
                  <div key={c.id} className="comment-row">
                    <div className="comment-avatar">
                      {c.profiles?.avatar_url ? (
                        <img src={c.profiles.avatar_url} alt={c.profiles.username || 'avatar'} />
                      ) : (
                        <span className="comment-initial">
                          {(c.profiles?.username || 'U').replace(/^@+/, '').charAt(0).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="comment-body">
                      <div className="comment-meta">
                        <span className="comment-user">
                          {c.profiles?.full_name || c.profiles?.username || 'Usuario'}
                        </span>
                        {c.profiles?.username && (
                          <span className="comment-handle">{c.profiles.username}</span>
                        )}
                        <span className="comment-date">
                          {new Date(c.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="comment-text">{c.content}</p>
                    </div>
                  </div>
                ))}
              <div className="comment-input-row">
                <div className="comment-avatar small">
                  {canInteract && currentUserAvatar ? (
                    <img src={currentUserAvatar} alt={currentUsername || 'avatar'} />
                  ) : (
                    <span className="comment-initial">
                      {(currentUsername || 'U').replace(/^@+/, '').charAt(0).toUpperCase()}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  placeholder="Comenta..."
                  value={commentDraft || ''}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onComment(review.id, commentDraft?.trim() || '')
                    }
                  }}
                  disabled={!canInteract}
                />
                <button
                  type="button"
                  className="primary small"
                  onClick={() => onComment(review.id, commentDraft?.trim() || '')}
                  disabled={!canInteract || !commentDraft?.trim()}
                >
                  Enviar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function HomePage() {
  const { user, profile } = useAuth()
  const [reviews, setReviews] = useState([])
  const [userQuery, setUserQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [commentDrafts, setCommentDrafts] = useState({})
  const [openComments, setOpenComments] = useState({})
  const [loadingComments, setLoadingComments] = useState({})
  const [currentUserAvatar, setCurrentUserAvatar] = useState('')
  const [followedIds, setFollowedIds] = useState(new Set())
  const [userResults, setUserResults] = useState([])
  const [userSearchLoading, setUserSearchLoading] = useState(false)
  const [userSearchError, setUserSearchError] = useState('')
  const [userSearchPerformed, setUserSearchPerformed] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState(null)

  const userId = user?.id
  const currentUsername = profile?.username || ''
  const adminHandles = ['admin1912']
  const adminEmail = (import.meta.env.VITE_ADMIN_EMAIL || '').toLowerCase()
  const adminId = import.meta.env.VITE_ADMIN_ID || ''
  const isAdmin = useMemo(() => {
    const handle = currentUsername.replace(/^@+/, '').toLowerCase()
    const emailMatch = (user?.email || '').toLowerCase() === adminEmail && adminEmail
    const idMatch = userId && adminId && userId === adminId
    return adminHandles.includes(handle) || Boolean(emailMatch) || Boolean(idMatch)
  }, [currentUsername, user?.email, adminEmail, userId, adminId])

  useEffect(() => {
    const fetchReviews = async () => {
      setLoading(true)
      setError('')
      const { data, error } = await supabase
        .from('reviews')
        .select(
          `
          id, user_id, rating, content, created_at,
          profiles:profiles!reviews_user_id_fkey (id, username, full_name, avatar_url),
          places:places!reviews_place_id_fkey (id, name, address, latitude, longitude),
          review_images (image_url),
          review_hashtags (hashtags (tag)),
          votes (id, type, user_id),
          review_comments (
            id,
            user_id,
            content,
            created_at,
            profiles:profiles!review_comments_user_id_fkey (id, username, full_name, avatar_url)
          )
        `,
        )
        .order('created_at', { ascending: false })

      if (error) {
        setError(error.message)
      } else {
        const enriched = await Promise.all((data || []).map((review) => enrichReviewAvatars(review)))
        setReviews(enriched)
      }
      setLoading(false)
    }

    fetchReviews()
  }, [])

  useEffect(() => {
    const loadFollows = async () => {
      if (!userId) {
        setFollowedIds(new Set())
        return
      }
      const { data, error } = await supabase
        .from('followers')
        .select('followed_id')
        .eq('follower_id', userId)
      if (error) return
      setFollowedIds(new Set((data || []).map((row) => row.followed_id)))
    }
    loadFollows()
  }, [userId])


  useEffect(() => {
    let isMounted = true
    const loadCurrentAvatar = async () => {
      if (!profile?.avatar_url) {
        if (isMounted) setCurrentUserAvatar('')
        return
      }
      const signed = await getSignedUrlIfNeeded(profile.avatar_url)
      if (isMounted) {
        setCurrentUserAvatar(signed || profile.avatar_url)
      }
    }
    loadCurrentAvatar()
    return () => {
      isMounted = false
    }
  }, [profile?.avatar_url])

  const likeTotals = useMemo(() => {
    const totals = {}
    reviews.forEach((rev) => {
      const authorId = rev.profiles?.id
      if (!authorId) return
      const likes = rev.votes?.filter((vote) => vote.type === 'like').length || 0
      totals[authorId] = (totals[authorId] || 0) + likes
    })
    return totals
  }, [reviews])

  const updateReviewInState = (id, updater) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? updater(r) : r)))
  }

  const handleFollowToggle = async (profileId, isFollowing) => {
    if (!userId) return
    if (profileId === userId) {
      setError('No puedes seguirte a ti mismo.')
      return
    }
    try {
      if (isFollowing) {
        await supabase
          .from('followers')
          .delete()
          .eq('follower_id', userId)
          .eq('followed_id', profileId)
        setFollowedIds((prev) => {
          const next = new Set(prev)
          next.delete(profileId)
          return next
        })
      } else {
        await supabase.from('followers').insert({ follower_id: userId, followed_id: profileId })
        setFollowedIds((prev) => new Set(prev).add(profileId))
      }
    } catch (err) {
      setError(err?.message ?? 'No se pudo actualizar el seguimiento.')
    }
  }

  const handleVote = async (reviewId, type) => {
    if (!userId) {
      setError('Debes iniciar sesión para reaccionar.')
      return
    }
    try {
      const review = reviews.find((r) => r.id === reviewId)
      const existing = review?.votes?.find((v) => v.user_id === userId)

      if (existing && existing.type === type) {
        await supabase.from('votes').delete().eq('id', existing.id)
        updateReviewInState(reviewId, (r) => ({
          ...r,
          votes: (r.votes || []).filter((v) => v.id !== existing.id),
        }))
        return
      }

      if (existing) {
        const { data, error } = await supabase
          .from('votes')
          .update({ type })
          .eq('id', existing.id)
          .select()
          .single()
        if (error) throw error
        updateReviewInState(reviewId, (r) => ({
          ...r,
          votes: (r.votes || []).map((v) => (v.id === existing.id ? data : v)),
        }))
      } else {
        const { data, error } = await supabase
          .from('votes')
          .insert({ review_id: reviewId, user_id: userId, type })
          .select()
          .single()
        if (error) throw error
        updateReviewInState(reviewId, (r) => ({
          ...r,
          votes: [...(r.votes || []), data],
        }))
      }
    } catch (err) {
      setError(err?.message ?? 'No se pudo registrar tu reacción.')
    }
  }

  const handleComment = async (reviewId, content) => {
    if (!userId) {
      setError('Debes iniciar sesión para comentar.')
      return
    }
    const trimmed = content.trim()
    if (!trimmed) return
    try {
      const { data, error } = await supabase
        .from('review_comments')
        .insert({
          review_id: reviewId,
          user_id: userId,
          content: trimmed,
        })
        .select(
          `
          id, user_id, content, created_at,
          profiles:profiles!review_comments_user_id_fkey (id, username, full_name, avatar_url)
        `,
        )
        .single()
      if (error) throw error

      const enriched = await enrichCommentAvatar(data)

      updateReviewInState(reviewId, (r) => ({
        ...r,
        review_comments: [enriched, ...(r.review_comments || [])],
      }))
      setCommentDrafts((prev) => ({ ...prev, [reviewId]: '' }))
    } catch (err) {
      setError(err?.message ?? 'No se pudo publicar el comentario.')
    }
  }

  const handleAdminDelete = async (review) => {
    if (!isAdmin) return
    const confirmDelete = window.confirm('¿Borrar esta reseña y todos sus datos relacionados?')
    if (!confirmDelete) return
    try {
      await deleteReviewCascade(review)
      setReviews((prev) => prev.filter((r) => r.id !== review.id))
    } catch (err) {
      setError(err?.message ?? 'No se pudo borrar la reseña.')
    }
  }

  const loadComments = async (reviewId) => {
    // evita recargar si ya están
    if (openComments[reviewId] && (reviews.find((r) => r.id === reviewId)?.review_comments?.length || 0) > 0) {
      return
    }
    setLoadingComments((prev) => ({ ...prev, [reviewId]: true }))
    try {
      const { data, error } = await supabase
        .from('review_comments')
        .select(
          `
          id, user_id, content, created_at,
          profiles:profiles!review_comments_user_id_fkey (id, username, full_name, avatar_url)
        `,
        )
        .eq('review_id', reviewId)
        .order('created_at', { ascending: false })
      if (error) throw error

      const enriched = await Promise.all((data || []).map((comment) => enrichCommentAvatar(comment)))

      updateReviewInState(reviewId, (r) => ({
        ...r,
        review_comments: enriched,
      }))
    } catch (err) {
      setError(err?.message ?? 'No se pudieron cargar los comentarios.')
    } finally {
      setLoadingComments((prev) => ({ ...prev, [reviewId]: false }))
    }
  }

  const toggleComments = (reviewId) => {
    setOpenComments((prev) => ({ ...prev, [reviewId]: !prev[reviewId] }))
  }

  const handleUserSearch = async (event) => {
    event.preventDefault()
    const rawTerm = userQuery.trim()
    const normalized = rawTerm.replace(/^@+/, '')

    if (!normalized) {
      setUserResults([])
      setUserSearchPerformed(false)
      setUserSearchError('')
      setSelectedProfile(null)
      return
    }

    setUserSearchPerformed(true)
    setUserSearchLoading(true)
    setUserSearchError('')
    setSelectedProfile(null)

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, reputation_level')
        .or(`username.ilike.%${normalized}%,full_name.ilike.%${normalized}%`)
        .order('full_name', { ascending: true })
        .limit(15)

      if (error) throw error

      const enriched = await Promise.all(
        (data || []).map(async (profile) => ({
          ...profile,
          avatar_url: profile.avatar_url ? await getSignedUrlIfNeeded(profile.avatar_url) : '',
        })),
      )

      setUserResults(enriched)
      if (enriched.length === 1) {
        setSelectedProfile(enriched[0])
      }
    } catch (err) {
      setUserSearchError(err?.message ?? 'No se pudieron buscar usuarios.')
      setUserResults([])
    } finally {
      setUserSearchLoading(false)
    }
  }

  const handleSelectProfile = (profile) => {
    setSelectedProfile(profile)
  }

  const clearSelectedProfile = () => {
    setSelectedProfile(null)
  }

  const orderedReviews = useMemo(() => {
    const list = [...reviews]
    return list.sort((a, b) => {
      const aFollow = followedIds.has(a.profiles?.id)
      const bFollow = followedIds.has(b.profiles?.id)
      if (aFollow && !bFollow) return -1
      if (!aFollow && bFollow) return 1
      return new Date(b.created_at) - new Date(a.created_at)
    })
  }, [reviews, followedIds])

  const visibleReviews = useMemo(() => {
    if (selectedProfile) {
      return orderedReviews.filter((rev) => rev.profiles?.id === selectedProfile.id)
    }
    return orderedReviews
  }, [orderedReviews, selectedProfile])

  return (
    <div className="feed">
      <form className="user-search-bar" onSubmit={handleUserSearch}>
        <input
          type="text"
          placeholder="Buscar reseñas por usuario..."
          value={userQuery}
          onChange={(e) => setUserQuery(e.target.value)}
        />
        <button className="secondary" type="submit">
          Buscar usuario
        </button>
      </form>

      {(userSearchLoading || userResults.length > 0 || userSearchPerformed || userSearchError) && (
        <div className="user-search-results">
          {userSearchError && <p className="muted error">{userSearchError}</p>}
          {userSearchLoading && <p className="muted small">Buscando usuarios...</p>}
          {!userSearchLoading &&
            userResults.map((profile) => {
              const displayName = profile.full_name || profile.username || 'Usuario'
              const handle = profile.username || ''
              const initialsSeed = (handle || displayName || 'U').replace(/^@+/, '')
              const initial = initialsSeed.charAt(0).toUpperCase() || 'U'
              const isSelected = selectedProfile?.id === profile.id
              const canFollowProfile = profile.id !== userId
              const isFollowingProfile = followedIds.has(profile.id)
              return (
                <div
                  key={profile.id}
                  className={`user-result-card ${isSelected ? 'selected' : ''}`}
                >
                  <div className="user-result-info">
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt={displayName} />
                    ) : (
                      <span className="user-result-initial">{initial}</span>
                    )}
                    <div>
                      <p className="user-result-name">{displayName}</p>
                      {handle && <p className="user-result-handle">{handle}</p>}
                    </div>
                  </div>
                  <div className="user-result-actions">
                    <button
                      type="button"
                      className="secondary small"
                      onClick={() => handleSelectProfile(profile)}
                    >
                      Ver feed
                    </button>
                    {canFollowProfile && (
                      <button
                        type="button"
                        className="follow-btn small"
                        onClick={() => handleFollowToggle(profile.id, isFollowingProfile)}
                      >
                        {isFollowingProfile ? 'Dejar de seguir' : 'Seguir'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          {userSearchPerformed &&
            !userSearchLoading &&
            userResults.length === 0 &&
            !userSearchError && <p className="muted small">No encontramos usuarios con ese nombre.</p>}
        </div>
      )}

      <h2 className="feed-title">Últimas reseñas</h2>
      {selectedProfile && (
        <div className="selected-user-banner">
          <div>
            <p className="muted small">Viendo reseñas de</p>
            <p className="selected-user-name">
              {selectedProfile.full_name || selectedProfile.username || 'Usuario'}
              {selectedProfile.username && (
                <span className="selected-user-handle">{selectedProfile.username}</span>
              )}
            </p>
          </div>
          <button type="button" className="secondary small" onClick={clearSelectedProfile}>
            Ver todo
          </button>
        </div>
      )}
      {loading && <p className="muted">Cargando reseñas...</p>}
      {error && <p className="muted error">{error}</p>}
      {!loading && reviews.length === 0 && (
        <p className="muted">Aún no hay reseñas. ¡Crea la primera!</p>
      )}
      {selectedProfile && !loading && visibleReviews.length === 0 && reviews.length > 0 && (
        <p className="muted">Este usuario aún no tiene reseñas publicadas.</p>
      )}
      <div className="feed-grid">
        {visibleReviews.map((rev) => (
          <ReviewCard
            key={rev.id}
            review={rev}
            onVote={handleVote}
            onComment={handleComment}
            onToggleComments={toggleComments}
            onLoadComments={loadComments}
            commentsOpen={!!openComments[rev.id]}
            comments={rev.review_comments}
            commentsLoading={!!loadingComments[rev.id]}
            commentDraft={commentDrafts[rev.id] || ''}
            setCommentDraft={(val) =>
              setCommentDrafts((prev) => ({
                ...prev,
                [rev.id]: val,
              }))
            }
            canInteract={Boolean(userId)}
            currentUserAvatar={currentUserAvatar}
            currentUsername={currentUsername}
            currentUserId={userId}
            totalLikes={likeTotals[rev.profiles?.id] || 0}
            isFollowing={followedIds.has(rev.profiles?.id)}
            onFollowToggle={handleFollowToggle}
            isAdmin={isAdmin}
            onAdminDelete={handleAdminDelete}
          />
        ))}
      </div>
    </div>
  )
}

export default HomePage
