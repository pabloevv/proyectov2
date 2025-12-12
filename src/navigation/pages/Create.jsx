import { useEffect, useMemo, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import './Create.css'
import { supabase } from '../../lib/supabaseClient'
import userIcon from '../../assets/images/maps-icons/yourlocation.svg'
import pinIconImg from '../../assets/images/maps-icons/pin.svg'
import { useAuth } from '../../contexts/AuthContext'

const userLocIcon = L.icon({
  iconUrl: userIcon,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -12],
})

const placePinIcon = L.icon({
  iconUrl: pinIconImg,
  iconSize: [30, 40],
  iconAnchor: [15, 40],
  popupAnchor: [0, -34],
})

const DEFAULT_POS = { lat: 9.9281, lng: -84.0907 }

function SelectableMap({ position, onSelect }) {
  useMapEvents({
    click(e) {
      onSelect({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  return null
}

function haversine(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function Stars({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={n <= value ? 'star active' : 'star'}
          onClick={() => onChange(n)}
          aria-label={`${n} estrellas`}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function CreatePage() {
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)
  const [loadingPlaces, setLoadingPlaces] = useState(false)
  const [places, setPlaces] = useState([])
  const [placesError, setPlacesError] = useState('')
  const [userPos, setUserPos] = useState(null)
  const [selectedPos, setSelectedPos] = useState(null)
  const [selectedPlaceId, setSelectedPlaceId] = useState(null)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [rating, setRating] = useState(0)
  const [content, setContent] = useState('')
  const [hashtagsInput, setHashtagsInput] = useState('')
  const [hashtags, setHashtags] = useState([])
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [osmPlaces, setOsmPlaces] = useState([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [osmError, setOsmError] = useState('')

  const handlePlaceSelect = (place) => {
    setSelectedPlaceId(place.id)
    setSelectedPlace(place)
    setSelectedPos({ lat: place.latitude, lng: place.longitude })
  }

  useEffect(() => {
    if (!modalOpen) return

    setLoadingPlaces(true)
    setPlacesError('')

    const fetchPlaces = async () => {
      const { data, error } = await supabase
        .from('places')
        .select('id, name, address, latitude, longitude')

      if (error) {
        setPlacesError(error.message)
        setLoadingPlaces(false)
        return
      }

      setPlaces(
        (data || []).filter(
          (p) =>
            typeof p.latitude === 'number' &&
            typeof p.longitude === 'number' &&
            !Number.isNaN(p.latitude) &&
            !Number.isNaN(p.longitude),
        ),
      )
      setLoadingPlaces(false)
    }

    fetchPlaces()

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setUserPos(DEFAULT_POS),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
      )
    } else {
      setUserPos(DEFAULT_POS)
    }
  }, [modalOpen])

  useEffect(() => {
    if (!hashtagsInput) return
    const tags = hashtagsInput
      .split(/\s+/)
      .map((t) => t.trim().replace(/^#+/, '').toLowerCase())
      .filter(Boolean)
    setHashtags([...new Set(tags)])
  }, [hashtagsInput])

  // Busca lugares OSM a 100m del punto seleccionado o la ubicación del usuario
  useEffect(() => {
    const anchor = selectedPos || userPos
    if (!anchor) return

    const fetchOsm = async () => {
      setOsmLoading(true)
      setOsmError('')
      try {
        const query = `
          [out:json][timeout:10];
          (
            node(around:50,${anchor.lat},${anchor.lng})["name"];
            way(around:50,${anchor.lat},${anchor.lng})["name"];
            relation(around:50,${anchor.lat},${anchor.lng})["name"];
          );
          out center 50;
        `
        const resp = await fetch('https://overpass-api.de/api/interpreter', {
          method: 'POST',
          body: query,
        })
        if (!resp.ok) throw new Error('No se pudo consultar lugares OSM')
        const data = await resp.json()
        const elements = Array.isArray(data?.elements) ? data.elements : []

        const pickLabel = (tags) => {
          if (!tags) return ''
          return (
            tags.name ||
            tags.amenity ||
            tags.shop ||
            tags.tourism ||
            tags.leisure ||
            tags.office ||
            tags.craft ||
            tags.building ||
            tags.place ||
            tags.historic ||
            ''
          )
        }

        const mapped = elements
          .map((el) => {
            const lat = el.lat || el.center?.lat
            const lng = el.lon || el.center?.lon
            const name = pickLabel(el.tags)
            if (!lat || !lng || !name) return null
            return {
              id: `osm-${el.type}-${el.id}`,
              name,
              address:
                el.tags?.['addr:street'] ||
                el.tags?.['addr:full'] ||
                el.tags?.['addr:housenumber'] ||
                '',
              latitude: lat,
              longitude: lng,
            }
          })
          .filter(Boolean)
        setOsmPlaces(mapped)
      } catch (error) {
        setOsmError(error?.message ?? 'No se pudieron cargar lugares cercanos.')
      } finally {
        setOsmLoading(false)
      }
    }

    fetchOsm()
  }, [selectedPos, userPos])

  const nearestPlaces = useMemo(() => {
    const anchor = selectedPos || userPos
    const combined = [...places, ...osmPlaces]
    if (!anchor || combined.length === 0) return []
    const withDistance = combined.map((p) => ({
      ...p,
      distance: haversine(anchor, { lat: p.latitude, lng: p.longitude }),
    }))
    return withDistance
        .filter((p) => p.distance <= 0.1) // 100 metros
      .sort((a, b) => a.distance - b.distance)
  }, [selectedPos, userPos, places])

  const displayedPlaces = selectedPlace ? [selectedPlace] : nearestPlaces

  const handleResetPlaceSelection = () => {
    setSelectedPlace(null)
    setSelectedPlaceId(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!user || !user.id) {
      setSubmitError('Debes iniciar sesión para publicar una reseña.')
      return
    }
    if (!selectedPlace || !selectedPlaceId || rating === 0 || !content.trim()) {
      setSubmitError('Completa lugar, calificación y comentario antes de publicar.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      // Si es un lugar OSM, crear registro en places
      let placeId = selectedPlaceId
      if (String(selectedPlaceId).startsWith('osm-')) {
        // Reusa el lugar si ya existe con el mismo nombre/coords
        const { data: existingPlace } = await supabase
          .from('places')
          .select('id')
          .eq('name', selectedPlace.name)
          .eq('latitude', selectedPlace.latitude)
          .eq('longitude', selectedPlace.longitude)
          .maybeSingle()

        if (existingPlace?.id) {
          placeId = existingPlace.id
        } else {
          const { data: newPlace, error: placeErr } = await supabase
            .from('places')
            .insert({
              name: selectedPlace.name,
              address: selectedPlace.address,
              latitude: selectedPlace.latitude,
              longitude: selectedPlace.longitude,
            })
            .select('id')
            .single()
          if (placeErr) throw placeErr
          placeId = newPlace.id
        }
      }

      const { data: reviewRow, error: reviewErr } = await supabase
        .from('reviews')
        .insert({
          user_id: user.id,
          place_id: placeId,
          rating,
          content: content.trim(),
        })
        .select('id')
        .single()
      if (reviewErr) throw reviewErr
      const reviewId = reviewRow.id

      const upsertHashtag = async (tag) => {
        const { data, error } = await supabase
          .from('hashtags')
          .insert({ tag })
          .select('id')
          .maybeSingle()
        if (error) {
          // si ya existe, recupéralo
          const { data: existing, error: existingErr } = await supabase
            .from('hashtags')
            .select('id')
            .eq('tag', tag)
            .maybeSingle()
          if (existingErr) throw existingErr
          return existing
        }
        return data
      }

      // Hashtags: upsert y pivot
      if (hashtags.length) {
        for (const tag of hashtags) {
          const hashRow = await upsertHashtag(tag)
          if (!hashRow?.id) continue
          const { error: linkErr } = await supabase
            .from('review_hashtags')
            .insert({ review_id: reviewId, hashtag_id: hashRow.id })
          if (linkErr && linkErr.code !== '23505') {
            throw linkErr
          }
        }
      }

      // Imagen opcional
      if (photoFile) {
        const ext = photoFile.name.split('.').pop()?.toLowerCase() || 'jpg'
        const path = `reviews/${reviewId}/photo-${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('resennas')
          .upload(path, photoFile, { upsert: true })
        if (uploadError) throw uploadError
        const {
          data: { publicUrl },
        } = supabase.storage.from('resennas').getPublicUrl(path)
        await supabase.from('review_images').insert({
          review_id: reviewId,
          image_url: publicUrl,
        })
      }

      // Reset formulario
      setModalOpen(false)
      setContent('')
      setHashtagsInput('')
      setHashtags([])
      setSelectedPlaceId(null)
      setSelectedPlace(null)
      setSelectedPos(null)
      setRating(0)
      setPhotoFile(null)
      setPhotoPreview('')
    } catch (err) {
      setSubmitError(err?.message ?? 'No se pudo publicar la reseña.')
    } finally {
      setSubmitting(false)
    }
  }

  const center = selectedPos || userPos || DEFAULT_POS

  return (
    <section className="create-card">
      <h2>Crea una nueva reseña</h2>
      <p  >Selecciona un lugar en el mapa, elige un punto cercano y describe tu experiencia.</p>
      <button className="primary" type="button" onClick={() => setModalOpen(true)}>
        Crear reseña
      </button>

      {modalOpen && (
        <div className="create-overlay">
          <div className="create-backdrop" onClick={() => setModalOpen(false)} />
          <div className="create-modal">
            <div className="create-modal-header">
              <h3>Nueva reseña</h3>
              <button className="text-link" type="button" onClick={() => setModalOpen(false)}>
                Cerrar
              </button>
            </div>

            <div className="create-layout">
              <div className="map-column">
                <MapContainer center={center} zoom={selectedPos ? 16 : 13} scrollWheelZoom>
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  />
                  {userPos && <Marker position={userPos} icon={userLocIcon} />}
                  {selectedPos && (
                    <Marker position={selectedPos} icon={placePinIcon}>
                      <Popup>Punto seleccionado</Popup>
                    </Marker>
                  )}
                  <SelectableMap position={selectedPos} onSelect={setSelectedPos} />
                </MapContainer>
              </div>

        <div className="form-column">
                <form className="review-form" onSubmit={handleSubmit}>
                  <div className="field">
                    <label>Lugar cercano</label>
                    {loadingPlaces || osmLoading ? (
                      <p className="muted small">Cargando lugares...</p>
                    ) : nearestPlaces.length === 0 ? (
                      <p className="muted small">
                        Toca el mapa para mostrar lugares dentro de 100 m. No se encontraron
                        lugares registrados en esa zona.
                      </p>
                    ) : (
                      <div className="places-list">
                        {selectedPlace && (
                          <button
                            type="button"
                            className="text-link small"
                            onClick={handleResetPlaceSelection}
                          >
                            Cambiar lugar
                          </button>
                        )}
                        {displayedPlaces.map((p) => (
                          <button
                            type="button"
                            key={p.id}
                            className={`place-item ${selectedPlaceId === p.id ? 'selected' : ''}`}
                            onClick={() => handlePlaceSelect(p)}
                          >
                            <div>
                              <p className="place-name">{p.name}</p>
                              <p className="muted small">{p.address || 'Sin dirección'}</p>
                            </div>
                            <span className="distance">{(p.distance * 1000).toFixed(0)} m</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedPlace && (
                      <p className="muted small">
                        Seleccionado: <strong>{selectedPlace.name}</strong> ·{' '}
                        {selectedPlace.address || 'Sin dirección'} · {selectedPlace.latitude.toFixed(5)},{' '}
                        {selectedPlace.longitude.toFixed(5)}
                      </p>
                    )}
                  </div>

                  <div className="field">
                    <label>Calificación</label>
                    <Stars value={rating} onChange={setRating} />
                  </div>

                  <div className="field">
                    <label>Foto del lugar</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setPhotoFile(file)
                          const reader = new FileReader()
                          reader.onload = () => setPhotoPreview(reader.result)
                          reader.readAsDataURL(file)
                        }
                      }}
                    />
                    {photoPreview && (
                      <div className="photo-preview">
                        <img src={photoPreview} alt="Previsualización del lugar" />
                      </div>
                    )}
                  </div>

                  <div className="field">
                    <label>Comentario</label>
                    <textarea
                      rows={3}
                      placeholder="Cuenta tu experiencia..."
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label>Hashtags</label>
                    <input
                      type="text"
                      placeholder="#cafe #bici #estudio"
                      value={hashtagsInput}
                      onChange={(e) => setHashtagsInput(e.target.value)}
                    />
                    {hashtags.length > 0 && (
                      <div className="hashtags">
                        {hashtags.map((tag) => (
                          <span key={tag}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  {submitError && <p className="muted small error">{submitError}</p>}
                  <button
                    className="primary"
                    type="submit"
                    disabled={!selectedPlaceId || rating === 0 || !content.trim() || submitting}
                  >
                    {submitting ? 'Publicando...' : 'Publicar reseña'}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default CreatePage
