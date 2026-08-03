/* ============================================================
   workpic.js
   Work Pic feature: password-locked full-page photo/file dashboard
   (upload images or any file, gallery, lightbox) backed by imgbb
   (images) and Google Drive (any file type).
   Loaded by index.html via <script src="workpic.js">.
   Depends on globals already defined in index.html's main script:
   dlImg, shareImg.

   DUAL-ROUTE VERSION — the upload panel has a "Google Drive" vs
   "ImgBB + GitHub" radio choice (#workpicDestDriveRadio /
   #workpicDestImgbbRadio).
     - ImgBB route: images only (imgbb only hosts images). Image goes
       straight from the browser to imgbb, then the resulting url is
       saved via Code.gs.
     - Drive route: ANY file type is allowed now (not just photos).
       File is base64-encoded and posted to Code.gs, which saves it
       into a Drive folder (DRIVE_FOLDER_ID script property) and saves
       the resulting share link the same way.
   Either way the url ends up in the same saved gallery list, so both
   routes' uploads show up together in the dashboard. Non-image files
   (from the Drive route) are rendered as a generic file card in the
   gallery instead of a photo thumbnail, but can still be opened and
   downloaded like any image.
   ============================================================ */

// Apps Script backend (Code.gs) — handles password check and saves the
// gallery list permanently to a file in your GitHub repo.
const WORKPIC_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyaP3hpU471aMaRTHaJo5yG5MqG4EyaR8U4Yo1pyrmU-YleGRXfwOMpac8QXyNx5u1Mlw/exec';

// imgbb API key — the image itself is uploaded straight from the browser
// (imgbb blocks server/cloud-originated uploads like Apps Script's, so this
// can't be proxied). Only the resulting url/name is then saved via the
// Apps Script backend above. imgbb only accepts images, so this route
// stays image-only.
const IMGBB_API_KEY = 'fbf9f03772f70e689d52d28b0a0afc86';
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload?key=' + IMGBB_API_KEY;

