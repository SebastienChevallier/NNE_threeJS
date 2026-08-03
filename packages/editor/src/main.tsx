import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { createController } from './controller.js';

const host = document.getElementById('root');
if (!host) throw new Error('no #root element in the page');

const controller = createController();

createRoot(host).render(
  <StrictMode>
    <App controller={controller} />
  </StrictMode>,
);
