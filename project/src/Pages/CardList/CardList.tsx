import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import { GoogleGenerativeAI } from '@google/generative-ai';
import styles from './CardList.module.css';


// ======================================================
// 単語カード型
// ======================================================
interface WordCard {
    id: string;
    question: string;
    answer: string;
    markerColor: string;
    markerLabel: string;
    bookId: string; // 単語帳識別用（新規はランダム生成）
    learned: boolean; // 学習済みかどうかのフラグ
}

// ======================================================
// 単語カード一覧ページ
// ======================================================
const CardList: React.FC = () => {
    const API_KEY_STORAGE_KEY = 'apiKey';

    // URLパラメータ取得
    const { id } = useParams<{ id: string }>();

    // 遷移時のstate取得
    const location = useLocation();

    // 単語帳データ
    const book = (location.state as any)?.book;

    const currentBookId = id ?? book?.id ?? '';


    // 現在開いているカードID
    const [openedIds, setOpenedIds] = useState<string[]>([]);

    const [isAddFormOpen, setIsAddFormOpen] = useState(false);
    const [newQuestion, setNewQuestion] = useState('');
    const [newAnswer, setNewAnswer] = useState('');

    // APIキー設定モーダル表示状態
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Gemini APIキー
    const [apiKey, setApiKey] = useState('');

    // AI生成中のカードID
    const [generatingId, setGeneratingId] = useState<string | null>(null);


    // カード一覧state
    const [cards, setCards] = useState<WordCard[]>([]);

    const [filterType, setFilterType] = useState<'all' | 'learned' | 'unlearned'>('all');
    const [mode, setMode] = useState<'card' | 'test' | 'edit'>('card');
    const [showModeMenu, setShowModeMenu] = useState(false);
    const [showAnswers, setShowAnswers] = useState(false);

    const [questionSentence, setQuestionSentence] = useState('');
    const [answerObj, setAnswerObj] = useState<Record<string, string>>({});

    useEffect(() => {
        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.get([API_KEY_STORAGE_KEY], (res: any) => {
                const savedApiKey = res?.[API_KEY_STORAGE_KEY] ?? '';
                if (savedApiKey) {
                    setApiKey(savedApiKey);
                }
            });
            return;
        }

        const fallbackApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) ?? localStorage.getItem('api_key') ?? '';
        if (fallbackApiKey) {
            setApiKey(fallbackApiKey);
        }
    }, []);

    //絞り込み機能
    const filteredCards = cards.filter((card) => {
        switch (filterType) {
            case 'learned':
                return card.learned;

            case 'unlearned':
                return !card.learned;

            default:
                return true;
        }
    });

    // ======================================================
    // API結果の受信
    // ======================================================
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'API_KEY_RESULT') {
                setApiKey(event.data.apiKey ?? '');
            }
        };

        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    // ======================================================
    // APIキーリクエスト
    // ======================================================
    const getApiKey = (): Promise<string> => {
        return new Promise((resolve) => {

            const handler = (event: MessageEvent) => {
                if (event.data?.type === 'API_KEY_RESULT') {
                    window.removeEventListener('message', handler);
                    resolve(event.data.apiKey ?? '');
                }
            };

            window.addEventListener('message', handler);

            window.postMessage(
                {
                    type: 'REQUEST_API_KEY',
                },
                '*'
            );
        });
    };



    //指定した単語帳に属するカード一覧を生成
    const deriveCardsForBook = (bookId: string, arr: any[] | null) => {
        if (!Array.isArray(arr)) return [] as WordCard[];

        return arr
            .filter((card: any) => card && card.bookId === bookId)
            .map((card: any) => ({
                id: card.id,
                question: card.question ?? '',
                answer: card.answer ?? '',
                markerColor: card.markerColor ?? (book?.markerColor ?? '#FFEB3B'),
                markerLabel: card.markerLabel ?? (book?.markerLabel ?? '未分類'),
                bookId: card.bookId ?? bookId,
                learned: !!card.learned,
            }));
    };


    // ======================================================
    // 単語カード一覧データの読み込み
    // ======================================================
    useEffect(() => {
        const chromeApi = (window as any).chrome;
        let stopped = false;

        // --------------------------------------------------
        // 指定した単語帳のカードだけを画面に反映
        // --------------------------------------------------
        const applyCards = (arr: any[]) => {
            const derived = deriveCardsForBook(currentBookId, arr);
            setCards(derived);
        };


        // --------------------------------------------------
        // chrome strageから取得
        // --------------------------------------------------
        if (chromeApi?.storage?.local) {

            //初回読み込み
            chromeApi.storage.local.get(['wordCard', 'highlights'], (res: any) => {
                if (stopped) return;

                const source = Array.isArray(res?.wordCard) && res.wordCard.length > 0
                    ? res.wordCard
                    : Array.isArray(res?.highlights)
                        ? res.highlights
                        : [];
                applyCards(source);
            });

            // --------------------------------------------------
            // strage更新時にカード一覧を再取得
            // --------------------------------------------------
            const onChange = (changes: any, areaName: string) => {
                if (areaName !== 'local') return;
                if (changes.wordCard) {
                    applyCards(changes.wordCard.newValue ?? []);
                } else if (changes.highlights) {
                    applyCards(changes.highlights.newValue ?? []);
                }
            };

            chromeApi.storage.onChanged.addListener(onChange);

            // クリーンアップ
            return () => {
                stopped = true;
                chromeApi.storage.onChanged.removeListener(onChange);
            };
        }

        // --------------------------------------------------
        // contentからカード情報を取得
        // --------------------------------------------------
        const handleMessage = (e: MessageEvent) => {
            const data = e.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'EXTENSION_WORD_CARDS' && Array.isArray(data.cards)) {
                applyCards(data.cards);
            }
        };

        window.addEventListener('message', handleMessage);

        // --------------------------------------------------
        // contentにカード情報の送信をリクエスト
        // --------------------------------------------------
        let attempts = 0;
        const sendRequest = () => {
            attempts += 1;
            try {
                window.postMessage({ type: 'REQUEST_EXTENSION_WORD_CARDS' }, '*');
            } catch (_) {
            }
            if (attempts < 4) setTimeout(sendRequest, 400);
        };
        sendRequest();

        //クリーンアップ
        return () => window.removeEventListener('message', handleMessage);
    }, [currentBookId, book]);


    // ======================================================
    // カードID生成
    // ======================================================
    const createCardId = () => {
        return globalThis.crypto?.randomUUID?.() ?? `card-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    };


    // =====================================================
    // カード追加フォーム表示
    // =====================================================
    const handleOpenAddForm = () => {
        setIsAddFormOpen(true);
    };


    // =====================================================
    // カード追加フォームを閉じる
    // =====================================================
    const handleCloseAddForm = () => {
        setIsAddFormOpen(false);
        setNewQuestion('');
        setNewAnswer('');
    };


    // ======================================================
    // chrome strageに保存
    // ======================================================
    const persistCard = (newCard: WordCard) => {
        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.get(['wordCard'], (res: any) => {
                const existing = Array.isArray(res?.wordCard) ? res.wordCard : [];
                const next = [newCard, ...existing.filter((card: WordCard) => card.id !== newCard.id)];
                chromeApi.storage.local.set({ wordCard: next, highlights: next }, () => {
                    toast.success('カードを保存しました');
                });
            });
            return;
        }

        // --------------------------------------------------
        // content経由で保存
        // --------------------------------------------------
        try {
            let handled = false;
            const onMessage = (e: MessageEvent) => {
                const data = e.data;
                if (!data || typeof data !== 'object') return;

                //保存結果を受信
                if (data.type === 'SAVE_EXTENSION_WORD_CARDS_RESULT') {
                    handled = true;
                    window.removeEventListener('message', onMessage);
                    if (data.success) {
                        toast.success('カードを保存しました');
                    } else {
                        toast.error('カードの保存に失敗しました');
                    }
                }
            };

            window.addEventListener('message', onMessage);
            window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS', cards: [newCard] }, '*');

            // 1秒後に保存完了とみなす（contentからの応答がない場合のフォールバック）
            setTimeout(() => {
                if (!handled) {
                    try {
                        window.removeEventListener('message', onMessage);
                    } catch (_) {
                        // noop
                    }
                    toast.success('カードを保存しました');
                }
            }, 1000);
        } catch (_) {
            toast.error('カードの保存に失敗しました');
        }
    };


    // =====================================================
    // カード一覧を保存
    // =====================================================
    const persistCards = (nextCards: WordCard[]) => {
        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.set({ wordCard: nextCards, highlights: nextCards });
            return;
        }

        //content経由で保存
        try {
            window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS', cards: nextCards }, '*');
        } catch (_) {
            // noop
        }
    };

    // =====================================================
    // カード一覧追加
    // =====================================================
    const handleAddCard = () => {
        const trimmedQuestion = newQuestion.trim();
        const trimmedAnswer = newAnswer.trim();

        if (!currentBookId) {
            toast.error('単語帳情報が見つかりません。');
            return;
        }

        if (!trimmedQuestion || !trimmedAnswer) {
            toast.warning('問題と答えを入力してください。');
            return;
        }

        //新規カード作成
        const newCard: WordCard = {
            id: createCardId(),
            question: trimmedQuestion,
            answer: trimmedAnswer,
            markerColor: book?.markerColor ?? '#FFEB3B',
            markerLabel: book?.markerLabel ?? '未分類',
            bookId: currentBookId,
            learned: false,
        };

        setCards((currentCards) => [newCard, ...currentCards]);
        persistCard(newCard);
        handleCloseAddForm();
    };

    // ======================================================
    // カードの表裏を切り替え
    // ======================================================
    const handleToggle = (cardId: string) => {
        setOpenedIds((current) =>
            current.includes(cardId)
                ? current.filter((id) => id !== cardId)
                : [...current, cardId]
        );
    };

    //長文の方
    const [isOpen, setIsOpen] = useState(false);
    const handleToggleSentence = () => {
        setIsOpen((current) => !current);
    };

    // ======================================================
    // 学習済み状態を切り替え
    // ======================================================
    const toggleCheck = (cardId: string) => {
        const updatedCards = cards.map((card) =>
            card.id === cardId
                ? { ...card, learned: !card.learned }
                : card
        );

        setCards(updatedCards);
        persistCards(updatedCards);
    };


    // ======================================================
    // カードをシャッフル
    // ======================================================
    const handleShuffle = () => {
        setCards((currentCards) => [...currentCards].sort(() => Math.random() - 0.5));
    };

    // ======================================================
    // カードを削除
    // ======================================================
    const handleDelete = (cardId: string) => {
        if (!window.confirm('削除しますか？')) return;

        const nextCards = cards.filter(
            (card) => card.id !== cardId
        );

        setCards(nextCards);
        //content経由で保存
        try {
            window.postMessage({ type: 'DELETE_WORD_CARD', cardId: cardId }, '*');
        } catch (_) {
            // noop
        }

        console.log('削除後', nextCards);
    };

    // ======================================================
    // APIキー保存
    // ======================================================
    const handleSaveApiKey = async () => {
        const trimmedApiKey = apiKey.trim();
        console.log('ボタンがクリックされました');

        if (!trimmedApiKey) {
            setIsSettingsOpen(true);
            return;
        }

        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.set({ geminiApiKey: trimmedApiKey });
            console.log('APIキーをchrome.storageに保存しました');
            return;
        }

        try {

            window.postMessage(
                {
                    type: 'SAVE_API_KEY',
                    apiKey: apiKey.trim(),
                },
                '*'
            );
            console.log('API key sent for saving');

            // setApiKey(trimmedApiKey);
            setIsSettingsOpen(false);
            toast.success('APIキーを保存しました。');
        } catch (error) {
            console.error(error);
            toast.error('APIキーの保存に失敗しました。');
        }
    };

    // ======================================================
    // AI生成
    // ======================================================
    const handleGenerateByAI = async () => {

        const usableApiKey = await getApiKey();

        if (!usableApiKey) { //APIがない時は入力画面を開く
            toast.error('AI生成にはAPIキーが必要です。設定画面でAPIキーを入力してください。');
            setIsSettingsOpen(true);
            return;
        }

        if (filteredCards.length === 0) {
            toast.error('カードが見つかりません。');
            return;
        }

        const cardInfo = filteredCards
            .map(
                (card) =>
                    `用語:${card.question}
          説明:${card.answer}`
            )
            .join('\n\n');

        setGeneratingId('generating'); //「生成中」の表示に使用

        try {
            const prompt =
                `以下の用語と説明を使用して、
        学習用の総合穴埋め問題を1つ作成してください。

        条件:
        - すべての用語を使用する
        - 用語名は（①）（②）...のように隠す
        - 単なる箇条書きは禁止
        - ストーリー性や流れのある文章にする
        - 問題の後に、解答を必ずつける
        - JSON形式のみで回答する
        - 回答は必ずJSON形式で、他の説明文やMarkdownなどは一切含めないこと
        出力形式:
        {
          "question": "問題文",
          "answer": {
            "①": "用語1",
            "②": "用語2",
            "③": "用語3"
          }
        }${cardInfo}`;

            const genAI = new GoogleGenerativeAI(
                usableApiKey
            );

            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
            });

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
            });

            const responseText = result.response.text().trim();
            const cleanedText = responseText
                .replace(/```json/g, '')
                .replace(/```/g, '')
                .trim();


            const aiResult = JSON.parse(cleanedText);

            setQuestionSentence(aiResult.question ?? '');
            setAnswerObj(aiResult.answer ?? {});

            toast.success('文章題を生成しました');
            console.log('AIレスポンス全体:', responseText);
            console.log('生成された文章題:', aiResult.question);
            console.log('解答:', aiResult.answer);
        } catch (error: any) {
            console.error(error);

            const em =
                error?.message ?? String(error);

            toast.error(`AI生成に失敗しました: ${em}`);
            console.error('AI生成エラー:', error);
        } finally {
            setGeneratingId(null);

        };
    };

    const handleGenerateAnswerByAI = async () => {
        setGeneratingId('new-card');

        const usableApiKey = await getApiKey();

        if (!usableApiKey) { //APIがない時は入力画面を開く
            toast.error('AI生成にはAPIキーが必要です。設定画面でAPIキーを入力してください。');
            setIsSettingsOpen(true);
            return;
        }


        const question = newQuestion.trim();

        try {
            const prompt =
                `以下の問題に対して、単語帳の「答え」として使える簡潔な説明を日本語で出力してください。問題: ${question}`;

            const genAI = new GoogleGenerativeAI(
                usableApiKey
            );

            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
            });

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                text: prompt,
                            },
                        ],
                    },
                ],
            });

            const responseText = result.response.text().trim();

            if (!responseText) {
                throw new Error(
                    'AIの応答が空でした。'
                );
            }

            setNewAnswer(responseText);

            toast.success('答えを生成しました');

        } catch (error: any) {
            console.error(error);

            const em =
                error?.message ?? String(error);

            toast.error(`AI生成に失敗しました: ${em}`);
        } finally {
            setGeneratingId(null);
        }
    };


    // ======================================================
    // 画面レイアウト
    // ======================================================
    return (
        <div className={styles.container}>

            {/* ヘッダー */}
            <div className={styles.header}>
                {isSettingsOpen && (
                    <div className={styles.overlay}>
                        <div
                            className={
                                styles.settingsPanel
                            }
                        >
                            <p
                                className={
                                    styles.settingsTitle
                                }
                            >
                                Gemini APIを入力してください
                            </p>

                            <input
                                className={
                                    styles.apiKeyInput
                                }
                                type="password"
                                value={apiKey}
                                onChange={(e) =>
                                    setApiKey(
                                        e.target.value
                                    )
                                }
                            />

                            <div
                                className={
                                    styles.settingsActions
                                }
                            >
                                <button
                                    className={
                                        styles.resetBtn
                                    }
                                    onClick={() =>
                                        setIsSettingsOpen(
                                            false
                                        )
                                    }
                                >
                                    閉じる
                                </button>

                                <button
                                    className={
                                        styles.saveButton
                                    }
                                    onClick={
                                        handleSaveApiKey
                                    }
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 単語帳タイトル */}
                <h1 className={styles.title}>
                    {book?.markerLabel ? `${book.markerLabel}` : `単語帳 ${id}`}
                </h1>

                <div className={styles.headerButtons}>
                    <button className={styles.addButton} onClick={handleOpenAddForm}>
                        ＋ カード追加
                    </button>
                    <button className={styles.shuffleButton} onClick={handleShuffle}>
                        シャッフル
                    </button>
                    <button className={styles.modeButton} onClick={() => setShowModeMenu(!showModeMenu)}>
                        モード変更
                    </button>

                    <div className={styles.modeWrapper}>

                        {showModeMenu && (
                            <div className={styles.modeMenu}>
                                <button className={mode === 'card' ? styles.activeMode : ''} onClick={() => {
                                    setMode('card');
                                    setOpenedIds([]);
                                    setShowAnswers(false);
                                    setShowModeMenu(false);
                                }}
                                >
                                    カードモード
                                </button>

                                <button className={mode === 'test' ? styles.activeMode : ''} onClick={() => {
                                    setMode('test');
                                    setOpenedIds([]);
                                    setShowAnswers(false);
                                    setShowModeMenu(false);
                                }}
                                >
                                    テストモード
                                </button>

                                <button className={mode === 'edit' ? styles.activeMode : ''} onClick={() => {
                                    setMode('edit');
                                    setOpenedIds([]);
                                    setShowAnswers(false);
                                    setShowModeMenu(false);
                                }}
                                >
                                    編集モード
                                </button>
                            </div>
                        )}
                    </div>
                    <div className={styles.filterButtons}>
                        <button
                            className={`${styles.filterButton} ${styles.filterAll}`}
                            onClick={() => setFilterType('all')}
                        >
                            全て
                        </button>

                        <button
                            className={`${styles.filterButton} ${styles.filterLearned}`}
                            onClick={() => setFilterType('learned')}
                        >
                            学習済み
                        </button>

                        <button
                            className={`${styles.filterButton} ${styles.filterUnlearned}`}
                            onClick={() => setFilterType('unlearned')}
                        >
                            未学習
                        </button>
                        <button
                            className={`${styles.iconBtn} ${styles.reconstruct}`}
                            title="AIで文章題生成"
                            onClick={() =>
                                handleGenerateByAI()
                            }
                            disabled={
                                generatingId !== null
                            }
                        >
                            {generatingId ? (
                                <span>
                                    ⏳
                                    生成中...
                                </span>
                            ) : (
                                <span>
                                    ✨
                                    AIで文章題生成
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() =>
                                handleSaveApiKey()
                            }
                        >
                            <span>Gemini API設定</span>
                        </button>
                    </div>
                </div>
            </div>


            {/* カード追加フォーム */}
            {isAddFormOpen && (
                <div className={styles.formCard}>
                    <h2 className={styles.formTitle}>カードを追加</h2>

                    <label className={styles.field}>
                        <span className={styles.fieldLabel}>問題</span>
                        <textarea
                            className={styles.textArea}
                            value={newQuestion}
                            placeholder="例: 桶狭間の戦いは何年？"
                            onChange={(event) => setNewQuestion(event.target.value)}
                        />
                    </label>

                    <label className={styles.field}>
                        <div className={styles.aiRow}>
                            <button
                                type="button"
                                onClick={() => handleGenerateAnswerByAI()}
                                disabled={generatingId === 'new-card'}
                            >
                                {generatingId === 'new-card'
                                    ? '生成中...'
                                    : '✨AIで答え生成'}
                            </button>
                        </div>
                        <span className={styles.fieldLabel}>答え</span>

                        <textarea
                            className={styles.textArea}
                            value={newAnswer}
                            placeholder="例: 1560年"
                            onChange={(event) => setNewAnswer(event.target.value)}
                        />
                    </label>

                    <div className={styles.formButtons}>
                        <button className={styles.secondaryButton} onClick={handleCloseAddForm}>
                            キャンセル
                        </button>
                        <button className={styles.primaryButton} onClick={handleAddCard}>
                            追加する
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.cardList}>
                {filteredCards.map((card, index) => (
                    <div key={card.id} className={styles.card}>
                        <div className={styles.cardTop}>
                            <label className={styles.checkboxArea}>
                                <input
                                    type="checkbox"
                                    checked={card.learned}
                                    onChange={() => toggleCheck(card.id)}
                                />
                            </label>


                            {/* 問題ボタン */}
                            <div className={styles.questionArea}>
                                <div className={styles.questionText} onClick={() => mode === 'card' && handleToggle(card.id)}>
                                    {mode === 'test' ? `(${index + 1}) ` : ''}
                                    {card.question}
                                </div>
                                {mode === 'card' && (
                                    <button className={styles.arrowButton} onClick={() => handleToggle(card.id)}>
                                        {openedIds.includes(card.id) ? '▲' : '▼'}
                                    </button>
                                )}

                            </div>
                            {/* 削除ボタン */}
                            {mode === 'edit' && (
                                <button className={styles.deleteButton} onClick={() => handleDelete(card.id)}>
                                    削除
                                </button>
                            )}
                        </div>

                        {/* 答え表示エリア */}
                        {(mode === 'card' || mode === 'edit') && (
                            <div
                                className={`${styles.answer} ${mode === 'edit' || openedIds.includes(card.id)
                                    ? styles.answerOpen
                                    : ''
                                    }`}
                            >
                                {card.answer}
                            </div>
                        )}

                    </div>
                ))}
                {mode === 'card' && (
                    <>
                        <button
                            className={styles.questionButton}
                            onClick={() => handleToggleSentence()}
                        >
                            {questionSentence}
                        </button>

                        {isOpen && (
                            <div>
                                {Object.entries(answerObj).map(
                                    ([key, value]) => (
                                        <div key={key}>
                                            {key}: {value}
                                        </div>
                                    )
                                )}
                            </div>
                        )}
                    </>
                )}
                {mode === 'test' && (
                    <div className={styles.questionButton}>
                        {questionSentence}
                    </div>
                )}

            </div>
            {mode === 'test' && (
                <div className={styles.answerList}>
                    <button
                        className={styles.showAnswersButton}
                        onClick={() => setShowAnswers(!showAnswers)}
                    >
                        {showAnswers ? '解答を隠す' : '解答一覧を表示'}
                    </button>

                    {showAnswers && (
                        <>
                            <h2>解答一覧</h2>

                            {filteredCards.map((card, index) => (
                                <div
                                    key={`answer-${card.id}`}
                                    className={styles.answerItem}
                                >
                                    <strong>({index + 1})</strong> {card.answer}
                                </div>
                            ))}
                            {Object.entries(answerObj).map(
                                ([key, value]) => (
                                    <div key={key}>
                                        {key}: {value}
                                    </div>
                                )
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default CardList;