(function () {
    const navWorkPicLink       = document.getElementById('navWorkPicLink');
    const workpicLockOverlay   = document.getElementById('workpicLockOverlay');
    const workpicLockClose     = document.getElementById('workpicLockClose');
    const workpicPasswordInput = document.getElementById('workpicPasswordInput');
    const workpicUnlockBtn     = document.getElementById('workpicUnlockBtn');
    const workpicLockMsg       = document.getElementById('workpicLockMsg');
    const workpicPwEyeBtn      = document.getElementById('workpicPwEyeBtn');
    const workpicPwEyeIconOpen = document.getElementById('workpicPwEyeIconOpen');
    const workpicPwEyeIconClosed = document.getElementById('workpicPwEyeIconClosed');

    const workpicUploadOverlay = document.getElementById('workpicUploadOverlay');
    const workpicUploadClose   = document.getElementById('workpicUploadClose');
    const workpicSettingsBtn   = document.getElementById('workpicSettingsBtn');
    const workpicUploadPanel   = document.getElementById('workpicUploadPanel');
    const workpicDestDriveRadio = document.getElementById('workpicDestDriveRadio');
    const workpicDestImgbbRadio = document.getElementById('workpicDestImgbbRadio');
    const workpicFileInput     = document.getElementById('workpicFileInput');
    const workpicThumbs        = document.getElementById('workpicThumbs');
    const workpicSendBtn       = document.getElementById('workpicSendBtn');
    const workpicMsg           = document.getElementById('workpicMsg');
    const workpicProgressWrap  = document.getElementById('workpicProgressWrap');
    const workpicProgressFill  = document.getElementById('workpicProgressFill');
    const workpicDoneCount     = document.getElementById('workpicDoneCount');
    const workpicTotalCount    = document.getElementById('workpicTotalCount');
    const workpicGallery        = document.getElementById('workpicGallery');
    const workpicGalleryLoading = document.getElementById('workpicGalleryLoading');
    const workpicGalleryWrap    = document.getElementById('workpicGalleryWrap');

    const workpicLightbox = document.getElementById('workpicLightbox');
    const wplbClose   = document.getElementById('wplbClose');
    const wplbPrev    = document.getElementById('wplbPrev');
    const wplbNext    = document.getElementById('wplbNext');
    const wplbImg     = document.getElementById('wplbImg');
    const wplbTitle   = document.getElementById('wplbTitle');
    const wplbCounter = document.getElementById('wplbCounter');
    const wplbDl      = document.getElementById('wplbDl');
    const wplbShare   = document.getElementById('wplbShare');

    if (!navWorkPicLink) return;

    // workpicImages now comes from the Apps Script backend (GitHub-saved),
    // so it persists across refreshes/devices — not session-only anymore.
    let workpicImages = []; // { url, name, time, deleteUrl? }
    let workpicLbIdx = 0;
    let workpicSelectedFiles = [];

    // Kept in memory only after a successful unlock, so add/delete calls
    // to the backend can re-send it. Never stored, never sent anywhere
    // except this Apps Script URL.
    let workpicSessionPassword = null;

    // ------------------------------------------------------------
    // Apps Script backend helpers
    // ------------------------------------------------------------
    function workpicBackendPost(body) {
        // text/plain avoids a CORS preflight (Apps Script doesn't handle
        // OPTIONS), while Code.gs still parses e.postData.contents as JSON fine.
        return fetch(WORKPIC_APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(body)
        }).then(r => r.json());
    }

    function workpicBackendGet() {
        return fetch(WORKPIC_APPS_SCRIPT_URL, { method: 'GET' }).then(r => r.json());
    }

    // ------------------------------------------------------------
    // File-type helpers (used to tell an uploaded photo apart from
    // any other file type coming from the Drive route, so the
    // gallery knows whether to render a photo thumbnail or a
    // generic file card).
    // ------------------------------------------------------------
    const WORKPIC_IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif)$/i;

    function workpicIsImageName(name) {
        return WORKPIC_IMAGE_EXT_RE.test(String(name || ''));
    }
    function workpicFileExt(name) {
        const m = String(name || '').match(/\.([a-zA-Z0-9]+)$/);
        return m ? m[1].toUpperCase() : 'FILE';
    }
    // An imgbb-route entry is always an image. A Drive-route entry is
    // only treated as "not an image" if its filename doesn't look like
    // a photo — everything from imgbb is unaffected since those urls
    // never match isWorkpicDriveUrl.
    function workpicIsNonImageEntry(img) {
        return isWorkpicDriveUrl(img && img.url) && !workpicIsImageName(img && img.name);
    }

    // ------------------------------------------------------------
    // Google Drive url helpers (Drive-route uploads are saved as
    // drive.google.com/file/d/<id>/view links — those don't render
    // directly in an <img> tag, so thumb/view/download urls need to
    // be derived from the file id, same pattern as the main gallery).
    // ------------------------------------------------------------
    function isWorkpicDriveUrl(url) {
        return /drive\.google\.com/.test(url || '');
    }
    function getWorkpicDriveFileId(url) {
        let m = String(url || '').match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = String(url || '').match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        return null;
    }
    function workpicRenderUrl(url) {
        if (isWorkpicDriveUrl(url)) {
            const id = getWorkpicDriveFileId(url);
            if (id) return 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000';
        }
        return url;
    }
    function workpicDownloadUrl(url) {
        if (isWorkpicDriveUrl(url)) {
            const id = getWorkpicDriveFileId(url);
            if (id) return 'https://drive.google.com/uc?export=download&id=' + id;
        }
        return url;
    }

    // Reads a File as base64 (no data: prefix) so it can be JSON-posted
    // to the Apps Script backend for saving into Drive.
    function workpicFileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
            reader.onerror = () => reject(new Error('File read failed'));
            reader.readAsDataURL(file);
        });
    }

    function loadWorkpicGalleryFromServer() {
        workpicGalleryLoading.style.display = 'block';
        return workpicBackendGet()
            .then(result => {
                workpicImages = (result && result.success && Array.isArray(result.images)) ? result.images : [];
            })
            .catch(() => { workpicImages = []; })
            .then(() => renderWorkpicGallery());
    }

    // Which files the picker accepts depends on the selected route:
    // imgbb only takes images, Drive can take anything.
    function updateWorkpicFileAccept() {
        const useDrive = !!(workpicDestDriveRadio && workpicDestDriveRadio.checked);
        workpicFileInput.setAttribute('accept', useDrive ? '*/*' : 'image/*');
    }
    workpicFileInput.multiple = true;
    updateWorkpicFileAccept();
    if (workpicDestDriveRadio) workpicDestDriveRadio.addEventListener('change', updateWorkpicFileAccept);
    if (workpicDestImgbbRadio) workpicDestImgbbRadio.addEventListener('change', updateWorkpicFileAccept);

    // ------------------------------------------------------------
    // Lock overlay (local password check — no backend anymore)
    // ------------------------------------------------------------
    navWorkPicLink.addEventListener('click', (e) => {
        e.preventDefault();
        workpicLockOverlay.classList.add('open');
        workpicPasswordInput.value = '';
        workpicPasswordInput.type = 'password';
        workpicPwEyeIconOpen.style.display = 'none';
        workpicPwEyeIconClosed.style.display = 'flex';
        workpicLockMsg.textContent = '';
        workpicPasswordInput.focus();
    });

    workpicLockClose.addEventListener('click', () => workpicLockOverlay.classList.remove('open'));
    workpicLockOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) workpicLockOverlay.classList.remove('open');
    });

    workpicPwEyeBtn.addEventListener('click', () => {
        const showing = workpicPasswordInput.type === 'text';
        workpicPasswordInput.type = showing ? 'password' : 'text';
        workpicPwEyeIconOpen.style.display = showing ? 'none' : 'flex';
        workpicPwEyeIconClosed.style.display = showing ? 'flex' : 'none';
    });

    function tryWorkpicUnlock() {
        const entered = workpicPasswordInput.value;
        workpicUnlockBtn.disabled = true;
        workpicLockMsg.textContent = 'যাচাই করা হচ্ছে...';

        workpicBackendPost({ password: entered, action: 'verify' })
            .then(result => {
                if (result && result.success) {
                    workpicSessionPassword = entered;
                    workpicLockOverlay.classList.remove('open');
                    resetWorkpicUploadFlow();
                    workpicUploadOverlay.classList.add('open');
                    return loadWorkpicGalleryFromServer();
                } else {
                    workpicLockMsg.textContent = 'ভুল পাসওয়ার্ড';
                }
            })
            .catch(() => {
                workpicLockMsg.textContent = 'সার্ভারে সমস্যা হয়েছে, আবার চেষ্টা করুন';
            })
            .finally(() => {
                workpicUnlockBtn.disabled = false;
            });
    }
    workpicUnlockBtn.addEventListener('click', tryWorkpicUnlock);
    workpicPasswordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryWorkpicUnlock();
    });

    // ------------------------------------------------------------
    // Upload panel open/close + settings toggle
    // ------------------------------------------------------------
    workpicSettingsBtn.addEventListener('click', () => {
        const isOpen = workpicUploadPanel.style.display !== 'none';
        if (isOpen) {
            workpicUploadPanel.style.display = 'none';
            workpicGalleryWrap.style.display = 'block';
        } else {
            workpicUploadPanel.style.display = 'block';
            workpicGalleryWrap.style.display = 'none';
        }
    });

    workpicUploadClose.addEventListener('click', () => {
        workpicUploadOverlay.classList.remove('open');
        resetWorkpicUploadFlow();
    });
    workpicUploadOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
            workpicUploadOverlay.classList.remove('open');
            resetWorkpicUploadFlow();
        }
    });

    function resetWorkpicUploadFlow() {
        workpicSelectedFiles = [];
        workpicFileInput.value = '';
        workpicThumbs.innerHTML = '';
        workpicSendBtn.disabled = true;
        workpicMsg.textContent = '';
        workpicMsg.className = 'admin-msg';
        workpicProgressWrap.style.display = 'none';
        workpicProgressFill.style.width = '0%';
        workpicUploadPanel.style.display = 'none';
        workpicGalleryWrap.style.display = 'block';
    }

    // ------------------------------------------------------------
    // File selection + thumbnail preview
    // ------------------------------------------------------------
    function renderWorkpicThumbs() {
        workpicThumbs.innerHTML = '';
        workpicSelectedFiles.forEach((file, idx) => {
            const div = document.createElement('div');
            div.className = 'upload-thumb';
            if (file.type && file.type.startsWith('image/')) {
                div.innerHTML = `<img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="thumb-remove" title="Remove">×</button>`;
            } else {
                // Non-image file (Drive route only) — show a small file
                // card with its extension instead of a broken image icon.
                div.innerHTML = `
                    <div class="upload-thumb-file" style="display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;background:#f0f0f0;border-radius:8px;padding:6px;box-sizing:border-box;text-align:center;overflow:hidden;">
                        <div style="font-size:22px;line-height:1;margin-bottom:4px;">📄</div>
                        <div style="font-size:10px;font-weight:700;color:#666;">${workpicFileExt(file.name)}</div>
                        <div style="font-size:9px;color:#888;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${file.name}</div>
                    </div>
                    <button type="button" class="thumb-remove" title="Remove">×</button>`;
            }
            div.querySelector('.thumb-remove').addEventListener('click', () => {
                workpicSelectedFiles.splice(idx, 1);
                renderWorkpicThumbs();
                workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
            });
            workpicThumbs.appendChild(div);
        });
    }

    workpicFileInput.addEventListener('change', () => {
        const useDrive = !!(workpicDestDriveRadio && workpicDestDriveRadio.checked);
        const picked = Array.from(workpicFileInput.files || []);
        // imgbb route stays image-only (imgbb rejects anything else);
        // Drive route now accepts any file type.
        workpicSelectedFiles = useDrive ? picked : picked.filter(f => f.type.startsWith('image/'));
        renderWorkpicThumbs();
        workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
        workpicMsg.textContent = '';
    });

    // ------------------------------------------------------------
    // Upload — image goes straight from the browser to imgbb (imgbb
    // blocks cloud/server-originated uploads, so this can't run inside
    // Apps Script). Once we have the imgbb url, it's saved to GitHub
    // via the Apps Script backend.
    // ------------------------------------------------------------
    function uploadOneWorkpicFile(file) {
        const form = new FormData();
        form.append('image', file);

        return fetch(IMGBB_UPLOAD_URL, {
            method: 'POST',
            body: form
        })
        .then(r => r.json())
        .then(res => {
            if (res && res.success && res.data && res.data.url) {
                return {
                    success: true,
                    url: res.data.url,
                    name: res.data.title || file.name || 'work-pic'
                };
            }
            return { success: false, error: (res && res.error && res.error.message) || 'imgbb upload failed' };
        })
        .then(res => {
            if (!res.success) return res;
            // save the new entry to GitHub via the backend (default action = add)
            return workpicBackendPost({
                password: workpicSessionPassword,
                url: res.url,
                name: res.name
            }).then(saveRes => {
                if (saveRes && saveRes.success && Array.isArray(saveRes.images)) {
                    return { success: true, url: res.url, name: res.name, images: saveRes.images };
                }
                // imgbb upload succeeded but saving failed — still show it locally
                return { success: true, url: res.url, name: res.name };
            }).catch(() => ({ success: true, url: res.url, name: res.name }));
        })
        .catch(err => ({ success: false, error: (err && err.message) || 'Network error' }));
    }

    // ------------------------------------------------------------
    // Upload — Drive route. File (any type — image, pdf, doc, zip,
    // whatever) is base64-encoded in the browser and sent straight to
    // the Apps Script backend, which saves it into the Drive folder
    // (DRIVE_FOLDER_ID) and appends the resulting share link to the
    // same saved gallery list used by the imgbb route.
    // ------------------------------------------------------------
    function uploadOneWorkpicFileToDrive(file) {
        return workpicFileToBase64(file)
            .then(base64Data => workpicBackendPost({
                password: workpicSessionPassword,
                action: 'uploadDrive',
                imageData: base64Data,
                filename: file.name || 'work-file',
                mimeType: file.type || 'application/octet-stream'
            }))
            .then(res => {
                if (res && res.success && Array.isArray(res.images)) {
                    return { success: true, images: res.images };
                }
                return { success: false, error: (res && res.error) || 'Drive আপলোড ব্যর্থ হয়েছে' };
            })
            .catch(err => ({ success: false, error: (err && err.message) || 'Network error' }));
    }

    workpicSendBtn.addEventListener('click', () => {
        if (workpicSelectedFiles.length === 0) return;
        workpicSendBtn.disabled = true;
        workpicMsg.textContent = '';
        workpicMsg.className = 'admin-msg';
        workpicProgressWrap.style.display = 'block';
        workpicTotalCount.textContent = workpicSelectedFiles.length;
        workpicDoneCount.textContent = 0;
        workpicProgressFill.style.width = '0%';

        startWorkpicUploadBatch();
    });

    function startWorkpicUploadBatch() {
        let done = 0, failed = 0, lastError = '';
        const useDrive = !!(workpicDestDriveRadio && workpicDestDriveRadio.checked);
        const uploadOne = useDrive ? uploadOneWorkpicFileToDrive : uploadOneWorkpicFile;
        function next(i) {
            if (i >= workpicSelectedFiles.length) {
                workpicMsg.textContent = failed === 0
                    ? `✅ ${done} টা ফাইল আপলোড হয়েছে!`
                    : `✅ ${done} সফল, ❌ ${failed} ব্যর্থ — ${lastError}`;
                workpicMsg.className = failed === 0 ? 'admin-msg ok' : 'admin-msg err';
                workpicSendBtn.disabled = false;
                if (done > 0) renderWorkpicGallery();
                if (failed === 0) {
                    setTimeout(() => {
                        workpicFileInput.value = '';
                        workpicThumbs.innerHTML = '';
                        workpicSelectedFiles = [];
                        workpicSendBtn.disabled = true;
                        workpicProgressWrap.style.display = 'none';
                        workpicProgressFill.style.width = '0%';
                        workpicMsg.textContent = '';
                        workpicUploadPanel.style.display = 'none';
                        workpicGalleryWrap.style.display = 'block';
                    }, 1800);
                }
                return;
            }
            uploadOne(workpicSelectedFiles[i]).then(res => {
                if (res && res.success) {
                    done++;
                    if (Array.isArray(res.images)) {
                        workpicImages = res.images;
                    } else {
                        workpicImages.unshift({ url: res.url, name: res.name, time: Date.now() });
                    }
                } else {
                    failed++;
                    lastError = (res && res.error) || 'অজানা এরর';
                }
                workpicDoneCount.textContent = done + failed;
                workpicProgressFill.style.width = ((done + failed) / workpicSelectedFiles.length * 100) + '%';
                next(i + 1);
            });
        }
        next(0);
    }

    // ------------------------------------------------------------
    // Gallery — shows both photos (real thumbnails, opens in the
    // lightbox) and any other file type from the Drive route (a
    // generic file card with its extension, opens/downloads directly).
    // ------------------------------------------------------------
    function renderWorkpicGallery() {
        workpicGalleryLoading.style.display = 'none';
        workpicGallery.innerHTML = '';

        if (workpicImages.length === 0) {
            workpicGallery.innerHTML = '<p class="workpic-gallery-empty">এখনো কোনো ফাইল আপলোড হয়নি এই সেশনে।</p>';
            return;
        }

        workpicImages.forEach((img, idx) => {
            const item = document.createElement('div');
            item.className = 'workpic-gallery-item';
            const isFile = workpicIsNonImageEntry(img);

            const link = document.createElement('a');
            link.href = img.url;
            link.rel = 'noopener';

            if (isFile) {
                const fileBox = document.createElement('div');
                fileBox.className = 'workpic-file-box';
                fileBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;background:#f2f2f2;border-radius:8px;padding:10px;box-sizing:border-box;text-align:center;';
                fileBox.innerHTML = `<div style="font-size:32px;line-height:1;margin-bottom:6px;">📄</div><div style="font-size:12px;font-weight:700;color:#555;">${workpicFileExt(img.name)}</div>`;
                link.appendChild(fileBox);
            } else {
                const thumb = document.createElement('img');
                thumb.src = workpicRenderUrl(img.url);
                thumb.alt = img.name || '';
                thumb.loading = 'lazy';
                thumb.decoding = 'async';
                thumb.addEventListener('error', function onThumbErr() {
                    // thumbnail endpoint can occasionally lag right after upload —
                    // fall back to the direct view url once.
                    if (isWorkpicDriveUrl(img.url) && thumb.dataset.fallbackDone !== '1') {
                        thumb.dataset.fallbackDone = '1';
                        const id = getWorkpicDriveFileId(img.url);
                        if (id) thumb.src = 'https://drive.google.com/uc?export=view&id=' + id;
                    }
                });
                link.appendChild(thumb);
            }

            link.addEventListener('click', (e) => {
                e.preventDefault();
                if (isFile) {
                    // Not a photo — open the file directly (Drive's own
                    // viewer/downloader) instead of the image lightbox.
                    window.open(img.url, '_blank', 'noopener');
                } else {
                    openWorkpicLightbox(idx);
                }
            });

            const nameEl = document.createElement('span');
            nameEl.className = 'wp-name';
            nameEl.textContent = img.name || '';

            const actions = document.createElement('div');
            actions.className = 'wp-actions';
            actions.innerHTML = `
                <button type="button" class="wp-action-btn wp-dl" title="Download">⬇</button>
                <button type="button" class="wp-action-btn wp-share" title="Share">↗</button>
                <button type="button" class="wp-action-btn wp-delete" title="Remove from gallery">✕</button>
            `;
            actions.querySelector('.wp-dl').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                dlImg(workpicDownloadUrl(img.url), img.name || (isFile ? 'work-file' : 'work-pic.jpg'));
            });
            actions.querySelector('.wp-share').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                shareImg(workpicDownloadUrl(img.url), img.name || (isFile ? 'work-file' : 'work-pic.jpg'), img.name || 'Work Pic');
            });
            actions.querySelector('.wp-delete').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const ok = window.confirm('এই ফাইলটা গ্যালারি থেকে সরাতে চান? (' + (img.name || '') + ')');
                if (!ok) return;

                const deleteBtn = actions.querySelector('.wp-delete');
                deleteBtn.disabled = true;

                workpicBackendPost({
                    password: workpicSessionPassword,
                    action: 'delete',
                    url: img.url
                })
                .then(result => {
                    if (result && result.success && Array.isArray(result.images)) {
                        workpicImages = result.images;
                    } else {
                        // fall back to local removal so the UI stays in sync
                        workpicImages.splice(idx, 1);
                    }
                })
                .catch(() => {
                    workpicImages.splice(idx, 1);
                })
                .then(() => renderWorkpicGallery());
            });

            item.appendChild(link);
            item.appendChild(nameEl);
            item.appendChild(actions);
            workpicGallery.appendChild(item);
        });
    }

    // ------------------------------------------------------------
    // Lightbox (images only — non-image files open directly instead,
    // see renderWorkpicGallery, so prev/next only ever step through
    // the image entries).
    // ------------------------------------------------------------
    function workpicImageIndices() {
        const out = [];
        workpicImages.forEach((img, i) => { if (!workpicIsNonImageEntry(img)) out.push(i); });
        return out;
    }
    function openWorkpicLightbox(idx) {
        if (!workpicImages.length) return;
        workpicLbIdx = idx;
        updateWorkpicLightbox();
        workpicLightbox.classList.add('open');
        document.body.style.overflow = 'hidden';
    }
    function closeWorkpicLightbox() {
        workpicLightbox.classList.remove('open');
        document.body.style.overflow = '';
    }
    function updateWorkpicLightbox() {
        const img = workpicImages[workpicLbIdx];
        if (!img) return;
        const indices = workpicImageIndices();
        const pos = indices.indexOf(workpicLbIdx);
        wplbImg.src = workpicRenderUrl(img.url);
        wplbTitle.textContent = img.name || '';
        wplbCounter.textContent = (pos + 1) + ' / ' + indices.length;
        wplbDl.onclick = () => dlImg(workpicDownloadUrl(img.url), img.name || 'work-pic.jpg');
        wplbShare.onclick = () => shareImg(workpicDownloadUrl(img.url), img.name || 'work-pic.jpg', img.name || 'Work Pic');
    }
    wplbClose.onclick = closeWorkpicLightbox;
    workpicLightbox.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeWorkpicLightbox();
    });
    wplbPrev.onclick = () => {
        const indices = workpicImageIndices();
        if (!indices.length) return;
        const pos = indices.indexOf(workpicLbIdx);
        workpicLbIdx = indices[(pos - 1 + indices.length) % indices.length];
        updateWorkpicLightbox();
    };
    wplbNext.onclick = () => {
        const indices = workpicImageIndices();
        if (!indices.length) return;
        const pos = indices.indexOf(workpicLbIdx);
        workpicLbIdx = indices[(pos + 1) % indices.length];
        updateWorkpicLightbox();
    };
    document.addEventListener('keydown', e => {
        if (!workpicLightbox.classList.contains('open')) return;
        if (e.key === 'Escape') closeWorkpicLightbox();
        if (e.key === 'ArrowLeft') wplbPrev.click();
        if (e.key === 'ArrowRight') wplbNext.click();
    });
})();
