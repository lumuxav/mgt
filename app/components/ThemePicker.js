'use client'

import { useEffect, useState } from 'react'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'blue', label: 'Navy' },
]

function ThemeIcon({ type }) {
  if (type === 'light') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" />
      </svg>
    )
  }

  if (type === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" />
    </svg>
  )
}

export default function ThemePicker({ compact = false }) {
  const [theme, setTheme] = useState('light')

  useEffect(() => {
    const saved = localStorage.getItem('mgt-theme') || 'light'
    setTheme(saved)
    document.documentElement.dataset.theme = saved
  }, [])

  const changeTheme = (value) => {
    setTheme(value)
    localStorage.setItem('mgt-theme', value)
    document.documentElement.dataset.theme = value
  }

  return (
    <div className={`theme-picker ${compact ? 'theme-picker-compact' : ''}`} aria-label="Appearance">
      {THEMES.map((item) => (
        <button
          key={item.value}
          type="button"
          onClick={() => changeTheme(item.value)}
          className={theme === item.value ? 'theme-option theme-option-active' : 'theme-option'}
          aria-pressed={theme === item.value}
          title={`${item.label} theme`}
        >
          <span className="theme-icon"><ThemeIcon type={item.value} /></span>
          {!compact && <span>{item.label}</span>}
        </button>
      ))}
    </div>
  )
}
