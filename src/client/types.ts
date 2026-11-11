import type { ServiceStatus } from '../shared/contracts.js';

export type Connection =
  { state: 'loading' } | { state: 'error' } | { state: 'ready'; status: ServiceStatus };
