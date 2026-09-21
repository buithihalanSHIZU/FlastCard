import { validateSearch } from './search.js';

export function runRegexSearch(index, query, scope = 'all', { signal, timeoutMs = 1000, WorkerClass = globalThis.Worker } = {}) {
  validateSearch(query, 'regex', scope);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Search cancelled', 'AbortError'));
    if (!WorkerClass) return reject(new Error('Trình duyệt này chưa hỗ trợ chế độ Regex. Hãy dùng tìm kiếm thông thường.'));
    let worker, timer;
    const finish = (error, hits) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (error) reject(error); else resolve(hits);
    };
    const abort = () => finish(new DOMException('Search cancelled', 'AbortError'));
    try {
      worker = new WorkerClass(new URL('./regex-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = event => {
        if (event.data.error) finish(new Error(event.data.error));
        else if (Array.isArray(event.data.hits)) finish(null, event.data.hits);
        else finish(new Error('Không thể đọc kết quả tìm kiếm.'));
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new Error('Không thể chạy Regex. Hãy tải lại trang hoặc dùng tìm kiếm thông thường.')); };
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(new Error('Biểu thức xử lý quá lâu. Hãy rút gọn mẫu rồi thử lại.')), timeoutMs);
      worker.postMessage({ index, query, scope });
    } catch { finish(new Error('Không thể khởi động tìm kiếm Regex. Hãy dùng tìm kiếm thông thường.')); }
  });
}
