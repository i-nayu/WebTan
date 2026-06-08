import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';

// import BookList from './Pages/BookList/BookList';
// import CardList from './Pages/CardList/CardList';
import ReviewWords from './Pages/ReviewWords/ReviewWords';

import 'react-toastify/dist/ReactToastify.css';

function App() {
  return (
    <>
      <ToastContainer />

      <BrowserRouter>
        <Routes>
          {/* 単語帳一覧画面 */}
          {/* <Route path="/" element={<BookList />} /> */}

          {/* 単語確認画面 */}
          <Route path="/review" element={<ReviewWords />} />

          {/* 学習画面 */}
          {/* <Route path="/card/:id" element={<CardList />} /> */}
        </Routes>
      </BrowserRouter>
    </>
  );
}

export default App;