(() => {
  // ========================================
  // 1. INITIALIZATION & DOM ELEMENTS
  // ========================================

  const { $, toast, copy, wsUrl } = Amo1;

  const E = {
    qr: $('#qr'),
    url: $('#url'),
    count: $('#count'),
    conn: $('#conn'),
    connText: $('#connText'),
    loc: $('#loc'),
    lat: $('#lat'),
    lng: $('#lng'),
    stage: $('#stage'),
    empty: $('#empty'),
    title: $('#streamTitle'),
    devices: $('#devices'),
    gallery: $('#gallery'),
    photos: $('#photos')
  };

  // ========================================
  // 2. SESSION STATE & WEBRTC CONFIGURATION
  // ========================================

  const S = {
    ws: null,
    id: null,
    sid: null,
    exp: 0,
    peers: new Map(),
    selected: null,
    ended: false,
    chosen: new Set()
  };

  const ice = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' }
    ]
  };

  // ========================================
  // 3. WEBSOCKET MESSAGE SENDING
  // ========================================

  function send(message) {
    if (S.ws?.readyState === WebSocket.OPEN) {
      S.ws.send(JSON.stringify(message));
    }
  }

  // ========================================
  // 4. SESSION URL & QR CODE
  // ========================================

  function url() {
    const u = new URL('./camera.html', location.href);
    u.hash = 'session=' + encodeURIComponent(S.sid);
    return u.href;
  }

  function qr() {
    const img = document.createElement('img');

    img.src =
      'https://api.qrserver.com/v1/create-qr-code/?size=520x520&data=' +
      encodeURIComponent(url());

    E.qr.replaceChildren(img);
    E.url.textContent = url();
  }

  // ========================================
  // 5. WEBRTC PEER CREATION
  // ========================================

  function peer(id) {
    if (S.peers.has(id)) {
      return S.peers.get(id);
    }

    const p = {
      id,
      pc: new RTCPeerConnection(ice),
      dc: null,
      stream: null,
      info: {},
      pending: [],
      remote: false
    };

    S.peers.set(id, p);

    if (S.selected === null) {
      S.selected = id;
    }

    p.pc.onicecandidate = event => {
      if (event.candidate) {
        send({
          type: 'signal',
          to: id,
          data: {
            k: 'ice',
            c: event.candidate
          }
        });
      }
    };

    p.pc.ontrack = event => {
      p.stream =
        event.streams[0] ||
        new MediaStream([event.track]);

      show(p);
      drawDevices();
    };

    p.pc.ondatachannel = event => {
      bindDC(p, event.channel);
    };

    p.pc.onconnectionstatechange = drawDevices;

    return p;
  }

  // ========================================
  // 6. DATA CHANNEL MANAGEMENT
  // ========================================

  function bindDC(p, channel) {
    p.dc = channel;

    channel.onopen = () => {
      drawDevices();
    };

    channel.onmessage = event => {
      let message;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'device-info') {
        p.info = {
          ...p.info,
          ...message.info
        };

        drawDevices();
        locationUI(p.info.location);
      }

      if (message.type === 'location') {
        p.info.location = message.location;
        locationUI(message.location);
      }

      if (message.type === 'photo') {
        savePhoto(p, message);
      }
    };

    channel.onclose = () => {
      drawDevices();
    };
  }

  // ========================================
  // 7. WEBRTC OFFER CREATION
  // ========================================

  async function offer(id) {
    const p = peer(id);

    try {
      if (!p.dc) {
        bindDC(
          p,
          p.pc.createDataChannel('amo1-data')
        );
      }

      p.pc.addTransceiver('video', {
        direction: 'recvonly'
      });

      const description = await p.pc.createOffer();

      await p.pc.setLocalDescription(description);

      send({
        type: 'signal',
        to: id,
        data: {
          k: 'offer',
          d: p.pc.localDescription
        }
      });
    } catch (error) {
      console.error('Offer failed', error);
      toast('Could not start WebRTC');
    }
  }

  // ========================================
  // 8. WEBRTC SIGNAL HANDLING
  // ========================================

  async function signal(from, data) {
    const p = peer(from);

    try {
      if (data.k === 'offer') {
        await p.pc.setRemoteDescription(data.d);
        p.remote = true;

        for (const candidate of p.pending) {
          await p.pc.addIceCandidate(candidate)
            .catch(() => {});
        }

        p.pending = [];

        const answer = await p.pc.createAnswer();

        await p.pc.setLocalDescription(answer);

        send({
          type: 'signal',
          to: from,
          data: {
            k: 'answer',
            d: p.pc.localDescription
          }
        });
      } else if (data.k === 'answer') {
        await p.pc.setRemoteDescription(data.d);
        p.remote = true;

        for (const candidate of p.pending) {
          await p.pc.addIceCandidate(candidate)
            .catch(() => {});
        }

        p.pending = [];
      } else if (data.k === 'ice') {
        if (p.remote) {
          await p.pc.addIceCandidate(data.c);
        } else {
          p.pending.push(data.c);
        }
      }
    } catch (error) {
      console.error('Signaling failed', error);
    }
  }

  // ========================================
  // 9. WEBSOCKET MESSAGE ROUTER
  // ========================================

  function msg(message) {
    if (message.type === 'hello') {
      S.id = message.peerId;
      send({ type: 'create-session' });
      return;
    }

    if (message.type === 'session-created') {
      S.sid = message.sessionId;
      S.exp = message.expiresAt;

      qr();
      timer();
      return;
    }

    if (message.type === 'peer-joined') {
      peer(message.peerId);
      drawDevices();
      offer(message.peerId);
      return;
    }

    if (message.type === 'peer-left') {
      remove(message.peerId);
      return;
    }

    if (message.type === 'signal') {
      signal(message.from, message.data);
      return;
    }

    if (message.type === 'device-info') {
      const p = peer(message.from);

      p.info = {
        ...p.info,
        ...message.info
      };

      drawDevices();
      locationUI(p.info.location);
      return;
    }

    if (message.type === 'session-ended') {
      endLocal();
    }
  }

  // ========================================
  // 10. WEBSOCKET CONNECTION
  // ========================================

  function connect() {
    S.ws = new WebSocket(wsUrl());

    S.ws.onopen = () => {
      E.connText.textContent = 'Connected to signaling server';
    };

    S.ws.onmessage = event => {
      try {
        msg(JSON.parse(event.data));
      } catch (error) {
        console.error('Invalid server message', error);
      }
    };

    S.ws.onerror = () => {
      toast('Signaling server unavailable');
    };

    S.ws.onclose = () => {
      if (!S.ended) {
        E.connText.textContent =
          'Signaling disconnected — refresh Device A';

        toast('Signaling disconnected');
      }
    };
  }

  // ========================================
  // 11. SESSION COUNTDOWN TIMER
  // ========================================

  function timer() {
    const interval = setInterval(() => {
      const remaining = Math.max(
        0,
        S.exp - Date.now()
      );

      E.count.textContent =
        String(Math.floor(remaining / 60000)).padStart(2, '0') +
        ':' +
        String(Math.floor((remaining % 60000) / 1000))
          .padStart(2, '0');

      if (remaining <= 0 || S.ended) {
        clearInterval(interval);

        if (!S.ended) {
          send({ type: 'end-session' });
          endLocal();
        }
      }
    }, 250);
  }

  // ========================================
  // 12. LIVE VIDEO DISPLAY
  // ========================================

  function show(p) {
    E.empty.classList.add('hidden');

    E.title.textContent =
      (p.info.deviceName || 'Device B') + ' · live';

    let video = E.stage.querySelector('video.remote');

    if (!video) {
      video = document.createElement('video');
      video.className = 'remote';
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;

      E.stage.append(video);
    }

    video.srcObject = p.stream;
    video.play().catch(() => {});

    p.video = video;
  }

  // ========================================
  // 13. CONNECTED DEVICE LIST
  // ========================================

  function drawDevices() {
    E.devices.innerHTML = '';

    for (const [id, p] of S.peers) {
      const button = document.createElement('button');

      button.className =
        S.selected === id ? 'active' : '';

      button.textContent =
        (p.info.deviceName || 'Device B') +
        ' · ' +
        (p.pc.connectionState || 'connecting');

      button.onclick = () => {
        S.selected = id;

        if (p.stream) {
          show(p);
        }

        locationUI(p.info.location);
        drawDevices();
      };

      E.devices.append(button);
    }

    E.conn.textContent = S.peers.size
      ? S.peers.size + ' device(s) connected'
      : 'Waiting';

    E.connText.textContent = S.peers.size
      ? 'Camera session active'
      : 'Scan the QR on Device B';
  }

  // ========================================
  // 14. DEVICE LOCATION DISPLAY
  // ========================================

  function locationUI(location) {
    if (
      !location ||
      !Number.isFinite(Number(location.lat)) ||
      !Number.isFinite(Number(location.lng))
    ) {
      E.loc.textContent = 'Waiting';
      return;
    }

    E.loc.textContent = 'Location received';
    E.lat.textContent = Number(location.lat).toFixed(6);
    E.lng.textContent = Number(location.lng).toFixed(6);
  }

  // ========================================
  // 15. PHOTO STORAGE IN INDEXEDDB
  // ========================================

  function openPhotoDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('amo1photos', 1);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('p')) {
          db.createObjectStore('p', {
            keyPath: 'id'
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function savePhoto(p, message) {
    try {
      const db = await openPhotoDB();

      const transaction = db.transaction('p', 'readwrite');

      transaction.objectStore('p').put({
        id: Date.now() + Math.random(),
        data: message.data,
        name: p.info.deviceName || 'Device B'
      });

      transaction.oncomplete = gallery;
      transaction.onerror = () => {
        toast('Could not save photo');
      };
    } catch (error) {
      console.error('Photo storage failed', error);
      toast('Could not open photo storage');
    }
  }

  // ========================================
  // 16. PHOTO GALLERY
  // ========================================

  async function gallery() {
    try {
      const db = await openPhotoDB();

      const transaction = db.transaction('p', 'readonly');
      const request = transaction.objectStore('p').getAll();

      request.onsuccess = () => {
        const photos = request.result;

        E.photos.textContent = photos.length;
        E.gallery.innerHTML = '';

        photos.slice(-12).reverse().forEach(photo => {
          const button = document.createElement('button');
          const image = document.createElement('img');
          const label = document.createElement('small');

          image.src = photo.data;
          image.alt = 'Captured photo';

          label.textContent = photo.name;

          button.append(image, label);

          button.onclick = () => {
            if (S.chosen.has(photo.id)) {
              S.chosen.delete(photo.id);
              button.classList.remove('selected');
            } else {
              S.chosen.add(photo.id);
              button.classList.add('selected');
            }
          };

          if (S.chosen.has(photo.id)) {
            button.classList.add('selected');
          }

          E.gallery.append(button);
        };
      };
    } catch (error) {
      console.error('Gallery failed', error);
    }
  }

  // ========================================
  // 17. DEVICE DISCONNECTION
  // ========================================

  function remove(id) {
    const p = S.peers.get(id);

    if (!p) return;

    try {
      p.pc.close();
    } catch (error) {
      console.error(error);
    }

    S.peers.delete(id);

    if (S.selected === id) {
      S.selected = S.peers.keys().next().value ?? null;
    }

    if (S.selected !== null) {
      const selectedPeer = S.peers.get(S.selected);

      if (selectedPeer?.stream) {
        show(selectedPeer);
      }
    } else {
      E.empty.classList.remove('hidden');
      E.title.textContent = 'No active stream';
    }

    drawDevices();
  }

  // ========================================
  // 18. END SESSION
  // ========================================

  function endLocal() {
    if (S.ended) return;

    S.ended = true;

    for (const p of S.peers.values()) {
      try {
        p.pc.close();
      } catch (error) {
        console.error(error);
      }
    }

    S.peers.clear();
    S.selected = null;

    S.ws?.close();

    E.conn.textContent = 'Disconnected';
    E.connText.textContent = 'Session ended';

    drawDevices();
    toast('Session ended');
  }

  // ========================================
  // 19. DELETE SELECTED PHOTOS
  // ========================================

  async function deleteSelectedPhotos() {
    if (!S.chosen.size) {
      toast('Select photos first');
      return;
    }

    try {
      const db = await openPhotoDB();
      const transaction = db.transaction('p', 'readwrite');
      const store = transaction.objectStore('p');

      for (const id of S.chosen) {
        store.delete(id);
      }

      transaction.oncomplete = () => {
        S.chosen.clear();
        gallery();
      };
    } catch (error) {
      console.error('Photo deletion failed', error);
      toast('Could not delete photos');
    }
  }

  // ========================================
  // 20. BUTTON EVENT HANDLERS
  // ========================================

  $('#delete').onclick = deleteSelectedPhotos;

  $('#copy').onclick = () => {
    if (S.sid) {
      copy(url());
    } else {
      toast('QR not ready');
    }
  };

  $('#share').onclick = async () => {
    if (!S.sid) {
      toast('QR not ready');
      return;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          url: url(),
          title: 'Amo1'
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          toast('Could not share session');
        }
      }
    } else {
      copy(url());
    }
  };

  $('#end').onclick = () => {
    send({ type: 'end-session' });
    endLocal();
  };

  $('#regen').onclick = () => {
    location.reload();
  };

  $('#map').onclick = () => {
    const location = S.peers.get(S.selected)?.info.location;

    if (!location) {
      toast('Location unavailable');
      return;
    }

    const mapURL =
      'https://www.openstreetmap.org/?mlat=' +
      encodeURIComponent(location.lat) +
      '&mlon=' +
      encodeURIComponent(location.lng);

    window.open(mapURL, '_blank', 'noopener,noreferrer');
  };

  // ========================================
  // 21. APPLICATION STARTUP
  // ========================================

  gallery();
  connect();
})();
