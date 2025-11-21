import rookieFrame from '../assets/images/rangos/rookie.svg'
import explorerFrame from '../assets/images/rangos/explorer.svg'
import proFrame from '../assets/images/rangos/pro.svg'
import legendFrame from '../assets/images/rangos/legend.svg'

const rankLevels = [
  { key: 'legend', label: 'Leyenda', minLikes: 4, frame: legendFrame },
  { key: 'pro', label: 'Pro', minLikes: 3, frame: proFrame },
  { key: 'explorer', label: 'Explorador', minLikes: 2, frame: explorerFrame },
  { key: 'rookie', label: 'Rookie', minLikes: 0, frame: rookieFrame },
]

export const getRankByLikes = (likes = 0) => {
  const total = Number.isFinite(likes) ? likes : 0
  return rankLevels.find((rank) => total >= rank.minLikes) ?? rankLevels[rankLevels.length - 1]
}

export const formatLikesLabel = (likes = 0) => {
  if (likes >= 1000) {
    return `${(likes / 1000).toFixed(1).replace(/\\.0$/, '')}k`
  }
  return `${likes}`
}
