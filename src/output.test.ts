import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from './output.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('render', () => {
  it('renders YAML output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    render([{ title: 'Hello', rank: 1 }], { fmt: 'yaml' });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('- title: Hello');
    expect(log.mock.calls[0]?.[0]).toContain('rank: 1');
  });

  it('renders yml alias as YAML output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    render({ title: 'Hello' }, { fmt: 'yml' });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('title: Hello');
  });
});
