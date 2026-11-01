import { createRoot } from 'react-dom/client';
import { App } from '../../ui/App';
import { OfficeBehaviorProvider } from '../../ui/useOfficeBehavior';
import { createEmbeddedController } from './controller';

const root = document.getElementById('root');
if (!root) throw new Error('PetsTown requires a root element.');
const controller = createEmbeddedController();
createRoot(root).render(<OfficeBehaviorProvider value={{ lifecycle: controller.lifecycle, handoffs: controller.store }}>
  <App store={controller.store} onPresentationAction={async () => {}} />
</OfficeBehaviorProvider>);
void controller.connect();
window.addEventListener('pagehide', () => controller.stop(), { once: true });
