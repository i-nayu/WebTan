import * as pdfjsLib from './pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.mjs';

let currentPdfDocument = null;
let currentFileName = "";
let currentBooks = []; 
let currentScale = 1.0; // 動的に計算するレンダリングスケール

const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name-display');
const viewerContainer = document.getElementById('viewer-container');
const addMarkerBtn = document.getElementById('add-marker-btn');
const bookSelect = document.getElementById('book-select');
const markerLabelInput = document.getElementById('marker-label');
const markerColorInput = document.getElementById('marker-color');
const colorPaletteContainer = document.getElementById('color-palette');

// ==========================================
// ★ 30種類のカラーパレットの生成
// ==========================================
const PALETTE_COLORS = [
  '#ffcdd2', '#f8bbd0', '#e1bee7', '#d1c4e9', '#c5cae9', '#bbdefb', '#b2ebf2', '#b2dfdb', '#c8e6c9', '#fff9c4',
  '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4', '#009688', '#4caf50', '#ffeb3b',
  '#ff0000', '#ff00ff', '#800080', '#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff9800', '#ff5722', '#9e9e9e'
];

PALETTE_COLORS.forEach(color => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'color-swatch';
  btn.dataset.color = color;
  btn.style.backgroundColor = color;
  btn.title = color;
  colorPaletteContainer.appendChild(btn);
});

const colorSwatches = document.querySelectorAll('.color-swatch');

function updateColorUI(colorStr) {
  const normalizedColor = (colorStr || '#ffff00').toLowerCase();
  markerColorInput.value = normalizedColor;
  
  colorSwatches.forEach(swatch => {
    if (swatch.dataset.color.toLowerCase() === normalizedColor) {
      swatch.classList.add('selected');
    } else {
      swatch.classList.remove('selected');
    }
  });
}

colorSwatches.forEach(swatch => {
  swatch.addEventListener('click', (e) => {
    const selectedColor = e.target.dataset.color;
    updateColorUI(selectedColor);
    saveCurrentSettings();
  });
});

// ==========================================
// UIの調整と同期
// ==========================================
if (bookSelect) {
  bookSelect.style.display = 'none';
  if (bookSelect.previousElementSibling && bookSelect.previousElementSibling.tagName === 'LABEL') {
    bookSelect.previousElementSibling.style.display = 'none';
  }
}

let datalist = document.getElementById('label-suggestions');
if (!datalist) {
  datalist = document.createElement('datalist');
  datalist.id = 'label-suggestions';
  document.body.appendChild(datalist);
  markerLabelInput.setAttribute('list', 'label-suggestions');
}

async function initSettings() {
  const data = await chrome.storage.local.get(['wordBook', 'markerLabel', 'markerColor']);
  currentBooks = Array.isArray(data.wordBook) ? data.wordBook : [];
  
  datalist.innerHTML = '';
  const uniqueLabels = [...new Set(currentBooks.map(b => b.markerLabel || '未分類'))];
  uniqueLabels.forEach(label => {
    const opt = document.createElement('option');
    opt.value = label;
    datalist.appendChild(opt);
  });
  
  if (data.markerLabel) markerLabelInput.value = data.markerLabel;
  if (data.markerColor) updateColorUI(data.markerColor);
}

async function saveCurrentSettings() {
  await chrome.storage.local.set({
    markerLabel: markerLabelInput.value.trim(),
    markerColor: markerColorInput.value
  });
}

// ★修正: changeイベントからinputイベントに変更することで、datalist（サジェスト）から選択した瞬間に即時で連動するように改善
markerLabelInput.addEventListener('input', (e) => {
  const label = e.target.value.trim();
  const existingBook = currentBooks.find(b => b.markerLabel === label);
  if (existingBook && existingBook.markerColor) {
    updateColorUI(existingBook.markerColor);
  }
  saveCurrentSettings();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    if (changes.wordBook || changes.markerLabel || changes.markerColor) {
      initSettings();
    }
  }
});

initSettings();

