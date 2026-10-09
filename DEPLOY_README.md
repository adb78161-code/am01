# Amo1 corrected project

## GitHub Pages (frontend)
Upload these files into the ROOT of your `amo1` repository:
- `index.html`
- `console.html`, `console.js`
- `camera.html`, `camera.js`
- `common.js`, `config.js`
- `styles.css`

Do not upload the Node server files as the Pages frontend's substitute for these files; keep them in the same repository root if Render is configured to deploy from this repository.

## Render (signaling server)
The repository root must also contain `package.json` and `server.js`.
Set Render Start Command to `npm start`.
Use the existing Render service; a new service is not required.

## Configuration
`config.js` currently points to `wss://am01-vwy8.onrender.com`.
If that is not the exact public hostname shown in Render, change it to the correct host. Do not include `/signal` in the value; `common.js` appends `/signal`.

## Testing
1. Visit `/amo1/` and confirm it redirects to `console.html`.
2. Keep Device A open and wait for QR creation.
3. Scan with Device B and tap the camera button to approve camera access.
4. Keep Device B's page open while checking Device A.
5. Location requires a separate browser permission. Some mobile networks require TURN for reliable WebRTC.
