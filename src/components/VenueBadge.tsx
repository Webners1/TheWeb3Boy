/**
 * Venue identity: which protocol a vault runs on, and which chain.
 *
 * `entity.venue` is `"<protocol>"` or `"<protocol>:<chain>"` (see the
 * backend's adapters in `packages/sources/src/*\/adapter.ts` — venue is set
 * once there and never guessed here). This renders that as a small icon
 * plus label instead of the raw string, so "enzyme:ethereum" reads as
 * Enzyme's own mark next to Ethereum's rather than a colon-joined slug.
 *
 * Icon provenance, because a wrong logo is worse than no logo:
 *  - Ethereum, Solana, Polygon, Optimism, OKX are the real marks from
 *    Simple Icons (CC0) — verified paths, not redrawn from memory.
 *  - Enzyme is its own compact mark, pulled directly from enzyme.finance's
 *    asset CDN (the icon-only file their own site serves for small contexts).
 *  - Chamber (formerly dHEDGE), Drift, Hyperliquid, Arbitrum and Base have
 *    no confirmed source-of-truth SVG available here, so they render as a
 *    plain monogram rather than a guessed shape. Hyperliquid's and
 *    Enzyme's brand colors are confirmed from their own brand pages;
 *    Arbitrum/Base use their long-standing public brand colors. Chamber
 *    and Drift have no confirmed color either, so they stay neutral.
 */

import type { ReactElement } from "react";

type IconProps = { className?: string };

function EnzymeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 25" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M24 4.96745V0H9.58011V4.50682C9.58011 4.73267 9.40109 4.91641 9.18104 4.91641H0V9.88387H9.18104C9.40109 9.88387 9.58011 10.0676 9.58011 10.2935V14.3396C9.58011 14.5655 9.40109 14.7492 9.18104 14.7492H0V19.7167H9.18104C9.40109 19.7167 9.58011 19.9004 9.58011 20.1263V24.6331H24V19.6657H10.0289C9.80886 19.6657 9.62983 19.4819 9.62983 19.2561V15.2099C9.62983 14.984 9.80886 14.8003 10.0289 14.8003H24V9.83282H10.004C9.78399 9.83282 9.60497 9.64909 9.60497 9.42323V5.37705C9.60497 5.1512 9.78399 4.96745 10.004 4.96745H24Z"
      />
    </svg>
  );
}

function EthereumIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"
      />
    </svg>
  );
}

function SolanaIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="m23.8764 18.0313-3.962 4.1393a.9201.9201 0 0 1-.306.2106.9407.9407 0 0 1-.367.0742H.4599a.4689.4689 0 0 1-.2522-.0733.4513.4513 0 0 1-.1696-.1962.4375.4375 0 0 1-.0314-.2545.4438.4438 0 0 1 .117-.2298l3.9649-4.1393a.92.92 0 0 1 .3052-.2102.9407.9407 0 0 1 .3658-.0746H23.54a.4692.4692 0 0 1 .2523.0734.4531.4531 0 0 1 .1697.196.438.438 0 0 1 .0313.2547.4442.4442 0 0 1-.1169.2297zm-3.962-8.3355a.9202.9202 0 0 0-.306-.2106.941.941 0 0 0-.367-.0742H.4599a.4687.4687 0 0 0-.2522.0734.4513.4513 0 0 0-.1696.1961.4376.4376 0 0 0-.0314.2546.444.444 0 0 0 .117.2297l3.9649 4.1394a.9204.9204 0 0 0 .3052.2102c.1154.049.24.0744.3658.0746H23.54a.469.469 0 0 0 .2523-.0734.453.453 0 0 0 .1697-.1961.4382.4382 0 0 0 .0313-.2546.4444.4444 0 0 0-.1169-.2297zM.46 6.7225h18.7815a.9411.9411 0 0 0 .367-.0742.9202.9202 0 0 0 .306-.2106l3.962-4.1394a.4442.4442 0 0 0 .117-.2297.4378.4378 0 0 0-.0314-.2546.453.453 0 0 0-.1697-.196.469.469 0 0 0-.2523-.0734H4.7596a.941.941 0 0 0-.3658.0745.9203.9203 0 0 0-.3052.2102L.1246 5.9687a.4438.4438 0 0 0-.1169.2295.4375.4375 0 0 0 .0312.2544.4512.4512 0 0 0 .1692.196.4689.4689 0 0 0 .2518.0739z"
      />
    </svg>
  );
}

function PolygonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="m17.82 16.342 5.692-3.287A.98.98 0 0 0 24 12.21V5.635a.98.98 0 0 0-.488-.846l-5.693-3.286a.98.98 0 0 0-.977 0L11.15 4.789a.98.98 0 0 0-.489.846v11.747L6.67 19.686l-3.992-2.304v-4.61l3.992-2.304 2.633 1.52V8.896L7.158 7.658a.98.98 0 0 0-.977 0L.488 10.945a.98.98 0 0 0-.488.846v6.573a.98.98 0 0 0 .488.847l5.693 3.286a.981.981 0 0 0 .977 0l5.692-3.286a.98.98 0 0 0 .489-.846V6.618l.072-.041 3.92-2.263 3.99 2.305v4.609l-3.99 2.304-2.63-1.517v3.092l2.14 1.236a.981.981 0 0 0 .978 0v-.001Z"
      />
    </svg>
  );
}

function OptimismIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0M9.6094 8.705c.4623 0 .8778.0784 1.2441.2345.3663.15.6532.3773.8633.6835.2101.3002.3164.6598.3164 1.0801 0 .1261-.0149.2864-.045.4785a20.4 20.4 0 0 1-.3241 1.5586c-.2102.8227-.5735 1.4375-1.0899 1.8457-.5164.4023-1.2076.6036-2.0722.6036-.7146 0-1.2996-.1677-1.756-.504q-.6755-.5133-.6757-1.459 0-.198.045-.4863c.078-.4323.1898-.9521.334-1.5586.4082-1.6512 1.4608-2.4765 3.16-2.4765m4.1699.09h2.3965q.9999-.0001 1.6035.414c.4083.2762.6113.6749.6113 1.1973 0 .15-.0186.3066-.0547.4687-.15.6905-.4518 1.201-.9082 1.5313-.4503.3302-1.0689.496-1.8554.496h-1.2168l-.414 1.9727a.26.26 0 0 1-.0997.1621c-.054.042-.11.0625-.17.0625h-1.2245c-.066 0-.1183-.0204-.1543-.0625-.03-.048-.0394-.102-.0274-.1621l1.2442-5.8555a.256.256 0 0 1 .0976-.162c.054-.042.1118-.0626.1719-.0626m-4.2871 1.207c-.3363 0-.6231.0987-.8633.2968-.2341.1982-.4019.5019-.5039.9102-.1081.4023-.2162.8941-.3242 1.4765a1.93 1.93 0 0 0-.0371.379c0 .5524.2888.828.8652.828q.5043.0002.8555-.2968c.2402-.1981.4116-.5019.5136-.9102.1381-.5644.2425-1.0562.3145-1.4765a2.1 2.1 0 0 0 .0371-.3887c0-.5464-.287-.8183-.8574-.8183m5.4492.0449-.3418 1.6113h1.0352c.2521 0 .472-.069.6582-.207.1921-.1381.3169-.3356.377-.5938.018-.102.0273-.1915.0273-.2695 0-.1742-.0503-.3064-.1524-.3965-.102-.096-.2772-.1445-.5234-.1445z"
      />
    </svg>
  );
}

function OkxIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        d="M 7.15 8.685 C 7.18 8.705 7.2 8.745 7.2 8.785 L 7.2 15.225 C 7.2 15.265 7.18 15.305 7.15 15.325 C 7.121 15.355 7.082 15.372 7.04 15.375 L 0.16 15.375 C 0.118 15.372 0.079 15.355 0.05 15.325 C 0.02 15.3 0.002 15.264 0 15.225 L 0 8.785 C 0 8.745 0.02 8.705 0.05 8.685 C 0.079 8.655 0.118 8.638 0.16 8.635 L 7.04 8.635 C 7.08 8.635 7.12 8.655 7.15 8.685 Z M 4.8 11.035 C 4.798 10.996 4.78 10.96 4.75 10.935 C 4.721 10.905 4.682 10.887 4.64 10.885 L 2.56 10.885 C 2.52 10.885 2.481 10.899 2.45 10.925 C 2.42 10.95 2.402 10.986 2.4 11.025 L 2.4 12.975 C 2.4 13.015 2.42 13.055 2.45 13.075 C 2.48 13.115 2.52 13.125 2.56 13.125 L 4.64 13.125 C 4.68 13.125 4.72 13.115 4.75 13.085 C 4.78 13.06 4.798 13.024 4.8 12.985 L 4.8 11.035 Z M 21.6 11.035 L 21.6 12.975 C 21.6 13.065 21.53 13.125 21.44 13.125 L 19.36 13.125 C 19.27 13.125 19.2 13.065 19.2 12.975 L 19.2 11.035 C 19.2 10.955 19.27 10.885 19.36 10.885 L 21.44 10.885 C 21.53 10.885 21.6 10.945 21.6 11.035 Z M 19.2 8.785 L 19.2 10.735 C 19.2 10.815 19.13 10.885 19.04 10.885 L 16.96 10.885 C 16.87 10.885 16.8 10.815 16.8 10.735 L 16.8 8.785 C 16.8 8.705 16.87 8.635 16.96 8.635 L 19.04 8.635 C 19.13 8.635 19.2 8.705 19.2 8.785 Z M 24 8.785 L 24 10.735 C 24 10.815 23.93 10.885 23.84 10.885 L 21.76 10.885 C 21.67 10.885 21.6 10.815 21.6 10.735 L 21.6 8.785 C 21.6 8.705 21.67 8.635 21.76 8.635 L 23.84 8.635 C 23.93 8.635 24 8.705 24 8.785 Z M 19.2 13.285 L 19.2 15.225 C 19.2 15.305 19.13 15.375 19.04 15.375 L 16.96 15.375 C 16.87 15.375 16.8 15.305 16.8 15.225 L 16.8 13.275 C 16.8 13.195 16.87 13.125 16.96 13.125 L 19.04 13.125 C 19.13 13.125 19.2 13.195 19.2 13.275 L 19.2 13.285 Z M 24 13.285 L 24 15.225 C 24 15.305 23.93 15.375 23.84 15.375 L 21.76 15.375 C 21.67 15.375 21.6 15.305 21.6 15.225 L 21.6 13.275 C 21.6 13.195 21.67 13.125 21.76 13.125 L 23.84 13.125 C 23.93 13.125 24 13.195 24 13.275 L 24 13.285 Z M 15.6 8.785 L 15.6 10.735 C 15.6 10.815 15.53 10.885 15.44 10.885 L 13.36 10.885 C 13.27 10.885 13.2 10.815 13.2 10.735 L 13.2 8.785 C 13.2 8.705 13.27 8.635 13.36 8.635 L 15.44 8.635 C 15.53 8.635 15.6 8.705 15.6 8.785 Z M 15.6 13.285 L 15.6 15.225 C 15.6 15.305 15.53 15.375 15.44 15.375 L 13.36 15.375 C 13.27 15.375 13.2 15.305 13.2 15.225 L 13.2 13.275 C 13.2 13.195 13.27 13.125 13.36 13.125 L 15.44 13.125 C 15.53 13.125 15.6 13.195 15.6 13.275 L 15.6 13.285 Z M 13.2 12.985 C 13.195 13.069 13.125 13.135 13.04 13.135 L 10.8 13.135 L 10.8 15.215 C 10.8 15.255 10.78 15.295 10.75 15.325 C 10.719 15.351 10.68 15.365 10.64 15.365 L 8.56 15.365 C 8.516 15.368 8.473 15.353 8.44 15.325 C 8.414 15.298 8.399 15.262 8.4 15.225 L 8.4 8.775 C 8.4 8.735 8.41 8.695 8.44 8.675 C 8.472 8.643 8.515 8.625 8.56 8.625 L 10.64 8.625 C 10.68 8.625 10.72 8.645 10.75 8.675 C 10.78 8.695 10.8 8.735 10.8 8.775 L 10.8 10.875 L 13.04 10.875 C 13.08 10.875 13.12 10.885 13.15 10.915 C 13.18 10.945 13.2 10.985 13.2 11.015 L 13.2 12.965 L 13.2 12.985 Z"
      />
    </svg>
  );
}

