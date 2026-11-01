import type { OfficeSnapshot } from '../shared/contract';

export const OFFICE_RESOURCE_URI = 'ui://petstown/office-v1.html';
export interface OfficeView {
  snapshot: OfficeSnapshot;
  scopeId: string;
  selectedAgentId: string | null;
  projectId: string | null;
}
// Full snapshot is UI-only tool result metadata; model context is a bounded summary.
export interface OfficeToolMeta { office: OfficeView }
export const OFFICE_TOOLS = {
  show: 'show_office', refresh: 'refresh_office', inspect: 'inspect_agent',
} as const;
