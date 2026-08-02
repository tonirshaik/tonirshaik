/* ============================================================
   workpic.js
   Work Pic feature: password-locked full-page photo dashboard
   (upload images, gallery, lightbox) backed by imgbb.
   Loaded by index.html via <script src="workpic.js">.
   Depends on globals already defined in index.html's main script:
   dlImg, shareImg.

   IMGBB VERSION — Google Drive / Apps Script backend, folders,
   move/copy/rename, and non-image files have all been removed.
   Every uploaded photo goes straight to imgbb and only lives in
   the gallery for the current browser session (nothing is saved
   to any database, so refreshing or opening on another device
   won't show older uploads — only what you upload in this visit).
   ============================================================ */

// TODO: এটা আপনার নিজের একটা পাসওয়ার্ড দিয়ে বদলে দিন
const WORKPIC_LOCAL_PASSWORD = '';

// imgbb API key
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

    // In-memory only — resets on page refresh (by design, per user's choice)
    let workpicImages = []; // { url, deleteUrl, name }
    let workpicLbIdx = 0;
    let workpicSelectedFiles = [];

    // allow only image files now (imgbb only hosts images)
    workpicFileInput.setAttribute('accept', 'image/*');
    workpicFileInput.multiple = true;

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
        if (entered === WORKPIC_LOCAL_PASSWORD) {
            workpicLockOverlay.classList.remove('open');
            resetWorkpicUploadFlow();
            workpicUploadOverlay.classList.add('open');
            renderWorkpicGallery();
        } else {
            workpicLockMsg.textContent = 'ভুল পাসওয়ার্ড';
        }
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
            div.innerHTML = `<img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="thumb-remove" title="Remove">×</button>`;
            div.querySelector('.thumb-remove').addEventListener('click', () => {
                workpicSelectedFiles.splice(idx, 1);
                renderWorkpicThumbs();
                workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
            });
            workpicThumbs.appendChild(div);
        });
    }

    workpicFileInput.addEventListener('change', () => {
        workpicSelectedFiles = Array.from(workpicFileInput.files || []).filter(f => f.type.startsWith('image/'));
        renderWorkpicThumbs();
        workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
        workpicMsg.textContent = '';
    });

    // ------------------------------------------------------------
    // Upload to imgbb
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
                    deleteUrl: res.data.delete_url || null,
                    name: res.data.title || file.name || 'work-pic'
                };
            }
            return { success: false, error: (res && res.error && res.error.message) || 'Upload failed' };
        })
        .catch(() => ({ success: false, error: 'Network error' }));
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
        let done = 0, failed = 0;
        function next(i) {
            if (i >= workpicSelectedFiles.length) {
                workpicMsg.textContent = failed === 0
                    ? `✅ ${done} টা ছবি imgbb-তে আপলোড হয়েছে!`
                    : `✅ ${done} সফল, ❌ ${failed} ব্যর্থ`;
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
            uploadOneWorkpicFile(workpicSelectedFiles[i]).then(res => {
                if (res && res.success) {
                    done++;
                    workpicImages.unshift({ url: res.url, deleteUrl: res.deleteUrl, name: res.name });
                } else {
                    failed++;
                }
                workpicDoneCount.textContent = done + failed;
                workpicProgressFill.style.width = ((done + failed) / workpicSelectedFiles.length * 100) + '%';
                next(i + 1);
            });
        }
        next(0);
    }

    // ------------------------------------------------------------
    // Gallery (session-only, in-memory)
    // ------------------------------------------------------------
    function renderWorkpicGallery() {
        workpicGalleryLoading.style.display = 'none';
        workpicGallery.innerHTML = '';

        if (workpicImages.length === 0) {
            workpicGallery.innerHTML = '<p class="workpic-gallery-empty">এখনো কোনো ছবি আপলোড হয়নি এই সেশনে।</p>';
            return;
        }

        workpicImages.forEach((img, idx) => {
            const item = document.createElement('div');
            item.className = 'workpic-gallery-item';

            const link = document.createElement('a');
            link.href = img.url;
            link.rel = 'noopener';

            const thumb = document.createElement('img');
            thumb.src = img.url;
            thumb.alt = img.name || '';
            thumb.loading = 'lazy';
            thumb.decoding = 'async';
            link.appendChild(thumb);

            link.addEventListener('click', (e) => {
                e.preventDefault();
                openWorkpicLightbox(idx);
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
                dlImg(img.url, img.name || 'work-pic.jpg');
            });
            actions.querySelector('.wp-share').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                shareImg(img.url, img.name || 'work-pic.jpg', img.name || 'Work Pic');
            });
            actions.querySelector('.wp-delete').addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const ok = window.confirm('এই ছবিটা গ্যালারি থেকে সরাতে চান? (' + (img.name || '') + ')');
                if (!ok) return;
                workpicImages.splice(idx, 1);
                renderWorkpicGallery();
            });

            item.appendChild(link);
            item.appendChild(nameEl);
            item.appendChild(actions);
            workpicGallery.appendChild(item);
        });
    }

    // ------------------------------------------------------------
    // Lightbox
    // ------------------------------------------------------------
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
        wplbImg.src = img.url;
        wplbTitle.textContent = img.name || '';
        wplbCounter.textContent = (workpicLbIdx + 1) + ' / ' + workpicImages.length;
        wplbDl.onclick = () => dlImg(img.url, img.name || 'work-pic.jpg');
        wplbShare.onclick = () => shareImg(img.url, img.name || 'work-pic.jpg', img.name || 'Work Pic');
    }
    wplbClose.onclick = closeWorkpicLightbox;
    workpicLightbox.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeWorkpicLightbox();
    });
    wplbPrev.onclick = () => {
        workpicLbIdx = (workpicLbIdx - 1 + workpicImages.length) % workpicImages.length;
        updateWorkpicLightbox();
    };
    wplbNext.onclick = () => {
        workpicLbIdx = (workpicLbIdx + 1) % workpicImages.length;
        updateWorkpicLightbox();
    };
    document.addEventListener('keydown', e => {
        if (!workpicLightbox.classList.contains('open')) return;
        if (e.key === 'Escape') closeWorkpicLightbox();
        if (e.key === 'ArrowLeft') wplbPrev.click();
        if (e.key === 'ArrowRight') wplbNext.click();
    });
})();
