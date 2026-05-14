import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve to the on-disk fixture as a file:// URL, OR honour
// $EMOSAIC_FIXTURE_URL when set so the same suite can be pointed at a
// deployed widget for smoke-testing.
const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_URL =
  process.env.EMOSAIC_FIXTURE_URL ||
  pathToFileURL(join(here, '..', 'fixtures', 'widget.html')).toString();
