import * as pdfjsLib from './pdfjs/pdf.mjs';

// PDF.jsのWorkerを設定
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.mjs';

let currentPdfDocument = null;
let currentFileName = "";
let currentBooks = []; // ブックリストのキャッシュ

const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name-display');
const viewerContainer = document.getElementById('viewer-container');
const addMarkerBtn = document.getElementById('add-marker-btn');

// 追加したUI要素
const bookSelect = document.getElementById('book-select');
const markerLabelInput = document.getElementById('marker-label');
const markerColorInput = document.getElementById('marker-color');

// ==========================================
// ★ UIの調整 (ブック選択プルダウンを隠し、ラベル入力にサジェストを追加)
// ==========================================
if (bookSelect) {
  bookSelect.style.display = 'none';
  if (bookSelect.previousElementSibling && bookSelect.previousElementSibling.tagName === 'LABEL') {
    bookSelect.previousElementSibling.style.display = 'none';
  }
}

// ラベル入力欄にサジェスト(datalist)を追加
let datalist = document.getElementById('label-suggestions');
if (!datalist) {
  datalist = document.createElement('datalist');
  datalist.id = 'label-suggestions';
  document.body.appendChild(datalist);
  markerLabelInput.setAttribute('list', 'label-suggestions');
}

// ==========================================
// ★ 設定の初期化と同期
// ==========================================
async function initSettings() {
  const data = await chrome.storage.local.get(['wordBook', 'markerLabel', 'markerColor']);
  currentBooks = Array.isArray(data.wordBook) ? data.wordBook : [];
  
  // ラベルのサジェスト一覧を再構築
  datalist.innerHTML = '';
  const uniqueLabels = [...new Set(currentBooks.map(b => b.markerLabel || '未分類'))];
  uniqueLabels.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    datalist.appendChild(opt);
  });
  
  if (data.markerLabel) {
    markerLabelInput.value = data.markerLabel;
  }
  if (data.markerColor) {
    markerColorInput.value = data.markerColor;
  }
}

// ユーザーがUIを変更した際にストレージへ保存する処理
async function saveCurrentSettings() {
  await chrome.storage.local.set({
    markerLabel: markerLabelInput.value.trim(),
    markerColor: markerColorInput.value
  });
}

// ラベル名が変更・選択されたら、既存のブックがあれば色を合わせる
markerLabelInput.addEventListener('change', (e) => {
  const label = e.target.value.trim();
  const existingBook = currentBooks.find(b => b.markerLabel === label);
  if (existingBook && existingBook.markerColor) {
    markerColorInput.value = existingBook.markerColor;
  }
  saveCurrentSettings();
});

markerColorInput.addEventListener('change', saveCurrentSettings);

// ポップアップ側で設定が変わった場合などにリアルタイムでUIを同期
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.wordBook || changes.markerLabel || changes.markerColor) {
      initSettings();
    }
  }
});

// 起動時に設定を読み込む
initSettings();


// ==========================================
// PDF読み込みと描画
// ==========================================
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file || file.type !== "application/pdf") return;

  currentFileName = file.name;
  fileNameDisplay.textContent = currentFileName;
  addMarkerBtn.disabled = false;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const arrayBuffer = e.target.result;
    await renderPDF(arrayBuffer);
    await restoreHighlights();
  };
  reader.readAsArrayBuffer(file);
});

