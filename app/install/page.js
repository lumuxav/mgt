import Link from 'next/link'
import InstallButton from '../components/InstallButton'

export const metadata = { title: 'Install MGT | Mobile and desktop' }

const devices = [
  ['Android, including Redmi', 'Open MGT in Chrome. Use Install MGT above, or open the browser menu and choose Install app / Add to Home screen. Launch MGT from its new icon.'],
  ['iPhone and iPad', 'Open MGT in Safari. Tap Share, choose Add to Home Screen, then Add. Open the new MGT icon to use the app.'],
  ['Windows and Linux', 'Open MGT in Chrome or Edge. Choose the install icon in the address bar, or Install app in the browser menu. MGT opens in its own window and can be pinned to your taskbar.'],
  ['Mac', 'Use Chrome or Edge and choose the address bar install icon. In Safari on supported macOS versions, choose File → Add to Dock.'],
]

export default function InstallPage() {
  return <main className="page-wrap mx-auto max-w-4xl py-8">
    <div className="page-card p-6 sm:p-8">
      <p className="page-eyebrow">MGT Business Suite</p>
      <h1 className="page-title">Your workspace, on any device</h1>
      <p className="mt-3 text-muted">Install MGT on your phone, tablet or computer. Sign in with the same account to access your business across devices.</p>
      <InstallButton />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/" className="btn-secondary rounded-xl px-4 py-2.5 font-bold">Open MGT</Link>
        <a href="https://github.com/lumuxav/mgt/releases/tag/mgt-test-latest" className="btn-secondary rounded-xl px-4 py-2.5 font-bold">Android test APK</a>
      </div>
      <p className="mt-3 text-xs text-muted">APK downloads require repository access. Browser installation is available without an APK.</p>
    </div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {devices.map(([name, instructions]) => <section key={name} className="page-card p-6">
        <h2 className="text-lg font-bold">{name}</h2>
        <p className="mt-3 text-sm leading-6 text-muted">{instructions}</p>
      </section>)}
    </div>
    <section className="page-card mt-5 p-6">
      <h2 className="text-lg font-bold">Connection and updates</h2>
      <p className="mt-3 text-sm leading-6 text-muted">Live stock, sales and financial actions need an internet connection. If you lose connection, reconnect and retry. MGT does not queue transactions offline.</p>
      <p className="mt-3 text-sm leading-6 text-muted">When an app update is ready, finish any work in progress, then choose Update now. You can keep using MGT in your browser if installation is unavailable.</p>
    </section>
  </main>
}
