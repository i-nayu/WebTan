console.log("content.js が起動しました。");

// 一時保存
const markedWords = [];
let markerEnabled = false;
let deleteButton = null;

function normalizeColor(color) {
    return String(color || '').trim().toLowerCase();
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function createBookId() {
    return globalThis.crypto?.randomUUID?.() ?? `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function resolveMarkerMeta(color, fallbackLabel = 'default') {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            resolve({ color: color || 'yellow', label: fallbackLabel, bookId: createBookId() });
            return;
        }

        chrome.storage.local.get(['wordBook', 'markerColor', 'markerLabel', 'bookId'], (res) => {
            const normalizedTargetColor = normalizeColor(color || res?.markerColor || 'yellow');
            const normalizedTargetLabel = normalizeText(res?.markerLabel || fallbackLabel);
            const books = (res && Array.isArray(res.wordBook)) ? res.wordBook : [];
            const matched = books.find((book) => {
                const bookId = normalizeText(book?.bookId || book?.id);
                const bookLabel = normalizeText(book?.markerLabel);
                const bookColor = normalizeColor(book?.markerColor);
                return (
                    (res?.bookId && bookId === normalizeText(res.bookId))
                    || (normalizedTargetLabel && bookLabel === normalizedTargetLabel)
                    || (normalizedTargetColor && bookColor === normalizedTargetColor)
                );
            });

            resolve({
                color: color || res?.markerColor || 'yellow',
                label: matched?.markerLabel || res?.markerLabel || fallbackLabel,
                bookId: matched?.bookId || matched?.id || createBookId(),
            });
        });
    });
}

// =========================
// 保存処理
// =========================

function saveMarkedWordsToStorage() {
    if (markedWords.length === 0) {
        console.log('保存対象がありません');
        return;
    }

    resolveMarkerMeta(undefined, 'default').then((markerMeta) => {
        const newWords = markedWords.map((item) => ({
            id: crypto.randomUUID(),
            question: item.text,
            answer: '',
            markerColor: (item && item.span && item.span.style && item.span.style.backgroundColor) ? item.span.style.backgroundColor : 'yellow',
            markerLabel: (item && item.markerLabel) ? item.markerLabel : (markerMeta?.label || 'default'),
            bookId: (item && item.bookId) ? item.bookId : (markerMeta?.bookId || createBookId()),
            learned: false,
        }));

        // merge into 'wordCard' and also update 'wordBook' (derive) and keep 'highlights' for compatibility
        chrome.storage.local.get(['wordCard', 'wordBook', 'highlights'], (result) => {
            const existing = (result && Array.isArray(result.wordCard)) ? result.wordCard : [];
            const existingBooks = (result && Array.isArray(result.wordBook)) ? result.wordBook : [];
            const map = new Map();
            existing.forEach((c) => map.set(c.id, c));
            newWords.forEach((w) => map.set(w.id, { ...map.get(w.id), ...w }));
            const merged = Array.from(map.values());

            // keep existing wordBook entries and add any books derived from the merged cards
            const bookMap = new Map();
            existingBooks.forEach((book) => {
                const key = book?.bookId || book?.id;
                if (!key) return;
                bookMap.set(key, book);
            });
            merged.forEach((c) => {
                if (!c.bookId) return;
                const prev = bookMap.get(c.bookId) || {};
                bookMap.set(c.bookId, {
                    bookId: c.bookId,
                    id: c.bookId,
                    markerColor: c.markerColor ?? prev.markerColor ?? '#FFEB3B',
                    markerLabel: c.markerLabel ?? prev.markerLabel ?? '未分類',
                });
            });
            const derivedBooks = Array.from(bookMap.values());

            chrome.storage.local.set({ wordCard: merged, wordBook: derivedBooks, highlights: merged }, () => {
                console.log('保存完了');

                try {
                    chrome.storage.local.get(['wordCard'], (r) => {
                        const hs = (r && r.wordCard) ? r.wordCard : [];
                        console.log('content.js post-save wordCard:', hs);
                        window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: hs }, '*');
                    });
                } catch (e) {
                    // noop
                }

                markedWords.forEach((item) => {
                    const span = item.span;
                    const parent = span.parentNode;

                    while (span.firstChild) {
                        parent.insertBefore(span.firstChild, span);
                    }

                    parent.removeChild(span);
                });

                markedWords.length = 0;
                console.log('マーカー解除完了');
            });
        });
    });
}


// =========================
// マーカー処理
// =========================

document.addEventListener("mouseup", () => {
    if (!markerEnabled) {
        return;
    }

    // 選択取得
    const selection = window.getSelection();

    const text = selection?.toString().trim();

    // 未選択
    if (!text) {
        return;
    }

    console.log(`選択テキスト: ${text}`);

    // range取得
    const range = selection.getRangeAt(0);

    // 複数行禁止
    // 複数行禁止（改行が含まれる選択は不可）。
    // 異なるコンテナにまたがる選択でも単一行であれば許可する。
    if (/\r?\n/.test(text)) {
        alert("複数行の選択には未対応です");
        return;
    }

    // span生成およびマーカー色・ラベルはストレージから取得して適用する
    try {
        const createWithColor = (color, label, bookId) => {
            const span = document.createElement("span");
            span.style.backgroundColor = color || 'yellow';

            // 切り出し
            const extracted = range.extractContents();

            // spanへ
            span.appendChild(extracted);

            // DOMへ戻す
            range.insertNode(span);

            // 一時保存
            markedWords.push({ text: text, span: span, markerLabel: label || 'default', bookId: bookId || '' });

            console.log(markedWords);
        };

        resolveMarkerMeta(undefined, 'default').then(({ color, label, bookId }) => {
            createWithColor(color, label, bookId);
        });

    } catch (e) {
        console.log("マーカー失敗", e);
    }

    // 選択解除
    selection.removeAllRanges();

});


// =========================
// 一斉送信
// =========================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
        if (!msg || !msg.command) return;

        if (msg.command === 'toggle-marker') {
            console.log('received command from background:', msg.command);
            markerEnabled = !markerEnabled;
            console.log('markerEnabled:', markerEnabled);
            sendResponse({ ok: true, markerEnabled });
            return;
        }

        if (msg.command === 'save-highlights') {
            console.log('received command from background:', msg.command);
            saveMarkedWordsToStorage();
            sendResponse({ ok: true });
            return;
        }

        if (msg.command === 'update-delete-button') {
            try {
                chrome.storage.local.get(['showDeleteButton'], (res) => {
                    if (res && res.showDeleteButton) createDeleteButton(); else removeDeleteButton();
                    sendResponse({ ok: true, showDeleteButton: !!(res && res.showDeleteButton) });
                });
            } catch (e) {
                console.warn('update-delete-button error', e);
                sendResponse({ ok: false });
            }
            return;
        }
    } catch (e) {
        console.warn('runtime message error', e);
    }
});


// ページ（ReviewWords 等）からの要求に応答するリスナー
window.addEventListener('message', (e) => {
    try {
        const data = e.data;
        if (!data || typeof data !== 'object') return;

        // safe chrome accessor (typeof protects against ReferenceError when context invalidated)
        const chromeApi = (typeof chrome !== 'undefined') ? chrome : null;

        if (data.type === 'REQUEST_EXTENSION_WORD_CARDS') {
            console.log('content.js received REQUEST_EXTENSION_WORD_CARDS');
            try {
                if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
                    // chrome.storage not available (extension context maybe invalidated)
                    try { window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: [] }, '*'); } catch (_) {}
                    return;
                }

                chromeApi.storage.local.get(['wordCard', 'wordBook', 'highlights'], (res) => {
                    try {
                        const hs = (res && Array.isArray(res.wordCard) && res.wordCard.length > 0)
                            ? res.wordCard
                            : (res && Array.isArray(res.highlights) ? res.highlights : []);
                        console.log('content.js request result wordCard:', res?.wordCard);
                        console.log('content.js request result wordBook:', res?.wordBook);
                        console.log('content.js sending EXTENSION_WORD_CARDS, count=', hs.length);
                        try {
                            window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: hs, wordBook: (res && Array.isArray(res.wordBook)) ? res.wordBook : [] }, '*');
                        } catch (err) {
                            console.warn('postMessage send failed', err);
                        }
                    } catch (innerErr) {
                        console.warn('REQUEST handler inner error', innerErr);
                        try { window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: [] }, '*'); } catch (_) {}
                    }
                });
            } catch (err) {
                console.warn('REQUEST handler error', err);
                try { window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: [] }, '*'); } catch (_) {}
            }
            return;
        }

        if (data.type === 'SAVE_EXTENSION_WORD_CARDS' && Array.isArray(data.cards)) {
            const cardsToSave = data.cards;
            console.log('content.js received SAVE_EXTENSION_WORD_CARDS, count=', cardsToSave.length);

            try {
                if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
                    try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS_RESULT', success: false, error: 'chrome.storage unavailable' }, '*'); } catch (_) {}
                    return;
                }

                chromeApi.storage.local.get(['wordCard', 'wordBook'], (res) => {
                    try {
                        const existing = (res && Array.isArray(res.wordCard)) ? res.wordCard : [];
                        const existingBooks = (res && Array.isArray(res.wordBook)) ? res.wordBook : [];
                        const map = new Map();
                        existing.forEach((h) => map.set(h.id, h));
                        cardsToSave.forEach((c) => map.set(c.id, { ...map.get(c.id), ...c }));
                        const merged = Array.from(map.values());

                        const bookMap = new Map();
                        existingBooks.forEach((book) => bookMap.set(book.id, book));
                        merged.forEach((c) => {
                            if (!c.bookId) return;
                            const prev = bookMap.get(c.bookId) || {};
                            bookMap.set(c.bookId, {
                                id: c.bookId,
                                markerColor: c.markerColor ?? prev.markerColor ?? '#FFEB3B',
                                markerLabel: c.markerLabel ?? prev.markerLabel ?? '未分類',
                            });
                        });

                        const derivedBooks = Array.from(bookMap.values());

                            chromeApi.storage.local.set({ wordCard: merged, wordBook: derivedBooks, highlights: merged }, () => {
                            try {
                                console.log('saved from page request, new wordCard count=', merged.length);
                                try { window.postMessage({ type: 'EXTENSION_WORD_CARDS', cards: merged }, '*'); } catch (_) {}
                                try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS_RESULT', success: true, count: cardsToSave.length }, '*'); } catch (_) {}
                            } catch (innerErr) {
                                console.warn('post-save inner error', innerErr);
                            }
                        });
                    } catch (inner) {
                        console.warn('SAVE_EXTENSION_WORD_CARDS inner handler failed', inner);
                        try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS_RESULT', success: false, error: String(inner) }, '*'); } catch (_) {}
                    }
                });
            } catch (err) {
                console.warn('SAVE_EXTENSION_WORD_CARDS handler failed', err);
                try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS_RESULT', success: false, error: String(err) }, '*'); } catch (_) {}
            }
            return;
        }
// ==========================================
        // 新規追加: highlights のみを取得して送信するハンドラー
        // ==========================================
        if (data.type === 'REQUEST_STORED_HIGHLIGHTS') {
            console.log('content.js received REQUEST_STORED_HIGHLIGHTS');
            if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
                console.warn('chrome.storage is not available');
                window.postMessage({ type: 'EXTENSION_STORED_HIGHLIGHTS', highlights: [] }, '*');
                return;
            }

            chromeApi.storage.local.get(['highlights'], (res) => {
                const hs = (res && Array.isArray(res.highlights)) ? res.highlights : [];
                console.log('content.js sending EXTENSION_STORED_HIGHLIGHTS, count =', hs.length);
                window.postMessage({
                    type: 'EXTENSION_STORED_HIGHLIGHTS',
                    highlights: hs
                }, '*');
            });
            return;
        }

        if (data.type === 'SAVE_EXTENSION_WORD_BOOKS' && data.book && (data.book.bookId || data.book.id)) {
            const newBook = data.book;
            console.log('content.js received SAVE_EXTENSION_WORD_BOOKS:', newBook);

            try {
                if (!chromeApi || !chromeApi.storage || !chromeApi.storage.local) {
                    try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_BOOKS_RESULT', success: false, error: 'chrome.storage unavailable' }, '*'); } catch (_) {}
                    return;
                }

                chromeApi.storage.local.get(['wordBook'], (res) => {
                    try {
                        const existing = (res && Array.isArray(res.wordBook)) ? res.wordBook : [];
                        const normalizedBookId = newBook.bookId || newBook.id || createBookId();
                        const normalizedLabel = newBook.markerLabel || '未分類';
                        const filtered = existing.filter((book) => {
                            const sameBookId = normalizeText(book.bookId || book.id) === normalizeText(normalizedBookId);
                            const sameLabel = normalizeText(book.markerLabel) === normalizeText(normalizedLabel);
                            return !(sameBookId || sameLabel);
                        });
                        const next = [{ ...newBook, bookId: normalizedBookId, id: normalizedBookId, markerLabel: normalizedLabel }, ...filtered];
                        chromeApi.storage.local.set({ wordBook: next }, () => {
                            console.log('saved wordBook from page request, new count=', next.length);
                            try {
                                window.postMessage({ type: 'SAVE_EXTENSION_WORD_BOOKS_RESULT', success: true, book: newBook }, '*');
                            } catch (err) {
                                console.warn('postMessage wordBook result failed', err);
                            }
                        });
                    } catch (inner) {
                        console.warn('SAVE_EXTENSION_WORD_BOOKS inner handler failed', inner);
                        try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_BOOKS_RESULT', success: false, error: String(inner) }, '*'); } catch (_) {}
                    }
                });
            } catch (err) {
                console.warn('SAVE_EXTENSION_WORD_BOOKS handler failed', err);
                try { window.postMessage({ type: 'SAVE_EXTENSION_WORD_BOOKS_RESULT', success: false, error: String(err) }, '*'); } catch (_) {}
            }
            return;
        }

        if (data.type === 'DELETE_WORD_CARD') {
            const cardId = data.cardId;

            console.log(
                'content.js received DELETE_WORD_CARD',
                cardId
            );

            chromeApi.storage.local.get(
                ['wordCard', 'highlights'],
                (res) => {

                    const cards = Array.isArray(res.wordCard)
                        ? res.wordCard
                        : [];

                    const nextCards = cards.filter(
                        (card) => card.id !== cardId
                    );

                    chromeApi.storage.local.set(
                        {
                            wordCard: nextCards,
                            highlights: nextCards,
                        },
                        () => {

                            console.log(
                                'deleted card, new count=',
                                nextCards.length
                            );

                            window.postMessage(
                                {
                                    type: 'EXTENSION_WORD_CARDS',
                                    cards: nextCards,
                                },
                                '*'
                            );

                            window.postMessage(
                                {
                                    type: 'DELETE_WORD_CARD_RESULT',
                                    success: true,
                                    cardId,
                                },
                                '*'
                            );
                        }
                    );

                }
            );

            return;
        }

        if (data.type === 'DELETE_WORD_BOOK') {
            const bookId = data.bookId;

            console.log('content.js received DELETE_WORD_BOOK', bookId);

            if (!bookId) {
                console.warn('DELETE_WORD_BOOK: bookId is missing');
                return;
            }

            chromeApi.storage.local.get(['wordBook'], (res) => {
                try {
                    const books = Array.isArray(res.wordBook) ? res.wordBook : [];

                    const beforeCount = books.length;

                    const nextBooks = books.filter((book) => book.id !== bookId);

                    const isDeleted = nextBooks.length !== beforeCount;

                    if (!isDeleted) {
                        console.warn('DELETE_WORD_BOOK: target not found', bookId);
                    }

                    chromeApi.storage.local.set(
                        {
                            wordBook: nextBooks,
                        },
                        () => {
                            if (chromeApi.runtime?.lastError) {
                                console.error('storage.set error:', chromeApi.runtime.lastError);
                                return;
                            }

                            console.log('deleted book, new count=', nextBooks.length);

                            // UI更新用
                            window.postMessage(
                                {
                                    type: 'EXTENSION_WORD_BOOKS_UPDATED',
                                    books: nextBooks,
                                },
                                '*'
                            );

                            // 削除通知
                            window.postMessage(
                                {
                                    type: 'DELETE_WORD_BOOK_RESULT',
                                    success: true,
                                    bookId,
                                },
                                '*'
                            );
                        }
                    );
                } catch (err) {
                    console.error('DELETE_WORD_BOOK error:', err);

                    window.postMessage(
                        {
                            type: 'DELETE_WORD_BOOK_RESULT',
                            success: false,
                            bookId,
                        },
                        '*'
                    );
                }
            });

            

            return;
        }

        //API保存
        if (data.type === 'SAVE_API_KEY') {
            console.log('content.js received SAVE_API_KEY, key=', data.apiKey);
            chrome.storage.local.set(
                { geminiApiKey: data.apiKey },
                () => {
                    console.log('APIキー保存完了');

                    window.postMessage({
                        type: 'SAVE_API_KEY_RESULT',
                        success: true,
                    }, '*');
                }
            );


            return;
        }

        //API取得
        if (data.type === 'REQUEST_API_KEY') {
            console.log('content.js received REQUEST_API_KEY, fetching from storage');
            chrome.storage.local.get(
                ['geminiApiKey'],
                (result) => {
                    window.postMessage({
                        type: 'API_KEY_RESULT',
                        apiKey: result.geminiApiKey ?? '',
                    }, '*');
                }
            );

            console.log('content.js received REQUEST_API_KEY');

            return;
        }
        
    } catch (e) {
        // noop
    }
});

function removeLastMarkedWord() {
    if (markedWords.length === 0) {
        console.log('削除対象がありません');
        return;
    }

    const item = markedWords.pop();
    try {
        const span = item.span;
        const parent = span.parentNode;
        while (span.firstChild) {
            parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        console.log('最後のマーカーを削除しました');
    } catch (e) {
        console.warn('removeLastMarkedWord failed', e);
    }
}

function createDeleteButton() {
    if (deleteButton) return;
    deleteButton = document.createElement('button');
    deleteButton.id = 'wordmarker-delete-button';
    deleteButton.textContent = '削除';
    deleteButton.style.position = 'fixed';
    deleteButton.style.right = '12px';
    deleteButton.style.bottom = '12px';
    deleteButton.style.zIndex = 2147483647;
    deleteButton.style.padding = '8px 10px';
    deleteButton.style.background = '#ff5252';
    deleteButton.style.color = '#fff';
    deleteButton.style.border = 'none';
    deleteButton.style.borderRadius = '6px';
    deleteButton.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
    deleteButton.style.cursor = 'pointer';
    deleteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        removeLastMarkedWord();
    });
    document.body.appendChild(deleteButton);
}

function removeDeleteButton() {
    if (!deleteButton) return;
    try { deleteButton.remove(); } catch (e) {}
    deleteButton = null;
}

// initialize delete button based on storage
try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['showDeleteButton'], (res) => {
            if (res && res.showDeleteButton) createDeleteButton(); else removeDeleteButton();
        });
    }
} catch (e) {
    // noop
}