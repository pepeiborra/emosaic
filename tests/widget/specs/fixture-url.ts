import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Resolve to the on-disk fixture as a file:// URL.
const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_URL = pathToFileURL(
  join(here, '..', 'fixtures', 'widget.html')
).toString();
