/* ============================================================
   workpic.js
   Work Pic feature: password-locked full-page file dashboard
   (upload any file type, folders, gallery, move/copy/rename/delete,
   lightbox) backed by Google Drive via Apps Script.
   Loaded by index.html via <script src="workpic.js">.
   Depends on globals already defined in index.html's main script:
   dlImg, shareImg.

   SINGLE-ACCOUNT VERSION — the old multi-account router logic
   (resolveBackend, listMerged, per-item "account" tagging) has been
   removed. Everything now talks to one Apps Script deployment.
   ============================================================ */
const WORKPIC_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyaP3hpU471aMaRTHaJo5yG5MqG4EyaR8U4Yo1pyrmU-YleGRXfwOMpac8QXyNx5u1Mlw/exec';
let WORKPIC_PASSWORD = '';
const WORKPIC_CACHE_PREFIX = 'workpicGalleryCache_v2_';

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
        let workpicFolders = [];
        let workpicLbIdx = 0;
        let workpicCurrentFolderId = null; // null = "not yet loaded"; resolves to real root id after first load
        let workpicRootFolderId = null;
        let workpicDragItem = null; // { id, type, name } of the tile currently being dragged

        // Folder-picker modal state (used by "Move to..." / "Copy to...")
        let workpicPickerMode = null;   // 'move' | 'copy'
        let workpicPickerItem = null;   // { id, type, name }
        let workpicPickerFolderId = null;
        let workpicBreadcrumbBar, workpicPickerOverlay, workpicPickerTitleEl,
            workpicPickerBreadcrumbEl, workpicPickerListEl, workpicPickerConfirmBtn, workpicPickerCloseBtn;

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
            const downloadUrl = img.source === 'imgbb'
                ? img.url
                : 'https://drive.google.com/uc?export=download&id=' + img.id;
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

        injectWorkpicExtras();

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
            workpicLockMsg.textContent = 'Checking...';
            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: entered, action: 'verify' })
            })
            .then(r => r.json())
            .then(res => {
                workpicUnlockBtn.disabled = false;
                if (res.success) {
                    WORKPIC_PASSWORD = entered;
                    workpicLockOverlay.classList.remove('open');
                    resetWorkpicUploadFlow();
                    workpicUploadOverlay.classList.add('open');
                    workpicCurrentFolderId = null;
                    workpicRootFolderId = null;
                    loadWorkpicGallery(null);
                } else {
                    workpicLockMsg.textContent = res.error || 'Wrong password';
                }
            })
            .catch(() => {
                workpicUnlockBtn.disabled = false;
                workpicLockMsg.textContent = 'Network error, try again';
            });
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

        // ------------------------------------------------------------
        // Extra UI: breadcrumb bar, context menu, folder-picker modal.
        // Built entirely in JS so index.html doesn't need to change.
        // ------------------------------------------------------------
        function injectWorkpicExtras() {
            const style = document.createElement('style');
            style.textContent = `
                .wp-crumb-bar { display:flex; flex-wrap:wrap; align-items:center; gap:4px; margin-bottom:10px; font-size:14px; }
                .wp-crumb { cursor:pointer; color:#4a90d9; padding:2px 4px; border-radius:4px; }
                .wp-crumb:hover { background:rgba(74,144,217,0.12); }
                .wp-crumb-current { color:inherit; cursor:default; font-weight:600; }
                .wp-crumb-current:hover { background:none; }
                .wp-crumb-sep { opacity:0.5; }
                .wp-folder-icon { font-size:44px; line-height:1; display:flex; align-items:center; justify-content:center; height:100%; user-select:none; }
                .wp-folder-item { cursor:pointer; }
                .wp-drag-over { outline:2px dashed #4a90d9; outline-offset:-2px; background:rgba(74,144,217,0.08); }
                .wp-context-menu { position:fixed; z-index:9999; background:#1e1e1e; color:#fff; border-radius:8px; box-shadow:0 4px 20px rgba(0,0,0,0.35); padding:4px; min-width:190px; overflow:hidden; }
                .wp-context-menu-item { display:block; width:100%; text-align:left; background:none; border:none; color:inherit; padding:8px 12px; font-size:14px; cursor:pointer; border-radius:6px; }
                .wp-context-menu-item:hover { background:rgba(255,255,255,0.12); }
                .wp-context-menu-item.wp-danger { color:#ff6b6b; }
                .wp-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.55); display:none; align-items:center; justify-content:center; z-index:9998; }
                .wp-modal-overlay.open { display:flex; }
                .wp-modal-panel { background:#1e1e1e; color:#fff; border-radius:10px; width:min(420px, 90vw); max-height:80vh; display:flex; flex-direction:column; padding:16px; }
                .wp-picker-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; font-weight:600; gap:10px; }
                .wp-picker-header button { background:none; border:none; color:inherit; font-size:18px; cursor:pointer; flex-shrink:0; }
                .wp-picker-list { flex:1; overflow-y:auto; min-height:120px; margin:8px 0; }
                .wp-picker-row { padding:8px 10px; border-radius:6px; cursor:pointer; }
                .wp-picker-row:hover { background:rgba(255,255,255,0.1); }
                .wp-picker-confirm { width:100%; padding:10px; border:none; border-radius:6px; background:#4a90d9; color:#fff; font-weight:600; cursor:pointer; margin-top:6px; }
            `;
            document.head.appendChild(style);

            workpicBreadcrumbBar = document.createElement('div');
            workpicBreadcrumbBar.id = 'workpicBreadcrumbBar';
            workpicBreadcrumbBar.className = 'wp-crumb-bar';
            workpicGalleryWrap.insertBefore(workpicBreadcrumbBar, workpicGalleryWrap.firstChild);

            workpicPickerOverlay = document.createElement('div');
            workpicPickerOverlay.id = 'workpicPickerOverlay';
            workpicPickerOverlay.className = 'wp-modal-overlay';
            workpicPickerOverlay.innerHTML = `
                <div class="wp-modal-panel">
                    <div class="wp-picker-header">
                        <span id="workpicPickerTitle"></span>
                        <button type="button" id="workpicPickerClose">✕</button>
                    </div>
                    <div id="workpicPickerBreadcrumb" class="wp-crumb-bar"></div>
                    <div id="workpicPickerList" class="wp-picker-list"></div>
                    <button type="button" id="workpicPickerConfirm" class="wp-picker-confirm"></button>
                </div>
            `;
            document.body.appendChild(workpicPickerOverlay);

            workpicPickerTitleEl      = document.getElementById('workpicPickerTitle');
            workpicPickerBreadcrumbEl = document.getElementById('workpicPickerBreadcrumb');
            workpicPickerListEl       = document.getElementById('workpicPickerList');
            workpicPickerConfirmBtn   = document.getElementById('workpicPickerConfirm');
            workpicPickerCloseBtn     = document.getElementById('workpicPickerClose');
            workpicPickerCloseBtn.addEventListener('click', closeWorkpicFolderPicker);
            workpicPickerOverlay.addEventListener('click', (e) => {
                if (e.target === workpicPickerOverlay) closeWorkpicFolderPicker();
            });
            workpicPickerConfirmBtn.addEventListener('click', () => {
                if (!workpicPickerItem || !workpicPickerFolderId) return;
                if (workpicPickerItem.type === 'folder' && workpicPickerItem.id === workpicPickerFolderId) {
                    alert('একটা ফোল্ডারকে নিজের ভেতরে সরানো/কপি করা যাবে না');
                    return;
                }
                if (workpicPickerMode === 'move') {
                    performWorkpicMove(workpicPickerItem.id, workpicPickerItem.type, workpicPickerFolderId);
                } else {
                    performWorkpicCopy(workpicPickerItem.id, workpicPickerItem.type, workpicPickerFolderId);
                }
                closeWorkpicFolderPicker();
            });

            // right-click on empty gallery space -> "New folder"
            workpicGallery.addEventListener('contextmenu', (e) => {
                if (e.target !== workpicGallery) return; // tile clicks handle their own menu + stopPropagation
                e.preventDefault();
                showWorkpicMenu(e.clientX, e.clientY, [
                    { label: '📁 নতুন ফোল্ডার', onClick: () => createWorkpicFolder(workpicCurrentFolderId) }
                ]);
            });

            document.addEventListener('click', hideWorkpicContextMenu);
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideWorkpicContextMenu(); });

            // allow uploading any file type, multiple at once
            workpicFileInput.removeAttribute('accept');
            workpicFileInput.multiple = true;
        }

        // ------------------------------------------------------------
        // Context menu
        // ------------------------------------------------------------
        function showWorkpicMenu(x, y, menuItems) {
            hideWorkpicContextMenu();
            const menu = document.createElement('div');
            menu.id = 'workpicContextMenu';
            menu.className = 'wp-context-menu';
            menuItems.forEach(mi => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'wp-context-menu-item' + (mi.danger ? ' wp-danger' : '');
                btn.textContent = mi.label;
                btn.addEventListener('click', () => {
                    hideWorkpicContextMenu();
                    mi.onClick();
                });
                menu.appendChild(btn);
            });
            document.body.appendChild(menu);

            const rect = menu.getBoundingClientRect();
            const left = Math.min(x, window.innerWidth - rect.width - 8);
            const top  = Math.min(y, window.innerHeight - rect.height - 8);
            menu.style.left = Math.max(8, left) + 'px';
            menu.style.top  = Math.max(8, top) + 'px';
        }

        function hideWorkpicContextMenu() {
            const existing = document.getElementById('workpicContextMenu');
            if (existing) existing.remove();
        }

        function showWorkpicItemMenu(x, y, item) {
            const items = [];
            if (item.type === 'folder') {
                items.push({ label: '📂 খুলুন', onClick: () => navigateWorkpicFolder(item.id) });
            }
            items.push({ label: '➡️ সরান (Move to...)', onClick: () => openWorkpicFolderPicker('move', item) });
            items.push({ label: '📋 কপি করুন (Copy to...)', onClick: () => openWorkpicFolderPicker('copy', item) });
            items.push({ label: '✎ নাম বদলান', onClick: () => renameWorkpicItem(item) });
            items.push({ label: '✕ ডিলেট করুন', danger: true, onClick: () => deleteWorkpicItem(item.id, item.name, item.type, null) });
            showWorkpicMenu(x, y, items);
        }

        // ------------------------------------------------------------
        // Folder create / rename / delete / move / copy
        // ------------------------------------------------------------
        function createWorkpicFolder(parentId) {
            const name = window.prompt('ফোল্ডারের নাম দিন:');
            if (!name || !name.trim()) return;
            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: WORKPIC_PASSWORD, action: 'createFolder', name: name.trim(), parentId })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    invalidateWorkpicCache();
                    loadWorkpicGallery(workpicCurrentFolderId);
                } else {
                    alert('ফোল্ডার তৈরি করা যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন'));
        }

        function renameWorkpicItem(item) {
            const newName = window.prompt('নতুন নাম দিন:', item.name || '');
            if (!newName || !newName.trim() || newName.trim() === item.name) return;
            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: WORKPIC_PASSWORD, action: 'rename', itemId: item.id, itemType: item.type, newName: newName.trim() })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    invalidateWorkpicCache();
                    loadWorkpicGallery(workpicCurrentFolderId);
                } else {
                    alert('নাম বদলানো যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন'));
        }

        function deleteWorkpicItem(id, name, type, itemEl) {
            const label = type === 'folder' ? 'ফোল্ডার' : 'ফাইল';
            const ok = window.confirm('এই ' + label + 'টা ডিলেট করতে চান? (' + (name || '') + ')');
            if (!ok) return;

            if (itemEl) {
                itemEl.style.opacity = '0.4';
                itemEl.style.pointerEvents = 'none';
            }

            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: WORKPIC_PASSWORD, action: 'delete', fileId: id, itemType: type })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    invalidateWorkpicCache();
                    loadWorkpicGallery(workpicCurrentFolderId);
                } else {
                    if (itemEl) { itemEl.style.opacity = '1'; itemEl.style.pointerEvents = 'auto'; }
                    alert('ডিলেট করা যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => {
                if (itemEl) { itemEl.style.opacity = '1'; itemEl.style.pointerEvents = 'auto'; }
                alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন');
            });
        }

        function performWorkpicMove(itemId, itemType, targetFolderId) {
            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: WORKPIC_PASSWORD, action: 'move', itemId, itemType, targetFolderId })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    invalidateWorkpicCache();
                    loadWorkpicGallery(workpicCurrentFolderId);
                } else {
                    alert('সরানো যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন'));
        }

        function performWorkpicCopy(itemId, itemType, targetFolderId) {
            fetch(WORKPIC_APPS_SCRIPT_URL, {
                method: 'POST',
                body: JSON.stringify({ password: WORKPIC_PASSWORD, action: 'copy', itemId, itemType, targetFolderId })
            })
            .then(r => r.json())
            .then(res => {
                if (res && res.success) {
                    invalidateWorkpicCache();
                    loadWorkpicGallery(workpicCurrentFolderId);
                } else {
                    alert('কপি করা যায়নি: ' + ((res && res.error) || 'Unknown error'));
                }
            })
            .catch(() => alert('নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন'));
        }

        function invalidateWorkpicCache() {
            try {
                Object.keys(sessionStorage)
                    .filter(k => k.startsWith(WORKPIC_CACHE_PREFIX))
                    .forEach(k => sessionStorage.removeItem(k));
            } catch (e) { /* ignore */ }
        }

        // ------------------------------------------------------------
        // Folder-picker modal (for "Move to..." / "Copy to...")
        // ------------------------------------------------------------
        function openWorkpicFolderPicker(mode, item) {
            workpicPickerMode = mode;
            workpicPickerItem = item;
            workpicPickerTitleEl.textContent = (mode === 'move' ? 'সরান: ' : 'কপি করুন: ') + (item.name || '');
            workpicPickerConfirmBtn.textContent = mode === 'move' ? 'এখানে সরান' : 'এখানে কপি করুন';
            workpicPickerOverlay.classList.add('open');
            loadWorkpicPickerFolder(null);
        }

        function closeWorkpicFolderPicker() {
            workpicPickerOverlay.classList.remove('open');
            workpicPickerItem = null;
        }

        function loadWorkpicPickerFolder(folderId) {
            workpicPickerListEl.innerHTML = '<p class="admin-msg">Loading...</p>';
            const qs = folderId ? ('?folderId=' + encodeURIComponent(folderId)) : '';
            fetch(WORKPIC_APPS_SCRIPT_URL + qs)
                .then(r => r.json())
                .then(res => {
                    if (!res || res.success !== true) {
                        workpicPickerListEl.innerHTML = '<p class="admin-msg err">লোড করা যায়নি</p>';
                        return;
                    }
                    workpicPickerFolderId = res.folderId;
                    renderWorkpicPickerBreadcrumb(res.breadcrumbs || []);
                    renderWorkpicPickerList(res.folders || []);
                })
                .catch(() => { workpicPickerListEl.innerHTML = '<p class="admin-msg err">নেটওয়ার্ক সমস্যা</p>'; });
        }

        function renderWorkpicPickerBreadcrumb(crumbs) {
            workpicPickerBreadcrumbEl.innerHTML = '';
            crumbs.forEach((c, i) => {
                const isLast = i === crumbs.length - 1;
                const span = document.createElement('span');
                span.className = 'wp-crumb' + (isLast ? ' wp-crumb-current' : '');
                span.textContent = c.name;
                if (!isLast) span.addEventListener('click', () => loadWorkpicPickerFolder(c.id));
                workpicPickerBreadcrumbEl.appendChild(span);
                if (!isLast) {
                    const sep = document.createElement('span');
                    sep.className = 'wp-crumb-sep';
                    sep.textContent = '›';
                    workpicPickerBreadcrumbEl.appendChild(sep);
                }
            });
        }

        function renderWorkpicPickerList(folders) {
            workpicPickerListEl.innerHTML = '';
            if (folders.length === 0) {
                workpicPickerListEl.innerHTML = '<p class="admin-msg">কোনো সাবফোল্ডার নেই</p>';
                return;
            }
            folders.forEach(f => {
                const row = document.createElement('div');
                row.className = 'wp-picker-row';
                row.textContent = '📁 ' + f.name;
                row.addEventListener('click', () => loadWorkpicPickerFolder(f.id));
                workpicPickerListEl.appendChild(row);
            });
        }

        // ------------------------------------------------------------
        // File-type icon fallback (used when a thumbnail fails to load,
        // e.g. non-image files like pdf/doc/zip)
        // ------------------------------------------------------------
        function workpicFileIcon(mimeType, name) {
            const ext = (name || '').split('.').pop().toLowerCase();
            if (mimeType && mimeType.startsWith('video/')) return '🎬';
            if (mimeType && mimeType.startsWith('audio/')) return '🎵';
            if (mimeType === 'application/pdf' || ext === 'pdf') return '📕';
            if (['doc', 'docx'].includes(ext)) return '📄';
            if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
            if (['ppt', 'pptx'].includes(ext)) return '📽️';
            if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
            if (['txt', 'md'].includes(ext)) return '📝';
            return '📦';
        }

        // ------------------------------------------------------------
        // Breadcrumb + gallery rendering
        // ------------------------------------------------------------
        function navigateWorkpicFolder(folderId) {
            if (folderId === 'root') { loadWorkpicGallery(null); return; }
            loadWorkpicGallery(folderId);
        }

        function renderWorkpicBreadcrumbs(crumbs) {
            if (!workpicBreadcrumbBar) return;
            workpicBreadcrumbBar.innerHTML = '';
            crumbs.forEach((c, i) => {
                const isLast = i === crumbs.length - 1;
                const span = document.createElement('span');
                span.className = 'wp-crumb' + (isLast ? ' wp-crumb-current' : '');
                span.textContent = c.name;
                if (!isLast) {
                    span.addEventListener('click', () => navigateWorkpicFolder(c.id));
                    span.addEventListener('dragover', (e) => { e.preventDefault(); span.classList.add('wp-drag-over'); });
                    span.addEventListener('dragleave', () => span.classList.remove('wp-drag-over'));
                    span.addEventListener('drop', (e) => {
                        e.preventDefault();
                        span.classList.remove('wp-drag-over');
                        if (!workpicDragItem) return;
                        performWorkpicMove(workpicDragItem.id, workpicDragItem.type, c.id);
                        workpicDragItem = null;
                    });
                }
                workpicBreadcrumbBar.appendChild(span);
                if (!isLast) {
                    const sep = document.createElement('span');
                    sep.className = 'wp-crumb-sep';
                    sep.textContent = '›';
                    workpicBreadcrumbBar.appendChild(sep);
                }
            });
        }

        function attachWorkpicDragHandlers(el, itemInfo) {
            el.addEventListener('dragstart', (e) => {
                workpicDragItem = itemInfo;
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', itemInfo.id); } catch (err) { /* ignore */ }
            });
            el.addEventListener('dragend', () => { workpicDragItem = null; });

            if (itemInfo.type === 'folder') {
                el.addEventListener('dragover', (e) => {
                    if (!workpicDragItem || workpicDragItem.id === itemInfo.id) return;
                    e.preventDefault();
                    el.classList.add('wp-drag-over');
                });
                el.addEventListener('dragleave', () => el.classList.remove('wp-drag-over'));
                el.addEventListener('drop', (e) => {
                    e.preventDefault();
                    el.classList.remove('wp-drag-over');
                    if (!workpicDragItem || workpicDragItem.id === itemInfo.id) return;
                    performWorkpicMove(workpicDragItem.id, workpicDragItem.type, itemInfo.id);
                    workpicDragItem = null;
                });
            }
        }

        function renderWorkpicGallery(folders, files) {
            workpicGallery.innerHTML = '';

            if (folders.length === 0 && files.length === 0) {
                workpicGallery.innerHTML = '<p class="workpic-gallery-empty">এই ফোল্ডারে এখনো কিছু নেই। খালি জায়গায় রাইট-ক্লিক করে নতুন ফোল্ডার বানাতে পারেন।</p>';
                return;
            }

            folders.forEach(folder => {
                const item = document.createElement('div');
                item.className = 'workpic-gallery-item wp-folder-item';
                item.draggable = true;
                item.innerHTML = `
                    <div class="wp-folder-icon">📁</div>
                    <span class="wp-name">${folder.name}</span>
                `;
                item.addEventListener('click', () => navigateWorkpicFolder(folder.id));
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showWorkpicItemMenu(e.clientX, e.clientY, { id: folder.id, type: 'folder', name: folder.name });
                });
                attachWorkpicDragHandlers(item, { id: folder.id, type: 'folder', name: folder.name });
                workpicGallery.appendChild(item);
            });

            files.forEach((img) => {
                const downloadUrl = img.source === 'imgbb'
                    ? img.url
                    : 'https://drive.google.com/uc?export=download&id=' + img.id;
                const isImage = (img.mimeType || '').startsWith('image/');

                const item = document.createElement('div');
                item.className = 'workpic-gallery-item';
                item.draggable = true;

                const link = document.createElement('a');
                link.href = img.viewUrl || img.url;
                link.rel = 'noopener';

                const thumb = document.createElement('img');
                thumb.src = img.url;
                thumb.alt = img.name || '';
                thumb.loading = 'lazy';
                thumb.decoding = 'async';
                thumb.addEventListener('error', () => {
                    const icon = document.createElement('div');
                    icon.className = 'wp-folder-icon';
                    icon.textContent = workpicFileIcon(img.mimeType, img.name);
                    thumb.replaceWith(icon);
                }, { once: true });
                link.appendChild(thumb);

                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (isImage) {
                        openWorkpicLightbox(workpicImages.indexOf(img));
                    } else {
                        window.open(img.viewUrl || img.url, '_blank', 'noopener');
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
                    <button type="button" class="wp-action-btn wp-delete" title="Delete">✕</button>
                `;
                actions.querySelector('.wp-dl').addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    dlImg(downloadUrl, img.name || 'work-file');
                });
                actions.querySelector('.wp-share').addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    shareImg(downloadUrl, img.name || 'work-file', img.name || 'Work Pic');
                });
                actions.querySelector('.wp-delete').addEventListener('click', (e) => {
                    e.preventDefault(); e.stopPropagation();
                    deleteWorkpicItem(img.id, img.name, 'file', item);
                });

                item.appendChild(link);
                item.appendChild(nameEl);
                item.appendChild(actions);

                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showWorkpicItemMenu(e.clientX, e.clientY, { id: img.id, type: 'file', name: img.name });
                });

                attachWorkpicDragHandlers(item, { id: img.id, type: 'file', name: img.name });
                workpicGallery.appendChild(item);
            });
        }

        function loadWorkpicGallery(folderId) {
            const cacheKey = WORKPIC_CACHE_PREFIX + (folderId || 'root');
            let usedCache = false;

            // Show cached results instantly (super fast open), then refresh quietly in the background
            try {
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (parsed && Array.isArray(parsed.files) && Array.isArray(parsed.folders)) {
                        workpicImages = parsed.files;
                        workpicFolders = parsed.folders;
                        workpicGalleryLoading.style.display = 'none';
                        renderWorkpicBreadcrumbs(parsed.breadcrumbs || []);
                        renderWorkpicGallery(parsed.folders, parsed.files);
                        usedCache = true;
                    }
                }
            } catch (e) { /* ignore cache errors */ }

            if (!usedCache) {
                workpicGalleryLoading.style.display = 'block';
                workpicGalleryLoading.textContent = 'Loading...';
                workpicGalleryLoading.className = 'admin-msg';
                workpicGallery.innerHTML = '';
            }

            const qs = folderId ? ('?folderId=' + encodeURIComponent(folderId)) : '';

            fetch(WORKPIC_APPS_SCRIPT_URL + qs)
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

                    workpicCurrentFolderId = res.folderId;
                    if (!workpicRootFolderId) workpicRootFolderId = res.folderId;

                    const files = Array.isArray(res.images) ? res.images : [];
                    const folders = Array.isArray(res.folders) ? res.folders : [];
                    workpicImages = files;
                    workpicFolders = folders;

                    try {
                        sessionStorage.setItem(cacheKey, JSON.stringify({
                            files, folders, breadcrumbs: res.breadcrumbs || []
                        }));
                    } catch (e) { /* ignore */ }

                    renderWorkpicBreadcrumbs(res.breadcrumbs || []);
                    renderWorkpicGallery(folders, files);
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
                const isImage = file.type && file.type.startsWith('image/');
                div.innerHTML = isImage
                    ? `<img src="${URL.createObjectURL(file)}" alt=""><button type="button" class="thumb-remove" title="Remove">×</button>`
                    : `<div class="wp-folder-icon">${workpicFileIcon(file.type, file.name)}</div><button type="button" class="thumb-remove" title="Remove">×</button>`;
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
                        filename: file.name,
                        parentId: workpicCurrentFolderId
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

            startWorkpicUploadBatch();
        });

        function startWorkpicUploadBatch() {
            let done = 0, failed = 0;
            function next(i) {
                if (i >= workpicSelectedFiles.length) {
                    workpicMsg.textContent = failed === 0
                        ? `✅ All ${done} file(s) uploaded successfully!`
                        : `✅ ${done} succeeded, ❌ ${failed} failed`;
                    workpicMsg.className = failed === 0 ? 'admin-msg ok' : 'admin-msg err';
                    workpicSendBtn.disabled = false;
                    if (done > 0) {
                        invalidateWorkpicCache();
                        loadWorkpicGallery(workpicCurrentFolderId);
                    }
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
        }
    })();
