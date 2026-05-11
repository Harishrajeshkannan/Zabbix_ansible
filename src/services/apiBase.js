const DEFAULT_BACKEND_API_URL = '/api';

const trimTrailingSlash = (value) => value.replace(/\/+$/, '');

export const resolveBackendApiUrl = () => {
  const configuredUrl = (import.meta.env.VITE_BACKEND_API_URL || '').trim();
  if (configuredUrl) {
    return trimTrailingSlash(configuredUrl);
  }

  const baseUrl = import.meta.env.BASE_URL || '/';
  if (baseUrl === '/') {
    return DEFAULT_BACKEND_API_URL;
  }

  return `${trimTrailingSlash(baseUrl)}/api`;
};
