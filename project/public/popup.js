document.addEventListener('DOMContentLoaded', () => {
  const openShortcuts = document.getElementById('open-shortcuts');
  const toggleDelete = document.getElementById('toggle-delete');
  const markerColorInput = document.getElementById('markerColor');
  const markerLabelPreview = document.createElement('div');
  markerLabelPreview.style.fontSize = '12px';
  markerLabelPreview.style.color = '#555';
  markerLabelPreview.style.marginTop = '4px';
  markerColorInput?.parentElement?.appendChild(markerLabelPreview);

  const normalizeColor = (color) => String(color || '').trim().toLowerCase();
  const normalizeLabel = (label) => String(label || '').trim().toLowerCase();

  const createBookId = () => {
    return globalThis.crypto?.randomUUID?.() ?? `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  };

  const normalizeWordBooks = (books) => {
    const seenIds = new Set();
    const seenLabels = new Set();
    return (books || []).reduce((acc, book) => {
      const bookId = String(book?.bookId || book?.id || '').trim();
      const label = String(book?.markerLabel || '').trim();
      if (!bookId || !label) return acc;

      const idKey = bookId.toLowerCase();
      const labelKey = label.toLowerCase();
      if (seenIds.has(idKey) || seenLabels.has(labelKey)) return acc;

      seenIds.add(idKey);
      seenLabels.add(labelKey);
      acc.push({
        bookId,
        id: bookId,
        markerColor: book?.markerColor || '#FFFF00',
        markerLabel: label,
      });
      return acc;
    }, []);
  };

  const getWordBooks = (callback) => {
    chrome.storage.local.get(['wordBook'], (res) => {
      const sets = normalizeWordBooks((res && Array.isArray(res.wordBook)) ? res.wordBook : []);
      callback(sets);
    });
  };

  const syncLabelByColor = (color) => {
    const target = normalizeColor(color);
    getWordBooks((sets) => {
      const matched = sets.find((s) => normalizeColor(s.markerColor) === target);
      const label = matched?.markerLabel || '未登録の色';
      if (newLabelInput && matched?.markerLabel) {
        newLabelInput.value = matched.markerLabel;
      }
      markerLabelPreview.textContent = `ラベル: ${label}`;
      chrome.storage.local.set({
        markerColor: color,
        markerLabel: matched?.markerLabel || '',
        bookId: matched?.bookId || matched?.id || '',
      });
    });
  };

  openShortcuts.addEventListener('click', () => {
    // Open Chrome extensions shortcuts page in a new tab
    const url = 'chrome://extensions/shortcuts';
    try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
  });

  // init checkbox from storage
  chrome.storage.local.get(['showDeleteButton'], (res) => {
    toggleDelete.checked = !!res.showDeleteButton;
  });

  // init marker color from storage
  if (markerColorInput) {
    chrome.storage.local.get(['markerColor'], (res) => {
      if (res && res.markerColor) {
        markerColorInput.value = res.markerColor;
        syncLabelByColor(res.markerColor);
      }
    });

    markerColorInput.addEventListener('change', () => {
      const color = markerColorInput.value || '#FFFF00';
      syncLabelByColor(color);
      // notify active tab so UI can update immediately
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (typeof tabId === 'number') {
          try { chrome.tabs.sendMessage(tabId, { command: 'update-marker-color', color }); } catch (e) {}
        }
      });
    });
  }

  toggleDelete.addEventListener('change', () => {
    const enabled = toggleDelete.checked;
    chrome.storage.local.set({ showDeleteButton: enabled }, () => {
      // notify active tab to update UI
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (typeof tabId === 'number') {
          chrome.tabs.sendMessage(tabId, { command: 'update-delete-button' });
        }
      });
    });
  });

  // show current commands and shortcuts
  const commandsContainer = document.getElementById('commands');
  if (commandsContainer && chrome.commands && chrome.commands.getAll) {
    chrome.commands.getAll((cmds) => {
      commandsContainer.innerHTML = '';
      cmds.forEach((c) => {
        const row = document.createElement('div');
        row.style.marginBottom = '6px';
        const desc = document.createElement('div');
        desc.textContent = c.description || c.name || '';
        desc.style.fontSize = '13px';
        const key = document.createElement('div');
        key.textContent = c.shortcut && c.shortcut.length ? c.shortcut : '未割当';
        key.style.fontSize = '12px';
        key.style.color = '#333';
        const btn = document.createElement('button');
        btn.textContent = '変更';
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', () => {
          const url = 'chrome://extensions/shortcuts';
          try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
        });

        const line = document.createElement('div');
        line.appendChild(desc);
        line.appendChild(key);
        line.appendChild(btn);
        row.appendChild(line);
        commandsContainer.appendChild(row);
      });
    });
  }

  // --- marker sets (wordBook) handling ---
  const markerSetsContainer = document.getElementById('markerSets');
  const newBookIdInput = document.getElementById('newBookId');
  const newLabelInput = document.getElementById('newLabel');
  const addSetBtn = document.getElementById('addSet');

  function renderSets(sets) {
    if (!markerSetsContainer) return;
    markerSetsContainer.innerHTML = '';
    normalizeWordBooks(sets).forEach((s) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.marginBottom = '6px';

      const sw = document.createElement('div');
      sw.style.width = '20px';
      sw.style.height = '20px';
      sw.style.background = s.markerColor || '#FFFF00';
      sw.style.border = '1px solid #ccc';
      sw.style.borderRadius = '4px';
      sw.style.marginRight = '8px';

      const lbl = document.createElement('div');
      lbl.textContent = s.markerLabel || s.id || '(無名)';
      lbl.style.flex = '1';

      const idText = document.createElement('div');
      idText.textContent = s.bookId || s.id || '';
      idText.style.fontSize = '11px';
      idText.style.color = '#777';
      idText.style.marginRight = '8px';
      idText.style.maxWidth = '140px';
      idText.style.overflow = 'hidden';
      idText.style.textOverflow = 'ellipsis';
      idText.style.whiteSpace = 'nowrap';

      const choose = document.createElement('button');
      choose.textContent = '選択';
      choose.addEventListener('click', () => {
        const color = s.markerColor || '#FFFF00';
        const label = s.markerLabel || '';
        const bookId = s.bookId || s.id || '';
        if (markerColorInput) markerColorInput.value = color;
        if (newBookIdInput) newBookIdInput.value = bookId;
        if (newLabelInput) newLabelInput.value = label;
        markerLabelPreview.textContent = `ラベル: ${label || '未登録の色'}`;
        chrome.storage.local.set({ markerColor: color, markerLabel: label, bookId }, () => {
          // notify active tab
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs?.[0]?.id;
            if (typeof tabId === 'number') {
              try { chrome.tabs.sendMessage(tabId, { command: 'update-marker-color', color }); } catch (e) {}
            }
          });
        });
      });

      row.appendChild(sw);
      row.appendChild(lbl);
      row.appendChild(idText);
      row.appendChild(choose);
      markerSetsContainer.appendChild(row);
    });
  }

  // load and render existing sets
  chrome.storage.local.get(['wordBook'], (res) => {
    const sets = normalizeWordBooks((res && Array.isArray(res.wordBook)) ? res.wordBook : []);
    renderSets(sets);
  });

  // add new set from current color + input label
  if (addSetBtn) {
    addSetBtn.addEventListener('click', () => {
      const label = (newLabelInput && newLabelInput.value && newLabelInput.value.trim()) ? newLabelInput.value.trim() : null;
      if (!label) return;
      const color = (document.getElementById('markerColor') && document.getElementById('markerColor').value) ? document.getElementById('markerColor').value : '#FFFF00';
      const enteredBookId = (newBookIdInput && newBookIdInput.value && newBookIdInput.value.trim()) ? newBookIdInput.value.trim() : '';
      const id = enteredBookId || createBookId();
      chrome.storage.local.get(['wordBook'], (res) => {
        const existing = normalizeWordBooks((res && Array.isArray(res.wordBook)) ? res.wordBook : []);
        const existingByLabel = existing.find((item) => normalizeLabel(item.markerLabel) === normalizeLabel(label));
        const bookId = enteredBookId || existingByLabel?.bookId || existingByLabel?.id || id;
        const next = existing.filter((item) => {
          const sameId = normalizeLabel(item.bookId || item.id) === normalizeLabel(bookId);
          const sameLabel = normalizeLabel(item.markerLabel) === normalizeLabel(label);
          return !(sameId || sameLabel);
        });
        next.unshift({ bookId, id: bookId, markerColor: color, markerLabel: label });
        chrome.storage.local.set({ wordBook: next }, () => {
          renderSets(next);
          if (newLabelInput) newLabelInput.value = '';
          if (newBookIdInput) newBookIdInput.value = bookId;
          markerLabelPreview.textContent = `ラベル: ${label}`;
          chrome.storage.local.set({ markerColor: color, markerLabel: label, bookId });
        });
      });
    });
  }
});

// PDFマーカーを開くボタンの処理
document.addEventListener('DOMContentLoaded', () => {
  const openPdfBtn = document.getElementById('open-pdf-viewer');
  if (openPdfBtn) {
    openPdfBtn.addEventListener('click', () => {
      // 拡張機能内の pdf-viewer.html を新しいタブで開く
      chrome.tabs.create({ url: chrome.runtime.getURL('pdf-viewer.html') });
    });
  }
});
