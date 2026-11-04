// Types are derived from the hub's OpenAPI contract, never hand-written.
// If a shape here looks wrong, the spec is wrong — fix hypha/api/openapi.yaml
// and regenerate with `npm run api:types`.

import type { components, paths } from './schema'

type JsonBody<T> = T extends { content: { 'application/json': infer R } } ? R : never

/** Response type of a documented GET, keyed by path. */
export type GetResponse<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: infer R } }
}
  ? JsonBody<R>
  : never

export type Meta = components['schemas']['Meta']
export type Host = components['schemas']['Host']
export type EnrollTokenInfo = components['schemas']['EnrollTokenInfo']
export type EnrollTokenRequest = components['schemas']['EnrollTokenRequest']
export type EnrollTokenResponse = components['schemas']['EnrollTokenResponse']
export type ExecRequest = components['schemas']['ExecRequest']
export type ExecResponse = components['schemas']['ExecResponse']
export type JobRef = components['schemas']['JobRef']
export type ExecRecord = components['schemas']['ExecRecord']
export type ExecEvent = components['schemas']['ExecEvent']
export type ExecOutput = components['schemas']['ExecOutput']
export type ExecExit = components['schemas']['ExecExit']
export type ExecFailed = components['schemas']['ExecFailed']
export type ExecStarted = components['schemas']['ExecStarted']
export type Targets = components['schemas']['Targets']
export type TermIn = components['schemas']['TermIn']
export type TermOut = components['schemas']['TermOut']
export type ApiError = components['schemas']['ApiError']
export type AuditEntry = components['schemas']['AuditEntry']
export type FilePushRequest = components['schemas']['FilePushRequest']
export type FilePushResponse = components['schemas']['FilePushResponse']
export type FilePushResult = components['schemas']['FilePushResult']
export type HostMetrics = components['schemas']['HostMetrics']
export type PtySession = components['schemas']['PtySession']

/**
 * The contract version this build understands.
 *
 * Bump together with `API_VERSION` in hypha's crates/proto when a breaking
 * change lands. A hub that reports a higher number is running a newer contract
 * than this panel was generated against: refuse to render instead of guessing.
 */
export const KNOWN_API_VERSION = 1
