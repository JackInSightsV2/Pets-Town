import type { PetAsset } from './contract.js';

// Built-in assets returned by the official ChatGPT Pets download tool.
// Keep artwork on its official CDN; this repository does not redistribute it.
const animations: PetAsset['animations'] = {
  idle: { row: 0, frames: 6, fps: 6 },
  'running-right': { row: 1, frames: 8, fps: 8 },
  'running-left': { row: 2, frames: 8, fps: 8 },
  waving: { row: 3, frames: 4, fps: 6 },
  jumping: { row: 4, frames: 5, fps: 6 },
  failed: { row: 5, frames: 8, fps: 6 },
  waiting: { row: 6, frames: 6, fps: 6 },
  running: { row: 7, frames: 6, fps: 8 },
  review: { row: 8, frames: 6, fps: 6 },
};

export const builtInPets: PetAsset[] = ['codex', 'dewey', 'hoots'].map((id) => ({
  assetId: id,
  name: id === 'codex' ? 'Codex' : id[0].toUpperCase() + id.slice(1),
  imageUrl: `https://cdn.openai.com/c6d7b0d0-3abf-40b5-9d0c-ecd2b9364692/${id}-spritesheet-v4.webp`,
  origin: 'chatgpt',
  width: 1536,
  height: 1872,
  columns: 8,
  rows: 9,
  animations,
}));
