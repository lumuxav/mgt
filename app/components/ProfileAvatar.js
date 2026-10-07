'use client'

import { useEffect, useState } from 'react'

export const avatarStorageKey = (userId) => `mgt-profile-photo:${userId || 'guest'}`

export default function ProfileAvatar({ userId, initials = 'MG', className = '' }) {
  const [photo, setPhoto] = useState(null)

  useEffect(() => {
    if (!userId) return

    const load = () => {
      try {
        setPhoto(localStorage.getItem(avatarStorageKey(userId)))
      } catch {
        setPhoto(null)
      }
    }

    load()
    const onChange = (event) => {
      if (!event.detail || event.detail.userId === userId) load()
    }
    window.addEventListener('mgt-avatar-change', onChange)
    window.addEventListener('storage', load)
    return () => {
      window.removeEventListener('mgt-avatar-change', onChange)
      window.removeEventListener('storage', load)
    }
  }, [userId])

  return (
    <span className={`profile-avatar ${photo ? 'profile-avatar-has-photo' : ''} ${className}`.trim()}>
      {photo ? <img src={photo} alt="Profile" /> : <span>{initials}</span>}
    </span>
  )
}
