import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';
import { startPwa } from './pwa';
import { startDesktop } from './desktop';

startDesktop();
startPwa();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
