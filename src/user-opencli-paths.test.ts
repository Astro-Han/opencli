import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { USER_OPENCLI_DIR } from './discovery.js';
import { getUserExploreDir, getUserRecordDir, USER_EXPLORE_DIR, USER_RECORD_DIR } from './user-opencli-paths.js';

describe('user-opencli-paths', () => {
  it('builds the shared explore directory under ~/.opencli', () => {
    expect(USER_EXPLORE_DIR).toBe(path.join(USER_OPENCLI_DIR, 'explore'));
    expect(getUserExploreDir('mysite')).toBe(path.join(USER_OPENCLI_DIR, 'explore', 'mysite'));
  });

  it('builds the shared record directory under ~/.opencli', () => {
    expect(USER_RECORD_DIR).toBe(path.join(USER_OPENCLI_DIR, 'record'));
    expect(getUserRecordDir('mysite')).toBe(path.join(USER_OPENCLI_DIR, 'record', 'mysite'));
  });
});
