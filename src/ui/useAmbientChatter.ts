import { useEffect, useRef, useState } from 'react';
import type { OfficeAgent } from '../shared/contract';
import type { Point } from '../office/layout';

const CHATTER = ['Lovely spot for a breather.', 'Anyone fancy a biscuit?', 'The coffee smells good.', 'This chair is surprisingly comfy.', 'Nice weather out here.', 'I could get used to this view.'];
export interface ChatterPet { agent: OfficeAgent; point: Point; eligible: boolean }
export function nearbyChatterPets(pets: readonly ChatterPet[]): string[] {
  return pets.filter(pet => pet.eligible && pets.some(other => other !== pet && other.eligible
    && !!(pet.agent.parentAgentId || other.agent.parentAgentId)
    && Math.hypot(pet.point.x - other.point.x, pet.point.y - other.point.y) <= 150)).map(pet => pet.agent.agentId);
}

/** Decorative small talk only: never publishes activity, messages or handoffs. */
export function useAmbientChatter(pets: readonly ChatterPet[], enabled: boolean) {
  const candidates = enabled ? nearbyChatterPets(pets) : [];
  const key = JSON.stringify(candidates);
  const latest = useRef(candidates); latest.current = candidates;
  const [speech, setSpeech] = useState<{ agentId: string; text: string } | null>(null);
  useEffect(() => {
    setSpeech(null);
    if (!enabled || !latest.current.length) return;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const chat = () => {
      const ids = latest.current;
      if (!ids.length) return;
      setSpeech({ agentId: ids[Math.floor(Math.random() * ids.length)], text: CHATTER[Math.floor(Math.random() * CHATTER.length)] });
      clearTimeout(expiry);
      expiry = setTimeout(() => setSpeech(null), 3500);
    };
    const first = setTimeout(chat, 1800);
    const timer = setInterval(chat, 9000);
    return () => { clearTimeout(first); clearTimeout(expiry); clearInterval(timer); };
  }, [enabled, key]);
  return speech && candidates.includes(speech.agentId) ? speech : null;
}
