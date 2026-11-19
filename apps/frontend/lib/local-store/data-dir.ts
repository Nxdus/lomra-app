import { homedir } from 'node:os';
import { join } from 'node:path';

/** Workspace folder; the desktop app sets LOMRA_DATA_DIR. */
export const dataDir = () => process.env.LOMRA_DATA_DIR ?? join(homedir(), 'Documents', 'Lomra');