/** No confirmed source-of-truth mark — a plain letter, never a guessed shape. */
function Monogram({ letter }: { letter: string }) {
  return <span className="venue-monogram">{letter}</span>;
}

interface VenueMeta {
  label: string;
  color: string;
  icon: (props: IconProps) => ReactElement;
}

const PROTOCOLS: Record<string, VenueMeta> = {
  enzyme: { label: "Enzyme", color: "#6F56FD", icon: EnzymeIcon },
  chamber: { label: "Chamber", color: "#AFA290", icon: () => <Monogram letter="C" /> },
  hyperliquid: { label: "Hyperliquid", color: "#00E5A0", icon: () => <Monogram letter="H" /> },
  okx: { label: "OKX", color: "#F4EEE2", icon: OkxIcon },
  drift: { label: "Drift", color: "#AFA290", icon: () => <Monogram letter="D" /> },
};

const CHAINS: Record<string, VenueMeta> = {
  ethereum: { label: "Ethereum", color: "#627EEA", icon: EthereumIcon },
  mainnet: { label: "Ethereum", color: "#627EEA", icon: EthereumIcon },
  arbitrum: { label: "Arbitrum", color: "#12AAFF", icon: () => <Monogram letter="A" /> },
  base: { label: "Base", color: "#0052FF", icon: () => <Monogram letter="B" /> },
  polygon: { label: "Polygon", color: "#8247E5", icon: PolygonIcon },
  optimism: { label: "Optimism", color: "#FF0420", icon: OptimismIcon },
  hyperevm: { label: "HyperEVM", color: "#00E5A0", icon: () => <Monogram letter="H" /> },
  solana: { label: "Solana", color: "#14F195", icon: SolanaIcon },
};

/** Drift and OKX don't carry a chain in `venue`, but the chain is a fixed fact about the protocol. */
const IMPLIED_CHAIN: Record<string, string> = { drift: "solana" };

function titleCase(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function parseVenue(venue: string): { protocol: VenueMeta; protocolLabel: string; chain?: VenueMeta } {
  const [rawProtocol, rawChain] = venue.split(":");
  const protocolKey = (rawProtocol ?? venue).toLowerCase();
  const protocol = PROTOCOLS[protocolKey] ?? {
    label: titleCase(rawProtocol ?? venue),
    color: "#AFA290",
    icon: () => <Monogram letter={(rawProtocol ?? venue).slice(0, 1).toUpperCase()} />,
  };
  const chainKey = (rawChain ?? IMPLIED_CHAIN[protocolKey])?.toLowerCase();
  const chain = chainKey === undefined ? undefined : CHAINS[chainKey] ?? {
    label: titleCase(chainKey),
    color: "#AFA290",
    icon: () => <Monogram letter={chainKey.slice(0, 1).toUpperCase()} />,
  };
  return { protocol, protocolLabel: protocol.label, chain };
}

function Chip({ meta, size }: { meta: VenueMeta; size: number }) {
  const Icon = meta.icon;
  return (
    <span
      className="venue-chip"
      style={{ width: size, height: size, color: meta.color, background: `${meta.color}24` }}
    >
      <Icon className="venue-chip-icon" />
    </span>
  );
}

export default function VenueBadge({ venue, size = 16 }: { venue: string; size?: number }) {
  const { protocol, protocolLabel, chain } = parseVenue(venue);
  return (
    <span className="venue-badge" title={venue}>
      <Chip meta={protocol} size={size} />
      <span className="venue-name">{protocolLabel}</span>
      {chain && (
        <span className="venue-chain">
          <span className="venue-sep">on</span>
          <Chip meta={chain} size={size - 2} />
          {chain.label}
        </span>
      )}
    </span>
  );
}
