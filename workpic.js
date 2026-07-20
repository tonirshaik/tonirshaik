/* ============================================================
   workpic.js
   Work Pic feature: password-locked full-page photo dashboard
   (upload, gallery, delete, lightbox) backed by Google Drive
   via Apps Script. Loaded by index.html via <script src="workpic.js">.
   Depends on globals already defined in index.html's main script:
   dlImg, shareImg.
   ============================================================ */
const WORKPIC_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyaP3hpU471aMaRTHaJo5yG5MqG4EyaR8U4Yo1pyrmU-YleGRXfwOMpac8QXyNx5u1Mlw/exec';
const WORKPIC_PASSWORD = 'work2002';

    (function() {
        const navWorkPicLink      = document.getElementById('navWorkPicLink');
        const workpicLockOverlay  = document.getElementById('workpicLockOverlay');
        const workpicLockClose    = document.getElementById('workpicLockClose');
        const workpicPasswordInput= document.getElementById('workpicPasswordInput');
        const workpicUnlockBtn    = document.getElementById('workpicUnlockBtn');
        const workpicLockMsg      = document.getElementById('workpicLockMsg');
        const workpicPwEyeBtn     = document.getElementById('workpicPwEyeBtn');
        const workpicPwEyeIconOpen= document.getElementById('workpicPwEyeIconOpen');
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

        let workpicImages = [];
        let workpicLbIdx = 0;

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
            const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + img.id;
            wplbImg.src = img.url;
            wplbTitle.textContent = img.name || '';
            wplbCounter.textContent = (workpicLbIdx + 1) + ' / ' + workpicImages.length;
            wplbDl.onclick = () => dlImg(downloadUrl, img.name || 'work-pic.jpg');
            wplbShare.onclick = () => shareImg(downloadUrl, img.name || 'work-pic.jpg', img.name || 'Work Pic');
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

        let workpicSelectedFiles = [];

        if (!navWorkPicLink) return;

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
            if (workpicPasswordInput.value === WORKPIC_PASSWORD) {
                workpicLockOverlay.classList.remove('open');
                resetWorkpicUploadFlow();
                workpicUploadOverlay.classList.add('open');
                loadWorkpicGallery();
            } else {
                workpicLockMsg.textContent = 'Wrong password';
            }
        }
        workpicUnlockBtn.addEventListener('click', tryWorkpicUnlock);
        workpicPasswordInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') tryWorkpicUnlock();
        });

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

        function fileToBase64(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result.split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
        }

        function deleteWorkpicPhoto(fileId, name, itemEl) {
            const ok = window.confirm('এই ছবিটা ডিলেট করতে চান? (' + (name || '') + ')');
            if (!ok) return;

            itemEl.style.opacity = '0.4';
            itemEl.style.pointerEvents = 'none';

            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({
                    password: WORKPIC_PASSWORD,
                    action: 'delete',
                    fileId: fileId
                })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    itemEl.remove();
                    workpicImages = workpicImages.filter(im => im.id !== fileId);
                    try { sessionStorage.setItem(WORKPIC_CACHE_KEY, JSON.stringify(workpicImages)); } catch (e) { /* ignore */ }
                    if (workpicImages.length === 0) {
                        workpicGallery.innerHTML = '<p class="workpic-gallery-empty">এখনো কোনো ছবি আপলোড হয়নি</p>';
                    }
                } else {
                    itemEl.style.opacity = '1';
                    itemEl.style.pointerEvents = 'auto';
                    alert('ডিলেট করা যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => {
                itemEl.style.opacity = '1';
                itemEl.style.pointerEvents = 'auto';
                alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন');
            });
        }

        const WORKPIC_CACHE_KEY = 'workpicGalleryCache_v1';

        function workpicThumbUrl(img) {
            // Small, fast-loading Drive thumbnail instead of the full-size image for the grid
            return 'https://drive.google.com/thumbnail?id=' + img.id + '&sz=w400';
        }

        function renderWorkpicGallery(images) {
            workpicGallery.innerHTML = '';

            if (images.length === 0) {
                workpicGallery.innerHTML = '<p class="workpic-gallery-empty">এখনো কোনো ছবি আপলোড হয়নি</p>';
                return;
            }

            images.forEach((img, i) => {
                const downloadUrl = 'https://drive.google.com/uc?export=download&id=' + img.id;
                const item = document.createElement('div');
                item.className = 'workpic-gallery-item';
                item.innerHTML = `
                    <a href="${img.viewUrl || img.url}" rel="noopener">
                        <img src="${workpicThumbUrl(img)}" alt="${img.name || ''}" loading="lazy" decoding="async">
                    </a>
                    <span class="wp-name">${img.name || ''}</span>
                    <div class="wp-actions">
                        <button type="button" class="wp-action-btn wp-dl" title="Download">⬇</button>
                        <button type="button" class="wp-action-btn wp-share" title="Share">↗</button>
                        <button type="button" class="wp-action-btn wp-delete" title="Delete">✕</button>
                    </div>
                `;
                item.querySelector('a').addEventListener('click', (e) => {
                    e.preventDefault();
                    openWorkpicLightbox(i);
                });
                item.querySelector('.wp-dl').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dlImg(downloadUrl, img.name || 'work-pic.jpg');
                });
                item.querySelector('.wp-share').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    shareImg(downloadUrl, img.name || 'work-pic.jpg', img.name || 'Work Pic');
                });
                item.querySelector('.wp-delete').addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteWorkpicPhoto(img.id, img.name, item);
                });
                workpicGallery.appendChild(item);
            });
        }

        function loadWorkpicGallery() {
            let usedCache = false;

            // Show cached results instantly (super fast open), then refresh quietly in the background
            try {
                const cached = sessionStorage.getItem(WORKPIC_CACHE_KEY);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed)) {
                        workpicImages = parsed;
                        workpicGalleryLoading.style.display = 'none';
                        renderWorkpicGallery(parsed);
                        usedCache = true;
                    }
                }
            } catch (e) { /* ignore cache errors */ }

            if (!usedCache) {
                workpicGalleryLoading.style.display = 'block';
                workpicGalleryLoading.textContent = 'Loading uploaded photos...';
                workpicGalleryLoading.className = 'admin-msg';
                workpicGallery.innerHTML = '';
            }

            fetch(WORKPIC_APPS_SCRIPT_URL)
                .then(r => r.json())
                .then(res => {
                    workpicGalleryLoading.style.display = 'none';

                    if (!res || res.success !== true) {
                        if (!usedCache) {
                            workpicGalleryLoading.style.display = 'block';
                            workpicGalleryLoading.textContent = 'লিস্ট আনতে সমস্যা হয়েছে: ' + ((res && res.error) || 'Unknown error');
                            workpicGalleryLoading.className = 'admin-msg err';
                        }
                        return;
                    }

                    const images = Array.isArray(res.images) ? res.images : [];
                    workpicImages = images;

                    try { sessionStorage.setItem(WORKPIC_CACHE_KEY, JSON.stringify(images)); } catch (e) { /* ignore */ }

                    renderWorkpicGallery(images);
                })
                .catch(() => {
                    if (!usedCache) {
                        workpicGalleryLoading.style.display = 'block';
                        workpicGalleryLoading.textContent = 'তালিকা লোড করা যায়নি, আবার চেষ্টা করুন';
                        workpicGalleryLoading.className = 'admin-msg err';
                    }
                });
        }

        function renderWorkpicThumbs() {
            workpicThumbs.innerHTML = '';
            workpicSelectedFiles.forEach((file, idx) => {
                const div = document.createElement('div');
                div.className = 'upload-thumb';
                div.innerHTML = `
                    <img src="${URL.createObjectURL(file)}" alt="">
                    <button type="button" class="thumb-remove" title="Remove">×</button>
                `;
                div.querySelector('.thumb-remove').addEventListener('click', () => {
                    workpicSelectedFiles.splice(idx, 1);
                    renderWorkpicThumbs();
                    workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
                });
                workpicThumbs.appendChild(div);
            });
        }

        workpicFileInput.addEventListener('change', () => {
            workpicSelectedFiles = Array.from(workpicFileInput.files || []);
            renderWorkpicThumbs();
            workpicSendBtn.disabled = workpicSelectedFiles.length === 0;
            workpicMsg.textContent = '';
        });

        function uploadOneWorkpicFile(file) {
            return fileToBase64(file).then(base64 => {
                return fetch(WORKPIC_APPS_SCRIPT_URL, {
                    method: 'POST',
                    body: JSON.stringify({
                        password: WORKPIC_PASSWORD,
                        image: base64,
                        mimeType: file.type,
                        filename: file.name
                    })
                })
                .then(r => r.json())
                .catch(() => ({ success: false, error: 'Network error' }));
            });
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

            let done = 0, failed = 0;
            function next(i) {
                if (i >= workpicSelectedFiles.length) {
                    workpicMsg.textContent = failed === 0
                        ? `✅ All ${done} file(s) uploaded to Drive successfully!`
                        : `✅ ${done} succeeded, ❌ ${failed} failed`;
                    workpicMsg.className = failed === 0 ? 'admin-msg ok' : 'admin-msg err';
                    workpicSendBtn.disabled = false;
                    if (done > 0) loadWorkpicGallery();
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
                    if (res && res.success) done++; else failed++;
                    workpicDoneCount.textContent = done + failed;
                    workpicProgressFill.style.width = ((done + failed) / workpicSelectedFiles.length * 100) + '%';
                    next(i + 1);
                });
            }
            next(0);
        });
    })();
