import type {
  DexMarketPrice,
  DexPlacedOrder,
  FillEvent,
  MarketCandle,
  NadoNetwork,
  PlannedOrder
} from "../../../shared/src/index.ts";
import {
  LiveTradingDisabledError,
  type CandlestickRequest,
  type ClosePositionParams,
  type DexAdapter,
  type PlaceOrderContext
} from "../types.ts";

export interface NadoDexAdapterOptions {
  network: NadoNetwork;
  chainEnv: string;
  privateKey?: string;
  subaccount?: string;
  liveTradingEnabled: boolean;
  gatewayBaseUrl?: string;
  indexerBaseUrl?: string;
}

const GATEWAY_ENDPOINTS: Record<NadoNetwork, string> = {
  mainnet: "https://gateway.nado.xyz/v1",
  testnet: "https://gateway.test.nado.xyz/v1"
};

const INDEXER_ENDPOINTS: Record<NadoNetwork, string> = {
  mainnet: "https://archive.prod.nado.xyz/v1",
  testnet: "https://archive.test.nado.xyz/v1"
};

export class NadoDexAdapter implements DexAdapter {
  readonly name = "nado";
  readonly network: NadoNetwork;

  private readonly options: NadoDexAdapterOptions;
  private readonly placedOrders = new Map<string, { productId: number; digest: string }[]>();
  private readClientPromise: Promise<any> | undefined;
  private writeClientPromise: Promise<any> | undefined;

  constructor(options: NadoDexAdapterOptions) {
    this.options = options;
    this.network = options.network;
  }

