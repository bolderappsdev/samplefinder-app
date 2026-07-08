import { DEEP_LINK_SCHEME } from '@env';

export const DEEP_LINK_DOMAIN = 'samplefinder.com';
export const REFERRAL_PATH_PREFIX = '/referral/';
// Custom URL scheme for deep links. Prod default; .env.staging sets samplefinderstaging.
export const CUSTOM_SCHEME = (DEEP_LINK_SCHEME || 'com.samplefinder.app').trim();
export const REFERRAL_CODE_PATTERN = /^[A-Z2-9]{6}$/;
