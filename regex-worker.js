import { searchRegex } from './search.js';

self.onmessage = event => {
  const { index, query, scope } = event.data;
  try { self.postMessage({ hits: searchRegex(index, query, scope) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
