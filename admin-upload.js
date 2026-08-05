/* ============================================================
   admin-upload.js
   Photo Gallery Admin: Upload + Face-Tag flow for Tonir Shaik's
   gallery site. Loaded by index.html via <script src="admin-upload.js">.
   Depends on globals already defined in index.html's main script:
   csvUrl, APPS_SCRIPT_URL, allPhotos, applyFiltersAndSearch,
   buildStrip, parsePhotoFile, fetchLiveUploads, buildMergedPhotoList,
   dlImg, shareImg.
   face-api.js and face-recognition.js are NOT loaded by index.html
   anymore — this file lazy-loads them itself (see ensureFaceScriptsLoaded)
   the moment the admin reaches the photo-tagging step, so regular
   visitors never download that ML library.
   ============================================================ */
(function () {
    let ADMIN_PASSWORD = '';

    // 🆕 Google Apps Script কখনো কখনো (cold start-এ) অনেক দেরি করে বা
    // hang করে থাকে — তাই টাইমআউট সহ fetch (ডিফল্ট ৮ সেকেন্ড), যাতে
    // admin-এর কোনো action অনির্দিষ্টকাল "Checking..."/"Loading..."-এ
    // আটকে না থাকে। ব্যবহারের ধরন fetch()-এর মতোই।
    function fetchWithTimeout(url, options, timeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs || 8000);
        const opts = Object.assign({}, options, { signal: controller.signal });
        return fetch(url, opts).finally(() => clearTimeout(timer));
    }

    // 🆕 Apps Script-এর exec URL POST করলে ভেতরে ভেতরে একটা 302
    // রিডাইরেক্ট (script.googleusercontent.com-এ) হয়, যেটা fetch()
    // ঠিকভাবে handle করে কিন্তু বড় base64 body (কয়েক MB ছবি) নিয়ে
    // XMLHttpRequest-এ মাঝেমধ্যে ফেইল করে — তাই Drive route-এর আসল
    // request আগের মতোই fetchWithTimeout (fetch-ভিত্তিক, বিশ্বস্ত)
    // দিয়ে যায়। real byte-progress এখানে পাওয়া যায় না বলে bar-টা
    // এই simulated ease-এর মাধ্যমে আস্তে আস্তে ~৯০% পর্যন্ত ভরতে
    // থাকে, তারপর আসল response এলে ১০০%-এ snap করে।
    function fetchWithSimulatedProgress(url, options, timeoutMs, onProgress) {
        return new Promise((resolve) => {
            let simulated = 0;
            const timer = setInterval(() => {
                simulated += (0.9 - simulated) * 0.12;
                if (onProgress) onProgress(Math.min(simulated, 0.9));
            }, 150);

            fetchWithTimeout(url, options, timeoutMs)
                .then(r => r.json())
                .then(res => {
                    clearInterval(timer);
                    if (onProgress) onProgress(1);
                    resolve(res);
                })
                .catch(() => {
                    clearInterval(timer);
                    if (onProgress) onProgress(1);
                    resolve({ success: false, error: 'Network error' });
                });
        });
    }

    // ImgBB আপলোড আলাদা ডোমেইনে (api.imgbb.com) সরাসরি FormData POST,
    // কোনো Apps Script রিডাইরেক্ট নেই — এখানে XMLHttpRequest নিরাপদ,
    // তাই এই রুটে আসল xhr.upload.onprogress ব্যবহার করা হয়।
    function postWithProgress(url, bodyObj, timeoutMs, onProgress) {
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = timeoutMs || 30000;
            xhr.upload.onprogress = function (e) {
                if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
            };
            xhr.onload = function () {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch (e) { resolve({ success: false, error: 'Bad response' }); }
            };
            xhr.onerror = function () { resolve({ success: false, error: 'Network error' }); };
            xhr.ontimeout = function () { resolve({ success: false, error: 'Timeout' }); };
            xhr.send(JSON.stringify(bodyObj));
        });
    }

    document.getElementById('navGalleryLink').addEventListener('click', (e) => {
        e.preventDefault();
        adminLockOverlay.classList.add('open');
        adminPasswordInput.value = '';
        adminPasswordInput.type = 'password';
        pwEyeIconOpen.style.display = 'none';
        pwEyeIconClosed.style.display = 'flex';
        adminLockMsg.textContent = '';
        adminUnlockBtn.style.display = 'none';
        adminPasswordInput.focus();
    });

    const adminLockOverlay  = document.getElementById('adminLockOverlay');
    const adminLockClose    = document.getElementById('adminLockClose');
    const adminPasswordInput= document.getElementById('adminPasswordInput');
    const adminUnlockBtn    = document.getElementById('adminUnlockBtn');
    const adminLockMsg      = document.getElementById('adminLockMsg');
    const pwEyeBtn          = document.getElementById('pwEyeBtn');
    const pwEyeIconOpen     = document.getElementById('pwEyeIconOpen');
    const pwEyeIconClosed   = document.getElementById('pwEyeIconClosed');

    const adminUploadOverlay= document.getElementById('adminUploadOverlay');
    const adminUploadClose  = document.getElementById('adminUploadClose');
    const adminFileInput    = document.getElementById('adminFileInput');
    const adminStartTagBtn  = document.getElementById('adminStartTagBtn');
    const adminPickMsg      = document.getElementById('adminPickMsg');
    const uploadThumbs      = document.getElementById('uploadThumbs');
    const uploadStepPick    = document.getElementById('uploadStepPick');
    const uploadStepTag     = document.getElementById('uploadStepTag');
    const uploadStepUploading = document.getElementById('uploadStepUploading');
    const tagPreviewImg     = document.getElementById('tagPreviewImg');
    const tagCategoryRow    = document.getElementById('tagCategoryRow');
    const tagFacesList      = document.getElementById('tagFacesList');
    const tagQuickAddInput  = document.getElementById('tagQuickAddInput');
    const tagQuickAddBtn    = document.getElementById('tagQuickAddBtn');
    const tagPrevBtn        = document.getElementById('tagPrevBtn');
    const tagNextBtn        = document.getElementById('tagNextBtn');
    const tagProgressFill   = document.getElementById('tagProgressFill');
    const tagPhotoNum       = document.getElementById('tagPhotoNum');
    const tagPhotoTotal     = document.getElementById('tagPhotoTotal');
    const uploadProgressFill= document.getElementById('uploadProgressFill');
    const uploadDoneCount   = document.getElementById('uploadDoneCount');
    const uploadTotalCount  = document.getElementById('uploadTotalCount');
    const adminUploadMsg    = document.getElementById('adminUploadMsg');

    let uploadPeople = [];
    let selectedPhotos = [];
    let currentTagIdx = 0;

    // 🆕 Single/Dual/Group ক্যাটাগরি — ব্যাকএন্ড এখন এর জন্য আলাদা native
    // "cat" ফিল্ড সাপোর্ট করে (caption/names থেকে সম্পূর্ণ আলাদা), তাই
    // uploadOnePhoto() / saveCurrentEditTagPhoto()-এ সরাসরি `cat: ...`
    // হিসেবে পাঠানো হয় — caption টেক্সটে কোনো মার্কার জুড়তে হয় না।
    function suggestCategoryFromCount(count) {
        if (count >= 3) return 'group';
        if (count === 2) return 'dual';
        return 'single';
    }
    function setPhotoCategory(photo, cat, manual) {
        photo.category = cat;
        if (manual) photo.categoryManual = true;
    }

    // face-api.js (~ a few hundred KB) and face-recognition.js are only
    // needed for the admin face-tagging step, so they're fetched on demand
    // here instead of being loaded by every regular visitor on every page view.
    let faceScriptsState = 'idle'; // idle | loading | ready
    let faceApiReadyCallbacks = [];
    function ensureFaceScriptsLoaded(onReady) {
        if (faceScriptsState === 'ready') {
            if (onReady) onReady();
            return;
        }
        if (onReady) faceApiReadyCallbacks.push(onReady);
        if (faceScriptsState === 'loading') return;
        faceScriptsState = 'loading';

        const faceApiScript = document.createElement('script');
        faceApiScript.src = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js';
        faceApiScript.onload = function () {
            const faceRecScript = document.createElement('script');
            faceRecScript.src = 'face-recognition.js';
            faceRecScript.onload = function () {
                faceScriptsState = 'ready';
                faceApiReadyCallbacks.forEach(function (cb) { cb(); });
                faceApiReadyCallbacks = [];
            };
            faceRecScript.onerror = function () { faceScriptsState = 'idle'; };
            document.body.appendChild(faceRecScript);
        };
        faceApiScript.onerror = function () { faceScriptsState = 'idle'; };
        document.body.appendChild(faceApiScript);
    }

    function resetUploadFlow() {
        selectedPhotos = [];
        uploadPeople = [];
        currentTagIdx = 0;
        adminFileInput.value = '';
        uploadThumbs.innerHTML = '';
        adminStartTagBtn.disabled = true;
        adminPickMsg.textContent = '';
        adminPickMsg.className = 'admin-msg';
        uploadStepPick.style.display = 'block';
        uploadStepTag.style.display = 'none';
        uploadStepUploading.style.display = 'none';
        const destDriveRadio = document.getElementById('destDriveRadio');
        if (destDriveRadio) destDriveRadio.checked = true; // ডিফল্ট সবসময় Google Drive
    }

    // "Destination: Google Drive / ImgBB + GitHub" রেডিও থেকে বর্তমান
    // সিলেকশন পড়ে — এটা শুধু শেষ upload ধাপে (uploadOnePhoto) কাজে
    // লাগে, বাকি পুরো ফ্লো (পিক করা, ফেস-ট্যাগিং) দুটোর জন্যই একই।
    function getUploadDestination() {
        const checked = document.querySelector('input[name="uploadDest"]:checked');
        return checked ? checked.value : 'drive';
    }

    adminLockClose.addEventListener('click', () => adminLockOverlay.classList.remove('open'));
    adminLockOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) adminLockOverlay.classList.remove('open');
    });

    function tryUnlock() {
        const entered = adminPasswordInput.value;
        adminUnlockBtn.disabled = true;
        adminLockMsg.textContent = 'Checking...';
        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ password: entered, action: 'verify' })
        })
        .then(r => r.json())
        .then(res => {
            adminUnlockBtn.disabled = false;
            if (res.success) {
                ADMIN_PASSWORD = entered;
                window.ADMIN_PASSWORD = entered; // face-recognition.js এর জন্য
                adminLockOverlay.classList.remove('open');
                resetUploadFlow();
                adminUploadOverlay.classList.add('open');
                document.body.classList.add('admin-mode');
            } else {
                adminLockMsg.textContent = res.error || 'Wrong password';
            }
        })
        .catch(() => {
            adminUnlockBtn.disabled = false;
            adminLockMsg.textContent = 'Network error, try again';
        });
    }
    adminUnlockBtn.addEventListener('click', tryUnlock);
    adminPasswordInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

    pwEyeBtn.addEventListener('click', () => {
        const showing = adminPasswordInput.type === 'text';
        adminPasswordInput.type = showing ? 'password' : 'text';
        pwEyeIconOpen.style.display = showing ? 'none' : 'flex';
        pwEyeIconClosed.style.display = showing ? 'flex' : 'none';
        pwEyeBtn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        adminPasswordInput.focus();
    });

    adminPasswordInput.addEventListener('input', () => {
        adminLockMsg.textContent = '';
        adminUnlockBtn.style.display = adminPasswordInput.value.length > 0 ? 'block' : 'none';
    });

    adminUploadClose.addEventListener('click', () => {
        adminUploadOverlay.classList.remove('open');
        resetUploadFlow();
    });
    adminUploadOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            adminUploadOverlay.classList.remove('open');
            resetUploadFlow();
        }
    });

    // NOTE: We used to run every photo through compressImage() (canvas resize
    // to 1600px + 82% JPEG quality) before upload. That meant the ORIGINAL
    // file was thrown away the moment it was selected — Drive only ever
    // stored the compressed version, so there was no way to serve a true
    // original later, including from the Download button. prepareFile now
    // just reads the file's raw bytes as-is, so whatever the admin uploads
    // (a 3MB photo, etc.) is exactly what ends up on Drive and in downloads.
    function prepareFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ base64: reader.result, mime: file.type || 'image/jpeg' });
            reader.onerror = () => reject(new Error('file-read-failed'));
            reader.readAsDataURL(file);
        });
    }

    function renderUploadThumbs() {
        uploadThumbs.innerHTML = '';
        selectedPhotos.forEach((photo, idx) => {
            const div = document.createElement('div');
            div.className = 'upload-thumb';
            div.innerHTML = `
                <img src="${photo.base64}" alt="">
                <button type="button" class="thumb-remove" title="Remove">×</button>
            `;
            div.querySelector('.thumb-remove').addEventListener('click', () => {
                selectedPhotos.splice(idx, 1);
                renderUploadThumbs();
                adminStartTagBtn.disabled = selectedPhotos.length === 0;
            });
            uploadThumbs.appendChild(div);
        });
    }

    adminFileInput.addEventListener('change', () => {
        const files = Array.from(adminFileInput.files || []);
        if (files.length === 0) return;

        adminStartTagBtn.disabled = true;
        adminPickMsg.textContent = `Preparing ${files.length} photo(s)...`;
        adminPickMsg.className = 'admin-msg';

        Promise.all(files.map(file =>
            prepareFile(file)
                .then(({ base64, mime }) => ({ base64, mime, name: file.name, tagIdxs: new Set(), category: 'single', categoryManual: false }))
                .catch(() => null)
        )).then(results => {
            const ok = results.filter(Boolean);
            selectedPhotos = selectedPhotos.concat(ok);
            renderUploadThumbs();
            adminFileInput.value = '';
            adminStartTagBtn.disabled = selectedPhotos.length === 0;
            const failed = results.length - ok.length;
            adminPickMsg.textContent = failed > 0
                ? `❌ ${failed} photo(s) couldn't be read, the rest are ready`
                : (selectedPhotos.length ? `✅ ${selectedPhotos.length} photo(s) ready` : '');
            adminPickMsg.className = failed > 0 ? 'admin-msg err' : 'admin-msg ok';
        });
    });

    function addUploadPerson(rawName) {
        const name = (rawName || '').trim();
        if (!name) return null;
        const existingIdx = uploadPeople.findIndex(p => p.toLowerCase() === name.toLowerCase());
        if (existingIdx !== -1) return existingIdx;
        if (uploadPeople.length >= 20) {
            adminUploadMsg.textContent = 'You can add a maximum of 20 names';
            adminUploadMsg.className = 'admin-msg err';
            return null;
        }
        uploadPeople.push(name);
        return uploadPeople.length - 1;
    }

    function tagFaceForCurrentPhoto(name, descriptor) {
        const idx = addUploadPerson(name);
        if (idx === null) return;
        const photo = selectedPhotos[currentTagIdx];
        photo.tagIdxs.add(idx);
        if (!photo.categoryManual) setPhotoCategory(photo, suggestCategoryFromCount(photo.tagIdxs.size), false);
        renderTagFaces();
        renderTagCategoryButtons();

        photo.pendingFaceLearning = photo.pendingFaceLearning || [];
        photo.pendingFaceLearning.push({ name: name, descriptor: Array.from(descriptor) });
    }
    window.tagFaceForCurrentPhoto = tagFaceForCurrentPhoto;

    function removeUploadPerson(idx) {
        uploadPeople.splice(idx, 1);
        selectedPhotos.forEach(photo => {
            const newSet = new Set();
            photo.tagIdxs.forEach(i => {
                if (i === idx) return;
                newSet.add(i > idx ? i - 1 : i);
            });
            photo.tagIdxs = newSet;
        });
        renderTagFaces();
    }

    function renderTagFaces() {
        const photo = selectedPhotos[currentTagIdx];
        tagFacesList.innerHTML = '';
        if (uploadPeople.length === 0) {
            tagFacesList.innerHTML = '<div class="tag-faces-empty">No names added yet — type a name below and tap + Add</div>';
            return;
        }
        uploadPeople.forEach((name, idx) => {
            const checked = photo.tagIdxs.has(idx);
            const row = document.createElement('div');
            row.className = 'tag-face-check' + (checked ? ' checked' : '');
            row.innerHTML = `
                <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer; margin:0; min-width:0;">
                    <input type="checkbox" ${checked ? 'checked' : ''}> <span class="tag-face-name">${name}</span>
                </label>
                <button type="button" class="tag-face-edit-btn" title="এই নামটি ঠিক করো"><svg class="svg-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path d="M352.9 21.2L308 66.1 445.9 204 490.8 159.1C504.4 145.6 512 127.2 512 108s-7.6-37.6-21.2-51.1L455.1 21.2C441.6 7.6 423.2 0 404 0s-37.6 7.6-51.1 21.2zM274.1 100L58.9 315.1c-10.7 10.7-18.5 24.1-22.6 38.7L.9 481.6c-2.3 8.3 0 17.3 6.2 23.4s15.1 8.5 23.4 6.2l127.8-35.5c14.6-4.1 27.9-11.8 38.7-22.6L412 237.9 274.1 100z"/></svg></button>
                <button type="button" class="thumb-remove" title="Remove this name" style="position:static; flex-shrink:0;">×</button>
            `;
            row.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) photo.tagIdxs.add(idx);
                else photo.tagIdxs.delete(idx);
                row.classList.toggle('checked', e.target.checked);
                if (!photo.categoryManual) setPhotoCategory(photo, suggestCategoryFromCount(photo.tagIdxs.size), false);
                renderTagCategoryButtons();
            });
            row.querySelector('.tag-face-edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                startRenameUploadTagRow(row, idx);
            });
            row.querySelector('.thumb-remove').addEventListener('click', () => removeUploadPerson(idx));
            tagFacesList.appendChild(row);
        });
    }

    function startRenameUploadTagRow(row, idx) {
        const oldName = uploadPeople[idx];
        const wrap = document.createElement('div');
        wrap.className = 'tag-face-rename-row';
        wrap.innerHTML = `
            <input type="text" class="tag-face-rename-input" value="${oldName.replace(/"/g, '&quot;')}">
            <button type="button" class="tag-face-rename-save" title="Save"><svg class="svg-icon" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg"><path d="M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z"/></svg></button>
            <button type="button" class="tag-face-rename-cancel" title="Cancel"><svg class="svg-icon" viewBox="0 0 384 512" xmlns="http://www.w3.org/2000/svg"><path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"/></svg></button>
        `;
        row.innerHTML = '';
        row.appendChild(wrap);
        const input = wrap.querySelector('.tag-face-rename-input');
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim();
            if (!newName || newName === oldName) { renderTagFaces(); return; }
            const dupIdx = uploadPeople.findIndex((p, i) => i !== idx && p.toLowerCase() === newName.toLowerCase());
            if (dupIdx !== -1) {
                adminUploadMsg.textContent = 'এই নামটি আগে থেকেই তালিকায় আছে।';
                adminUploadMsg.className = 'admin-msg err';
                renderTagFaces();
                return;
            }
            uploadPeople[idx] = newName;
            renderTagFaces();
        };
        const cancel = () => renderTagFaces();

        wrap.querySelector('.tag-face-rename-save').addEventListener('click', (e) => { e.stopPropagation(); commit(); });
        wrap.querySelector('.tag-face-rename-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('click', (e) => e.stopPropagation());
    }

    // ছবিটাতে কয়জন মানুষ আছে সেই অনুযায়ী Single/Dual/Group বাটন
    // হাইলাইট করে — ফেস-ট্যাগের সংখ্যা থেকে অটো-সাজেস্ট হয় (উপরে
    // suggestCategoryFromCount), কিন্তু admin চাইলে যেকোনো সময় নিজে
    // ক্লিক করে বদলে দিতে পারে (তখন categoryManual = true হয়ে যায়,
    // আর অটো-সাজেশন আর ওভাররাইট করবে না)।
    if (tagCategoryRow) {
        tagCategoryRow.querySelectorAll('.tag-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const photo = selectedPhotos[currentTagIdx];
                if (!photo) return;
                setPhotoCategory(photo, btn.dataset.cat, true);
                renderTagCategoryButtons();
            });
        });
    }
    function renderTagCategoryButtons() {
        if (!tagCategoryRow) return;
        const photo = selectedPhotos[currentTagIdx];
        const current = photo ? photo.category : null;
        tagCategoryRow.querySelectorAll('.tag-cat-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.cat === current);
        });
    }

    function showTagStep(idx) {
        currentTagIdx = idx;
        const photo = selectedPhotos[idx];
        tagPreviewImg.src = photo.base64;
        tagPhotoNum.textContent = idx + 1;
        tagPhotoTotal.textContent = selectedPhotos.length;
        tagProgressFill.style.width = ((idx + 1) / selectedPhotos.length * 100) + '%';
        tagPrevBtn.disabled = idx === 0;
        tagNextBtn.textContent = (idx === selectedPhotos.length - 1) ? 'Upload All ✓' : 'Next →';
        renderTagCategoryButtons();

        const faceResultsEl = document.getElementById('faceDetectResults');
        const faceStatusEl = document.getElementById('faceDetectStatus');
        const faceBtn = document.getElementById('faceDetectTestBtn');
        if (faceResultsEl) faceResultsEl.innerHTML = '';
        if (faceStatusEl) faceStatusEl.textContent = '';
        if (faceBtn) {
            faceBtn.disabled = true;
            ensureFaceScriptsLoaded(function () { faceBtn.disabled = false; });
        }

        renderTagFaces();
    }

    function quickAddTagPerson() {
        const rawName = (tagQuickAddInput.value || '').trim();
        const idx = addUploadPerson(rawName);
        if (idx === null) return;
        const photo = selectedPhotos[currentTagIdx];
        photo.tagIdxs.add(idx);

        if (!isBanglaText(rawName)) {
            const banglaName = banglaPhonetic(rawName);
            if (banglaName && banglaName.toLowerCase() !== rawName.toLowerCase()) {
                const bIdx = addUploadPerson(banglaName);
                if (bIdx !== null) photo.tagIdxs.add(bIdx);
            }
        }

        if (!photo.categoryManual) setPhotoCategory(photo, suggestCategoryFromCount(photo.tagIdxs.size), false);

        tagQuickAddInput.value = '';
        adminUploadMsg.textContent = '';
        renderTagFaces();
        renderTagCategoryButtons();
        tagQuickAddInput.focus();
    }
    tagQuickAddBtn.addEventListener('click', quickAddTagPerson);
    tagQuickAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAddTagPerson(); });

    tagPrevBtn.addEventListener('click', () => {
        if (currentTagIdx > 0) showTagStep(currentTagIdx - 1);
    });

    adminStartTagBtn.addEventListener('click', () => {
        if (selectedPhotos.length === 0) return;
        uploadStepPick.style.display = 'none';
        uploadStepTag.style.display = 'block';
        showTagStep(0);
    });

    // 🆕 delete-এর পরও এখন upload-এর মতোই একটা bust=true (cache-busting)
    // গ্যালারি রিফ্রেশ ট্রিগার করা হয় (নিচের refreshGalleryWithLiveUploads),
    // শুধু admin-এর নিজের `allPhotos.filter(...)` স্প্লাইসের উপর ভরসা না
    // করে। এতে দুটো সুবিধা: (১) যদি ব্যাকএন্ডের delete action-ও Drive
    // export/GitHub commit করে, admin নিজে সত্যিকারের আপডেটেড merged
    // লিস্টটাই দেখবে (স্টেল লোকাল স্টেট না); (২) কয়েকবার রিট্রাই
    // (৩০s ধরে ৫s পরপর, GALLERY_EXPORT_RAW_URL-এর bust query param দিয়ে)
    // GitHub-এর raw.githubusercontent.com CDN cache বাইপাস করার চেষ্টা
    // করে যাতে সম্ভব হলে দ্রুত সাড়া মেলে।
    // ⚠️ সীমাবদ্ধতা: এটা শুধু admin-এর নিজের ব্রাউজারের রিফ্রেশ দ্রুত
    // করে। সাধারণ ভিজিটররা এখনো GALLERY_EXPORT_RAW_URL-এর সাধারণ
    // (bust ছাড়া) fetch ব্যবহার করে, যেটা backend-এর periodic export
    // trigger (কমেন্ট অনুযায়ী প্রতি ~১৫ মিনিটে) আর GitHub-এর নিজস্ব CDN
    // cache propagation-এর উপর নির্ভরশীল — এই ফ্রন্টএন্ড ফাইল থেকে সেই
    // ১০-১৫ মিনিট delay সম্পূর্ণ দূর করা যায় না, কারণ সেটা Apps
    // Script (Code.gs)-এর export trigger interval-এ ঠিক করতে হবে।
    function deletePhotoConfirm(fileId, btnEl, accountId) {
        if (!confirm('Are you sure you want to permanently delete this photo?')) return;

        const item = btnEl.closest('.photo-item, .strip-item');
        if (item) item.style.opacity = '0.4';
        btnEl.disabled = true;

        // 🆕 timeout ৩০ সেকেন্ডে বাড়ানো হলো (আগে ডিফল্ট ৮s ছিল) — নতুন
        // backend-এ delete request এখন synchronous GitHub export/commit
        // শেষ না হওয়া পর্যন্ত অপেক্ষা করে (সাধারণত ২-৫s, কিন্তু lock
        // wait/retry/cold-start মিলিয়ে মাঝেমধ্যে ৮s পার হয়ে যেতে পারে) —
        // ৮s টাইমআউটে request abort হয়ে ভুলভাবে "Network error" দেখাত,
        // অথচ backend-এ delete আসলে সফলই হয়ে যেত।
        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'delete',
                fileId: fileId,
                accountId: accountId || 'self'
            })
        }, 30000)
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                allPhotos = allPhotos.filter(p => p.fileId !== fileId);
                currentList = currentList.filter(p => p.fileId !== fileId);
                if (item) item.remove();
                const countEl = document.getElementById('photoCount');
                if (countEl) {
                    const n = parseInt(countEl.textContent, 10);
                    if (!isNaN(n) && n > 0) countEl.textContent = n - 1;
                }
                refreshGalleryWithLiveUploads(6, { fileId: fileId });
            } else {
                if (item) item.style.opacity = '1';
                btnEl.disabled = false;
                alert('Delete failed: ' + (res.error || 'Unknown error'));
            }
        })
        .catch(() => {
            if (item) item.style.opacity = '1';
            btnEl.disabled = false;
            alert('Network error, please try again');
        });
    }

    window.deletePhotoConfirm = deletePhotoConfirm;

    function deleteTextPhotoConfirm(rawUrl, btnEl) {
        if (!confirm('Are you sure you want to permanently delete this photo? (removes it from the source file)')) return;

        const item = btnEl.closest('.photo-item, .strip-item');
        if (item) item.style.opacity = '0.4';
        btnEl.disabled = true;

        // 🆕 একই কারণে (উপরে deletePhotoConfirm দেখো) এখানেও timeout
        // ৮s থেকে বাড়িয়ে ৩০s করা হলো।
        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'deleteText',
                url: rawUrl
            })
        }, 30000)
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                allPhotos = allPhotos.filter(p => p.rawUrl !== rawUrl);
                currentList = currentList.filter(p => p.rawUrl !== rawUrl);
                if (item) item.remove();
                const countEl = document.getElementById('photoCount');
                if (countEl) {
                    const n = parseInt(countEl.textContent, 10);
                    if (!isNaN(n) && n > 0) countEl.textContent = n - 1;
                }
                refreshGalleryWithLiveUploads(6, { rawUrl: rawUrl });
            } else {
                if (item) item.style.opacity = '1';
                btnEl.disabled = false;
                alert('Delete failed: ' + (res.error || 'Unknown error'));
            }
        })
        .catch(() => {
            if (item) item.style.opacity = '1';
            btnEl.disabled = false;
            alert('Network error, please try again');
        });
    }
    window.deleteTextPhotoConfirm = deleteTextPhotoConfirm;

    // 🆕 MULTI-SELECT: index.html-এর "Delete selected" বাল্ক বাটন এটা কল
    // করে। photos array-এর প্রতিটা আইটেম Drive/ImgBB (p.fileId থাকলে)
    // অথবা legacy GitHub text-file (p.rawUrl) — দুটোই এক request-এই
    // ব্যাকএন্ডের নতুন `deleteMultiple` action-এ পাঠানো হয় (দেখো Code.gs),
    // যেটা প্রতিটা ছবি আলাদাভাবে ডিলিট করে কিন্তু GitHub export/commit
    // শুধু ব্যাচ শেষে একবারই করে — তাই একসাথে অনেকগুলো ডিলিট করলেও
    // অনেকগুলো আলাদা GitHub commit হয় না।
    // আংশিক ব্যর্থতা (কিছু ছবি ডিলিট হলো, কিছু হলো না) হ্যান্ডল করা হয়:
    // res.failed-এ যেগুলো ব্যর্থ হয়েছে তা বাদ দিয়ে বাকিগুলো optimistically
    // allPhotos/UI থেকে সরানো হয়, তারপর refreshGalleryWithLiveUploads()
    // দিয়ে সার্ভারের আসল অবস্থা দিয়ে নিশ্চিত করা হয় (ঠিক single-delete-এর
    // মতোই)।
    function deleteMultipleConfirm(photos, btnEl, onDone) {
        if (!photos || photos.length === 0) return;

        const items = photos.map(p => p.fileId
            ? { fileId: p.fileId, accountId: p.acc || 'self' }
            : { rawUrl: p.rawUrl });

        if (btnEl) btnEl.disabled = true;

        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'deleteMultiple',
                items: items
            })
        }, 60000)
        .then(r => r.json())
        .then(res => {
            if (btnEl) btnEl.disabled = false;

            const failedFileIds = new Set((res.failed || []).filter(f => f.fileId).map(f => f.fileId));
            const failedRawUrls = new Set((res.failed || []).filter(f => f.rawUrl).map(f => f.rawUrl));

            const deletedKeys = new Set();
            photos.forEach(p => {
                const failed = p.fileId ? failedFileIds.has(p.fileId) : failedRawUrls.has(p.rawUrl);
                if (!failed) deletedKeys.add(p.fileId ? ('f:' + p.fileId) : ('u:' + p.rawUrl));
            });

            if (deletedKeys.size > 0) {
                allPhotos = allPhotos.filter(p => !deletedKeys.has(p.fileId ? ('f:' + p.fileId) : ('u:' + p.rawUrl)));
                allPhotos.forEach((p, i) => { p.idx = i; });
                currentList = allPhotos;
                const countEl = document.getElementById('photoCount');
                if (countEl) countEl.textContent = allPhotos.length;
                applyFiltersAndSearch();
                refreshGalleryWithLiveUploads(6);
            }

            if (res.failed && res.failed.length > 0) {
                alert((res.failed.length) + 'টা ছবি ডিলিট ব্যর্থ হয়েছে, বাকিগুলো ডিলিট হয়ে গেছে।');
            }

            if (onDone) onDone();
        })
        .catch(() => {
            if (btnEl) btnEl.disabled = false;
            alert('Network error, please try again');
        });
    }
    window.deleteMultipleConfirm = deleteMultipleConfirm;

    const PHONETIC_CONSONANTS = [
        ['kkh','ক্ষ'], ['kh','খ'], ['k','ক'],
        ['gh','ঘ'], ['g','গ'], ['ng','ঙ'],
        ['chh','ছ'], ['ch','চ'],
        ['jh','ঝ'], ['j','জ'], ['z','জ'],
        ['th','থ'], ['t','ত'],
        ['dh','ধ'], ['d','দ'],
        ['n','ন'],
        ['ph','ফ'], ['f','ফ'], ['p','প'],
        ['bh','ভ'], ['v','ভ'], ['b','ব'],
        ['m','ম'],
        ['sh','শ'], ['s','স'],
        ['h','হ'],
        ['r','র'],
        ['l','ল'],
        ['y','য়'],
        ['w','ও']
    ];
    const PHONETIC_VOWELS = [
        ['oi','ঐ','ৈ'], ['ou','ঔ','ৌ'],
        ['ee','ঈ','ী'], ['ii','ঈ','ী'],
        ['oo','ঊ','ূ'], ['uu','ঊ','ূ'],
        ['aa','আ','া'], ['a','আ','া'],
        ['i','ই','ি'],
        ['u','উ','ু'],
        ['e','এ','ে'],
        ['o','ও','']
    ];

    function isBanglaText(s) {
        return /[\u0980-\u09FF]/.test(s);
    }

    function banglaPhonetic(input) {
        const s = (input || '').toLowerCase();
        if (!s) return '';
        let out = '';
        let i = 0;
        let lastWasConsonant = false;
        while (i < s.length) {
            const ch = s[i];
            if (!/[a-z]/.test(ch)) { out += ch; i++; lastWasConsonant = false; continue; }

            let matched = false;
            for (const [pat, standalone, matra] of PHONETIC_VOWELS) {
                if (s.startsWith(pat, i)) {
                    out += lastWasConsonant ? matra : standalone;
                    i += pat.length;
                    lastWasConsonant = false;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;

            for (const [pat, letter] of PHONETIC_CONSONANTS) {
                if (s.startsWith(pat, i)) {
                    out += letter;
                    i += pat.length;
                    lastWasConsonant = true;
                    matched = true;
                    break;
                }
            }
            if (matched) continue;

            out += ch;
            i++;
            lastWasConsonant = false;
        }
        return out;
    }

    const adminEditTagOverlay   = document.getElementById('adminEditTagOverlay');
    const adminEditTagClose     = document.getElementById('adminEditTagClose');
    const editTagPreviewImg     = document.getElementById('editTagPreviewImg');
    const editTagCategoryRow    = document.getElementById('editTagCategoryRow');
    const editTagFacesList      = document.getElementById('editTagFacesList');
    const editTagQuickAddInput  = document.getElementById('editTagQuickAddInput');
    const editTagQuickAddBtn    = document.getElementById('editTagQuickAddBtn');
    const editTagPrevBtn        = document.getElementById('editTagPrevBtn');
    const editTagNextBtn        = document.getElementById('editTagNextBtn');
    const editTagSaveBtn        = document.getElementById('editTagSaveBtn');
    const editTagMsg            = document.getElementById('editTagMsg');
    const editTagProgressText   = document.getElementById('editTagProgressText');

    let editTagPhoto = null;
    let editTagSelected = new Set();
    let editTagList = [];
    let editTagListPos = -1;
    let editTagCategory = 'single';

    if (editTagCategoryRow) {
        editTagCategoryRow.querySelectorAll('.tag-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                editTagCategory = btn.dataset.cat;
                renderEditTagCategoryButtons();
            });
        });
    }
    function renderEditTagCategoryButtons() {
        if (!editTagCategoryRow) return;
        editTagCategoryRow.querySelectorAll('.tag-cat-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.cat === editTagCategory);
        });
    }

    function parseExistingNames(photo) {
        const raw = (photo.names || '').trim();
        if (!raw) return [];
        return photo.fileId
            ? raw.split(',').map(s => s.trim()).filter(Boolean)
            : raw.split(/\s+/).filter(Boolean);
    }

    function serializeNames(namesArr, photo) {
        return photo.fileId ? namesArr.join(', ') : namesArr.join(' ');
    }

    function renderEditTagFaces() {
        editTagFacesList.innerHTML = '';
        if (uploadPeople.length === 0) {
            editTagFacesList.innerHTML = '<div class="tag-faces-empty">No names added yet — type a name below and tap + Add</div>';
            return;
        }
        uploadPeople.forEach((name) => {
            const checked = editTagSelected.has(name.toLowerCase());
            const row = document.createElement('div');
            row.className = 'tag-face-check' + (checked ? ' checked' : '');
            row.innerHTML = `
                <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer; margin:0; min-width:0;">
                    <input type="checkbox" ${checked ? 'checked' : ''}> <span class="tag-face-name">${name}</span>
                </label>
                <button type="button" class="tag-face-edit-btn" title="Edit name"><svg class="svg-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg"><path d="M352.9 21.2L308 66.1 445.9 204 490.8 159.1C504.4 145.6 512 127.2 512 108s-7.6-37.6-21.2-51.1L455.1 21.2C441.6 7.6 423.2 0 404 0s-37.6 7.6-51.1 21.2zM274.1 100L58.9 315.1c-10.7 10.7-18.5 24.1-22.6 38.7L.9 481.6c-2.3 8.3 0 17.3 6.2 23.4s15.1 8.5 23.4 6.2l127.8-35.5c14.6-4.1 27.9-11.8 38.7-22.6L412 237.9 274.1 100z"/></svg></button>
                <button type="button" class="tag-face-delete-btn" title="Delete this tag entirely"><svg class="svg-icon" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg"><path d="M136.7 5.9L128 32 32 32C14.3 32 0 46.3 0 64S14.3 96 32 96l384 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0-8.7-26.1C306.9-7.2 294.7-16 280.9-16L167.1-16c-13.8 0-26 8.8-30.4 21.9zM416 144L32 144 53.1 467.1C54.7 492.4 75.7 512 101 512L347 512c25.3 0 46.3-19.6 47.9-44.9L416 144z"/></svg></button>
            `;
            row.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) editTagSelected.add(name.toLowerCase());
                else editTagSelected.delete(name.toLowerCase());
                row.classList.toggle('checked', e.target.checked);
            });
            row.querySelector('.tag-face-edit-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                startRenameRow(row, name);
            });
            row.querySelector('.tag-face-delete-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteTagEntry(name);
            });
            editTagFacesList.appendChild(row);
        });
    }

    function deleteTagEntry(name) {
        const idx = uploadPeople.findIndex(p => p.toLowerCase() === name.toLowerCase());
        if (idx !== -1) uploadPeople.splice(idx, 1);
        editTagSelected.delete(name.toLowerCase());
        renderEditTagFaces();
    }

    function startRenameRow(row, oldName) {
        const wrap = document.createElement('div');
        wrap.className = 'tag-face-rename-row';
        wrap.innerHTML = `
            <input type="text" class="tag-face-rename-input" value="${oldName.replace(/"/g, '&quot;')}">
            <button type="button" class="tag-face-rename-save" title="Save"><svg class="svg-icon" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg"><path d="M434.8 70.1c14.3 10.4 17.5 30.4 7.1 44.7l-256 352c-5.5 7.6-14 12.3-23.4 13.1s-18.5-2.7-25.1-9.3l-128-128c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0l101.5 101.5 234-321.7c10.4-14.3 30.4-17.5 44.7-7.1z"/></svg></button>
            <button type="button" class="tag-face-rename-cancel" title="Cancel"><svg class="svg-icon" viewBox="0 0 384 512" xmlns="http://www.w3.org/2000/svg"><path d="M55.1 73.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L147.2 256 9.9 393.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192.5 301.3 329.9 438.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.8 256 375.1 118.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192.5 210.7 55.1 73.4z"/></svg></button>
        `;
        row.innerHTML = '';
        row.appendChild(wrap);
        const input = wrap.querySelector('.tag-face-rename-input');
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim();
            if (!newName || newName === oldName) { renderEditTagFaces(); return; }
            const dupIdx = uploadPeople.findIndex(p => p.toLowerCase() === newName.toLowerCase() && p.toLowerCase() !== oldName.toLowerCase());
            if (dupIdx !== -1) {
                editTagMsg.textContent = 'এই নামটি আগে থেকেই তালিকায় আছে।';
                editTagMsg.className = 'admin-msg err';
                renderEditTagFaces();
                return;
            }
            const idx = uploadPeople.findIndex(p => p.toLowerCase() === oldName.toLowerCase());
            if (idx !== -1) uploadPeople[idx] = newName;
            if (editTagSelected.has(oldName.toLowerCase())) {
                editTagSelected.delete(oldName.toLowerCase());
                editTagSelected.add(newName.toLowerCase());
            }
            renderEditTagFaces();
        };
        const cancel = () => renderEditTagFaces();

        wrap.querySelector('.tag-face-rename-save').addEventListener('click', (e) => { e.stopPropagation(); commit(); });
        wrap.querySelector('.tag-face-rename-cancel').addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        });
        input.addEventListener('click', (e) => e.stopPropagation());
    }

    function ensureInPeopleList(name) {
        const idx = uploadPeople.findIndex(p => p.toLowerCase() === name.toLowerCase());
        if (idx !== -1) return uploadPeople[idx];
        uploadPeople.push(name);
        return name;
    }

    function addNameWithPhonetic(rawName) {
        const name = (rawName || '').trim();
        if (!name) return;
        const finalName = ensureInPeopleList(name);
        editTagSelected.add(finalName.toLowerCase());

        if (!isBanglaText(name)) {
            const banglaName = banglaPhonetic(name);
            if (banglaName && banglaName.toLowerCase() !== name.toLowerCase()) {
                const finalBangla = ensureInPeopleList(banglaName);
                editTagSelected.add(finalBangla.toLowerCase());
            }
        }
    }

    function loadEditTagAtPos(pos) {
        const photo = editTagList[pos];
        if (!photo) return;
        editTagListPos = pos;
        editTagPhoto = photo;
        editTagMsg.textContent = '';
        editTagMsg.className = 'admin-msg';
        editTagPreviewImg.src = photo.url;
        editTagQuickAddInput.value = '';

        const existing = parseExistingNames(photo);
        existing.forEach(n => ensureInPeopleList(n));
        editTagSelected = new Set(existing.map(n => n.toLowerCase()));

        editTagCategory = (photo.cat === 'single' || photo.cat === 'dual' || photo.cat === 'group') ? photo.cat : 'single';
        renderEditTagCategoryButtons();
        if (editTagCategoryRow) editTagCategoryRow.style.display = photo.isLive ? 'flex' : 'none';

        renderEditTagFaces();
        if (editTagProgressText) editTagProgressText.textContent = (pos + 1) + ' / ' + editTagList.length;
        editTagPrevBtn.disabled = pos === 0;
        editTagNextBtn.disabled = pos === editTagList.length - 1;
    }

    function openEditTagsByIdx(idx) {
        editTagList = allPhotos.slice().sort((a, b) => a.idx - b.idx);
        const pos = editTagList.findIndex(p => p.idx === idx);
        if (pos === -1) return;
        loadEditTagAtPos(pos);
        adminEditTagOverlay.classList.add('open');
    }
    window.openEditTagsByIdx = openEditTagsByIdx;

    // 🆕 MULTI-SELECT: index.html-এর "Edit tags" বাল্ক বাটন এটা কল করে —
    // openEditTagsByIdx()-এর মতোই একই editTagList/overlay ব্যবহার করে,
    // শুধু allPhotos-এর বদলে শুধু সিলেক্টেড ছবিগুলো দিয়ে list বসানো হয়।
    // Prev/Next/Save লজিক (উপরে) অপরিবর্তিতই কাজ করে, তাই admin এক
    // ছবি থেকে পরেরটায় গিয়ে সবগুলোর ট্যাগ/ক্যাটাগরি একে একে এডিট করতে
    // পারে।
    function openEditTagsForPhotos(photos) {
        if (!photos || photos.length === 0) return;
        editTagList = photos.slice().sort((a, b) => a.idx - b.idx);
        loadEditTagAtPos(0);
        adminEditTagOverlay.classList.add('open');
    }
    window.openEditTagsForPhotos = openEditTagsForPhotos;

    function closeEditTagOverlay() {
        adminEditTagOverlay.classList.remove('open');
        editTagPhoto = null;
        editTagList = [];
        editTagListPos = -1;
        editTagQuickAddInput.value = '';
    }
    adminEditTagClose.addEventListener('click', closeEditTagOverlay);
    adminEditTagOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeEditTagOverlay();
    });

    function quickAddEditTagPerson() {
        const name = (editTagQuickAddInput.value || '').trim();
        if (!name) return;
        if (uploadPeople.length >= 20 && !uploadPeople.some(p => p.toLowerCase() === name.toLowerCase())) {
            editTagMsg.textContent = 'You can add a maximum of 20 names';
            editTagMsg.className = 'admin-msg err';
            return;
        }
        addNameWithPhonetic(name);
        editTagQuickAddInput.value = '';
        editTagMsg.textContent = '';
        renderEditTagFaces();
        editTagQuickAddInput.focus();
    }
    editTagQuickAddBtn.addEventListener('click', quickAddEditTagPerson);
    editTagQuickAddInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') quickAddEditTagPerson(); });

    function saveCurrentEditTagPhoto() {
        if (!editTagPhoto) return Promise.resolve(false);
        const finalNames = uploadPeople.filter(n => editTagSelected.has(n.toLowerCase()));
        const newNamesStr = serializeNames(finalNames, editTagPhoto);
        const photo = editTagPhoto;
        // GitHub-এর পুরনো টেক্সট-ফাইল এন্ট্রি (# single/dual/group হেডার দিয়ে
        // ক্যাটাগরাইজড) থেকে আসা ছবির cat বদলানো এখান থেকে সাপোর্ট করা হয়
        // না — সেগুলোর ক্যাটাগরি হেডার থেকেই ঠিক হয়। শুধু live-upload
        // (photo.isLive — Drive বা ImgBB+GitHub রুটে আপলোড হওয়া, doGet
        // থেকে আসা) ক্ষেত্রে native "cat" ফিল্ড পাঠাই।
        const isLiveUpload = !!photo.isLive;

        editTagSaveBtn.disabled = true;
        editTagPrevBtn.disabled = true;
        editTagNextBtn.disabled = true;
        editTagMsg.textContent = 'Saving...';
        editTagMsg.className = 'admin-msg';

        const payload = photo.fileId
            ? { password: ADMIN_PASSWORD, action: 'updateCaption', fileId: photo.fileId, caption: newNamesStr, cat: isLiveUpload ? editTagCategory : undefined, accountId: photo.acc || 'self' }
            : { password: ADMIN_PASSWORD, action: 'updateText', url: photo.rawUrl, names: newNamesStr };

        // 🆕 একই কারণে (deletePhotoConfirm/deleteTextPhotoConfirm দেখো) timeout
        // ডিফল্ট ৮s থেকে বাড়িয়ে ৩০s করা হলো — Apps Script (backend) মাঝে
        // মাঝে cold start/lock wait-এর কারণে ৮s পার হয়ে যেত, তখন client
        // request abort করে ভুলভাবে "Network error" দেখাত, অথচ backend-এ
        // tag আসলে ঠিকই সফলভাবে সেভ হয়ে যেত।
        return fetchWithTimeout(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) }, 30000)
            .then(r => r.json())
            .then(res => {
                editTagSaveBtn.disabled = false;
                if (res.success) {
                    photo.names = newNamesStr;
                    photo.title = newNamesStr || photo.title;
                    if (isLiveUpload) photo.cat = editTagCategory;
                    const sectionWords = SECTION_SEARCH_WORDS[photo.cat] || [];
                    photo.searchIndex = [newNamesStr, ...sectionWords].join(' ').toLowerCase();
                    editTagMsg.textContent = '✅ Saved';
                    editTagMsg.className = 'admin-msg ok';
                    return true;
                } else {
                    editTagMsg.textContent = 'Save failed: ' + (res.error || 'Unknown error');
                    editTagMsg.className = 'admin-msg err';
                    return false;
                }
            })
            .catch(() => {
                editTagSaveBtn.disabled = false;
                editTagMsg.textContent = 'Network error, please try again';
                editTagMsg.className = 'admin-msg err';
                return false;
            });
    }

    editTagSaveBtn.addEventListener('click', () => {
        saveCurrentEditTagPhoto().then(ok => {
            if (ok) setTimeout(closeEditTagOverlay, 500);
            else { editTagPrevBtn.disabled = editTagListPos === 0; editTagNextBtn.disabled = editTagListPos === editTagList.length - 1; }
        });
    });

    editTagPrevBtn.addEventListener('click', () => {
        if (editTagListPos <= 0) return;
        saveCurrentEditTagPhoto().then(ok => {
            if (ok) loadEditTagAtPos(editTagListPos - 1);
            else { editTagPrevBtn.disabled = false; editTagNextBtn.disabled = editTagListPos === editTagList.length - 1; }
        });
    });

    editTagNextBtn.addEventListener('click', () => {
        if (editTagListPos >= editTagList.length - 1) return;
        saveCurrentEditTagPhoto().then(ok => {
            if (ok) loadEditTagAtPos(editTagListPos + 1);
            else { editTagNextBtn.disabled = false; editTagPrevBtn.disabled = editTagListPos === 0; }
        });
    });

    // 🆕 uploadOnePhoto এখন একটা optional onProgress(fraction 0..1)
    // callback নেয় — Drive route plain fetchWithTimeout-এর বদলে
    // postWithProgress (XMLHttpRequest ভিত্তিক) ব্যবহার করে, যাতে
    // "Uploading..." bar আসল আপলোড অগ্রগতি অনুযায়ী আস্তে আস্তে ভরে,
    // শুধু শেষে হুট করে ১০০% না হয়ে যায়।
    function uploadOnePhoto(photo, onProgress) {
        // caption ফেস-ট্যাগিং ধাপ থেকে তৈরি — Drive আর ImgBB দুটো
        // destination-এর জন্যই ঠিক একই caption/tag ব্যবহার হয়, তাই
        // manual নাম-টাইপ করা আলাদা করে লাগে না ImgBB-র জন্য।
        const caption = Array.from(photo.tagIdxs).map(i => uploadPeople[i]).join(', ');
        const cat = photo.category;

        if (getUploadDestination() === 'imgbb') {
            return uploadOnePhotoToImgbb_(photo, caption, cat, onProgress);
        }

        return fetchWithSimulatedProgress(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                image: photo.base64,
                mimeType: photo.mime,
                filename: photo.name,
                caption: caption,
                cat: cat
            })
        }, 30000, onProgress); // 🆕 বড় ছবির ফাইল আপলোডে বেশি সময় লাগে বলে টাইমআউট ৩০ সেকেন্ড
    }

    // ImgBB route: ছবি → ImgBB (direct link) → সেই link + caption + cat
    // GitHub-এর টেক্সট ফাইলে/imgbb-links.json-এ (addTextLink action দিয়ে)।
    // রিটার্ন-করা shape uploadAllPhotos()-এর জন্য Drive route-এর মতোই
    // { success, accountId, ... } — তাই নিচের progress/face-learning
    // কোডে কোনো বদল লাগে না।
    // ImgBB আপলোড অংশটাকেই মূল progress ধরা হয় (~৯০%), GitHub-এ
    // লিংক লেখার ছোট রিকোয়েস্টটা বাকি ~১০% — শেষে onProgress(1)
    // কল করে bar পুরোপুরি ভরিয়ে দেয়।
    function uploadOnePhotoToImgbb_(photo, caption, cat, onProgress) {
        return uploadToImgbb_(photo.base64, function (frac) {
            if (onProgress) onProgress(frac * 0.9);
        }).then(imgRes => {
            if (!imgRes.success) {
                return { success: false, error: 'ImgBB: ' + imgRes.error };
            }
            return addLinkToGithub_(imgRes.url, imgRes.thumbUrl, caption, cat).then(ghRes => {
                if (onProgress) onProgress(1);
                if (!ghRes || !ghRes.success) {
                    return { success: false, error: 'GitHub: ' + ((ghRes && ghRes.error) || 'unknown error') };
                }
                // ImgBB-uploaded ছবি কোনো Drive account rotation-এর অংশ না,
                // তাই face descriptor সবসময় "self" (Main account)-এর
                // faces-data.json-এ সেভ হয় — doGet() সব account-এর face
                // descriptor মিলিয়েই রিটার্ন করে, তাই matching-এ পার্থক্য হয় না।
                return { success: true, imageUrl: imgRes.url, accountId: 'self' };
            });
        });
    }

    let isUploading = false;
    function uploadAllPhotos() {
        if (isUploading) return;
        isUploading = true;

        uploadStepTag.style.display = 'none';
        uploadStepUploading.style.display = 'block';
        uploadTotalCount.textContent = selectedPhotos.length;
        uploadDoneCount.textContent = 0;
        uploadProgressFill.style.width = '0%';
        adminUploadMsg.textContent = '';
        adminUploadMsg.className = 'admin-msg';

        let done = 0, failed = 0;

        function next(i) {
            if (i >= selectedPhotos.length) {
                adminUploadMsg.textContent = failed === 0
                    ? `✅ All ${done} photo(s) uploaded successfully! It may take a few seconds to appear in the gallery...`
                    : `✅ ${done} succeeded, ❌ ${failed} failed`;
                adminUploadMsg.className = failed === 0 ? 'admin-msg ok' : 'admin-msg err';
                isUploading = false;
                refreshGalleryWithLiveUploads(6);
                setTimeout(() => {
                    adminUploadOverlay.classList.remove('open');
                    resetUploadFlow();
                }, 2500);
                return;
            }
            // 🆕 প্রতিটা ছবির নিজস্ব আপলোড fraction (0..1) সামগ্রিক
            // (done+failed+frac)/total হিসেবে bar-এ প্রতিফলিত হয়, তাই
            // একটা ছবি হলেও (0/1) আপলোড হতে হতে bar আস্তে আস্তে ভরে।
            uploadOnePhoto(selectedPhotos[i], function (frac) {
                const overallPct = ((done + failed) + frac) / selectedPhotos.length * 100;
                uploadProgressFill.style.width = overallPct + '%';
            }).then(res => {
                if (res && res.success) {
                    done++;
                    // ছবিটা আসলে কোন অ্যাকাউন্টে সেভ হলো (self বা কোনো
                    // satellite-এর id) সেটা photo object-এ বসিয়ে দিচ্ছি,
                    // যাতে face-recognition.js এই ছবির face descriptor-ও
                    // একই অ্যাকাউন্টে সেভ করতে পারে (Main-এ না গিয়ে)।
                    selectedPhotos[i].uploadedAccountId = res.accountId || 'self';
                    if (typeof onPhotoUploadedForFaceLearning === 'function') {
                        onPhotoUploadedForFaceLearning(selectedPhotos[i]);
                    }
                } else failed++;
                uploadDoneCount.textContent = done + failed;
                uploadProgressFill.style.width = ((done + failed) / selectedPhotos.length * 100) + '%';
                next(i + 1);
            });
        }
        next(0);
    }

    tagNextBtn.addEventListener('click', () => {
        if (currentTagIdx < selectedPhotos.length - 1) {
            showTagStep(currentTagIdx + 1);
        } else {
            uploadAllPhotos();
        }
    });

    // 🆕 backend-এর export এখন async (upload response-এর ~৩s পর একটা
    // trigger export চালায়, তারপর GitHub commit), আর raw.githubusercontent.com
    // এর নিজস্ব CDN cache-ও (কয়েক সেকেন্ড থেকে কয়েক মিনিট) থাকতে পারে।
    // তাই এখানে (ক) cache-busting query param দিয়ে সেই CDN cache
    // বাইপাস করা হচ্ছে (fetchLiveUploadsOnce(timeout, true)) — সাধারণ
    // ভিজিটরের প্রথম লোডে এটা হয় না, শুধু নিজের upload-এর পরে; আর
    // (খ) রিট্রাই window বাড়ানো হয়েছে (৬ বার, ৫s পরপর = ৩০s) যাতে
    // export + commit শেষ হওয়ার জন্য যথেষ্ট সময় থাকে।
    // 🆕 এখন upload-এর পাশাপাশি delete-এর পরেও (উপরে দুটো
    // deletePhotoConfirm/deleteTextPhotoConfirm ফাংশনে) একই ফাংশন কল
    // করা হয়, যাতে admin এর নিজের ভিউ দ্রুত + সঠিকভাবে merged/আপডেটেড
    // লিস্ট দেখায়, শুধু client-side splice-এর উপর নির্ভর না করে।
    // 🆕 exclude প্যারামিটার যোগ হলো — { fileId } বা { rawUrl } পাঠালে,
    // merge করার পরপরই সেই ছবিটা আবার filter করে বাদ দেওয়া হয়। এটা
    // দরকার কারণ delete-এর পর backend-এর export (GitHub commit) আর
    // GitHub CDN cache আপডেট হতে কিছুটা সময় লাগে — এই কয়েক সেকেন্ড/
    // মিনিটের মধ্যে refresh চললে পুরনো (এখনো delete-না-হওয়া) ডেটাই
    // ফিরে আসতে পারে, আর ওই ছবিটা গ্যালারিতে আবার দেখা যেতে পারে।
    // exclude দিয়ে client-side জোর করে সেটা আটকানো হয়, backend সত্যিই
    // export শেষ না করা পর্যন্ত।
    function refreshGalleryWithLiveUploads(attemptsLeft, exclude) {
        attemptsLeft = (typeof attemptsLeft === 'number') ? attemptsLeft : 0;
        try {
            fetch(csvUrl).then(r => r.text()).catch(() => '').then(textData => {
                const oldPhotos = textData ? parsePhotoFile(textData) : [];
                fetchLiveUploadsOnce(10000, true).then(liveImages => {
                    try {
                        let merged = buildMergedPhotoList(oldPhotos, liveImages || []);
                        if (exclude) {
                            merged = merged.filter(p =>
                                (!exclude.fileId || p.fileId !== exclude.fileId) &&
                                (!exclude.rawUrl || p.rawUrl !== exclude.rawUrl)
                            );
                        }
                        allPhotos = merged;
                        document.getElementById('photoCount').textContent = allPhotos.length;
                        applyFiltersAndSearch();
                        buildStrip(allPhotos);
                    } catch (e) {
                    }
                });
            }).catch(() => {  });
        } catch (e) {  }

        if (attemptsLeft > 0) {
            setTimeout(() => refreshGalleryWithLiveUploads(attemptsLeft - 1, exclude), 5000);
        }
    }

    /* ============================================================
       Storage Accounts panel — একাধিক Gmail/Drive অ্যাকাউন্ট যোগ করে
       ১৪ জিবি ভরে গেলে অটো-রোটেশন সেটআপ।
       ============================================================ */
    const openAccountsBtn      = document.getElementById('openAccountsBtn');
    const adminAccountsOverlay = document.getElementById('adminAccountsOverlay');
    const adminAccountsClose   = document.getElementById('adminAccountsClose');
    const toggleAccountsListBtn = document.getElementById('toggleAccountsListBtn');
    const accountsListEl       = document.getElementById('accountsList');
    const accountsMsgEl        = document.getElementById('accountsMsg');
    const newAccLabelInput     = document.getElementById('newAccLabel');
    const newAccUrlInput       = document.getElementById('newAccUrl');
    const newAccPasswordInput  = document.getElementById('newAccPassword');
    const addAccountBtn        = document.getElementById('addAccountBtn');

    function bytesToGB(n) {
        return (Number(n || 0) / (1024 * 1024 * 1024)).toFixed(2);
    }

    // অ্যাকাউন্ট Remove করার আগে এই কোড চাওয়া হবে — accidental ক্লিকে
    // যাতে অ্যাকাউন্ট ডিলিট হয়ে না যায়।
    const REMOVE_ACCOUNT_CODE = '889900';

    // ব্যবহার কম হলে KB/MB-তে দেখাবে, বড় হলে GB-তে — যাতে "0.00 GB" এর
    // বদলে আসল সংখ্যা (যেমন "36 KB") চোখে পড়ে।
    function formatUsedBytes(n) {
        n = Number(n || 0);
        const KB = 1024, MB = KB * 1024, GB = MB * 1024;
        if (n < MB) return (n / KB).toFixed(n < KB ? 0 : 1) + ' KB';
        if (n < GB) return (n / MB).toFixed(2) + ' MB';
        return (n / GB).toFixed(2) + ' GB';
    }

    function renderAccountsList(accounts) {
        if (!accountsListEl) return;
        if (!accounts || accounts.length === 0) {
            accountsListEl.innerHTML = '<p class="admin-msg">কোনো অ্যাকাউন্ট পাওয়া যায়নি।</p>';
            return;
        }

        // সব অ্যাকাউন্ট মিলিয়ে মোট ব্যবহার + মোট ধারণক্ষমতা — যেমন দুইটা
        // ১৫ জিবি অ্যাকাউন্ট থাকলে এখানে "৩০.০০ GB" মোট ক্যাপাসিটি হিসেবে
        // দেখাবে। এটা শুধুই ডিসপ্লে/সামারি — আসল রাউটিং লজিক (১৪ জিবি
        // ছুঁলে পরের অ্যাকাউন্টে সুইচ) প্রতিটা অ্যাকাউন্টের নিজের হিসাবেই
        // আগের মতো চলবে, এটা বদলাচ্ছে না।
        const totalUsed = accounts.reduce((sum, acc) => sum + Number(acc.usedBytes || 0), 0);
        const totalCapacity = accounts.reduce((sum, acc) => sum + Number(acc.capacityBytes || 0), 0);
        const totalPct = totalCapacity > 0 ? Math.min(100, (totalUsed / totalCapacity) * 100) : 0;

        const summaryHtml = `
            <div class="account-row" style="margin-bottom:16px; padding:12px; border:1px solid rgba(63,168,255,0.35); border-radius:8px; background:rgba(63,168,255,0.06);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <strong style="font-size:13px;">🗄 সব মিলিয়ে (${accounts.length}টা অ্যাকাউন্ট)</strong>
                </div>
                <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:8px; overflow:hidden;">
                    <div style="width:${totalPct}%; height:100%; background:var(--gold-light);"></div>
                </div>
                <div style="font-size:11px; color:var(--muted); margin-top:4px;">
                    ${formatUsedBytes(totalUsed)} / ${bytesToGB(totalCapacity)} GB
                </div>
            </div>`;

        accountsListEl.innerHTML = summaryHtml + accounts.map(acc => {
            const pct = Math.min(100, (Number(acc.usedBytes || 0) / Number(acc.capacityBytes || 1)) * 100);
            const barColor = acc.full ? '#e07a6b' : 'var(--gold-light)';
            return `
                <div class="account-row" style="margin-bottom:14px; padding:10px; border:1px solid rgba(255,255,255,0.1); border-radius:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong style="font-size:13px;">${acc.label}${acc.isSelf ? ' (Main)' : ''}</strong>
                        ${acc.isSelf ? '' : `<button type="button" class="admin-btn admin-btn-secondary admin-btn-sm" style="padding:4px 10px; font-size:11px;" data-remove-acc="${acc.id}">Remove</button>`}
                    </div>
                    <div style="background:rgba(255,255,255,0.08); border-radius:4px; height:8px; overflow:hidden;">
                        <div style="width:${pct}%; height:100%; background:${barColor};"></div>
                    </div>
                    <div style="font-size:11px; color:var(--muted); margin-top:4px;">
                        ${formatUsedBytes(acc.usedBytes)} / ${bytesToGB(acc.capacityBytes)} GB ${acc.full ? '— পূর্ণ' : ''}
                    </div>
                </div>`;
        }).join('');

        accountsListEl.querySelectorAll('[data-remove-acc]').forEach(btn => {
            btn.addEventListener('click', () => {
                const accountId = btn.getAttribute('data-remove-acc');
                openRemoveAccConfirm(accountId, btn);
            });
        });
    }

    // --- In-page "remove account" confirmation box (replaces the native
    // browser prompt()/alert() with a styled overlay matching the rest of
    // the admin UI, so it no longer shows the "tonirshaik.github.io says"
    // browser chrome). ---
    const removeAccConfirmOverlay = document.getElementById('removeAccConfirmOverlay');
    const removeAccConfirmClose   = document.getElementById('removeAccConfirmClose');
    const removeAccCodeInput      = document.getElementById('removeAccCodeInput');
    const removeAccConfirmMsg     = document.getElementById('removeAccConfirmMsg');
    const removeAccCancelBtn      = document.getElementById('removeAccCancelBtn');
    const removeAccOkBtn          = document.getElementById('removeAccOkBtn');

    let pendingRemoveAccountId = null;
    let pendingRemoveAccountBtn = null;

    function openRemoveAccConfirm(accountId, triggerBtn) {
        pendingRemoveAccountId = accountId;
        pendingRemoveAccountBtn = triggerBtn;
        removeAccCodeInput.value = '';
        removeAccConfirmMsg.textContent = '';
        removeAccConfirmOverlay.classList.add('open');
        removeAccCodeInput.focus();
    }

    function closeRemoveAccConfirm() {
        removeAccConfirmOverlay.classList.remove('open');
        pendingRemoveAccountId = null;
        pendingRemoveAccountBtn = null;
    }

    function submitRemoveAccConfirm() {
        const code = removeAccCodeInput.value;
        if (code !== REMOVE_ACCOUNT_CODE) {
            removeAccConfirmMsg.textContent = 'ভুল কোড — অ্যাকাউন্টটা ডিলিট হয়নি।';
            return;
        }
        const accountId = pendingRemoveAccountId;
        const triggerBtn = pendingRemoveAccountBtn;
        removeAccOkBtn.disabled = true;
        removeAccConfirmMsg.textContent = '';
        if (triggerBtn) triggerBtn.disabled = true;

        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ password: ADMIN_PASSWORD, action: 'removeAccount', accountId: accountId })
        })
        .then(r => r.json())
        .then(res => {
            removeAccOkBtn.disabled = false;
            if (res.success) {
                closeRemoveAccConfirm();
                renderAccountsList(res.accounts);
            } else {
                removeAccConfirmMsg.textContent = 'Remove failed: ' + (res.error || 'Unknown error');
                if (triggerBtn) triggerBtn.disabled = false;
            }
        })
        .catch(() => {
            removeAccOkBtn.disabled = false;
            removeAccConfirmMsg.textContent = 'Network error';
            if (triggerBtn) triggerBtn.disabled = false;
        });
    }

    if (removeAccConfirmClose) removeAccConfirmClose.addEventListener('click', closeRemoveAccConfirm);
    if (removeAccCancelBtn) removeAccCancelBtn.addEventListener('click', closeRemoveAccConfirm);
    if (removeAccConfirmOverlay) {
        removeAccConfirmOverlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeRemoveAccConfirm();
        });
    }
    if (removeAccOkBtn) removeAccOkBtn.addEventListener('click', submitRemoveAccConfirm);
    if (removeAccCodeInput) {
        removeAccCodeInput.addEventListener('input', () => { removeAccConfirmMsg.textContent = ''; });
        removeAccCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitRemoveAccConfirm();
        });
    }

    function loadAccountsList() {
        if (!accountsListEl) return;
        accountsListEl.innerHTML = '<p class="admin-msg">Loading...</p>';
        fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({ password: ADMIN_PASSWORD, action: 'listAccounts' })
        })
        .then(r => r.json())
        .then(res => {
            if (res.success) renderAccountsList(res.accounts);
            else accountsListEl.innerHTML = '<p class="admin-msg err">' + (res.error || 'Failed to load') + '</p>';
        })
        .catch(() => { accountsListEl.innerHTML = '<p class="admin-msg err">Network error</p>'; });
    }

    // মিটার আইকনে ক্লিক করলেই স্টোরেজ ব্যবহারের লিস্ট দেখা/লুকানো যাবে —
    // এমনি প্যানেল খুললে এটা লুকানোই থাকবে।
    let accountsListVisible = false;
    function setAccountsListVisible(visible) {
        accountsListVisible = visible;
        if (accountsListEl) accountsListEl.style.display = visible ? 'block' : 'none';
    }

    if (toggleAccountsListBtn) {
        toggleAccountsListBtn.addEventListener('click', () => {
            if (accountsListVisible) {
                setAccountsListVisible(false);
            } else {
                setAccountsListVisible(true);
                loadAccountsList();
            }
        });
    }

    if (openAccountsBtn && adminAccountsOverlay) {
        openAccountsBtn.addEventListener('click', () => {
            adminUploadOverlay.classList.remove('open');
            adminAccountsOverlay.classList.add('open');
            if (accountsMsgEl) accountsMsgEl.textContent = '';
            setAccountsListVisible(false);
        });
    }
    if (adminAccountsClose && adminAccountsOverlay) {
        adminAccountsClose.addEventListener('click', () => adminAccountsOverlay.classList.remove('open'));
        adminAccountsOverlay.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) adminAccountsOverlay.classList.remove('open');
        });
    }

    // =====================================================================
    // 🔗 ImgBB + GitHub হেল্পার ফাংশন
    // -----------------------------------------------------------------
    // এগুলো আলাদা কোনো UI/overlay চালায় না — মূল Drive-upload flow-এর
    // (uploadStepPick → uploadStepTag → uploadOnePhoto, উপরে) ভেতরেই
    // "Destination: Google Drive / ImgBB + GitHub" রেডিও বাটন অনুযায়ী
    // এই ফাংশনগুলো কল হয়। তার মানে face-recognition + ট্যাগিং একই
    // ফ্লো-তে দুটো destination-এর জন্যই কাজ করে — আলাদা কোনো manual-tag
    // ফর্ম রাখতে হয় না।
    //
    // GitHub Personal Access Token কখনো ব্রাউজারে আসে না — সেটা
    // backend-এই (Script Properties → GITHUB_TOKEN) থেকে যায়, addTextLink
    // action দিয়ে (ঠিক যেভাবে handleDeleteFromTextFile /
    // handleUpdateTextFileNames এখন কাজ করে)।
    //
    // ⚠️ ImgBB API key ক্লায়েন্ট-সাইডে বসাতে হচ্ছে (ImgBB নিজেই এভাবে
    // ব্যবহার করতে বলে) — GitHub টোকেনের মতো স্পর্শকাতর না, কিন্তু
    // public থাকবে এটা মাথায় রেখো।
    // =====================================================================
    const IMGBB_API_KEY = 'bcb4dbe1b4e6af2e98b259afc291e550'; // 👉 https://api.imgbb.com/ থেকে নিজের key বসাও

    // 🆕 onProgress যোগ হয়েছে — FormData POST-ও XMLHttpRequest দিয়ে
    // পাঠানো হয় (fetch()-এ upload progress পাওয়া যায় না) যাতে ImgBB
    // route-এও bar লাইভ ভরতে থাকে, শুধু Drive route-এ না।
    function uploadToImgbb_(base64, onProgress) {
        const raw = base64.split(',').pop(); // "data:image/...;base64," প্রিফিক্স বাদ
        const form = new FormData();
        form.append('key', IMGBB_API_KEY);
        form.append('image', raw);

        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'https://api.imgbb.com/1/upload', true);
            xhr.upload.onprogress = function (e) {
                if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
            };
            xhr.onload = function () {
                try {
                    const json = JSON.parse(xhr.responseText);
                    if (json && json.success && json.data && json.data.url) {
                        // 🆕 THUMBNAIL FIX: ImgBB রেসপন্সে original url-এর পাশাপাশি
                        // thumb/medium সাইজের লিংকও থাকে — গ্রিডে এই ছোট ভার্সনটাই
                        // ব্যবহার হবে (index.html দেখো), আসল বড় url শুধু
                        // ডাউনলোড/ফুল-ভিউতে। ImgBB Drive-এর মতো কাস্টম পিক্সেল সাইজ
                        // (&sz=w200) সাপোর্ট করে না — যা ফিক্সড অপশন আছে তার মধ্যে
                        // "thumb" সবচেয়ে ছোট (Drive-এর 200px থাম্বনেইলের সবচেয়ে
                        // কাছের), তাই গ্রিডের জন্য thumb-কেই আগে বেছে নেওয়া হচ্ছে।
                        // thumb না থাকলে (কিছু ফরম্যাটে হয় না) medium, তাও না থাকলে
                        // original-ই fallback হিসেবে যাবে — কিছু ভাঙবে না।
                        const thumbUrl = (json.data.thumb && json.data.thumb.url)
                            || (json.data.medium && json.data.medium.url)
                            || json.data.url;
                        resolve({ success: true, url: json.data.url, thumbUrl: thumbUrl });
                    } else {
                        resolve({ success: false, error: (json && json.error && json.error.message) || 'ImgBB upload failed' });
                    }
                } catch (e) {
                    resolve({ success: false, error: 'Bad response' });
                }
            };
            xhr.onerror = function () { resolve({ success: false, error: 'ImgBB network error' }); };
            xhr.send(form);
        });
    }

    function addLinkToGithub_(url, thumbUrl, names, cat) {
        // 🆕 SPEED FIX: আগে এই action ব্যাকএন্ডে JSON ফাইলে লেখার পর
        // response দেওয়ার আগেই সরাসরি exportLiveGalleryToGithub() (২টা
        // GitHub API round-trip + satellite থাকলে সেগুলোও) শেষ হওয়ার
        // অপেক্ষা করত — cold-start মিলিয়ে প্রায়ই ২৫s+ লেগে যেত, client
        // timeout করে ভুলভাবে "failed" দেখাত অথচ ব্যাকএন্ডে কাজ শেষমেশ
        // সফলই হতো। এখন backend (Code.gs) export-টা একটা background
        // trigger দিয়ে async করে দেয় — এই request এখন শুধু Drive-এ
        // লিংক লেখা পর্যন্তই অপেক্ষা করে, তাই অনেক দ্রুত সাড়া দেয়।
        // তাই timeout-ও কমিয়ে আনা হলো, যাতে সত্যিকারের network সমস্যায়
        // দ্রুত জানা যায়।
        return fetchWithTimeout(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'addTextLink',
                url: url,
                thumbUrl: thumbUrl || '',
                names: names || '',
                cat: cat
            })
        }, 15000)
        .then(r => r.json())
        .catch(() => ({ success: false, error: 'Network error' }));
    }

    if (addAccountBtn) {
        addAccountBtn.addEventListener('click', () => {
            const label = (newAccLabelInput.value || '').trim();
            const webAppUrl = (newAccUrlInput.value || '').trim();
            const accountPassword = newAccPasswordInput.value || '';

            if (!label || !webAppUrl || !accountPassword) {
                accountsMsgEl.textContent = 'Label, Web App URL, আর Password — তিনটাই দিতে হবে';
                accountsMsgEl.className = 'admin-msg err';
                return;
            }

            addAccountBtn.disabled = true;
            accountsMsgEl.textContent = 'Adding...';
            accountsMsgEl.className = 'admin-msg';

            fetchWithTimeout(APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    password: ADMIN_PASSWORD,
                    action: 'addAccount',
                    label: label,
                    webAppUrl: webAppUrl,
                    accountPassword: accountPassword
                })
            })
            .then(r => r.json())
            .then(res => {
                addAccountBtn.disabled = false;
                if (res.success) {
                    accountsMsgEl.textContent = '✅ Account added';
                    accountsMsgEl.className = 'admin-msg ok';
                    newAccLabelInput.value = '';
                    newAccUrlInput.value = '';
                    newAccPasswordInput.value = '';
                    renderAccountsList(res.accounts);
                } else {
                    accountsMsgEl.textContent = 'Failed: ' + (res.error || 'Unknown error');
                    accountsMsgEl.className = 'admin-msg err';
                }
            })
            .catch(() => {
                addAccountBtn.disabled = false;
                accountsMsgEl.textContent = 'Network error, try again';
                accountsMsgEl.className = 'admin-msg err';
            });
        });
    }

})();
