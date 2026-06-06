import type {
  DexMarketPrice,
  DexPlacedOrder,
  FillEvent,
  NadoNetwork,
  PlannedOrder
} from "../../../shared/src/index.ts";
import { LiveTradingDisabledError, type ClosePositionParams, type DexAdapter, type PlaceOrderContext } from "../types.ts";

export interface NadoDexAdapterOptions {
  network: NadoNetwork;
  chainEnv: string;
  privateKey?: string;
  subaccount?: string;
  liveTradingEnabled: boolean;
  gatewayBaseUrl?: string;
}

const GATEWAY_ENDPOINTS: Record<NadoNetwork, string> = {
  mainnet: "https://gateway.nado.xyz/v1",
  testnet: "https://gateway.test.nado.xyz/v1"
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
    const chain = CHAIN_ENV_TO_CHAIN[this.options.chainEnv];
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

    return createNadoClient(this.options.chainEnv, {
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
