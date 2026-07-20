/* ============================================================
   admin-upload.js
   Photo Gallery Admin: Upload + Face-Tag flow for Tonir Shaik's
   gallery site. Loaded by index.html via <script src="admin-upload.js">.
   Depends on globals already defined in index.html's main script:
   csvUrl, APPS_SCRIPT_URL, allPhotos, applyFiltersAndSearch,
   buildStrip, parsePhotoFile, fetchLiveUploads, buildMergedPhotoList,
   dlImg, shareImg.

   NOTE: intentionally NOT wrapped in an IIFE. face-recognition.js
   (loaded separately) reads/calls several of this file's top-level
   variables and functions directly (e.g. selectedPhotos, currentTagIdx,
   tagFacesList, addUploadPerson, showTagStep, onPhotoUploadedForFaceLearning
   hook). Wrapping this in an IIFE hides them from face-recognition.js and
   breaks the "✓ ঠিক আছে / ✕ না" face-match buttons.
   ============================================================ */
const ADMIN_PASSWORD = 'uplo@d2002';

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
    }

    adminLockClose.addEventListener('click', () => adminLockOverlay.classList.remove('open'));
    adminLockOverlay.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) adminLockOverlay.classList.remove('open');
    });

    function tryUnlock() {
        if (adminPasswordInput.value === ADMIN_PASSWORD) {
            adminLockOverlay.classList.remove('open');
            resetUploadFlow();
            adminUploadOverlay.classList.add('open');
            document.body.classList.add('admin-mode');
        } else {
            adminLockMsg.textContent = 'Wrong password';
        }
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
        adminUnlockBtn.style.display = (adminPasswordInput.value === ADMIN_PASSWORD) ? 'block' : 'none';
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

    function compressImage(file, maxDim, quality) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('file-read-failed'));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error('image-decode-failed'));
                img.onload = () => {
                    let { width, height } = img;
                    if (width > maxDim || height > maxDim) {
                        if (width > height) {
                            height = Math.round(height * (maxDim / width));
                            width = maxDim;
                        } else {
                            width = Math.round(width * (maxDim / height));
                            height = maxDim;
                        }
                    }
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', quality));
                    } catch (e) {
                        reject(e);
                    }
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function prepareFile(file) {
        return compressImage(file, 1600, 0.82)
            .then(dataUrl => ({ base64: dataUrl, mime: 'image/jpeg' }))
            .catch(() => new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve({ base64: reader.result, mime: file.type });
                reader.onerror = () => reject(new Error('file-read-failed'));
                reader.readAsDataURL(file);
            }));
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
                .then(({ base64, mime }) => ({ base64, mime, name: file.name, tagIdxs: new Set() }))
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
                <button type="button" class="tag-face-edit-btn" title="এই নামটি ঠিক করো"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="thumb-remove" title="Remove this name" style="position:static; flex-shrink:0;">×</button>
            `;
            row.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) photo.tagIdxs.add(idx);
                else photo.tagIdxs.delete(idx);
                row.classList.toggle('checked', e.target.checked);
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
            <button type="button" class="tag-face-rename-save" title="Save"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="tag-face-rename-cancel" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
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

    function showTagStep(idx) {
        currentTagIdx = idx;
        const photo = selectedPhotos[idx];
        tagPreviewImg.src = photo.base64;
        tagPhotoNum.textContent = idx + 1;
        tagPhotoTotal.textContent = selectedPhotos.length;
        tagProgressFill.style.width = ((idx + 1) / selectedPhotos.length * 100) + '%';
        tagPrevBtn.disabled = idx === 0;
        tagNextBtn.textContent = (idx === selectedPhotos.length - 1) ? 'Upload All ✓' : 'Next →';

        const faceResultsEl = document.getElementById('faceDetectResults');
        const faceStatusEl = document.getElementById('faceDetectStatus');
        const faceBtn = document.getElementById('faceDetectTestBtn');
        if (faceResultsEl) faceResultsEl.innerHTML = '';
        if (faceStatusEl) faceStatusEl.textContent = '';
        if (faceBtn) faceBtn.disabled = false;

        renderTagFaces();
    }

    function quickAddTagPerson() {
        const rawName = (tagQuickAddInput.value || '').trim();
        const idx = addUploadPerson(rawName);
        if (idx === null) return;
        selectedPhotos[currentTagIdx].tagIdxs.add(idx);

        if (!isBanglaText(rawName)) {
            const banglaName = banglaPhonetic(rawName);
            if (banglaName && banglaName.toLowerCase() !== rawName.toLowerCase()) {
                const bIdx = addUploadPerson(banglaName);
                if (bIdx !== null) selectedPhotos[currentTagIdx].tagIdxs.add(bIdx);
            }
        }

        tagQuickAddInput.value = '';
        adminUploadMsg.textContent = '';
        renderTagFaces();
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

    function deletePhotoConfirm(fileId, btnEl) {
        if (!confirm('Are you sure you want to permanently delete this photo?')) return;

        const item = btnEl.closest('.photo-item, .strip-item');
        if (item) item.style.opacity = '0.4';
        btnEl.disabled = true;

        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'delete',
                fileId: fileId
            })
        })
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

    function deleteTextPhotoConfirm(rawUrl, btnEl) {
        if (!confirm('Are you sure you want to permanently delete this photo? (removes it from the source file)')) return;

        const item = btnEl.closest('.photo-item, .strip-item');
        if (item) item.style.opacity = '0.4';
        btnEl.disabled = true;

        fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                action: 'deleteText',
                url: rawUrl
            })
        })
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
                <button type="button" class="tag-face-edit-btn" title="Edit name"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="tag-face-delete-btn" title="Delete this tag entirely"><i class="fa-solid fa-trash"></i></button>
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
            <button type="button" class="tag-face-rename-save" title="Save"><i class="fa-solid fa-check"></i></button>
            <button type="button" class="tag-face-rename-cancel" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
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

        editTagSaveBtn.disabled = true;
        editTagPrevBtn.disabled = true;
        editTagNextBtn.disabled = true;
        editTagMsg.textContent = 'Saving...';
        editTagMsg.className = 'admin-msg';

        const payload = photo.fileId
            ? { password: ADMIN_PASSWORD, action: 'updateCaption', fileId: photo.fileId, caption: newNamesStr }
            : { password: ADMIN_PASSWORD, action: 'updateText', url: photo.rawUrl, names: newNamesStr };

        return fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify(payload) })
            .then(r => r.json())
            .then(res => {
                editTagSaveBtn.disabled = false;
                if (res.success) {
                    photo.names = newNamesStr;
                    photo.title = newNamesStr || photo.title;
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

    function uploadOnePhoto(photo) {
        const caption = Array.from(photo.tagIdxs).map(i => uploadPeople[i]).join(', ');
        return fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            body: JSON.stringify({
                password: ADMIN_PASSWORD,
                image: photo.base64,
                mimeType: photo.mime,
                filename: photo.name,
                caption: caption
            })
        })
        .then(r => r.json())
        .catch(() => ({ success: false, error: 'Network error' }));
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
                refreshGalleryWithLiveUploads(4);
                setTimeout(() => {
                    adminUploadOverlay.classList.remove('open');
                    resetUploadFlow();
                }, 2500);
                return;
            }
            uploadOnePhoto(selectedPhotos[i]).then(res => {
                if (res && res.success) {
                    done++;
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

    function refreshGalleryWithLiveUploads(attemptsLeft) {
        attemptsLeft = (typeof attemptsLeft === 'number') ? attemptsLeft : 0;
        try {
            fetch(csvUrl).then(r => r.text()).catch(() => '').then(textData => {
                const oldPhotos = textData ? parsePhotoFile(textData) : [];
                fetchLiveUploads().then(liveImages => {
                    try {
                        allPhotos = buildMergedPhotoList(oldPhotos, liveImages);
                        document.getElementById('photoCount').textContent = allPhotos.length;
                        applyFiltersAndSearch();
                        buildStrip(allPhotos);
                    } catch (e) {
                    }
                });
            }).catch(() => {  });
        } catch (e) {  }

        if (attemptsLeft > 0) {
            setTimeout(() => refreshGalleryWithLiveUploads(attemptsLeft - 1), 4000);
        }
    }
