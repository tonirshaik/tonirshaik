(function () {
    const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
    const MODEL_LOAD_TIMEOUT_MS = 15000;
    const MATCH_THRESHOLD = 0.5;
    const ADMIN_PASSWORD = 'uplo@d2002';

    let modelsLoaded = false;
    let modelsLoading = false;
    let knownFaces = [];
    let knownFacesLoaded = false;

    function withTimeout(promise, ms) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
        ]);
    }

    async function ensureModelsLoaded(statusEl) {
        if (modelsLoaded) return true;
        if (modelsLoading) return false;
        modelsLoading = true;
        if (statusEl) statusEl.textContent = 'মডেল লোড হচ্ছে... (প্রথমবার একটু সময় নেবে)';
        try {
            await withTimeout(Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
            ]), MODEL_LOAD_TIMEOUT_MS);
            modelsLoaded = true;
            if (statusEl) statusEl.textContent = 'মডেল লোড হয়ে গেছে ✓';
            return true;
        } catch (err) {
            console.error('Face model load failed:', err);
            if (statusEl) statusEl.textContent = '⚠️ মডেল লোড করতে সমস্যা হয়েছে — ইন্টারনেট কানেকশন চেক করে আবার "মুখ খুঁজে দেখাও" চাপো';
            return false;
        } finally {
            modelsLoading = false;
        }

    }

    async function loadKnownFaces() {
        if (knownFacesLoaded) return;
        knownFacesLoaded = true;
        try {
            const res = await fetch(APPS_SCRIPT_URL, { method: 'GET' });
            const data = await res.json();
            if (data && data.success && Array.isArray(data.faces)) {
                knownFaces = data.faces
                    .filter(function (f) { return f && f.name && Array.isArray(f.descriptor); })
                    .map(function (f) { return { name: f.name, descriptor: new Float32Array(f.descriptor) }; });
            }
        } catch (err) {
            console.error('Known faces load failed:', err);
        }
    }

    function findBestMatch(descriptor) {
        let best = null;
        let bestDist = Infinity;
        knownFaces.forEach(function (kf) {
            const dist = faceapi.euclideanDistance(descriptor, kf.descriptor);
            if (dist < bestDist) {
                bestDist = dist;
                best = kf.name;
            }
        });
        if (best !== null && bestDist < MATCH_THRESHOLD) {
            return { name: best, distance: bestDist };
        }
        return null;
    }

    function cropFaceToCanvas(imgEl, box) {
        const pad = 0.15;
        const w = box.width;
        const h = box.height;
        const x = Math.max(0, box.x - w * pad);
        const y = Math.max(0, box.y - h * pad);
        const cw = w * (1 + pad * 2);
        const ch = h * (1 + pad * 2);

        const canvas = document.createElement('canvas');
        const size = 90;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, x, y, cw, ch, 0, 0, size, size);
        return canvas;
    }

    async function detectFacesWithDescriptors(imgEl) {

        const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.3 });
        return faceapi
            .detectAllFaces(imgEl, options)
            .withFaceLandmarks()
            .withFaceDescriptors();
    }

    function confirmFaceWithName(name, descriptor) {
        window.tagFaceForCurrentPhoto(name, descriptor);
    }

    function buildFaceCard(imgEl, detection) {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:6px; width:110px;';

        const canvas = cropFaceToCanvas(imgEl, detection.detection.box);
        canvas.style.borderRadius = '8px';
        canvas.style.border = '2px solid #3FA8FF';
        wrap.appendChild(canvas);

        const match = findBestMatch(detection.descriptor);
        let confirmed = false;

        if (match) {
            const pct = Math.round((1 - match.distance / MATCH_THRESHOLD) * 40 + 60);
            const suggestBox = document.createElement('div');
            suggestBox.style.cssText = 'font-size:11px; text-align:center; color: var(--muted);';
            suggestBox.innerHTML = `সম্ভবত: <b style="color:#3FA8FF;">${match.name}</b> (${pct}%)`;
            wrap.appendChild(suggestBox);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex; gap:6px;';
            const yesBtn = document.createElement('button');
            yesBtn.type = 'button';
            yesBtn.textContent = '✓ ঠিক আছে';
            yesBtn.className = 'admin-btn admin-btn-sm';
            yesBtn.style.cssText = 'padding:4px 8px; font-size:11px;';
            const noBtn = document.createElement('button');
            noBtn.type = 'button';
            noBtn.textContent = '✕ না';
            noBtn.className = 'admin-btn admin-btn-secondary admin-btn-sm';
            noBtn.style.cssText = 'padding:4px 8px; font-size:11px;';

            yesBtn.addEventListener('click', function () {
                if (confirmed) return;
                confirmed = true;
                confirmFaceWithName(match.name, detection.descriptor);
                suggestBox.innerHTML = `✓ ট্যাগ হয়েছে: <b style="color:var(--gold);">${match.name}</b>`;
                btnRow.remove();
            });
            noBtn.addEventListener('click', function () {
                btnRow.remove();
                suggestBox.remove();
                wrap.appendChild(buildManualNameInput(detection));
            });

            btnRow.appendChild(yesBtn);
            btnRow.appendChild(noBtn);
            wrap.appendChild(btnRow);
        } else {
            wrap.appendChild(buildManualNameInput(detection));
        }

        return wrap;
    }

    function buildManualNameInput(detection) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:4px; width:100%;';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'নাম?';
        input.style.cssText = 'width:100%; min-width:0; font-size:11px; padding:4px 6px; border-radius:6px; border:1px solid rgba(255,255,255,0.15); background:#0a0f1a; color:#fff;';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.textContent = '+';
        addBtn.className = 'admin-btn admin-btn-sm';
        addBtn.style.cssText = 'padding:4px 8px; font-size:12px; flex-shrink:0;';

        let confirmed = false;
        const commit = function () {
            if (confirmed) return;
            const name = input.value.trim();
            if (!name) return;
            confirmed = true;
            confirmFaceWithName(name, detection.descriptor);
            row.outerHTML = `<div style="font-size:11px; text-align:center; color: var(--muted);">✓ ট্যাগ হয়েছে: <b style="color:var(--gold);">${name}</b></div>`;
        };

        addBtn.addEventListener('click', commit);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(); } });

        row.appendChild(input);
        row.appendChild(addBtn);
        return row;
    }

    async function runFaceDetectTest() {
        const btn = document.getElementById('faceDetectTestBtn');
        const statusEl = document.getElementById('faceDetectStatus');
        const resultsEl = document.getElementById('faceDetectResults');
        const imgEl = document.getElementById('tagPreviewImg');

        if (!btn || !statusEl || !resultsEl || !imgEl || !imgEl.src) return;

        if (typeof faceapi === 'undefined') {
            statusEl.textContent = '⚠️ face-api.js লাইব্রেরি লোড হয়নি, একটু পর আবার চেষ্টা করো';
            return;
        }

        btn.disabled = true;
        resultsEl.innerHTML = '';
        statusEl.textContent = '⏳ প্রসেসিং শুরু হচ্ছে...';

        const ok = await ensureModelsLoaded(statusEl);
        if (!ok) { btn.disabled = false; return; }

        statusEl.textContent = '⏳ চেনা মুখগুলো লোড হচ্ছে...';
        await loadKnownFaces();

        statusEl.textContent = '⏳ মুখ খোঁজা হচ্ছে... (গ্রুপ ফটোতে কয়েক সেকেন্ড লাগতে পারে)';
        try {
            const detections = await detectFacesWithDescriptors(imgEl);

            if (!detections || detections.length === 0) {
                statusEl.textContent = 'কোনো মুখ পাওয়া যায়নি 😕';
            } else {
                statusEl.textContent = detections.length + ' টা মুখ পাওয়া গেছে ✓';
                detections.forEach(function (det) {
                    resultsEl.appendChild(buildFaceCard(imgEl, det));
                });
            }
        } catch (err) {
            console.error('Face detection error:', err);
            statusEl.textContent = '⚠️ ডিটেকশনে সমস্যা হয়েছে, কনসোলে দেখো';
        }

        btn.disabled = false;
    }

    async function onPhotoUploadedForFaceLearning(photo) {
        if (!photo.pendingFaceLearning || photo.pendingFaceLearning.length === 0) return;
        for (const entry of photo.pendingFaceLearning) {
            try {
                const res = await fetch(APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        password: ADMIN_PASSWORD,
                        action: 'saveFaceDescriptor',
                        name: entry.name,
                        descriptor: entry.descriptor
                    })
                });
                const data = await res.json();

                if (data && data.success) {
                    knownFaces.push({
                        name: entry.name,
                        descriptor: new Float32Array(entry.descriptor)
                    });
                }
            } catch (err) {
                console.error('Face descriptor save failed:', err);
            }
        }
    }

    window.onPhotoUploadedForFaceLearning = onPhotoUploadedForFaceLearning;

    (function bindFaceDetectButton() {
        const btn = document.getElementById('faceDetectTestBtn');
        if (btn) btn.addEventListener('click', runFaceDetectTest);
    })();
})();
