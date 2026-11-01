import { useEffect, useState } from 'react';
import type { PetAsset, RuntimeState } from '../shared/contract';
import { animationFor } from './view-model';

/** Draw only frames declared by a genuine native atlas manifest. */
export function NativePet({ asset, state, size = 72, animationName }: { asset: PetAsset; state: RuntimeState; size?: number; animationName?: string }) {
  const animation = (animationName ? asset.animations[animationName] : undefined) ?? animationFor(asset, state);
  const [frame, setFrame] = useState(0);
  const [imageState, setImageState] = useState<{ url: string; status: 'loading' | 'loaded' | 'failed' }>({ url: asset.imageUrl, status: 'loading' });
  const status = imageState.url === asset.imageUrl ? imageState.status : 'loading';
  const height = size * (asset.height / asset.rows) / (asset.width / asset.columns);
  useEffect(() => {
    setFrame(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => setFrame(previous => (previous + 1) % animation.frames), 1000 / animation.fps);
    return () => window.clearInterval(timer);
  }, [asset.assetId, animation.row, animation.frames, animation.fps]);
  useEffect(() => {
    const timeout = window.setTimeout(() => setImageState(previous => previous.url === asset.imageUrl && previous.status === 'loaded' ? previous : { url: asset.imageUrl, status: 'failed' }), 8000);
    return () => window.clearTimeout(timeout);
  }, [asset.imageUrl]);
  return <span className={`native-pet native-pet-${status}`} role="img" aria-label={status === 'loaded' ? `${asset.name}, native ${asset.origin === 'codex' ? 'Codex' : 'ChatGPT'} pet` : `${asset.name} pet ${status === 'loading' ? 'loading' : 'unavailable'}`} data-pet-load={status} style={{ width: size, height }}>
    <img key={asset.imageUrl} src={asset.imageUrl} alt="" draggable={false} onLoad={event => setImageState({ url: asset.imageUrl, status: event.currentTarget.naturalWidth === asset.width && event.currentTarget.naturalHeight === asset.height ? 'loaded' : 'failed' })} onError={() => setImageState({ url: asset.imageUrl, status: 'failed' })} style={{ visibility: status === 'loaded' ? 'visible' : 'hidden', width: size * asset.columns, height: height * asset.rows, left: -(frame % animation.frames) * size, top: -animation.row * height }} />
    {status !== 'loaded' && <span className="native-pet-fallback">{status === 'loading' ? 'Loading pet…' : 'Pet unavailable'}</span>}
  </span>;
}
