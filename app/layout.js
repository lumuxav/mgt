import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./profile-overrides.css";
import "./preferences.css";
import "./mobile-native.css";
import AppShell from "./components/AppShell";
import PwaRegister from "./components/PwaRegister";
import ConnectivityStatus from "./components/ConnectivityStatus";
import PwaInstallPrompt from "./components/PwaInstallPrompt";
import SystemChrome from "./components/SystemChrome";
import MobileViewport from "./components/MobileViewport";
import NativeBackNavigation from "./components/NativeBackNavigation";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "MGT Business Suite",
  description: "Configurable business management for retail, wholesale, services and industry.",
  applicationName: "MGT Business Suite",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "MGT Business Suite",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/mgt-icon-512.png?v=3", type: "image/svg+xml" },
      { url: "/favicon.ico?v=3" },
    ],
    shortcut: "/icons/mgt-icon-512.png?v=3",
    apple: "/icons/mgt-apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#f4f6fa",
};

export default function RootLayout({ children }) {
  const themeScript = `
    try {
      const saved = localStorage.getItem('mgt-theme') || 'light';
      document.documentElement.dataset.theme = saved;
      const display = JSON.parse(localStorage.getItem('mgt-display-preferences') || '{}');
      document.documentElement.dataset.density = display.density || 'comfortable';
      document.documentElement.dataset.motion = display.reducedMotion ? 'reduced' : 'normal';
    } catch (e) {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.dataset.density = 'comfortable';
      document.documentElement.dataset.motion = 'normal';
    }
  `;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full">
        <SystemChrome />
        <MobileViewport />
        <NativeBackNavigation />
        <PwaRegister />
        <ConnectivityStatus />
        <PwaInstallPrompt />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
