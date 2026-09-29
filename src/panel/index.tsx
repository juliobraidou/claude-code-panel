import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import { App } from './App';
import { styles } from './styles';

const styleTag = document.createElement('style');
styleTag.textContent = styles;
document.head.appendChild(styleTag);

const rootEl = document.getElementById('root')!;
const root = ReactDOM.createRoot(rootEl);
root.render(<App />);
