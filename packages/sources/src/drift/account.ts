import { createHash } from 'node:crypto';

import { Decimal } from '@vaultbench/shared';

/**
 * Drift vaults program on Solana mainnet.
 * `drift-labs/drift-vaults` — not a Velocity lookalike host.
 */
export const DRIFT_VAULTS_PROGRAM_ID = 'vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR';

/** Anchor: first 8 bytes of sha256("account:Vault"). */
export const VAULT_DISCRIMINATOR = createHash('sha256')
  .update('account:Vault')
  .digest()
  .subarray(0, 8);

/** Layout size after the discriminator, per the published IDL. */
export const VAULT_ACCOUNT_SIZE = 536;

const PERCENTAGE_PRECISION = new Decimal('1000000');
const SECONDS_PER_DAY = new Decimal('86400');

/** Drift spot market 0 is USDC, 6 decimals, treated as 1:1 USD. */
export const USDC_SPOT_MARKET_INDEX = 0;
const USDC_SCALE = new Decimal('1000000');

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export interface DecodedVault {
  name: string;
  pubkey: string;
  manager: string;
  user: string;
  userShares: Decimal;
  totalShares: Decimal;
  redeemPeriodSeconds: Decimal;
  totalWithdrawRequested: Decimal;
  managementFee: Decimal;
  profitShare: Decimal;
  initTs: Decimal;
  spotMarketIndex: number;
  permissioned: boolean;
  vaultProtocol: boolean;
}

export interface VaultAccountFields {
  name: string;
  pubkey: Uint8Array;
  manager: Uint8Array;
  tokenAccount: Uint8Array;
  userStats: Uint8Array;
  user: Uint8Array;
  delegate: Uint8Array;
  liquidationDelegate: Uint8Array;
  userShares: bigint;
  totalShares: bigint;
  lastFeeUpdateTs?: bigint;
  liquidationStartTs?: bigint;
  redeemPeriod: bigint;
  totalWithdrawRequested: bigint;
  maxTokens?: bigint;
  managementFee: bigint;
  initTs: bigint;
  netDeposits?: bigint;
  managerNetDeposits?: bigint;
  totalDeposits?: bigint;
  totalWithdraws?: bigint;
  managerTotalDeposits?: bigint;
  managerTotalWithdraws?: bigint;
  managerTotalFee?: bigint;
  managerTotalProfitShare?: bigint;
  minDepositAmount?: bigint;
  lastManagerWithdrawShares?: bigint;
  lastManagerWithdrawValue?: bigint;
  lastManagerWithdrawTs?: bigint;
  sharesBase?: number;
  profitShare: number;
  hurdleRate?: number;
  spotMarketIndex: number;
  bump?: number;
  permissioned: boolean;
  vaultProtocol: boolean;
}

/**
 * Share price as the program computes it: vault equity / total shares.
 *
 * Equity is *not* on the Vault account. Without a real mark-to-market of
 * the Drift user account, this stays undefined rather than guessed.
 */
export function sharePrice(vaultEquity: Decimal, totalShares: Decimal): Decimal | undefined {
  if (!totalShares.isFinite() || totalShares.lte(0)) return undefined;
  if (!vaultEquity.isFinite() || vaultEquity.lt(0)) return undefined;
  return vaultEquity.div(totalShares);
}

/**
 * Manager + protocol share of the vault when shares are fungible.
 *
 * IDL: manager deposits are `total_shares - user_shares - protocol shares`.
 * Protocol shares live on a separate account we do not fetch, so this is
 * the non-user fraction — honest when `vaultProtocol` is false, and an
 * upper bound when it is true.
 */
export function managerStakeRatio(userShares: Decimal, totalShares: Decimal): Decimal | undefined {
  if (!totalShares.isFinite() || totalShares.lte(0)) return undefined;
  if (userShares.gt(totalShares)) {
    throw new Error('vault userShares exceed totalShares');
  }
  return totalShares.minus(userShares).div(totalShares);
}

export function feeRateFromPercentagePrecision(raw: Decimal): Decimal {
  return raw.div(PERCENTAGE_PRECISION);
}

