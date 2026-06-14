// 30色の蛍光ペンカラーパレット配列
const PALETTE_COLORS = [
  '#ffcdd2', '#f8bbd0', '#e1bee7', '#d1c4e9', '#c5cae9', '#bbdefb', '#b2ebf2', '#b2dfdb', '#c8e6c9', '#fff9c4',
  '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#009688', '#4caf50', '#ffeb3b',
  '#ff0000', '#ff00ff', '#800080', '#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff9800', '#ff5722', '#9e9e9e'
];

document.addEventListener('DOMContentLoaded', () => {
  const openShortcuts = document.getElementById('open-shortcuts');
  const toggleDelete = document.getElementById('toggle-delete');
  const markerColorInput = document.getElementById('markerColor');
  const colorPaletteContainer = document.getElementById('colorPalette');
  const openPdfBtn = document.getElementById('open-pdf-viewer');

  // ラベルプレビュー要素の生成
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

  // ★ カラーパレットのボタンの選択表示を切り替える関数
  const updateColorUI = (colorStr) => {
    const normalizedColor = normalizeColor(colorStr || '#ffff00');
    if (markerColorInput) {
      markerColorInput.value = normalizedColor;
    }
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach(sw => {
      if (normalizeColor(sw.dataset.color) === normalizedColor) {
        sw.classList.add('selected');
      } else {
        sw.classList.remove('selected');
      }
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

  // ★ 1. カラーパレットボタンの動的生成
  if (colorPaletteContainer) {
    PALETTE_COLORS.forEach(color => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-swatch';
      btn.dataset.color = color;
      btn.style.backgroundColor = color;
      btn.title = color;
      colorPaletteContainer.appendChild(btn);
    });

    // パレット内のカラーボタンクリック処理
    colorPaletteContainer.addEventListener('click', (e) => {
      const swatch = e.target.closest('.color-swatch');
      if (!swatch) return;

      const selectedColor = swatch.dataset.color;
      updateColorUI(selectedColor);
      syncLabelByColor(selectedColor);

      // アクティブなWebページへ通知
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs?.[0]?.id;
        if (typeof tabId === 'number') {
          try { chrome.tabs.sendMessage(tabId, { command: 'update-marker-color', color: selectedColor }); } catch (e) {}
        }
      });
    });
  }

  // ショートカット画面を開く処理
  if (openShortcuts) {
    openShortcuts.addEventListener('click', () => {
      const url = 'chrome://extensions/shortcuts';
      try { chrome.tabs.create({ url }); } catch (e) { window.open(url, '_blank'); }
    });
  }

  // PDFマーカーを開くボタンの処理
  if (openPdfBtn) {
    openPdfBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('pdf-viewer.html') });
    });
  }

  // チェックボックス初期化
  chrome.storage.local.get(['showDeleteButton'], (res) => {
    if (toggleDelete) {
      toggleDelete.checked = !!res.showDeleteButton;
    }
  });

  // マーカー色の初期読み込みとパレットUIへの反映
  chrome.storage.local.get(['markerColor'], (res) => {
    const defaultColor = res?.markerColor || '#ffff00';
    updateColorUI(defaultColor);
    syncLabelByColor(defaultColor);
  });

  // 削除ボタン表示切り替え
  if (toggleDelete) {
    toggleDelete.addEventListener('change', () => {
      const enabled = toggleDelete.checked;
      chrome.storage.local.set({ showDeleteButton: enabled }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tabId = tabs?.[0]?.id;
          if (typeof tabId === 'number') {
            chrome.tabs.sendMessage(tabId, { command: 'update-delete-button' });
          }
        });
      });
    });
  }

  // ★ 修正: ショートカット一覧表示 (変更ボタンを排除し、シンプルな対応リストにする)
  const commandsContainer = document.getElementById('commands');
  if (commandsContainer && chrome.commands && chrome.commands.getAll) {
    chrome.commands.getAll((cmds) => {
      commandsContainer.innerHTML = '';
      cmds.forEach((c) => {
        const row = document.createElement('div');
        row.style.marginBottom = '8px';
        row.style.padding = '6px 0';
        row.style.borderBottom = '1px dashed #eee';

        const line = document.createElement('div');
        line.style.display = 'flex';
        line.style.alignItems = 'center';
        line.style.justifyContent = 'space-between';

        const desc = document.createElement('div');
        
        // ★修正: '_execute_action' などのシステム用内部表記を、ユーザーに分かりやすいカスタム表記に差し替える
        let displayName = c.description || c.name || '';
        if (c.name === '_execute_action') {
          displayName = 'WordMarker設定ポップアップを開く';
        }
        desc.textContent = displayName;
        
        desc.style.fontSize = '13px';
        desc.style.color = '#333';

        const key = document.createElement('div');
        key.textContent = c.shortcut && c.shortcut.length ? c.shortcut : '未割当';
        key.style.fontSize = '11px';
        key.style.fontWeight = 'bold';
        key.style.padding = '2px 6px';
        key.style.borderRadius = '4px';
        
        // 割り当て状況に応じてバッジのスタイルを変更
        if (c.shortcut && c.shortcut.length) {
          key.style.color = '#1a73e8';
          key.style.background = '#e8f0fe';
        } else {
          key.style.color = '#777';
          key.style.background = '#f1f3f4';
        }

        line.appendChild(desc);
        line.appendChild(key);
        row.appendChild(line);
        commandsContainer.appendChild(row);
      });
    });
  }

  // --- マーカーブック (wordBook) のハンドリング ---
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

      const choose = document.createElement('button');
      choose.textContent = '選択';
      choose.addEventListener('click', () => {
        const color = s.markerColor || '#FFFF00';
        const label = s.markerLabel || '';
        const bookId = s.bookId || s.id || '';
        if (markerColorInput) markerColorInput.value = color;
        
        // ★ 選択ボタンクリック時にパレットのハイライト表示も連動させる
        updateColorUI(color);
        
        if (newBookIdInput) newBookIdInput.value = bookId;
        if (newLabelInput) newLabelInput.value = label;
        markerLabelPreview.textContent = `ラベル: ${label || '未登録の色'}`;
        chrome.storage.local.set({ markerColor: color, markerLabel: label, bookId }, () => {
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
      // ★ 修正: bookId (idText) 要素の作成および row への appendChild を削除し、表示を非表示化
      row.appendChild(choose);
      markerSetsContainer.appendChild(row);
    });
  }

  // ブックリストの初期ロード
  chrome.storage.local.get(['wordBook'], (res) => {
    const sets = normalizeWordBooks((res && Array.isArray(res.wordBook)) ? res.wordBook : []);
    renderSets(sets);
  });

  // 新規ブックの追加/更新
  if (addSetBtn) {
    addSetBtn.addEventListener('click', () => {
      const label = (newLabelInput && newLabelInput.value && newLabelInput.value.trim()) ? newLabelInput.value.trim() : null;
      if (!label) return;
      const color = (markerColorInput && markerColorInput.value) ? markerColorInput.value : '#FFFF00';
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