import { registerAs } from '@nestjs/config'
import { env } from './env.js'

/** Service name: logs, metrics, connection names. */
export const SERVICE_NAME = 'wallet-api'

export const appConfig = registerAs('app', () => ({
    service: SERVICE_NAME,
    nodeEnv: env().NODE_ENV,
    production: env().NODE_ENV === 'production',
    port: env().PORT,
    version: env().APP_VERSION,
    logLevel: env().LOG_LEVEL,
    trustProxyHops: env().TRUST_PROXY_HOPS,
    shutdownDelayMs: env().SHUTDOWN_DELAY_MS,
    metricsPort: env().METRICS_PORT,
}))

export const dbConfig = registerAs('db', () => ({
    url: env().DATABASE_URL,
    max: env().DATABASE_POOL_MAX,
}))

export const rabbitConfig = registerAs('rabbit', () => ({
    url: env().RABBITMQ_URL,
}))

export const authConfig = registerAs('auth', () => ({
    jwksUrl: env().ID_JWKS_URL,
    issuer: env().TOKEN_ISSUER,
    audience: env().TOKEN_AUDIENCE,
    internalToken: env().INTERNAL_API_TOKEN,
}))

export const walletConfig = registerAs('wallet', () => ({
    adminMaxAmount: env().WALLET_ADMIN_MAX_AMOUNT,
}))
