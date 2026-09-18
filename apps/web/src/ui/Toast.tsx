import { useStore } from '../store';

export function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <div className={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
      {toast}
    </div>
  );
}
