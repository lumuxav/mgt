export default function manifest() {
  return {
  "name": "MGT Business Suite",
  "short_name": "MGT",
  "description": "Configurable business management for retail, wholesale, services and industry.",
  "id": "/",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#f4f6fa",
  "theme_color": "#1f4f8f",
  "orientation": "any",
  "categories": [
    "business",
    "productivity"
  ],
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Point of Sale",
      "short_name": "POS",
      "url": "/pos",
      "icons": [
        {
          "src": "/icon.svg",
          "sizes": "any",
          "type": "image/svg+xml"
        }
      ]
    },
    {
      "name": "Inventory",
      "short_name": "Stock",
      "url": "/inventory",
      "icons": [
        {
          "src": "/icon.svg",
          "sizes": "any",
          "type": "image/svg+xml"
        }
      ]
    },
    {
      "name": "Notifications",
      "short_name": "Alerts",
      "url": "/notifications",
      "icons": [
        {
          "src": "/icon.svg",
          "sizes": "any",
          "type": "image/svg+xml"
        }
      ]
    }
  ]
}
}
