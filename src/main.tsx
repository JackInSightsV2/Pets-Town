import { createRoot } from 'react-dom/client';
import { createHandoffStore } from './client/handoffs';
import { connectOffice, presentationAction } from './client/connection';
import { App } from './ui/App';
import { createLifecycleStore } from './client/lifecycle';
import { OfficeBehaviorProvider } from './ui/useOfficeBehavior';

const lifecycle = createLifecycleStore();
const store = createHandoffStore({ store: lifecycle,
  getEligibleAgentIds: () => lifecycle.getLifecycleState().sprites
    .filter(sprite => !sprite.attention && (sprite.phase === 'unknown' || sprite.meetingEligible)).map(sprite => sprite.agentId) });
const connection = connectOffice(store);
const root = document.getElementById('root');
if (!root) throw new Error('PetsTown needs a #root element.');
createRoot(root).render(<OfficeBehaviorProvider value={{ lifecycle, handoffs: store }}><App store={store} onPresentationAction={(action, isCurrent) => presentationAction(store, action, '', isCurrent)} /></OfficeBehaviorProvider>);
window.addEventListener('pagehide', () => connection.stop(), { once: true });
