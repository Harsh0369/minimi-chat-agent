import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  missingProviderSettings,
  readConfig,
} from '../../src/server/config.js';

describe('configuration boundary', () => {
  it('can start the foundation without provider secrets and reports what is missing', () => {
    const config = readConfig({ GEMINI_API_KEY: '  ', TAVILY_API_KEY: '' });
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(missingProviderSettings(config)).toEqual(['GEMINI_API_KEY', 'TAVILY_API_KEY']);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each(['0', '-1', '65536', '3e3', '3000tail', '', 'Infinity', '3.5'])(
    'rejects invalid PORT %s',
    (PORT) => {
      expect(() => readConfig({ PORT })).toThrow(ConfigurationError);
    },
  );

  it.each(['0.0.0.0', 'example.com', '192.168.1.1'])(
    'prevents accidental public binding to %s',
    (HOST) => {
      expect(() => readConfig({ HOST })).toThrow('HOST');
    },
  );

  it('does not include invalid values or provider secrets in configuration errors', () => {
    const secret = 'fixture-secret-never-print';
    expect(() => readConfig({ NODE_ENV: secret, GEMINI_API_KEY: secret })).toThrow('NODE_ENV');
    try {
      readConfig({ NODE_ENV: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
