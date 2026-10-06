import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { TiledMap } from '@cesar-office/world';
import sede from '../../../packages/world/maps/sede.json';
import { App } from './App.tsx';
import { SandboxBackend, ServerBackend, type Backend } from './backend.ts';
import './styles.css';

declare const __SANDBOX__: boolean;

/**
 * Sandbox: build `--mode sandbox` (arquivo único) ou `?sandbox` na URL.
 * Servidor: `?server=http://host:4100` ou VITE_REALTIME_HTTP (padrão http://localhost:4100).
 */
function chooseBackend(): Backend {
  const q = new URLSearchParams(location.search);
  if (__SANDBOX__ || q.has('sandbox')) return new SandboxBackend(sede as unknown as TiledMap);
  const http = q.get('server') ?? (import.meta.env['VITE_REALTIME_HTTP'] as string | undefined) ?? 'http://localhost:4100';
  return new ServerBackend(http.replace(/\/$/, ''));
}

const root = document.getElementById('root');
if (!root) throw new Error('#root ausente');
createRoot(root).render(
  <StrictMode>
    <App backend={chooseBackend()} />
  </StrictMode>,
);
