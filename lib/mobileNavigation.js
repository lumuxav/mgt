export function nativeBackAction(path, canGoBack, historyLength, previousPress, now) {
  if (path === '/' || path === '/login') return previousPress !== null && now - previousPress < 2000 ? 'exit' : 'confirm'
  return canGoBack && historyLength > 1 ? 'back' : 'home'
}

export function isKeyboardOpen({ stableHeight, viewportHeight, touch, editing, scale = 1 }) {
  return touch && editing && scale === 1 && stableHeight - viewportHeight > Math.max(120, stableHeight * 0.18)
}
