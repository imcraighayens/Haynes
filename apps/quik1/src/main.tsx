import React from 'react';
import { createRoot } from 'react-dom/client';
import '../design/global.css';
import './generated/pseudo.css';
import { App } from './app/App';

createRoot(document.getElementById('dc-root')!).render(<App />);
