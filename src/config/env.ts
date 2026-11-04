import { z } from 'zod'
import {
    baseEnvSchema,
    defineEnv,
    metricsEnvSchema,
    postgresEnvSchema,
    rabbitEnvSchema,
} from '../common/config/define-env.js'

/** Every variable this service reads. Nothing else touches process.env. */
export const envSchema = baseEnvSchema
    .extend(postgresEnvSchema.shape)
    .extend(rabbitEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
        /** Access tokens of id-api (JWKS, issuer, audience). */
        ID_JWKS_URL: z.url().default('http://id-api.prod.svc/.well-known/jwks.json'),
        TOKEN_ISSUER: z.url().default('https://id.nick-lukashik.com'),
        TOKEN_AUDIENCE: z.string().min(1).default('nick-lukashik'),
        /** This service's token for in-cluster callers (debits and credits of other services). */
        INTERNAL_API_TOKEN: z.string().min(32, 'at least 32 characters'),
        /** The largest grant or adjustment one operator command may make. */
        WALLET_ADMIN_MAX_AMOUNT: z.coerce.number().int().min(1).max(1e15).default(1_000_000),
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
