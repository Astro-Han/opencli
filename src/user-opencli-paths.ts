import * as path from 'node:path';
import { USER_OPENCLI_DIR } from './discovery.js';

export const USER_EXPLORE_DIR = path.join(USER_OPENCLI_DIR, 'explore');
export const USER_RECORD_DIR = path.join(USER_OPENCLI_DIR, 'record');

export function getUserExploreDir(site: string): string {
  return path.join(USER_EXPLORE_DIR, site);
}

export function getUserRecordDir(site: string): string {
  return path.join(USER_RECORD_DIR, site);
}