async function renderPDF(arrayBuffer) {
  viewerContainer.innerHTML = '';
  
  const loadingTask = pdfjsLib.getDocument({ 
    data: arrayBuffer,
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true
  });
  
  try {
    currentPdfDocument = await loadingTask.promise;
  } catch (err) {
    console.error("PDFの読み込みエラー:", err);
    alert("PDFの読み込みに失敗しました。");
    return;
  }

  for (let pageNum = 1; pageNum <= currentPdfDocument.numPages; pageNum++) {
    try {
      const page = await currentPdfDocument.getPage(pageNum);
      const scale = 1.5;
      const viewport = page.getViewport({ scale: scale });

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;
      pageWrapper.style.setProperty('--scale-factor', scale);
      pageWrapper.dataset.pageNumber = pageNum;

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pageWrapper.appendChild(canvas);

      const textLayerDiv = document.createElement('div');
      textLayerDiv.className = 'textLayer';
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      pageWrapper.appendChild(textLayerDiv);

      viewerContainer.appendChild(pageWrapper);

      const renderContext = {
        canvasContext: canvas.getContext('2d'),
        viewport: viewport
      };
      await page.render(renderContext).promise;

      const textContent = await page.getTextContent();
      
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.color = 'transparent';

      for (const item of textContent.items) {
        if (!item.str || item.str.trim() === '') continue;
        
        const span = document.createElement('span');
        span.textContent = item.str;
        
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontHeight = Math.sqrt(item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3]);
        const scaledFontHeight = fontHeight * scale;
        
        span.style.position = 'absolute';
        span.style.left = `${x}px`;
        span.style.top = `${y - scaledFontHeight * 0.8}px`;
        span.style.fontSize = `${scaledFontHeight}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';
        span.style.lineHeight = 1;
        span.style.whiteSpace = 'pre';
        span.style.cursor = 'text';
        
        textLayerDiv.appendChild(span);
      }

    } catch (err) {
      console.error(`ページ ${pageNum} の描画でエラーが発生しました:`, err);
    }
  }
}

// 他のタブ(Webページ)へ更新をリアルタイム通知する処理
async function notifyTabsWordCardsUpdated() {
  const data = await chrome.storage.local.get(['wordCard', 'wordBook']);
  const cards = Array.isArray(data.wordCard) ? data.wordCard : [];
  const books = Array.isArray(data.wordBook) ? data.wordBook : [];

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.url && !tab.url.startsWith('chrome-extension://')) {
        chrome.tabs.sendMessage(tab.id, {
          command: 'sync-word-cards',
          cards: cards,
          wordBook: books
        }).catch(() => {});
      }
    });
  });
}


// ==========================================
// マーカー追加・復元・削除
// ==========================================
addMarkerBtn.addEventListener('click', async () => {
  const selection = window.getSelection();
  const text = selection.toString().trim();
  
  if (!text) {
    alert("テキストが選択されていません。PDF上のテキストを選択してからボタンを押してください。");
    return;
  }

  // ★UIに入力されている情報を取得
  const color = markerColorInput.value;
  const label = markerLabelInput.value.trim() || 'default';
  
  const data = await chrome.storage.local.get(['wordCard', 'wordBook', 'highlights']);
  const books = Array.isArray(data.wordBook) ? data.wordBook : [];
  
  // ★ラベル名からbookIdを自動決定 (一致するものがなければ新規ID)
  let targetBookId;
  const matchedBook = books.find(b => b.markerLabel === label);
  if (matchedBook) {
      targetBookId = matchedBook.bookId || matchedBook.id;
  } else {
      targetBookId = crypto.randomUUID();
  }

  const newId = crypto.randomUUID();
  drawHighlightFromSelection(selection, newId, color);

  // content.js と完全に一致する型定義
  const newHighlight = {
    id: newId,
    question: text,               
    answer: '',                   
    markerColor: color,           
    markerLabel: label,    
    bookId: targetBookId,        
    learned: false,               
    // 以下はPDF復元のための拡張プロパティ（無駄な重複を削除）
    pdf: currentFileName,         
    createdAt: Date.now()
  };

  const wordCards = Array.isArray(data.wordCard) ? data.wordCard : [];
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  
  wordCards.push(newHighlight);
  highlights.push(newHighlight);

  const bookMap = new Map();
  books.forEach(b => bookMap.set(b.bookId || b.id, b));
  
  if (!bookMap.has(targetBookId)) {
      // 新規ブックの場合はリストに追加
      bookMap.set(targetBookId, {
          id: targetBookId,
          bookId: targetBookId,
          markerColor: color,
          markerLabel: label
      });
  } else {
      // 既存ブックでも、色などが変更されていれば上書き更新する
      const b = bookMap.get(targetBookId);
      b.markerColor = color;
      b.markerLabel = label;
  }
  const updatedBooks = Array.from(bookMap.values());

  await chrome.storage.local.set({ 
      wordCard: wordCards, 
      highlights: highlights,
      wordBook: updatedBooks,
      // 次回のために現在の設定をストレージに記憶させる
      markerLabel: label,
      markerColor: color
  });

  await notifyTabsWordCardsUpdated();

  selection.removeAllRanges();
});

function drawHighlightFromSelection(selection, id, color) {
  if (selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  
  const rects = range.getClientRects();
  const containerRect = viewerContainer.getBoundingClientRect();

  for (let rect of rects) {
    const highlightDiv = document.createElement('div');
    highlightDiv.className = 'custom-highlight';
    highlightDiv.dataset.id = id;
    highlightDiv.style.backgroundColor = color;
    highlightDiv.style.opacity = '0.4';
    
    const top = rect.top - containerRect.top + viewerContainer.scrollTop;
    const left = rect.left - containerRect.left + viewerContainer.scrollLeft;
    
    highlightDiv.style.top = `${top}px`;
    highlightDiv.style.left = `${left}px`;
    highlightDiv.style.width = `${rect.width}px`;
    highlightDiv.style.height = `${rect.height}px`;
    
    highlightDiv.title = "クリックで削除";
    highlightDiv.addEventListener('click', () => removeMarker(id));
    
    viewerContainer.appendChild(highlightDiv);
  }
}

async function restoreHighlights() {
  if (!currentFileName) return;

  const data = await chrome.storage.local.get(['wordCard', 'highlights']);
  const items = (data.highlights && data.highlights.length > 0) ? data.highlights : (data.wordCard || []);
  const fileHighlights = items.filter(h => h.pdf === currentFileName);

  fileHighlights.forEach(hl => {
    window.getSelection().removeAllRanges();
    window.scrollTo(0, 0);
    
    // 復元時も content.js と共通のプロパティ（question, markerColor）を利用する
    const targetText = hl.question;
    const drawColor = hl.markerColor;
    
    if (!targetText) return;

    const found = window.find(targetText, false, false, false, false, false, false);
    
    if (found) {
      const selection = window.getSelection();
      drawHighlightFromSelection(selection, hl.id, drawColor);
    }
  });

  window.getSelection().removeAllRanges();
}

async function removeMarker(id) {
  if (!confirm("このマーカーを削除しますか？")) return;

  const highlightEls = document.querySelectorAll(`.custom-highlight[data-id="${id}"]`);
  highlightEls.forEach(el => el.remove());

  const data = await chrome.storage.local.get(['wordCard', 'highlights']);
  
  let wordCards = Array.isArray(data.wordCard) ? data.wordCard : [];
  let highlights = Array.isArray(data.highlights) ? data.highlights : [];
  
  wordCards = wordCards.filter(h => h.id !== id);
  highlights = highlights.filter(h => h.id !== id);
  
  await chrome.storage.local.set({ 
      wordCard: wordCards,
      highlights: highlights 
  });

  await notifyTabsWordCardsUpdated();
}