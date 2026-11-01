import type { RequestIdentity, RequestKind } from './state.js';

/** Future bridge input; never treats browser-provided identity as ownership evidence. */
export interface RequestReply {
  readonly identity: RequestIdentity;
  readonly expectedRevision: number;
  readonly kind: RequestKind;
  readonly idempotencyKey: string;
  readonly response: unknown;
}
export type ReplyResult = { readonly status: 'unsupported'; readonly reason: string };
export interface RequestReplyAdapter {
  respond(request: RequestReply): Promise<ReplyResult>;
}
/** No runtime route is proven. This boundary cannot dispatch or enable replies. */
export function createUnsupportedReplyAdapter(): RequestReplyAdapter {
  return { async respond() { return { status: 'unsupported', reason: 'Passive request access and response ownership are not verified for this runtime.' }; } };
}
