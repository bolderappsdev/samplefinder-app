import { Client } from 'react-native-appwrite';
import { APPWRITE_PROJECT_ID, APPWRITE_ENDPOINT, APPWRITE_PLATFORM } from '@env';

const endpoint = APPWRITE_ENDPOINT || '';
const projectId = APPWRITE_PROJECT_ID || '';

// Fail fast: an empty endpoint/project id means the active env file (.env for prod,
// .env.staging for APP_VARIANT=staging) wasn't loaded. Constructing a Client against
// '' throws deep in the SDK (setEndpoint rejects a non-URL); the old warn-and-continue
// path then re-threw uncaught in its own catch and crashed at boot anyway. Surface the
// real cause here instead.
if (!endpoint || !projectId) {
  throw new Error(
    'Appwrite: missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID — check the active env file ' +
      '(.env for production, .env.staging for APP_VARIANT=staging).',
  );
}

// Appwrite platform identifier — must match a registered platform on the Appwrite
// project. Prod default; .env.staging sets com.samplefinder.app.staging.
const platform = (APPWRITE_PLATFORM || 'com.samplefinder.app').trim();

const client = new Client()
  .setEndpoint(endpoint)
  .setProject(projectId)
  .setPlatform(platform);

// setKey is intentionally never called: the mobile client is session-based only.
// A server Appwrite API key must never ship in the client (see workspace CLAUDE.md).

export default client;