  async getMarketPrice(market: string, productId?: number): Promise<DexMarketPrice> {
    if (!productId) {
      throw new Error(`Nado productId is required for ${market}. Add it to the strategy before live start.`);
    }

    try {
      const markPrice = await this.getIndexerMarketPrice(productId);
      return {
        market: market.toUpperCase(),
        markPrice,
        indexPrice: markPrice,
        updatedAt: new Date().toISOString()
      };
    } catch {
      // Keep SDK and legacy gateway fallback for deployments that still expose
      // older read APIs.
    }

    try {
      const client = await this.getClient(false);
      const latest = await client.market.getLatestMarketPrice({ productId });
      const markPrice = extractPrice(latest);
      return {
        market: market.toUpperCase(),
        markPrice,
        indexPrice: markPrice,
        updatedAt: new Date().toISOString()
      };
    } catch {
      // Fall back to gateway query when the SDK is not installed yet or the
      // calling environment only needs read-only dry-run previews.
    }

    const baseUrl = this.options.gatewayBaseUrl ?? GATEWAY_ENDPOINTS[this.network];
    const url = new URL(`${baseUrl}/query`);
    url.searchParams.set("type", "market_prices");
    url.searchParams.set("product_ids", String(productId));

    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, br, deflate"
      }
    });

    if (!response.ok) {
      throw new Error(`Nado price query failed: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as unknown;
    const markPrice = extractPrice(payload);
    return {
      market: market.toUpperCase(),
      markPrice,
      indexPrice: markPrice,
      updatedAt: new Date().toISOString()
    };
  }

  async getCandlesticks(market: string, productId?: number, request: CandlestickRequest = {}): Promise<MarketCandle[]> {
    if (!productId) {
      throw new Error(`Nado productId is required to load candlesticks for ${market}.`);
    }

    const intervalSeconds = normalizeIntervalSeconds(request.intervalSeconds);
    const limit = normalizeCandlestickLimit(request.limit);

    try {
      const edgeCandles = await this.getIndexerCandlesticks("edge_candlesticks", productId, intervalSeconds, limit);
      if (edgeCandles.length > 0) return edgeCandles;
    } catch {
      // Fall back to archived candlesticks below.
    }

    try {
      const archivedCandles = await this.getIndexerCandlesticks("candlesticks", productId, intervalSeconds, limit);
      if (archivedCandles.length > 0) return archivedCandles;
    } catch {
      // Fall back to SDK when direct indexer HTTP is unavailable.
    }

    const client = await this.getClient(false);
    const sdk = (await this.loadNadoSdk()) as { CandlestickPeriod?: Record<string, number> };
    const period = selectCandlestickPeriod(intervalSeconds, sdk.CandlestickPeriod);

    try {
      if (typeof client.market.getEdgeCandlesticks === "function") {
        const candles = await client.market.getEdgeCandlesticks({
          productId,
          period,
          limit
        });
        return normalizeCandles(candles);
      }
    } catch {
      // Fall back to archived candlesticks when the edge indexer is unavailable.
    }

    const candles = await client.market.getCandlesticks({
      productId,
      period,
      limit
    });
    return normalizeCandles(candles);
  }

  private async getIndexerMarketPrice(productId: number): Promise<number> {
    try {
      const price = await this.queryIndexer("price", { product_id: productId });
      return extractPrice(price);
    } catch {
      // Some products currently return zero mark/index prices while oracle and
      // candles are populated.
    }

    try {
      const oracle = await this.queryIndexer("oracle_price", { product_ids: [productId] });
      return extractPrice(oracle);
    } catch {
      // Last candle close is the final read-only fallback for observation mode.
    }

    const candles = await this.getIndexerCandlesticks("edge_candlesticks", productId, 300, 1);
    const last = candles.at(-1);
    if (!last) throw new Error(`Nado indexer did not return a price for productId ${productId}.`);
    return last.close;
  }

  private async getIndexerCandlesticks(
    requestType: "candlesticks" | "edge_candlesticks",
    productId: number,
    intervalSeconds: number,
    limit: number
  ): Promise<MarketCandle[]> {
    const payload = await this.queryIndexer(requestType, {
      product_id: productId,
      granularity: intervalSeconds,
      limit
    });
    const candles = payload && typeof payload === "object" ? (payload as { candlesticks?: unknown }).candlesticks : undefined;
    return normalizeCandles(candles);
  }

  private async queryIndexer(requestType: string, params: Record<string, unknown>): Promise<unknown> {
    const baseUrl = this.options.indexerBaseUrl ?? INDEXER_ENDPOINTS[this.network];
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ [requestType]: params })
    });

    if (!response.ok) {
      throw new Error(`Nado indexer ${requestType} query failed: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<unknown>;
  }

  async placeOrders(orders: PlannedOrder[], context: PlaceOrderContext): Promise<DexPlacedOrder[]> {
    if (context.dryRun) {
      return orders.map((order) => ({
        exchangeOrderId: `dryrun_${order.clientOrderId}`,
        clientOrderId: order.clientOrderId,
        status: "open"
      }));
    }

    this.assertLiveAllowed(context);

    const client = await this.getClient(true);
    const { addDecimals, nowInSeconds, packOrderAppendix } = await this.loadNadoShared();
    const placed: DexPlacedOrder[] = [];

    for (const order of orders) {
      if (!order.productId) {
        throw new Error(`Nado productId is required to place ${order.clientOrderId}`);
      }
      const amount = order.side === "buy" ? order.amountBase : -order.amountBase;
      const result = await client.market.placeOrder({
        order: {
          subaccountName: this.options.subaccount ?? "default",
          expiration: nowInSeconds() + 60 * 60 * 24,
          appendix: packOrderAppendix({
            orderExecutionType: order.postOnly ? "post_only" : "default",
            reduceOnly: order.reduceOnly
          }),
          price: order.price,
          amount: addDecimals(amount, 18)
        },
        productId: order.productId,
        spotLeverage: undefined
      });
      const digest = String(result?.data?.digest ?? result?.digest ?? "");
      if (!digest) throw new Error(`Nado placeOrder did not return a digest for ${order.clientOrderId}`);
      const strategyOrders = this.placedOrders.get(order.strategyId) ?? [];
      strategyOrders.push({ productId: order.productId, digest });
      this.placedOrders.set(order.strategyId, strategyOrders);
      placed.push({
        exchangeOrderId: digest,
        clientOrderId: order.clientOrderId,
        status: "open"
      });
    }

    return placed;
  }

  async cancelStrategyOrders(strategyId: string, market: string): Promise<void> {
    void market;
    if (!this.options.liveTradingEnabled) return;
    const orders = this.placedOrders.get(strategyId) ?? [];
    if (orders.length === 0) return;
    const client = await this.getClient(true);
    await client.market.cancelOrders({
      digests: orders.map((order) => order.digest),
      productIds: orders.map((order) => order.productId),
      subaccountName: this.options.subaccount ?? "default"
    });
    this.placedOrders.delete(strategyId);
  }

  async closePositionReduceOnly(params: ClosePositionParams): Promise<DexPlacedOrder | undefined> {
    if (params.dryRun) {
      return {
        exchangeOrderId: `dryrun_close_${params.strategyId}`,
        clientOrderId: `${params.strategyId}:close:${params.reason}`,
        status: "open"
      };
    }
    this.assertLiveAllowed({ dryRun: false, allowLive: true });
    throw new Error("Nado live reduce-only close requires verified position sizing before enabling.");
  }

  async listRecentFills(strategyId: string, market: string): Promise<FillEvent[]> {
    void strategyId;
    void market;
    return [];
  }

  private assertLiveAllowed(context: PlaceOrderContext): void {
    if (!context.allowLive || !this.options.liveTradingEnabled) {
      throw new LiveTradingDisabledError();
    }
    if (!this.options.privateKey) {
      throw new Error("NADO_PRIVATE_KEY is required for live trading.");
    }
  }

  private async getClient(requireWallet: boolean): Promise<any> {
    if (requireWallet) {
      this.writeClientPromise ??= this.createClient(true);
      return this.writeClientPromise;
    }
    this.readClientPromise ??= this.createClient(false);
    return this.readClientPromise;
  }

  private async createClient(requireWallet: boolean): Promise<any> {
    const { createNadoClient } = (await this.loadNadoSdk()) as any;
    const { CHAIN_ENV_TO_CHAIN } = await this.loadNadoShared();
    const { createPublicClient, createWalletClient, http } = (await import("viem")) as any;
    const { privateKeyToAccount } = (await import("viem/accounts")) as any;
    const chainEnv = normalizeChainEnv(this.options.chainEnv, this.network);
    const chain = CHAIN_ENV_TO_CHAIN[chainEnv];
    if (!chain) throw new Error(`Unknown Nado chain env: ${this.options.chainEnv}`);

    const publicClient = createPublicClient({
      chain,
      transport: http()
    });
    const walletClient =
      this.options.privateKey
        ? createWalletClient({
            account: privateKeyToAccount(this.options.privateKey),
            chain,
            transport: http()
          })
        : undefined;

    if (requireWallet && !walletClient) {
      throw new Error("NADO_PRIVATE_KEY is required for Nado write operations.");
    }

    return createNadoClient(chainEnv, {
      walletClient,
      publicClient
    });
  }

  private async loadNadoSdk(): Promise<unknown> {
    try {
      return await import("@nadohq/client");
    } catch (error) {
      throw new Error(
        `@nadohq/client is required for live Nado trading. Install dependencies and verify SDK APIs first. Original error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async loadNadoShared(): Promise<any> {
    try {
      return await import("@nadohq/shared");
    } catch (error) {
      throw new Error(
        `@nadohq/shared is required for Nado SDK operations. Original error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}

function normalizeChainEnv(chainEnv: string, network: NadoNetwork): string {
  if (chainEnv === "ink") return "inkMainnet";
  if (chainEnv === "mainnet") return "inkMainnet";
  if (chainEnv === "testnet") return "inkTestnet";
  if (chainEnv === "inkSepolia") return "inkTestnet";
  if (chainEnv) return chainEnv;
  return network === "testnet" ? "inkTestnet" : "inkMainnet";
}

function selectCandlestickPeriod(intervalSeconds: number, periods: Record<string, number> | undefined): number {
  const requested = Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : 300;
  if (!periods) return requested;
  const supported: { seconds: number; value: number }[] = [];
  const addPeriod = (seconds: number, value: number | undefined) => {
    if (value !== undefined && Number.isFinite(value)) supported.push({ seconds, value });
  };
  addPeriod(60, periods.MIN);
  addPeriod(300, periods.FIVE_MIN);
  addPeriod(900, periods.FIFTEEN_MIN);
  addPeriod(3600, periods.HOUR);
  addPeriod(7200, periods.TWO_HOUR);
  addPeriod(14400, periods.FOUR_HOUR);
  addPeriod(86400, periods.DAY);
  addPeriod(604800, periods.WEEK);
  addPeriod(2419200, periods.MONTH);

  if (supported.length === 0) return requested;
  const exact = supported.find((item) => item.seconds === requested);
  if (exact) return exact.value;
  return supported.reduce((best, item) =>
    Math.abs(item.seconds - requested) < Math.abs(best.seconds - requested) ? item : best
  ).value;
}

function normalizeIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 300;
  return Math.max(Math.trunc(value), 60);
}

function normalizeCandlestickLimit(value: number | undefined): number {
  if (!Number.isFinite(value) || !value) return 120;
  return Math.min(Math.max(Math.trunc(value), 20), 500);
}

function normalizeCandles(payload: unknown): MarketCandle[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map(normalizeCandle)
    .filter((candle): candle is MarketCandle => candle !== undefined)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time));
}

