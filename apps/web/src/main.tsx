import React from 'react';
import ReactDOM from 'react-dom/client';
import Application from './Application';
import './style.css';
import { startPwa } from './pwa';
import { startDesktop } from './desktop';

startDesktop();
startPwa();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Application />
  </React.StrictMode>,
);
