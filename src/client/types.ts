import type { ServiceStatus } from '../shared/contracts.js';

export type Connection =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'expired' }
  | { state: 'ready'; status: ServiceStatus };
