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
  "theme_color": "#101820",
  "orientation": "any",
  "categories": [
    "business",
    "productivity"
  ],
  "icons": [
    { "src": "/icons/mgt-icon-192.png?v=4", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "/icons/mgt-icon-512.png?v=4", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "/icons/mgt-icon-maskable-512.png?v=4", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Point of Sale",
      "short_name": "POS",
      "url": "/pos",
      "icons": [
        {
          "src": "/icons/mgt-icon-192.png?v=4",
          "sizes": "any",
          "type": "image/png"
        }
      ]
    },
    {
      "name": "Inventory",
      "short_name": "Stock",
      "url": "/inventory",
      "icons": [
        {
          "src": "/icons/mgt-icon-192.png?v=4",
          "sizes": "any",
          "type": "image/png"
        }
      ]
    },
    {
      "name": "Notifications",
      "short_name": "Alerts",
      "url": "/notifications",
      "icons": [
        {
          "src": "/icons/mgt-icon-192.png?v=4",
          "sizes": "any",
          "type": "image/png"
        }
      ]
    }
  ]
}
}
