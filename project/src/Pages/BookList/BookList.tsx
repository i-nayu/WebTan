import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import styles from './BookList.module.css';


// ======================================================
// 単語帳型
// ======================================================
// markerLabel → 単語帳名
// markerColor → 左側の色
// ======================================================
interface WordBook {
    id: string;            // 単語帳ID
    markerColor: string;   // ラベル色
    markerLabel: string;   // 単語帳名
}


const WordBookList: React.FC = () => {

    // ======================================================
    // 単語帳データ（保存/読み込みあり）
    // ======================================================
    const [wordBooks, setWordBooks] = useState<WordBook[]>([]);

    useEffect(() => {
        const chromeApi = (window as any).chrome;

        // ----------------------------------
        // カード一覧から単語帳一覧を生成
        // ----------------------------------
        const deriveFromCards = (cards: any[]) => {
            const map = new Map<string, any>();

            (cards || []).forEach((c: any) => {
                if (!c || !c.bookId) return;

                // bookIdごとに重複を除いて登録
                if (!map.has(c.bookId)) {
                    map.set(c.bookId, {
                        id: c.bookId,
                        markerColor: c.markerColor ?? '#FFEB3B',
                        markerLabel: c.markerLabel ?? '未分類',
                    });
                }
            });

            return Array.from(map.values());
        };


        //chrome storageが利用可能かどうか
        if (chromeApi && chromeApi.storage && chromeApi.storage.local) {


            // Storageから単語帳情報を取得
            chromeApi.storage.local.get(
                ['wordBook'],
                (res: any) => {

                    console.log(
                        'BookList: storage read result:',
                        res
                    );

                    // 既存の単語帳があれば使用
                    if (
                        res &&
                        Array.isArray(res.wordBook) &&
                        res.wordBook.length > 0
                    ) {
                        setWordBooks(res.wordBook);
                        return;
                    }

                }
            );

            // ----------------------------------
            // Storage変更が変更された時
            // ----------------------------------
            const onChange = (
                changes: any,
                areaName: string
            ) => {

                if (areaName !== 'local') return;

                // wordBook更新
                if (changes.wordBook) {

                    setWordBooks(
                        changes.wordBook.newValue ?? []
                    );

                    return;
                }


                // wordCard変更時
                if (changes.wordCard) {

                    const arr = changes.wordCard.newValue ?? [];

                    const derived = deriveFromCards(arr); // 単語カードから単語帳を再生成

                    if (derived.length > 0) {

                        setWordBooks(derived);

                        chromeApi.storage.local.set({
                            wordBook: derived,
                        });
                    }
                }


                // highlights変更時
                if (changes.highlights) {

                    const arr = changes.highlights.newValue ?? [];

                    const derived = deriveFromCards(arr);

                    if (derived.length > 0) {

                        setWordBooks(derived);

                        chromeApi.storage.local.set({
                            wordBook: derived,
                        });
                    }
                }
            };

            // Storage監視開始
            chromeApi.storage.onChanged.addListener(
                onChange
            );

            // ----------------------------------
            // Contentからのメッセージ受信
            // ----------------------------------
            const handleMessage = (
                e: MessageEvent
            ) => {

                const data = e.data;

                if (
                    !data ||
                    typeof data !== 'object'
                ) {
                    return;
                }

                // 単語カード受信
                if (
                    data.type ===
                    'EXTENSION_WORD_CARDS' &&
                    Array.isArray(data.cards)
                ) {

                    const nextBooks =
                        Array.isArray(data.wordBook) &&
                            data.wordBook.length > 0
                            ? data.wordBook
                            : deriveFromCards(
                                data.cards
                            );

                    if (nextBooks.length > 0) {

                        setWordBooks(nextBooks);

                        chromeApi.storage.local.set({
                            wordBook: nextBooks,
                        });
                    }
                }
            };

            // メッセージ監視開始
            window.addEventListener(
                'message',
                handleMessage
            );

            // ----------------------------------
            // 監視解除
            // ----------------------------------
            return () => {
                chromeApi.storage.onChanged.removeListener(
                    onChange
                );

                window.removeEventListener(
                    'message',
                    handleMessage
                );
            };

        } else { // Chrome Extension APIが利用できない場合

            // Content Scriptからの受信を待つ
            const handleMessage = (
                e: MessageEvent
            ) => {

                const data = e.data;

                if (
                    data?.type ===
                    'EXTENSION_WORD_CARDS' &&
                    Array.isArray(data.cards)
                ) {

                    const nextBooks =
                        Array.isArray(data.wordBook) &&
                            data.wordBook.length > 0
                            ? data.wordBook
                            : deriveFromCards(
                                data.cards
                            );

                    if (nextBooks.length > 0) {
                        setWordBooks(nextBooks);
                    }
                }
            };

            window.addEventListener(
                'message',
                handleMessage
            );


            // Content Scriptへ単語カード要求を送信
            let attempts = 0;
            let stopped = false;

            const sendRequest = () => {

                if (stopped) return;

                attempts++;

                window.postMessage(
                    {
                        type:
                            'REQUEST_EXTENSION_WORD_CARDS',
                    },
                    '*'
                );

                if (
                    attempts < 5 &&
                    !stopped
                ) {
                    setTimeout(
                        sendRequest,
                        400
                    );
                }
            };

            sendRequest();

            // クリーンアップ
            return () => {
                window.removeEventListener(
                    'message',
                    handleMessage
                );

                stopped = true;
            };
        }
    }, []);

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newBookName, setNewBookName] = useState('');
    const [newBookColor, setNewBookColor] = useState('#FF9800');


    // ページ遷移用
    const navigate = useNavigate();


    // ======================================================
    // 単語帳ID生成
    // ======================================================
    const createBookId = () => {
        return globalThis.crypto?.randomUUID?.() ?? `book-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    };


    // ======================================================
    // 追加フォーム表示
    // ======================================================
    const handleOpenAddModal = () => {
        setIsAddModalOpen(true);
    };


    // ======================================================
    // 追加フォームを閉じる
    // ======================================================
    const handleCloseAddModal = () => {
        setIsAddModalOpen(false);
        setNewBookName('');
        setNewBookColor('#FF9800');
    };


    // ======================================================
    // 単語帳追加処理
    // ======================================================
    const handleAddBook = () => {

        const trimmedName = newBookName.trim();

        if (!trimmedName) {
            toast.error('単語帳名を入力してください。');
            return;
        }


        const newBook: WordBook = {
            id: createBookId(),
            markerColor: newBookColor,
            markerLabel: trimmedName,
        };


        const chromeApi = (window as any).chrome;


        // 色重複チェック
        if (
            wordBooks.some(
                (b) => b.markerColor === newBook.markerColor
            )
        ) {
            toast.warning('同じ色の単語帳が既に存在します。色を変更してください。');
            return;
        }

        // ----------------------------------------------
        // Chrome Storageへ保存
        // ----------------------------------------------
        if (
            chromeApi &&
            chromeApi.storage &&
            chromeApi.storage.local
        ) {
            chromeApi.storage.local.get(
                ['wordBook'],
                (res: any) => {

                    // 保存済み単語帳取得
                    const list =
                        res &&
                            Array.isArray(res.wordBook)
                            ? res.wordBook
                            : [];

                    // 色重複チェック
                    if (
                        list.some(
                            (b: WordBook) =>
                                b.markerColor ===
                                newBook.markerColor
                        )
                    ) {
                        toast.warning('同じ色の単語帳が既に存在します。色を変更してください。');
                        handleCloseAddModal();
                        return;
                    }


                    // 新しい単語帳を先頭に追加
                    const next = [
                        newBook,
                        ...list.filter(
                            (book: WordBook) =>
                                book.id !== newBook.id
                        ),
                    ];

                    // Storageへ保存
                    chromeApi.storage.local.set(
                        { wordBook: next },
                        () => {

                            // 画面状態更新
                            setWordBooks(next);

                            toast.success('追加しました');

                            // モーダル閉じる
                            handleCloseAddModal();
                        }
                    );
                }
            );

            return;
        }

        // ==================================================
        // 保存できない場合にはContent Script経由で保存を依頼
        // ==================================================
        try {

            // 念のため再度重複チェック
            if (
                wordBooks.some(
                    (b) =>
                        b.markerColor ===
                        newBook.markerColor
                )
            ) {
                toast.warning('同じ色の単語帳が既に存在します。色を変更してください。');
                return;
            }

            // 応答受信済みか判定
            let handled = false;

            // Contentからの返答受信
            const onMessage = (
                e: MessageEvent
            ) => {

                const d = e.data;

                if (
                    !d ||
                    typeof d !== 'object'
                ) {
                    return;
                }

                // 保存結果受信
                if (
                    d.type === 'SAVE_EXTENSION_WORD_BOOKS_RESULT'
                ) {

                    handled = true;

                    // イベント解除
                    window.removeEventListener('message', onMessage);

                    // 保存成功
                    if (
                        d.success &&
                        d.book &&
                        d.book.id === newBook.id
                    ) {

                        // 画面を更新
                        setWordBooks((current) => [
                            d.book,
                            ...current.filter(
                                (b) =>
                                    b.id !== d.book.id
                            ),
                        ]);

                        toast.success('追加しました');

                    } else {

                        // 保存失敗
                        console.warn('BookList: SAVE_EXTENSION_WORD_BOOKS_RESULT failed', d.error);
                    }

                    // モーダル閉じる
                    handleCloseAddModal();
                }
            };

            // メッセージ受信開始
            window.addEventListener(
                'message',
                onMessage
            );

            // Content Scriptへ保存依頼
            window.postMessage(
                {
                    type: 'SAVE_EXTENSION_WORD_BOOKS',
                    book: newBook,
                },
                '*'
            );

            // --------------------------------------------------
            // タイムアウト処理
            // Contentから応答がない場合
            // --------------------------------------------------
            setTimeout(() => {

                if (!handled) {

                    try {
                        window.removeEventListener(
                            'message',
                            onMessage
                        );
                    } catch (_) { }

                    console.warn(
                        'BookList: SAVE_EXTENSION_WORD_BOOKS no response from content script'
                    );

                    // ローカル状態だけ更新
                    setWordBooks((current) => [
                        newBook,
                        ...current,
                    ]);

                    toast.success('追加しました');

                    handleCloseAddModal();
                }
            }, 1000);

        } catch (error) {

            // postMessage失敗時の最終フォールバック
            console.warn(
                'BookList: postMessage save failed',
                error
            );

            // 画面のみ更新
            setWordBooks((current) => [
                newBook,
                ...current,
            ]);

            toast.success('追加しました');

            handleCloseAddModal();
        }
    };

    // ======================================================
    // 単語帳追加モーダルのキーボード操作
    // ======================================================
    useEffect(() => {

        // モーダルが閉じている場合は何もしない
        if (!isAddModalOpen) return;

        // Escキーでモーダルを閉じる
        const handleKeyDown = (
            event: KeyboardEvent
        ) => {

            if (event.key === 'Escape') {
                handleCloseAddModal();
            }
        };

        // キーボードイベント登録
        window.addEventListener(
            'keydown',
            handleKeyDown
        );

        // クリーンアップ
        // モーダルが閉じた時や再描画時に解除
        return () =>
            window.removeEventListener(
                'keydown',
                handleKeyDown
            );

    }, [isAddModalOpen]);

    // ======================================================
    // 単語帳削除処理
    // ======================================================
    const handleDelete = (id: string) => {
        if (!window.confirm('削除しますか？')) return;

        setWordBooks((currentBooks) => {
            const next = currentBooks.filter((book) => book.id !== id);

            // content経由で保存
            try {
                window.postMessage(
                    { type: 'DELETE_WORD_BOOK', bookId: id },
                    '*'
                );
                console.log('DELETE_WORD_BOOK送信:', id);
            } catch (e) {
                console.error('DELETE_WORD_BOOK送信失敗:', e);
            }

            console.log('削除後:', next);

            return next;
        });

    };


    // ======================================================
    // 画面レイアウト
    // ======================================================
    return (

        // 画面全体
        <div className={styles.container}>
            {/* ヘッダー */}
            <div className={styles.header}>
                {/* タイトル */}
                <h1 className={styles.title}>
                    単語帳一覧
                </h1>
            </div>

            {/* 単語帳追加モーダル */}
            {isAddModalOpen && (
                <div
                    className={styles.modalOverlay}
                    onClick={handleCloseAddModal}
                >
                    <div
                        className={styles.modalCard}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.modalHeader}>
                            <h2 className={styles.formTitle}>単語帳を追加</h2>
                            <button
                                className={styles.closeButton}
                                onClick={handleCloseAddModal}
                                aria-label="閉じる"
                            >
                                ×
                            </button>
                        </div>

                        <div
                            style={
                                {
                                    '--accent-color': newBookColor,
                                    '--accent-shadow': `${newBookColor}29`,
                                } as React.CSSProperties
                            }
                        >

                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>単語帳名</span>
                                <input
                                    className={styles.textInput}
                                    type="text"
                                    value={newBookName}
                                    placeholder="例: 世界史"
                                    onChange={(event) => setNewBookName(event.target.value)}
                                    autoFocus
                                />
                            </label>

                            <label className={styles.field}>
                                <span className={styles.fieldLabel}>マーカー色</span>
                                <div className={styles.colorInputRow}>
                                    <input
                                        className={styles.colorInput}
                                        type="color"
                                        value={newBookColor}
                                        onChange={(event) => setNewBookColor(event.target.value)}
                                    />
                                    <span className={styles.colorCode}>{newBookColor}</span>
                                </div>
                            </label>

                            <div className={styles.formButtons}>
                                <button
                                    className={styles.secondaryButton}
                                    onClick={handleCloseAddModal}
                                >
                                    キャンセル
                                </button>
                                <button
                                    className={styles.primaryButton}
                                    onClick={handleAddBook}
                                >
                                    追加する
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* 単語帳一覧 */}
            <div className={styles.list}>


                {/* 単語帳を1つずつ表示 */}
                {wordBooks.map((book) => {

                    return (
                        // 単語帳カード
                        <div
                            key={book.id}
                            className={styles.card}
                        >

                            <div
                                className={styles.colorBar}
                                // 単語帳ごとの色を適用
                                style={{ backgroundColor: book.markerColor, }}
                            />


                            {/* カード内容 */}
                            <div className={styles.content}>


                                {/* 単語帳名 */}
                                <h2 className={styles.bookTitle}>
                                    {book.markerLabel}
                                </h2>



                                <div className={styles.buttonArea}>

                                    {/* 学習開始ボタン */}
                                    <button
                                        className={styles.studyButton}

                                        // カード一覧ページへ遷移
                                        // stateで単語帳情報も渡している
                                        onClick={() =>
                                            navigate(`/card/${book.id}`, { state: { book }, })
                                        }
                                    >学習開始</button>



                                    {/* 削除ボタン */}
                                    <button
                                        className={styles.deleteButton}

                                        // この単語帳を削除
                                        onClick={() =>
                                            handleDelete(book.id)
                                        }
                                    >削除</button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>



            {/* 単語帳追加ボタン */}
            <button
                className={styles.addButton}
                onClick={handleOpenAddModal}
            >
                ＋ 単語帳を追加
            </button>

        </div>
    );
};


export default WordBookList;