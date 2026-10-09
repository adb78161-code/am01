# Amo1 Fixed WebRTC v2

This ZIP replaces the mixed PeerJS/native-WebRTC implementation with one native WebRTC protocol on both devices.

## GitHub Pages
Upload the frontend files to the repository root:
- console.html
- camera.html
- console.js
- camera.js
- common.js
- config.js
- styles.css

Open `console.html` for Device A.

## Render
Use:
- package.json
- server.js
- Start command: `npm start`

The frontend is configured for:
`wss://am01-vwy8.onrender.com/signal`

If your actual Render hostname differs, edit `config.js`.

## Notes
- Device B must approve camera permission.
- Location is requested only through the browser permission flow.
- Front camera is mirrored; back camera is not.
- Device A receives the WebRTC live stream.
- Photos are saved in Device A's IndexedDB.
- QR sessions expire after 20 minutes.
- STUN is included. A TURN server is recommended for difficult mobile/carrier NATs.
