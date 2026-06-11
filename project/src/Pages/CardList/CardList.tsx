import React, { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
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


  // カード一覧state
  const [cards, setCards] = useState<WordCard[]>([]);

  const [filterType, setFilterType] = useState<'all' | 'learned' | 'unlearned'>('all');

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

    setCards((currentCards) => {
      const next = currentCards.filter((card) => card.id !== cardId);
      persistCards(next);
      return next;
    });
  };

  // ======================================================
  // 画面レイアウト
  // ======================================================
  return (
    <div className={styles.container}>


      {/* ヘッダー */}
      <div className={styles.header}>

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
          <div className={styles.filterButtons}>
            <button
              onClick={() => setFilterType('all')}
            >
              全て
            </button>

            <button
              onClick={() => setFilterType('learned')}
            >
              学習済み
            </button>

            <button
              onClick={() => setFilterType('unlearned')}
            >
              未学習
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
        {filteredCards.map((card) => (
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
              <button
                className={styles.questionButton}

                // 答え表示切り替え
                onClick={() => handleToggle(card.id)}
              >
                {card.question}
              </button>


              {/* 削除ボタン */}
              <button
                className={styles.deleteButton}
                onClick={() => handleDelete(card.id)}
              >削除</button>

            </div>


            {/* 答え表示エリア */}
            <div
              className={`${styles.answer} ${openedIds.includes(card.id)
                ? styles.answerOpen
                : ''
                }`}
            >
              {card.answer}
            </div>

          </div>
        ))}
      </div>
    </div>
  );
};

export default CardList;
