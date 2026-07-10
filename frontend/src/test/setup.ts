import '@testing-library/jest-dom'
import { beforeAll, vi } from 'vitest'
import { loadRuntimeConfig } from '../config/runtimeConfig'

// Preload runtime config once before any test runs, using a mocked fetch,
// since components read config synchronously via getRuntimeConfig().
beforeAll(async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        region: 'us-east-1',
        userPoolId: 'us-east-1_test',
        userPoolClientId: 'test-client-id',
        apiBase: '',
      }),
  })
  vi.stubGlobal('fetch', fetchMock)

  await loadRuntimeConfig()

  vi.unstubAllGlobals()
})
