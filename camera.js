
(() => {
  const $ = (s) => document.querySelector(s);
  const E = {
    video: $("#cameraVideo"),
    stage: $("#cameraStage"),
    overlay: $("#overlay"),
    status: $("#status"),
    mood: $("#mood"),
    moodText: $("#moodText"),
    time: $("#time"),
    date: $("#date"),
    camera: $("#camera"),
    flip: $("#flip"),
    photo: $("#photo"),
    stop: $("#stop")
  };

  let stream = null;
  let recorder = null;
  let chunks = [];
  let facing = "user";
  let recordingStartedAt = 0;
  let timerId = null;
  let stopped = false;

  // Add visible recording controls.
  const bar = document.createElement("div");
  bar.id = "recordingBar";
  bar.style.cssText = `
    display:flex;align-items:center;justify-content:center;
    gap:12px;flex-wrap:wrap;margin:12px auto;padding:10px;
  `;

  const rec = document.createElement("span");
  rec.textContent = "● REC OFF";
  rec.style.cssText = "font-weight:700;color:#777";

  const elapsed = document.createElement("span");
  elapsed.textContent = "00:00";
  elapsed.style.fontVariantNumeric = "tabular-nums";

  const download = document.createElement("button");
  download.textContent = "Download video";
  download.disabled = true;

  bar.append(rec, elapsed, download);
  E.stage.insertAdjacentElement("afterend", bar);

  function setStatus(message) {
    if (E.status) E.status.textContent = message;
  }

  function updateClock() {
    const d = new Date();
    if (E.time) E.time.textContent = d.toLocaleTimeString();
    if (E.date) {
      E.date.textContent = d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    }
  }

  function updateTimer() {
    const seconds = Math.floor((Date.now() - recordingStartedAt) / 1000);
    elapsed.textContent =
      String(Math.floor(seconds / 60)).padStart(2, "0") +
      ":" +
      String(seconds % 60).padStart(2, "0");
  }

  async function startCamera() {
    if (stream) return true;
    stopped = false;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API unavailable. Open the HTTPS website.");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true
      });

      E.video.srcObject = stream;
      await E.video.play();

      E.overlay?.classList.add("hidden");
      E.stage?.classList.add("live");
      if (E.mood) E.mood.textContent = "Camera on";
      if (E.moodText) E.moodText.textContent = "Camera is active.";

      setStatus("Camera on");
      E.camera.textContent = "Camera on";
      download.disabled = true;

      // Recording starts only after the user approves camera access.
      startRecording();
      return true;
    } catch (error) {
      console.error(error);
      setStatus("Camera permission needed");
      alert(
        error.name === "NotAllowedError"
          ? "Camera/microphone permission was denied. Allow access in browser settings and try again."
          : "Unable to start camera: " + error.message
      );
      return false;
    }
  }

  function startRecording() {
    if (!stream || recorder?.state === "recording") return;

    if (!window.MediaRecorder) {
      setStatus("Video recording unsupported in this browser");
      return;
    }

    chunks = [];

    const mimeType = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ].find(type => MediaRecorder.isTypeSupported(type));

    try {
      recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearInterval(timerId);
        timerId = null;

        if (chunks.length) {
          const blob = new Blob(chunks, {
            type: recorder.mimeType || "video/webm"
          });

          // Keep the completed recording available for download.
          download.disabled = false;
          download.onclick = () => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `amo1-recording-${Date.now()}.webm`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          };

          setStatus("Recording saved locally — download available");
        }
      };

      recorder.start(1000);
      recordingStartedAt = Date.now();

      rec.textContent = "● REC";
      rec.style.color = "#d7193f";
      timerId = setInterval(updateTimer, 250);
      setStatus("Recording");
    } catch (error) {
      console.error(error);
      setStatus("Could not start recording");
    }
  }

  async function flipCamera() {
    if (!stream && !(await startCamera())) return;

    const oldStream = stream;
    facing = facing === "user" ? "environment" : "user";

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
        audio: true
      });

      const nextVideo = nextStream.getVideoTracks()[0];
      const nextAudio = nextStream.getAudioTracks()[0];

      // Replace the video track in the active recording when supported.
      if (recorder?.state === "recording") {
        recorder.stop();
      }

      oldStream.getTracks().forEach(track => track.stop());
      stream = nextStream;
      E.video.srcObject = stream;
      await E.video.play();

      startRecording();
      setStatus(facing === "user" ? "Front camera" : "Back camera");
    } catch (error) {
      console.error(error);
      facing = facing === "user" ? "environment" : "user";
      setStatus("Could not switch camera");
    }
  }

  function stopAll() {
    stopped = true;
    clearInterval(timerId);
    timerId = null;

    if (recorder?.state === "recording") {
      recorder.stop();
    }

    stream?.getTracks().forEach(track => track.stop());
    stream = null;

    if (E.video) E.video.srcObject = null;
    E.overlay?.classList.remove("hidden");
    E.stage?.classList.remove("live");

    if (E.mood) E.mood.textContent = "Camera off";
    if (E.moodText) E.moodText.textContent = "Camera and recording stopped.";

    rec.textContent = "● REC OFF";
    rec.style.color = "#777";
    setStatus("Stopped");
    E.camera.textContent = "Camera";
  }

  // Photo capture is local to this device.
  function takePhoto() {
    if (!stream || !E.video.videoWidth) {
      alert("Start the camera first.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = E.video.videoWidth;
    canvas.height = E.video.videoHeight;
    canvas.getContext("2d").drawImage(
      E.video, 0, 0, canvas.width, canvas.height
    );

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `amo1-photo-${Date.now()}.jpg`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }, "image/jpeg", 0.92);
  }

  E.camera?.addEventListener("click", startCamera);
  E.flip?.addEventListener("click", flipCamera);
  E.photo?.addEventListener("click", takePhoto);
  E.stop?.addEventListener("click", stopAll);

  updateClock();
  setInterval(updateClock, 1000);
  setStatus("Ready — tap Camera to begin");
})();
