import { describe, expect, it } from 'vitest';
import { isLostConnection } from '../../src/db/lost-connection.js';

const withCode = (code: string, message = 'boom') => Object.assign(new Error(message), { code });

describe('lost connection detection', () => {
  it('recognizes errors that mean the connection was lost', () => {
    expect(isLostConnection(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isLostConnection(new Error('Client has encountered a connection error and is not queryable'))).toBe(true);
    expect(isLostConnection(withCode('ECONNRESET'))).toBe(true);
    expect(isLostConnection(new Error('Authentication timed out'))).toBe(true);
    expect(isLostConnection(withCode('57P01', 'terminating connection due to administrator command'))).toBe(true);
  });

  it('leaves SQL errors and other failures alone', () => {
    expect(isLostConnection(withCode('23505', 'duplicate key value violates unique constraint'))).toBe(false);
    expect(isLostConnection(withCode('23514', 'new row violates check constraint'))).toBe(false);
    expect(isLostConnection(new Error('timeout expired'))).toBe(false);
    expect(isLostConnection('Connection terminated')).toBe(false);
  });
});
