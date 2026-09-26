import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/skin-board.css';
import './styles/skin-tuner.css';
import './styles/skin-drive.css';
import './styles/skin-daylight.css';
import './styles/skin-deck.css';
import './styles/skin-prism.css';
import './styles/skin-hifi.css';
import './store/skin'; // stamps data-skin before the first paint
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
