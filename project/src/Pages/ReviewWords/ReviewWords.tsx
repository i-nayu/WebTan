import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './ReviewWords.module.css';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { toast } from 'react-toastify';

// 単語カードのデータ型定義（確認画面用）
interface WordCard {
    id: string;
    question: string;
    answer: string;
    markerColor: string;
    markerLabel: string;
    bookId: string;
    learned: boolean;
}

const ReviewWords: React.FC = () => {
    const API_KEY_STORAGE_KEY = 'apiKey';
    // ======================================================
    // 変数
    // ======================================================

    // 単語カード一覧
    const [cards, setCards] = useState<WordCard[]>([]);

    // 入力エラー管理
    const [errors, setErrors] = useState<Record<string, string>>({});

    // ページ遷移
    const navigate = useNavigate();

    // APIキー設定モーダル表示状態
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    // Gemini APIキー
    const [apiKey, setApiKey] = useState('');

    // AI生成中のカードID
    const [generatingId, setGeneratingId] = useState<string | null>(null);

    // ======================================================
    // Gemini APIキーをローカルストレージから読み込み
    // ======================================================
    useEffect(() => {
        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.get([API_KEY_STORAGE_KEY], (res: any) => {
                const savedApiKey = res?.[API_KEY_STORAGE_KEY] ?? '';
                setApiKey(savedApiKey);
            });
            return;
        }

        const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY) ?? localStorage.getItem('api_key') ?? '';
        setApiKey(savedApiKey);
    }, []);

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

    // ======================================================
    // カード一覧表示 (window message 経由)
    // ======================================================
    useEffect(() => {
        setCards([]);
        function handleMessage(e: MessageEvent) {
            const data = e.data;

            console.log('ReviewWords received window.message:', data);

            if (!data || typeof data !== 'object') {
                return;
            }

            if (data.type === 'REQUEST_STORED_HIGHLIGHTS') {
        return; 
    }

            // 単語カード受信
            if (data.type === 'EXTENSION_STORED_HIGHLIGHTS') {
                console.log('ReviewWords EXTENSION_STORED_HIGHLIGHTS cards:', data.highlights);
                setCards(data.highlights ?? []);
            }
        }

        window.addEventListener('message', handleMessage);

        let attempts = 0;
        let stopped = false;

        const sendRequest = () => {
            if (stopped) return;

            attempts += 1;

            try {
                window.postMessage({ type: 'REQUEST_STORED_HIGHLIGHTS' }, '*');
            } catch (e) {
                console.error(e);
            }

            if (attempts < 4 && !stopped) {
                setTimeout(sendRequest, 400);
            }
        };

        sendRequest();

        return () => {
            stopped = true;
            window.removeEventListener('message', handleMessage);
        };
    }, []);



    // ======================================================
    // 問題編集
    // ======================================================
    const handleQuestionChange = (id: string, newQuestion: string) => {
        setCards((currentCards) =>
            currentCards.map((card) =>
                card.id === id ? { ...card, question: newQuestion } : card
            )
        );
    };

    // ======================================================
    // 回答編集
    // ======================================================
    const handleAnswerChange = (id: string, newAnswer: string) => {
        setCards((currentCards) =>
            currentCards.map((card) =>
                card.id === id ? { ...card, answer: newAnswer } : card
            )
        );

        if (newAnswer && newAnswer.trim() !== '') {
            setErrors((prev) => {
                if (!prev[id]) return prev;
                const copy = { ...prev };
                delete copy[id];
                return copy;
            });
        }
    };

    // ======================================================
    // 削除
    // ======================================================
    const handleDelete = (id: string) => {
        if (window.confirm('削除しますか？')) {
            setCards((currentCards) =>
                currentCards.filter((card) => card.id !== id)
            );
        }
    };

    // ======================================================
    // リセット
    // ======================================================
    const handleResetAnswers = () => {
        if (window.confirm('すべての答えをリセットしてもよろしいですか？')) {
            setCards((currentCards) =>
                currentCards.map((card) => ({ ...card, answer: '' }))
            );
        }
    };

    // ======================================================
    // 保存 (highlights のみを更新)
    // ======================================================
    const handleSendAnswers = () => {
        // 保存用に整形
        const toSave = cards.map((c) => ({
            id: c.id || (typeof crypto !== 'undefined' ? (crypto as any).randomUUID() : String(Date.now())),
            question: c.question ?? '',
            answer: c.answer ?? '',
            markerColor: c.markerColor ?? '#FFEB3B',
            markerLabel: c.markerLabel ?? '未分類',
            bookId: c.bookId ?? 'unspecified',
            learned: c.learned ?? false,
        }));

        // エラー処理
        const newErrors: Record<string, string> = {};
        toSave.forEach((c) => {
            if (!c.answer || c.answer.trim() === '') {
                newErrors[c.id] = '回答が未入力です';
            }
        });

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            toast.error('回答が未入力のカードがあります。未入力の欄を確認してください。', { autoClose: 4000 });
            return;
        }
        setErrors({});

        const chromeApi = (window as any).chrome;
        if (chromeApi?.storage?.local) {
            // 既存の highlights と新しいカードをマージ (重複は新しいカード優先)
            chromeApi.storage.local.get(['highlights'], (res: any) => {
                const existingHighlights = (res && Array.isArray(res.highlights)) ? res.highlights : [];

                const map = new Map<string, any>();
                existingHighlights.forEach((c: any) => map.set(c.id, c));
                toSave.forEach((c) => map.set(c.id, { ...map.get(c.id), ...c }));
                
                const mergedHighlights = Array.from(map.values());

                // highlights のみに保存
                chromeApi.storage.local.set({ highlights: mergedHighlights }, () => {
                    toast.success('単語帳に保存しました');
                    navigate('/');
                });
            });
            return;
        }

        try {
            window.postMessage({ type: 'SAVE_EXTENSION_WORD_CARDS', cards: toSave }, '*');
            setCards([]);
            toast.info('単語を保存しました');
            navigate('/');
        } catch (e) {
            console.error('postMessage save failed', e);
            toast.error('単語の保存に失敗しました');
        }
    };

    // ======================================================
    // APIキー保存
    // ======================================================
    const handleSaveApiKey = async () => {
        const trimmedApiKey = apiKey.trim();
        console.log('保存ボタンがクリックされました');

        if (!trimmedApiKey) {
            return;
        }

        const chromeApi = (window as any).chrome;

        if (chromeApi?.storage?.local) {
            chromeApi.storage.local.set({ geminiApiKey: trimmedApiKey });
            console.log('APIキーをchrome.storageに保存しました');
            setIsSettingsOpen(false);
            toast.success('APIキーを保存しました。');
            return;
        }

        try {
            window.postMessage(
                {
                    type: 'SAVE_API_KEY',
                    apiKey: trimmedApiKey,
                },
                '*'
            );
            console.log('API key sent for saving');
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
    const handleGenerateByAI = async (cardId: string) => {
        const usableApiKey = await getApiKey();

        if (!usableApiKey) {
            toast.error('AI生成にはAPIキーが必要です。設定画面でAPIキーを入力してください。');
            setIsSettingsOpen(true);
            return;
        }

        const target = cards.find((card) => card.id === cardId);

        if (!target) {
            toast.error('カードが見つかりません。');
            return;
        }

        setGeneratingId(cardId);

        try {
            const prompt = `以下の問題に対して、単語帳の「答え」として使える簡潔な説明を日本語で出力してください。問題: ${target.question}`;

            const genAI = new GoogleGenerativeAI(usableApiKey);
            const model = genAI.getGenerativeModel({
                model: 'gemini-2.5-flash',
            });

            const result = await model.generateContent({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: prompt }],
                    },
                ],
            });

            const responseText = result.response.text().trim();

            if (!responseText) {
                throw new Error('AIの応答が空でした。');
            }

            setCards((currentCards) =>
                currentCards.map((card) =>
                    card.id === cardId ? { ...card, answer: responseText } : card
                )
            );
        } catch (error: any) {
            console.error(error);
            const em = error?.message ?? String(error);
            toast.error(`AI生成に失敗しました: ${em}`);
        } finally {
            setGeneratingId(null);
        }
    };

    return (
        <div className={styles.wrapper}>
            <div className={styles.container}>
                {/* ヘッダー */}
                <header className={styles.header}>
                    <div className={styles.headerTop}>
                        <h1 className={styles.title}>
                            📝 選択した単語
                        </h1>
                    </div>
                    {/* 修正: 直接保存に走らず、設定モーダルを開くように変更 */}
                    <button
                        className={styles.settingsBtn}
                        onClick={() => setIsSettingsOpen(true)}
                    >
                        <span>Gemini API設定</span>
                    </button>

                    {isSettingsOpen && (
                        <div className={styles.settingsPanel}>
                            <p className={styles.settingsTitle}>
                                Gemini APIを入力してください
                            </p>

                            <input
                                className={styles.apiKeyInput}
                                type="password"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                            />

                            <div className={styles.settingsActions}>
                                <button
                                    className={styles.closeButton}
                                    onClick={() => setIsSettingsOpen(false)}
                                >
                                    閉じる
                                </button>

                                <button
                                    className={styles.saveButton}
                                    onClick={handleSaveApiKey}
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    )}
                </header>

                {/* カード一覧 */}
                <main className={styles.list}>
                    {cards.map((card) => (
                        <div key={card.id} className={styles.card}>
                            {/* 左側 */}
                            <div className={styles.cardLeft}>
                                <span className={`${styles.labelTag} ${styles.tagQuestion}`}>
                                    問題
                                </span>

                                <input
                                    className={styles.questionInput}
                                    value={card.question}
                                    onChange={(e) => handleQuestionChange(card.id, e.target.value)}
                                    placeholder="問題を入力..."
                                />

                                <div className={styles.markerInfo}>
                                    <span
                                        className={styles.markerDot}
                                        style={{ backgroundColor: card.markerColor }}
                                    />
                                    <span>{card.markerLabel}</span>
                                </div>
                            </div>

                            {/* 右側 */}
                            <div className={styles.cardRight}>
                                <div className={styles.answerHeader}>
                                    <div className={styles.iconGroup}>
                                        <button
                                            className={`${styles.iconBtn} ${styles.reconstruct}`}
                                            title="再生成"
                                            onClick={() => handleGenerateByAI(card.id)}
                                            disabled={generatingId === card.id}
                                        >
                                            {generatingId === card.id ? (
                                                <span>⏳ 生成中...</span>
                                            ) : (
                                                <span>✨ AI生成</span>
                                            )}
                                        </button>

                                        <button
                                            onClick={() => handleDelete(card.id)}
                                            className={`${styles.iconBtn} ${styles.delete}`}
                                            title="削除"
                                        >
                                            <span>🗑️ 削除</span>
                                        </button>
                                    </div>
                                </div>

                                <textarea
                                    className={styles.textarea}
                                    value={card.answer}
                                    onChange={(e) => handleAnswerChange(card.id, e.target.value)}
                                    placeholder="回答を入力してください"
                                />
                                {errors[card.id] && (
                                    <div style={{ color: '#c62828', marginTop: 6 }}>
                                        {errors[card.id]}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </main>

                {/* フッター */}
                <footer className={styles.footer}>
                    <button className={styles.resetBtn} onClick={handleResetAnswers}>
                        答えをリセット
                    </button>

                    <button className={styles.moveBtn} onClick={handleSendAnswers}>
                        単語帳へ保存
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default ReviewWords;