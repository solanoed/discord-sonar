import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { startKeepAlive } from './keepAlive';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startKeepAlive', () => {
  it('pings the health endpoint every 10 minutes', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    startKeepAlive('https://example-backend.onrender.com');

    expect(fetchSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://example-backend.onrender.com/health');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the ping fails', () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));

    expect(() => {
      startKeepAlive('https://example-backend.onrender.com');
      vi.advanceTimersByTime(10 * 60 * 1000);
    }).not.toThrow();
  });
});