addMarkerBtn.addEventListener('mousedown', (e) => {
  e.preventDefault(); 
});


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

  const firstPage = await currentPdfDocument.getPage(1);
  const tempViewport = firstPage.getViewport({ scale: 1.0 });
  const containerWidth = viewerContainer.clientWidth - 40; 
  
  currentScale = containerWidth / tempViewport.width;
  currentScale = Math.max(0.5, Math.min(currentScale, 2.0));

  for (let pageNum = 1; pageNum <= currentPdfDocument.numPages; pageNum++) {
    try {
      const page = await currentPdfDocument.getPage(pageNum);
      const viewport = page.getViewport({ scale: currentScale });

      const pageWrapper = document.createElement('div');
      pageWrapper.className = 'pdf-page-wrapper';
      pageWrapper.id = `page-wrapper-${pageNum}`;
      pageWrapper.style.width = `${viewport.width}px`;
      pageWrapper.style.height = `${viewport.height}px`;
      pageWrapper.style.setProperty('--scale-factor', currentScale);
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

      for (const item of textContent.items) {
        if (!item.str || item.str.trim() === '') continue;
        
        const span = document.createElement('span');
        span.textContent = item.str;
        
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        const fontHeight = Math.sqrt(item.transform[2] * item.transform[2] + item.transform[3] * item.transform[3]);
        const scaledFontHeight = fontHeight * currentScale;
        
        span.style.position = 'absolute';
        span.style.left = `${x}px`;
        span.style.top = `${y - scaledFontHeight * 0.85}px`; 
        span.style.fontSize = `${scaledFontHeight}px`;
        span.style.fontFamily = item.fontName || 'sans-serif';
        span.style.lineHeight = 1;
        
        textLayerDiv.appendChild(span);
      }

    } catch (err) {
      console.error(`ページ ${pageNum} の描画でエラーが発生しました:`, err);
    }
  }
}

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

  const range = selection.getRangeAt(0);
  let parent = range.commonAncestorContainer;
  while (parent && parent !== document.body) {
    if (parent.classList && parent.classList.contains('pdf-page-wrapper')) {
      break;
    }
    parent = parent.parentNode;
  }
  
  const pageWrapper = (parent && parent.classList?.contains('pdf-page-wrapper')) 
    ? parent 
    : viewerContainer.querySelector('.pdf-page-wrapper');
    
  if (!pageWrapper) {
    alert("ページの特定に失敗しました。もう一度選択してください。");
    return;
  }

  const pageNum = parseInt(pageWrapper.dataset.pageNumber);
  const color = markerColorInput.value;
  const label = markerLabelInput.value.trim() || 'default';
  
  const data = await chrome.storage.local.get(['wordCard', 'wordBook', 'highlights']);
  const books = Array.isArray(data.wordBook) ? data.wordBook : [];
  
  let targetBookId;
  const matchedBook = books.find(b => b.markerLabel === label);
  if (matchedBook) {
      targetBookId = matchedBook.bookId || matchedBook.id;
  } else {
      targetBookId = crypto.randomUUID();
  }

  const newId = crypto.randomUUID();
  
  drawHighlightFromRangeOnPage(range, pageWrapper, newId, color);

  const newHighlight = {
    id: newId,
    question: text,               
    answer: '',                   
    markerColor: color,           
    markerLabel: label,    
    bookId: targetBookId,        
    learned: false,               
    pdf: currentFileName,         
    pageNum: pageNum, 
    createdAt: Date.now()
  };

  const wordCards = Array.isArray(data.wordCard) ? data.wordCard : [];
  const highlights = Array.isArray(data.highlights) ? data.highlights : [];
  
  wordCards.push(newHighlight);
  highlights.push(newHighlight);

  const bookMap = new Map();
  books.forEach(b => bookMap.set(b.bookId || b.id, b));
  
  if (!bookMap.has(targetBookId)) {
      bookMap.set(targetBookId, {
          id: targetBookId,
          bookId: targetBookId,
          markerColor: color,
          markerLabel: label
      });
  } else {
      const b = bookMap.get(targetBookId);
      b.markerColor = color;
      b.markerLabel = label;
  }
  const updatedBooks = Array.from(bookMap.values());

  await chrome.storage.local.set({ 
      wordCard: wordCards, 
      highlights: highlights,
      wordBook: updatedBooks,
      markerLabel: label,
      markerColor: color
  });

  await notifyTabsWordCardsUpdated();

  selection.removeAllRanges();
});

function drawHighlightFromRangeOnPage(range, pageWrapper, id, color) {
  const rects = range.getClientRects();
  const pageRect = pageWrapper.getBoundingClientRect();

  for (let rect of rects) {
    const highlightDiv = document.createElement('div');
    highlightDiv.className = 'custom-highlight';
    highlightDiv.dataset.id = id;
    highlightDiv.style.backgroundColor = color;
    highlightDiv.style.opacity = '0.4';
    
    const top = rect.top - pageRect.top;
    const left = rect.left - pageRect.left;
    
    highlightDiv.style.top = `${top}px`;
    highlightDiv.style.left = `${left}px`;
    highlightDiv.style.width = `${rect.width}px`;
    highlightDiv.style.height = `${rect.height}px`;
    
    highlightDiv.title = "クリックで削除";
    highlightDiv.addEventListener('click', (e) => {
      e.stopPropagation();
      removeMarker(id);
    });
    
    pageWrapper.appendChild(highlightDiv);
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
    
    const targetText = hl.question;
    const drawColor = hl.markerColor;
    
    if (!targetText) return;

    const found = window.find(targetText, false, false, false, false, false, false);
    
    if (found) {
      const selection = window.getSelection();
      const range = selection.getRangeAt(0);
      
      let parent = range.commonAncestorContainer;
      while (parent && parent !== document.body) {
        if (parent.classList && parent.classList.contains('pdf-page-wrapper')) {
          break;
        }
        parent = parent.parentNode;
      }
      
      const pageWrapper = (parent && parent.classList?.contains('pdf-page-wrapper')) 
        ? parent 
        : viewerContainer.querySelector('.pdf-page-wrapper');
        
      if (pageWrapper) {
        drawHighlightFromRangeOnPage(range, pageWrapper, hl.id, drawColor);
      }
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