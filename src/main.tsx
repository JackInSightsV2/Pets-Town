import { createRoot } from 'react-dom/client';
import { createHandoffStore } from './client/handoffs';
import { connectOffice, presentationAction } from './client/connection';
import { App } from './ui/App';
import { createLifecycleStore } from './client/lifecycle';
import { OfficeBehaviorProvider } from './ui/useOfficeBehavior';

async function boot() {
  const root = document.getElementById('root');
  if (!root) throw new Error('PetsTown needs a #root element.');
  const invite = new URLSearchParams(window.location.hash.slice(1)).get('room');
  if (invite) {
    // The invitation stays out of HTTP URLs, referrers and server access logs.
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const response = await fetch('/api/room/session', { method: 'POST', headers: { Authorization: `Bearer ${invite}` } });
    if (!response.ok) { root.textContent = 'This room invitation could not be accepted. Open a current invitation from the host.'; return; }
  }
  const lifecycle = createLifecycleStore();
  const store = createHandoffStore({ store: lifecycle,
    getEligibleAgentIds: () => lifecycle.getLifecycleState().sprites
      .filter(sprite => !sprite.attention && (sprite.phase === 'unknown' || sprite.meetingEligible)).map(sprite => sprite.agentId) });
  const connection = connectOffice(store);
  createRoot(root).render(<OfficeBehaviorProvider value={{ lifecycle, handoffs: store }}><App store={store} onPresentationAction={(action, isCurrent) => presentationAction(store, action, '', isCurrent)} /></OfficeBehaviorProvider>);
  window.addEventListener('pagehide', () => connection.stop(), { once: true });
}
void boot().catch(() => { const root = document.getElementById('root'); if (root) root.textContent = 'The office could not connect. Reload to try again.'; });