export function redemptionPeriodDays(redeemPeriodSeconds: Decimal): number {
  const days = redeemPeriodSeconds.div(SECONDS_PER_DAY).toDecimalPlaces(0, Decimal.ROUND_DOWN);
  return Number.parseInt(days.toFixed(0), 10);
}

export function pendingRedemptionsUsd(
  totalWithdrawRequested: Decimal,
  spotMarketIndex: number,
): Decimal | undefined {
  if (spotMarketIndex !== USDC_SPOT_MARKET_INDEX) return undefined;
  return totalWithdrawRequested.div(USDC_SCALE);
}

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = '';
  while (value > 0n) {
    const rem = Number(value % 58n);
    encoded = BASE58_ALPHABET[rem] + encoded;
    value /= 58n;
  }
  return '1'.repeat(zeros) + encoded;
}

export function vaultDiscriminatorBase58(): string {
  return encodeBase58(VAULT_DISCRIMINATOR);
}

export function decodeVaultAccount(data: Uint8Array): DecodedVault {
  if (data.length < VAULT_ACCOUNT_SIZE) {
    throw new Error(`vault account too short: ${data.length} < ${VAULT_ACCOUNT_SIZE}`);
  }
  const cursor = new Cursor(data);
  const disc = cursor.bytes(8);
  if (!disc.equals(VAULT_DISCRIMINATOR)) {
    throw new Error('account discriminator is not Vault');
  }

  const name = readPaddedName(cursor.bytes(32));
  const pubkey = encodeBase58(cursor.bytes(32));
  const manager = encodeBase58(cursor.bytes(32));
  cursor.bytes(32); // tokenAccount
  cursor.bytes(32); // userStats
  const user = encodeBase58(cursor.bytes(32));
  cursor.bytes(32); // delegate
  cursor.bytes(32); // liquidationDelegate
  const userShares = cursor.u128();
  const totalShares = cursor.u128();
  cursor.i64(); // lastFeeUpdateTs
  cursor.i64(); // liquidationStartTs
  const redeemPeriodSeconds = cursor.i64();
  const totalWithdrawRequested = cursor.u64();
  cursor.u64(); // maxTokens
  const managementFee = cursor.i64();
  const initTs = cursor.i64();
  cursor.i64(); // netDeposits
  cursor.i64(); // managerNetDeposits
  cursor.u64(); // totalDeposits
  cursor.u64(); // totalWithdraws
  cursor.u64(); // managerTotalDeposits
  cursor.u64(); // managerTotalWithdraws
  cursor.i64(); // managerTotalFee
  cursor.u64(); // managerTotalProfitShare
  cursor.u64(); // minDepositAmount
  cursor.u128(); // lastManagerWithdrawRequest.shares
  cursor.u64(); // lastManagerWithdrawRequest.value
  cursor.i64(); // lastManagerWithdrawRequest.ts
  cursor.u32(); // sharesBase
  const profitShare = cursor.u32();
  cursor.u32(); // hurdleRate
  const spotMarketIndex = cursor.u16();
  cursor.u8(); // bump
  const permissioned = cursor.bool();
  const vaultProtocol = cursor.bool();

  return {
    name,
    pubkey,
    manager,
    user,
    userShares,
    totalShares,
    redeemPeriodSeconds,
    totalWithdrawRequested,
    managementFee,
    profitShare: new Decimal(profitShare.toString()),
    initTs,
    spotMarketIndex,
    permissioned,
    vaultProtocol,
  };
}

