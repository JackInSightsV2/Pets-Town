import { createRoot } from 'react-dom/client';
import { createOfficeStore } from './client/store';
import { connectOffice, presentationAction } from './client/connection';
import { App } from './ui/App';

const store = createOfficeStore();
const connection = connectOffice(store);
const root = document.getElementById('root');
if (!root) throw new Error('PetsTown needs a #root element.');
createRoot(root).render(<App store={store} onPresentationAction={action => presentationAction(store, action)} />);
window.addEventListener('pagehide', () => connection.stop(), { once: true });
