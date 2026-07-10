import { getRuntimeConfig } from '../config/runtimeConfig'

/**
 * Auth configuration, sourced from runtime config (see config/runtimeConfig.ts).
 * `loadRuntimeConfig()` must be awaited during app startup before this is read.
 */
export const authConfig = {
  get region() {
    return getRuntimeConfig().region
  },
  get userPoolId() {
    return getRuntimeConfig().userPoolId
  },
  get clientId() {
    return getRuntimeConfig().userPoolClientId
  },
}
