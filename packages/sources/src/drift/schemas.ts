import { z } from 'zod';

const programAccountSchema = z.object({
  pubkey: z.string().min(32),
  account: z.object({
    data: z.union([z.tuple([z.string().min(1), z.literal('base64')]), z.string().min(1)]),
    owner: z.string().optional(),
  }),
});

const programAccountsValueSchema = z.array(programAccountSchema);

export const solanaRpcEnvelopeSchema = z.object({
  jsonrpc: z.string(),
  result: z
    .union([programAccountsValueSchema, z.object({ value: programAccountsValueSchema })])
    .optional(),
  error: z
    .object({
      code: z.number().optional(),
      message: z.string(),
    })
    .optional(),
});

export type SolanaProgramAccount = z.infer<typeof programAccountSchema>;

export function programAccountsFromRpc(payload: z.infer<typeof solanaRpcEnvelopeSchema>): SolanaProgramAccount[] {
  if (payload.error !== undefined) {
    throw new Error(`solana rpc error: ${payload.error.message}`);
  }
  if (payload.result === undefined) {
    throw new Error('solana rpc returned no result');
  }
  return Array.isArray(payload.result) ? payload.result : payload.result.value;
}

export function accountDataBase64(account: SolanaProgramAccount): string {
  const { data } = account.account;
  return typeof data === 'string' ? data : data[0];
}