/** Test helper: build a Vault account whose layout matches `decodeVaultAccount`. */
export function encodeVaultAccount(fields: VaultAccountFields): Buffer {
  const writer = new Writer();
  writer.bytes(VAULT_DISCRIMINATOR);
  writer.bytes(padName(fields.name));
  writer.bytes(Buffer.from(fields.pubkey));
  writer.bytes(Buffer.from(fields.manager));
  writer.bytes(Buffer.from(fields.tokenAccount));
  writer.bytes(Buffer.from(fields.userStats));
  writer.bytes(Buffer.from(fields.user));
  writer.bytes(Buffer.from(fields.delegate));
  writer.bytes(Buffer.from(fields.liquidationDelegate));
  writer.u128(fields.userShares);
  writer.u128(fields.totalShares);
  writer.i64(fields.lastFeeUpdateTs ?? 0n);
  writer.i64(fields.liquidationStartTs ?? 0n);
  writer.i64(fields.redeemPeriod);
  writer.u64(fields.totalWithdrawRequested);
  writer.u64(fields.maxTokens ?? 0n);
  writer.i64(fields.managementFee);
  writer.i64(fields.initTs);
  writer.i64(fields.netDeposits ?? 0n);
  writer.i64(fields.managerNetDeposits ?? 0n);
  writer.u64(fields.totalDeposits ?? 0n);
  writer.u64(fields.totalWithdraws ?? 0n);
  writer.u64(fields.managerTotalDeposits ?? 0n);
  writer.u64(fields.managerTotalWithdraws ?? 0n);
  writer.i64(fields.managerTotalFee ?? 0n);
  writer.u64(fields.managerTotalProfitShare ?? 0n);
  writer.u64(fields.minDepositAmount ?? 0n);
  writer.u128(fields.lastManagerWithdrawShares ?? 0n);
  writer.u64(fields.lastManagerWithdrawValue ?? 0n);
  writer.i64(fields.lastManagerWithdrawTs ?? 0n);
  writer.u32(fields.sharesBase ?? 0);
  writer.u32(fields.profitShare);
  writer.u32(fields.hurdleRate ?? 0);
  writer.u16(fields.spotMarketIndex);
  writer.u8(fields.bump ?? 255);
  writer.bool(fields.permissioned);
  writer.bool(fields.vaultProtocol);
  writer.u8(0); // fuelDistributionMode
  writer.u8(0); // feeUpdateStatus
  writer.u8(0); // vaultClass
  writer.u32(0); // lastCumulativeFuelPerShareTs
  writer.u128(0n); // cumulativeFuelPerShare
  writer.u128(0n); // cumulativeFuel
  writer.u64(0n); // managerBorrowedValue
  writer.u64(0n); // padding[0]
  writer.u64(0n); // padding[1]
  const encoded = writer.finish();
  if (encoded.length !== VAULT_ACCOUNT_SIZE) {
    throw new Error(`encoded vault is ${encoded.length} bytes, expected ${VAULT_ACCOUNT_SIZE}`);
  }
  return encoded;
}

class Cursor {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  bytes(length: number): Buffer {
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(slice);
  }

  u8(): number {
    const value = this.data[this.offset];
    if (value === undefined) throw new Error('vault account truncated');
    this.offset += 1;
    return value;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  u16(): number {
    const value = this.bytes(2).readUInt16LE(0);
    return value;
  }

  u32(): number {
    return this.bytes(4).readUInt32LE(0);
  }

  u64(): Decimal {
    return new Decimal(this.bytes(8).readBigUInt64LE(0).toString());
  }

  i64(): Decimal {
    return new Decimal(this.bytes(8).readBigInt64LE(0).toString());
  }

  u128(): Decimal {
    const lo = this.bytes(8).readBigUInt64LE(0);
    const hi = this.bytes(8).readBigUInt64LE(0);
    return new Decimal(((hi << 64n) + lo).toString());
  }
}

class Writer {
  private readonly chunks: Buffer[] = [];

  bytes(value: Uint8Array): void {
    this.chunks.push(Buffer.from(value));
  }

  u8(value: number): void {
    this.chunks.push(Buffer.from([value]));
  }

  bool(value: boolean): void {
    this.u8(value ? 1 : 0);
  }

  u16(value: number): void {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value);
    this.chunks.push(buf);
  }

  u32(value: number): void {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value);
    this.chunks.push(buf);
  }

  u64(value: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(value);
    this.chunks.push(buf);
  }

  i64(value: bigint): void {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(value);
    this.chunks.push(buf);
  }

  u128(value: bigint): void {
    this.u64(value & 0xffffffffffffffffn);
    this.u64(value >> 64n);
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function padName(name: string): Buffer {
  const raw = Buffer.from(name, 'utf8');
  if (raw.length > 32) throw new Error(`vault name longer than 32 bytes: ${name}`);
  const padded = Buffer.alloc(32);
  raw.copy(padded);
  return padded;
}

function readPaddedName(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.subarray(0, end);
  return slice.toString('utf8').trim();
}
