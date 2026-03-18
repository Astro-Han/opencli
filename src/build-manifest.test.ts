import { describe, expect, it } from 'vitest';
import { parseTsArgsBlock } from './build-manifest.js';

describe('parseTsArgsBlock', () => {
  it('keeps args with nested choices arrays', () => {
    const args = parseTsArgsBlock(`
      {
        name: 'period',
        type: 'string',
        default: 'seven',
        help: 'Stats period: seven or thirty',
        choices: ['seven', 'thirty'],
      },
    `);

    expect(args).toEqual([
      {
        name: 'period',
        type: 'string',
        default: 'seven',
        required: false,
        positional: undefined,
        help: 'Stats period: seven or thirty',
        choices: ['seven', 'thirty'],
      },
    ]);
  });
});
