import { coinAmountSchema } from '@nick-lukashik/contracts'
import { z } from 'zod'

const ref = z.string().regex(/^[A-Za-z0-9._:-]{1,200}$/)
/** Refs with these prefixes belong to the service itself. */
const callerRef = ref.refine(value => !/^(grant|adjust|pack):/.test(value), 'reserved prefix')
const objectRef = z
    .string()
    .regex(/^[A-Za-z0-9._:-]{1,200}$/)
    .optional()

export const historyQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(200).optional(),
})
export type HistoryQuery = z.infer<typeof historyQuerySchema>

export const internalOperationSchema = z.object({
    ref: callerRef,
    userId: z.uuid(),
    amount: coinAmountSchema,
    source: z.enum([
        'roulette',
        'daily-bonus',
        'pay',
    ]),
    objectRef,
    reason: z.string().max(500).optional(),
    correlationId: z.string().max(128).optional(),
})
export type InternalOperation = z.infer<typeof internalOperationSchema>

export const balancesSchema = z.object({
    userIds: z.array(z.uuid()).min(1).max(1_000),
})
export type BalancesInput = z.infer<typeof balancesSchema>

export const refsSchema = z.object({
    refs: z.array(ref).min(1).max(1_000),
})
export type RefsInput = z.infer<typeof refsSchema>

export const adminCommandSchema = z.object({
    amount: coinAmountSchema,
    reason: z.string().trim().min(3).max(500),
    commandId: z.uuid(),
})
export type AdminCommand = z.infer<typeof adminCommandSchema>