function normalizeCandle(value: unknown): MarketCandle | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const time = normalizeCandleTime(record.time ?? record.timestamp);
  const open = toPriceNumber(record.open ?? record.open_x18);
  const high = toPriceNumber(record.high ?? record.high_x18);
  const low = toPriceNumber(record.low ?? record.low_x18);
  const close = toPriceNumber(record.close ?? record.close_x18);
  const volume = toFiniteNumber(record.volume);

  if (!time || ![open, high, low, close, volume].every(Number.isFinite)) return undefined;
  if (high <= 0 || low <= 0 || close <= 0 || high < low) return undefined;
  return { time, open, high, low, close, volume };
}

function normalizeCandleTime(value: unknown): string | undefined {
  const numeric = toFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toFiniteNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object") {
    const maybeNumber = (value as { toNumber?: unknown }).toNumber;
    if (typeof maybeNumber === "function") return maybeNumber.call(value);
    const maybeString = (value as { toString?: unknown }).toString;
    if (typeof maybeString === "function") return Number(maybeString.call(value));
  }
  return Number.NaN;
}

function toPriceNumber(value: unknown): number {
  const numeric = toFiniteNumber(value);
  return numeric > 1e12 ? numeric / 1e18 : numeric;
}

function extractPrice(payload: unknown): number {
  const candidates = collectNumericCandidates(payload);
  const first = candidates.find((value) => Number.isFinite(value) && value > 0);
  if (!first) throw new Error("Nado price response did not contain a positive price.");
  return first > 1e12 ? first / 1e18 : first;
}

function collectNumericCandidates(value: unknown): number[] {
  if (typeof value === "number") return [value];
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? [parsed] : [];
  }
  if (Array.isArray(value)) return value.flatMap(collectNumericCandidates);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => /mark|index|price/i.test(key))
      .flatMap(([, nested]) => collectNumericCandidates(nested));
  }
  return [];
}
