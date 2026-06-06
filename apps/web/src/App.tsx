import { AlertTriangle, Check, CircleDollarSign, LogIn, Play, RefreshCw, Save, ShieldAlert, Square, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AuditEvent, GridPreview, StrategyRecord } from "../../../packages/shared/src/index.ts";
import {
  createStrategy,
  getStatus,
  listStrategies,
  login,
  me,
  previewStrategy,
  startStrategy,
  stopStrategy,
  syncStrategy,
  updateStrategy,
  type CreateStrategyPayload
} from "./lib/api.ts";

const initialForm = {
  name: "",
  market: "BTC-PERP",
  productId: "",
  direction: "long" as "long" | "short",
  lowerPrice: "90000",
  upperPrice: "110000",
  gridCount: "10",
  marginPerGrid: "10",
  leverage: "3",
  takeProfitPrice: "112000",
  stopLossPrice: "88000",
  currentPrice: "100000",
  network: "mainnet" as "mainnet" | "testnet",
  postOnly: true
};

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [form, setForm] = useState(initialForm);
  const [strategies, setStrategies] = useState<StrategyRecord[]>([]);
  const [selected, setSelected] = useState<StrategyRecord | undefined>();
  const [preview, setPreview] = useState<GridPreview | undefined>();
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [executionMode, setExecutionMode] = useState<"dry-run" | "live">("dry-run");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [tvSymbol, setTvSymbol] = useState(marketToTradingViewSymbol(initialForm.market));
  const [autoSync, setAutoSync] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    me()
      .then(() => setAuthenticated(true))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    void refreshStrategies();
  }, [authenticated]);

  useEffect(() => {
    setTvSymbol(marketToTradingViewSymbol(selected?.config.market ?? form.market));
  }, [selected?.id, selected?.config.market, form.market]);

  useEffect(() => {
    if (!selected) return;
    setForm(strategyToForm(selected));
    setExecutionMode(selected.executionMode);
  }, [selected?.id]);

  useEffect(() => {
    if (!authenticated || !autoSync || !selected?.id) return;
    let cancelled = false;
    const sync = async () => {
      try {
        const status = await syncStrategy(selected.id);
        if (!cancelled) applyStatus(status);
      } catch {
        // Keep the current screen stable; explicit actions still surface errors.
      }
    };
    const timer = window.setInterval(() => void sync(), 5_000);
    void sync();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authenticated, autoSync, selected?.id]);

  const selectedStatusClass = selected ? `status status-${selected.status}` : "status";
  const chartSymbol = tvSymbol.trim() || marketToTradingViewSymbol(selected?.config.market ?? form.market);
  const observation = useMemo(() => (preview ? buildObservation(preview) : undefined), [preview]);
  const totalMargin = useMemo(() => {
    const gridCount = Number(form.gridCount) || 0;
    const margin = Number(form.marginPerGrid) || 0;
    return gridCount * margin;
  }, [form.gridCount, form.marginPerGrid]);

  async function refreshStrategies(nextId?: string) {
    const items = await listStrategies();
    setStrategies(items);
    const target = items.find((item) => item.id === (nextId ?? selected?.id)) ?? items[0];
    if (target) await selectStrategy(target.id);
  }

  async function selectStrategy(id: string) {
    const status = await getStatus(id);
    applyStatus(status);
  }

  function applyStatus(status: { strategy: StrategyRecord; preview?: GridPreview; audit: AuditEvent[] }) {
    setSelected(status.strategy);
    setPreview(status.preview);
    setAudit(status.audit);
    setLastSyncAt(status.strategy.lastSyncedAt ?? status.strategy.updatedAt);
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(password);
      setAuthenticated(true);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = formToPayload(form);
      const saved = selected ? await updateStrategy(selected.id, payload) : await createStrategy(payload);
      setSelected(saved.strategy);
      setPreview(saved.preview);
      setLastSyncAt(saved.strategy.lastSyncedAt ?? saved.strategy.updatedAt);
      await refreshStrategies(saved.strategy.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function handleNewStrategy() {
    setSelected(undefined);
    setPreview(undefined);
    setAudit([]);
    setForm(initialForm);
    setExecutionMode("dry-run");
    setConfirmPhrase("");
    setLastSyncAt(undefined);
  }

  async function handlePreview() {
    if (!selected) return;
    try {
      await handlePreviewAt(toNumber(form.currentPrice));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  async function handlePreviewAt(currentPrice?: number) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const nextPreview = await previewStrategy(selected.id, currentPrice);
      setPreview(nextPreview);
      setForm((current) => ({ ...current, currentPrice: formatInputNumber(nextPreview.currentPrice) }));
      await selectStrategy(selected.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleSync(currentPrice?: number) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const status = await syncStrategy(selected.id, currentPrice);
      applyStatus(status);
      if (status.strategy.currentPrice !== undefined) {
        setForm((current) => ({ ...current, currentPrice: formatInputNumber(status.strategy.currentPrice!) }));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const result = await startStrategy(selected.id, executionMode, confirmPhrase || undefined, toNumber(form.currentPrice));
      setSelected(result.strategy);
      setPreview(result.preview);
      await refreshStrategies(result.strategy.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleStop(emergency = false) {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const stopped = await stopStrategy(selected.id, emergency);
      setSelected(stopped);
      await refreshStrategies(stopped.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === undefined) {
    return <div className="boot">Nado Grid</div>;
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={handleLogin}>
          <h1>Nado Grid</h1>
          <label>
            管理员密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          </label>
          {error ? <div className="error-line">{error}</div> : null}
          <button className="primary" disabled={busy} type="submit">
            <LogIn size={16} />
            登录
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <CircleDollarSign size={22} />
          <h1>Nado Grid</h1>
        </div>
        <button className="ghost full" onClick={() => void refreshStrategies()} disabled={busy} title="刷新">
          <RefreshCw size={16} />
          刷新
        </button>
        <button className="ghost full" onClick={handleNewStrategy} disabled={busy} title="新建策略">
          新建策略
        </button>
        <nav className="strategy-list">
          {strategies.map((strategy) => (
            <button
              key={strategy.id}
              className={selected?.id === strategy.id ? "strategy-item active" : "strategy-item"}
              onClick={() => void selectStrategy(strategy.id)}
            >
              <span>{strategy.name}</span>
              <small>{strategy.config.market}</small>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <div className={selectedStatusClass}>{selected ? formatStatus(selected.status) : "新建"}</div>
            <h2>{selected?.name ?? "新建策略"}</h2>
            <small className="sync-caption">{lastSyncAt ? `Nado API 同步：${new Date(lastSyncAt).toLocaleTimeString("zh-CN")}` : "等待 Nado API 同步"}</small>
          </div>
          <div className="topbar-actions">
            <button className="ghost icon-text" onClick={() => void handleSync()} disabled={!selected || busy} title="同步 Nado API">
              <RefreshCw size={17} />
              同步
            </button>
            <button className="ghost icon" onClick={handlePreview} disabled={!selected || busy} title="刷新预览">
              <RefreshCw size={17} />
            </button>
            <button className="primary icon-text" onClick={handleStart} disabled={!selected || busy} title="启动">
              <Play size={17} />
              启动
            </button>
            <button className="danger icon-text" onClick={() => void handleStop(true)} disabled={!selected || busy} title="紧急停止">
              <ShieldAlert size={17} />
              停止
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="grid-layout">
          <form className="panel config-panel" onSubmit={handleCreate}>
            <div className="panel-title">
              <h3>策略配置</h3>
              <button className="primary icon-text" disabled={busy} type="submit" title="保存">
                <Save size={16} />
                {selected ? "更新" : "保存"}
              </button>
            </div>

            <div className="field-grid">
              <Field label="策略名称" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <Field label="市场" value={form.market} onChange={(value) => setForm({ ...form, market: value })} />
              <Field label="产品 ID" value={form.productId} onChange={(value) => setForm({ ...form, productId: value })} />
              <label>
                网络
                <select value={form.network} onChange={(event) => setForm({ ...form, network: event.target.value as "mainnet" | "testnet" })}>
                  <option value="mainnet">主网</option>
                  <option value="testnet">测试网</option>
                </select>
              </label>
            </div>

            <div className="segmented">
              <button type="button" className={form.direction === "long" ? "selected" : ""} onClick={() => setForm({ ...form, direction: "long" })}>
                做多
              </button>
              <button type="button" className={form.direction === "short" ? "selected" : ""} onClick={() => setForm({ ...form, direction: "short" })}>
                做空
              </button>
            </div>

            <div className="field-grid numeric">
              <Field label="区间下限" value={form.lowerPrice} onChange={(value) => setForm({ ...form, lowerPrice: value })} />
              <Field label="区间上限" value={form.upperPrice} onChange={(value) => setForm({ ...form, upperPrice: value })} />
              <Field label="网格数量" value={form.gridCount} onChange={(value) => setForm({ ...form, gridCount: value })} />
              <Field label="单格保证金" value={form.marginPerGrid} onChange={(value) => setForm({ ...form, marginPerGrid: value })} />
              <Field label="杠杆" value={form.leverage} onChange={(value) => setForm({ ...form, leverage: value })} />
              <Field label="当前价格" value={form.currentPrice} onChange={(value) => setForm({ ...form, currentPrice: value })} />
              <Field label="止盈价" value={form.takeProfitPrice} onChange={(value) => setForm({ ...form, takeProfitPrice: value })} />
              <Field label="止损价" value={form.stopLossPrice} onChange={(value) => setForm({ ...form, stopLossPrice: value })} />
            </div>

            <label className="check-row">
              <input type="checkbox" checked={form.postOnly} onChange={(event) => setForm({ ...form, postOnly: event.target.checked })} />
              仅挂 Post-only
            </label>

            <div className="metric-strip">
              <Metric label="总保证金" value={formatMoney(totalMargin)} />
              <Metric label="最大名义敞口" value={formatMoney(totalMargin * (Number(form.leverage) || 0))} />
            </div>
          </form>

          <section className="panel chart-panel">
            <div className="panel-title chart-title">
              <div>
                <h3>TradingView 图表</h3>
                <small>{selected?.config.market ?? form.market}</small>
              </div>
              <label className="chart-symbol-field">
                图表代码
                <input value={tvSymbol} onChange={(event) => setTvSymbol(event.target.value)} />
              </label>
            </div>
            <TradingViewChart symbol={chartSymbol} />
            {preview ? <GridBridge preview={preview} status={selected?.status} autoSync={autoSync} lastSyncAt={lastSyncAt} /> : null}
          </section>

          <section className="panel action-panel">
            <div className="panel-title">
              <h3>执行</h3>
              <Wifi size={17} />
            </div>
            <div className="segmented">
              <button type="button" className={executionMode === "dry-run" ? "selected" : ""} onClick={() => setExecutionMode("dry-run")}>
                模拟
              </button>
              <button type="button" className={executionMode === "live" ? "selected" : ""} onClick={() => setExecutionMode("live")}>
                实盘
              </button>
            </div>
            <label>
              确认短语
              <input value={confirmPhrase} onChange={(event) => setConfirmPhrase(event.target.value)} placeholder={executionMode === "live" ? "START LIVE" : ""} />
            </label>
            <label className="check-row">
              <input type="checkbox" checked={autoSync} onChange={(event) => setAutoSync(event.target.checked)} />
              自动同步 Nado API
            </label>
            <div className="button-row">
              <button className="primary icon-text" disabled={!selected || busy} onClick={handleStart}>
                <Play size={16} />
                启动
              </button>
              <button className="ghost icon-text" disabled={!selected || busy} onClick={() => void handleStop(false)}>
                <Square size={16} />
                停止
              </button>
            </div>
          </section>

          <section className="panel assist-panel">
            <div className="panel-title">
              <h3>观察辅助</h3>
              <span className={observation ? `assist-state ${observation.tone}` : "assist-state"}>{observation?.state ?? "待预览"}</span>
            </div>
            {observation ? (
              <>
                <div className="range-meter">
                  <div className="range-track">
                    <span style={{ left: `${observation.rangePositionPct}%` }} />
                  </div>
                  <div className="range-labels">
                    <span>{formatPrice(observation.lowerPrice)}</span>
                    <span>{formatPrice(observation.currentPrice)}</span>
                    <span>{formatPrice(observation.upperPrice)}</span>
                  </div>
                </div>
                <div className="metric-strip compact">
                  <Metric label="区间位置" value={observation.rangePositionLabel} />
                  <Metric label="下一入场" value={observation.nextEntryLabel} />
                  <Metric label="配对止盈" value={observation.pairedExitLabel} />
                  <Metric label="风控距离" value={observation.riskDistanceLabel} />
                </div>
                <div className="assist-actions">
                  <button className="ghost" type="button" disabled={!selected || busy} onClick={() => void handleSync()} title="读取 Nado API 市场价">
                    市场价
                  </button>
                  <button className="ghost" type="button" disabled={!selected || busy} onClick={() => void handleSync(observation.scenarios.lower)} title="下沿场景">
                    下沿
                  </button>
                  <button className="ghost" type="button" disabled={!selected || busy} onClick={() => void handleSync(observation.scenarios.middle)} title="中线场景">
                    中线
                  </button>
                  <button className="ghost" type="button" disabled={!selected || busy} onClick={() => void handleSync(observation.scenarios.upper)} title="上沿场景">
                    上沿
                  </button>
                </div>
                <div className="signal-list">
                  <div>
                    <span>建议</span>
                    <strong>{observation.actionLabel}</strong>
                  </div>
                  <div>
                    <span>止盈距离</span>
                    <strong>{observation.takeProfitDistanceLabel}</strong>
                  </div>
                  <div>
                    <span>止损距离</span>
                    <strong>{observation.stopLossDistanceLabel}</strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state compact">暂无观察数据</div>
            )}
          </section>

          <section className="panel preview-panel">
            <div className="panel-title">
              <h3>预览</h3>
              {preview?.risk.warnings.length ? <AlertTriangle size={17} className="warn-icon" /> : <Check size={17} className="ok-icon" />}
            </div>
            {preview ? (
              <>
                <div className="metric-strip">
                  <Metric label="入场挂单" value={String(preview.risk.activeEntryOrders)} />
                  <Metric label="保证金风险" value={formatMoney(preview.risk.marginAtRisk)} />
                  <Metric label="最大敞口" value={formatMoney(preview.risk.maxNotionalExposure)} />
                  <Metric label="网格步长" value={formatPrice(preview.risk.priceStep)} />
                </div>
                {preview.risk.warnings.length ? (
                  <div className="warning-list">
                    {preview.risk.warnings.map((warning) => (
                      <span key={warning}>{formatWarning(warning)}</span>
                    ))}
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>方向</th>
                        <th>价格</th>
                        <th>数量</th>
                        <th>名义金额</th>
                        <th>用途</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.orders.map((order) => (
                        <tr key={order.clientOrderId}>
                          <td className={order.side}>{formatOrderSide(order.side)}</td>
                          <td>{formatPrice(order.price)}</td>
                          <td>{order.amountBase.toFixed(6)}</td>
                          <td>{formatMoney(order.notional)}</td>
                          <td>{formatOrderIntent(order.intent)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state">暂无预览</div>
            )}
          </section>

          <section className="panel audit-panel">
            <div className="panel-title">
              <h3>审计日志</h3>
            </div>
            <div className="audit-list">
              {audit.map((event) => (
                <div key={event.id} className={`audit-row ${event.level}`}>
                  <span>{formatAuditType(event.type)}</span>
                  <p>{formatAuditMessage(event.message)}</p>
                  <time>{new Date(event.createdAt).toLocaleString("zh-CN")}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function TradingViewChart({ symbol }: { symbol: string }) {
  return (
    <iframe
      className="tradingview-frame"
      title={`${symbol} TradingView 图表`}
      srcDoc={buildTradingViewHtml(symbol)}
    />
  );
}

function GridBridge({
  preview,
  status,
  autoSync,
  lastSyncAt
}: {
  preview: GridPreview;
  status?: StrategyRecord["status"];
  autoSync: boolean;
  lastSyncAt?: string;
}) {
  const range = Math.max(preview.config.upperPrice - preview.config.lowerPrice, Number.EPSILON);
  const currentPct = clamp(((preview.currentPrice - preview.config.lowerPrice) / range) * 100, 0, 100);
  return (
    <div className="tv-bridge">
      <div className="bridge-head">
        <div>
          <span>Nado API</span>
          <strong>{autoSync ? "实时同步" : "手动同步"}</strong>
        </div>
        <div>
          <span>策略状态</span>
          <strong>{status ? formatStatus(status) : "未选择"}</strong>
        </div>
        <div>
          <span>当前价格</span>
          <strong>{formatPrice(preview.currentPrice)}</strong>
        </div>
        <div>
          <span>更新时间</span>
          <strong>{lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString("zh-CN") : "等待同步"}</strong>
        </div>
      </div>
      <div className="grid-map" aria-label="网格区间">
        {preview.levels.map((level) => (
          <span
            key={level.index}
            className="grid-map-line"
            style={{ left: `${clamp(((level.price - preview.config.lowerPrice) / range) * 100, 0, 100)}%` }}
            title={`${level.index}: ${formatPrice(level.price)}`}
          />
        ))}
        <span className="grid-map-current" style={{ left: `${currentPct}%` }} />
      </div>
      <div className="bridge-foot">
        <span>下沿 {formatPrice(preview.config.lowerPrice)}</span>
        <span>{preview.risk.activeEntryOrders} 笔入场挂单</span>
        <span>上沿 {formatPrice(preview.config.upperPrice)}</span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface ObservationSummary {
  state: string;
  tone: "ok" | "warn" | "danger";
  actionLabel: string;
  currentPrice: number;
  lowerPrice: number;
  upperPrice: number;
  rangePositionPct: number;
  rangePositionLabel: string;
  nextEntryLabel: string;
  pairedExitLabel: string;
  riskDistanceLabel: string;
  takeProfitDistanceLabel: string;
  stopLossDistanceLabel: string;
  scenarios: {
    lower: number;
    middle: number;
    upper: number;
  };
}

function strategyToForm(strategy: StrategyRecord): typeof initialForm {
  return {
    name: strategy.name,
    market: strategy.config.market,
    productId: strategy.config.productId === undefined ? "" : String(strategy.config.productId),
    direction: strategy.config.direction,
    lowerPrice: formatInputNumber(strategy.config.lowerPrice),
    upperPrice: formatInputNumber(strategy.config.upperPrice),
    gridCount: String(strategy.config.gridCount),
    marginPerGrid: formatInputNumber(strategy.config.marginPerGrid),
    leverage: formatInputNumber(strategy.config.leverage),
    takeProfitPrice: formatInputNumber(strategy.config.takeProfitPrice),
    stopLossPrice: formatInputNumber(strategy.config.stopLossPrice),
    currentPrice: formatInputNumber(strategy.currentPrice ?? midpoint(strategy.config.lowerPrice, strategy.config.upperPrice)),
    network: strategy.config.network,
    postOnly: strategy.config.postOnly
  };
}

function formToPayload(form: typeof initialForm): CreateStrategyPayload {
  return {
    name: form.name || undefined,
    currentPrice: toNumber(form.currentPrice),
    config: {
      market: form.market,
      productId: form.productId ? Number(form.productId) : undefined,
      direction: form.direction,
      lowerPrice: toNumber(form.lowerPrice),
      upperPrice: toNumber(form.upperPrice),
      gridCount: Math.trunc(toNumber(form.gridCount)),
      marginPerGrid: toNumber(form.marginPerGrid),
      leverage: toNumber(form.leverage),
      takeProfitPrice: toNumber(form.takeProfitPrice),
      stopLossPrice: toNumber(form.stopLossPrice),
      postOnly: form.postOnly,
      network: form.network
    }
  };
}

function buildObservation(preview: GridPreview): ObservationSummary {
  const { config, currentPrice, levels, orders, risk } = preview;
  const range = Math.max(config.upperPrice - config.lowerPrice, Number.EPSILON);
  const inRange = currentPrice > config.lowerPrice && currentPrice < config.upperPrice;
  const riskTriggered = isGlobalRiskTriggered(config.direction, currentPrice, config.takeProfitPrice, config.stopLossPrice);
  const rangePositionPct = clamp(((currentPrice - config.lowerPrice) / range) * 100, 0, 100);
  const nextEntry = findNextEntryOrder(preview);
  const pairedExitPrice =
    nextEntry?.pairedGridIndex === undefined
      ? undefined
      : levels.find((level) => level.index === nextEntry.pairedGridIndex)?.price;
  const takeProfitDistancePct = distancePercent(config.takeProfitPrice, currentPrice);
  const stopLossDistancePct = distancePercent(config.stopLossPrice, currentPrice);
  const nearestRiskDistancePct = Math.min(takeProfitDistancePct, stopLossDistancePct);

  let tone: ObservationSummary["tone"] = "ok";
  let state = "观察中";
  let actionLabel = nextEntry ? `等待${formatOrderSide(nextEntry.side)} ${formatPrice(nextEntry.price)}` : "等待新区间";

  if (riskTriggered) {
    tone = "danger";
    state = "触发风控";
    actionLabel = "停止模拟";
  } else if (!inRange) {
    tone = "warn";
    state = "区间外";
    actionLabel = "等待回区间";
  } else if (risk.warnings.length > 0) {
    tone = "warn";
    state = "需检查";
    actionLabel = nextEntry ? `复核${formatOrderSide(nextEntry.side)} ${formatPrice(nextEntry.price)}` : "调整参数";
  }

  return {
    state,
    tone,
    actionLabel,
    currentPrice,
    lowerPrice: config.lowerPrice,
    upperPrice: config.upperPrice,
    rangePositionPct,
    rangePositionLabel: inRange ? `${formatPercent(rangePositionPct)} 区间` : currentPrice <= config.lowerPrice ? "低于区间" : "高于区间",
    nextEntryLabel: nextEntry ? `${formatOrderSide(nextEntry.side)} ${formatPrice(nextEntry.price)}` : "无挂单",
    pairedExitLabel: pairedExitPrice === undefined ? "等待入场" : formatPrice(pairedExitPrice),
    riskDistanceLabel: formatPercent(nearestRiskDistancePct),
    takeProfitDistanceLabel: formatPriceDistance(config.takeProfitPrice, currentPrice),
    stopLossDistanceLabel: formatPriceDistance(config.stopLossPrice, currentPrice),
    scenarios: {
      lower: roundScenarioPrice(config.lowerPrice + range * 0.1),
      middle: roundScenarioPrice(config.lowerPrice + range * 0.5),
      upper: roundScenarioPrice(config.lowerPrice + range * 0.9)
    }
  };
}

function findNextEntryOrder(preview: GridPreview): GridPreview["orders"][number] | undefined {
  const entries = preview.orders.filter((order) => order.intent === "entry");
  if (preview.config.direction === "long") {
    return entries
      .filter((order) => order.price < preview.currentPrice)
      .sort((left, right) => right.price - left.price)[0];
  }
  return entries
    .filter((order) => order.price > preview.currentPrice)
    .sort((left, right) => left.price - right.price)[0];
}

function isGlobalRiskTriggered(direction: "long" | "short", currentPrice: number, takeProfitPrice: number, stopLossPrice: number): boolean {
  if (direction === "long") return currentPrice >= takeProfitPrice || currentPrice <= stopLossPrice;
  return currentPrice <= takeProfitPrice || currentPrice >= stopLossPrice;
}

function distancePercent(target: number, currentPrice: number): number {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) return 0;
  return (Math.abs(target - currentPrice) / currentPrice) * 100;
}

function formatPriceDistance(target: number, currentPrice: number): string {
  const diff = target - currentPrice;
  const prefix = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${prefix}${formatPrice(Math.abs(diff))} (${formatPercent(distancePercent(target, currentPrice))})`;
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`;
}

function formatInputNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(roundScenarioPrice(value));
}

function roundScenarioPrice(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function midpoint(lower: number, upper: number): number {
  return (lower + upper) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("数字字段必须填写有效数值");
  return parsed;
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function formatPrice(value: number): string {
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

function formatStatus(status: StrategyRecord["status"]): string {
  const labels: Record<StrategyRecord["status"], string> = {
    draft: "草稿",
    ready: "就绪",
    running: "运行中",
    stopping: "停止中",
    stopped: "已停止",
    error: "异常"
  };
  return labels[status] ?? status;
}

function formatOrderSide(side: string): string {
  return side === "buy" ? "买入" : side === "sell" ? "卖出" : side;
}

function formatOrderIntent(intent: string): string {
  const labels: Record<string, string> = {
    entry: "入场",
    "take-profit": "止盈",
    "stop-loss": "止损",
    close: "平仓",
    replenish: "补单"
  };
  return labels[intent] ?? intent;
}

function formatWarning(warning: string): string {
  const labels: Record<string, string> = {
    "No entry orders would be placed at the current price.": "当前价格下不会放置入场挂单。",
    "Leverage is high; confirm liquidation risk before live start.": "杠杆较高，实盘启动前请确认爆仓风险。",
    "Current price is outside the grid range.": "当前价格在网格区间之外。"
  };
  return labels[warning] ?? warning;
}

function formatAuditType(type: string): string {
  const labels: Record<string, string> = {
    "strategy.created": "策略创建",
    "strategy.updated": "策略更新",
    "strategy.started": "策略启动",
    "strategy.stopped": "策略停止",
    "tradingview.range_updated": "TradingView 区间更新",
    "grid.replenished": "网格补单",
    "risk.take-profit": "全局止盈",
    "risk.stop-loss": "全局止损"
  };
  return labels[type] ?? type;
}

function formatAuditMessage(message: string): string {
  if (message === "Strategy draft created") return "策略草稿已创建";
  if (message === "Strategy grid parameters updated") return "策略网格参数已更新";
  if (message === "TradingView webhook updated grid range") return "TradingView webhook 已更新网格区间";
  if (message === "Strategy started live") return "策略已实盘启动";
  if (message === "Strategy started in dry-run") return "策略已模拟启动";
  if (message === "Placed replenishment order after fill") return "成交后已放置补单";
  if (message.startsWith("Strategy stopped:")) {
    return `策略已停止：${formatReason(message.slice("Strategy stopped:".length).trim())}`;
  }
  if (message.startsWith("Global take-profit triggered at ")) {
    return `触发全局止盈：${message.slice("Global take-profit triggered at ".length)}`;
  }
  if (message.startsWith("Global stop-loss triggered at ")) {
    return `触发全局止损：${message.slice("Global stop-loss triggered at ".length)}`;
  }
  return message;
}

function formatReason(reason: string): string {
  const labels: Record<string, string> = {
    manual: "手动",
    "emergency-stop": "紧急停止"
  };
  return labels[reason] ?? reason;
}

function marketToTradingViewSymbol(market: string): string {
  const normalized = market.trim().toUpperCase();
  const knownSymbols: Record<string, string> = {
    "BTC-PERP": "BINANCE:BTCUSDT",
    "ETH-PERP": "BINANCE:ETHUSDT",
    "SOL-PERP": "BINANCE:SOLUSDT",
    "BNB-PERP": "BINANCE:BNBUSDT",
    "XRP-PERP": "BINANCE:XRPUSDT",
    "DOGE-PERP": "BINANCE:DOGEUSDT"
  };
  if (knownSymbols[normalized]) return knownSymbols[normalized];
  if (normalized.includes(":")) return normalized;
  const base = normalized.replace(/[-_/]?(PERP|USDT|USD)$/u, "");
  return base ? `BINANCE:${base}USDT` : "BINANCE:BTCUSDT";
}

function buildTradingViewHtml(symbol: string): string {
  const config = JSON.stringify({
    autosize: true,
    symbol,
    interval: "60",
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",
    locale: "zh_CN",
    enable_publishing: false,
    allow_symbol_change: true,
    hide_side_toolbar: false,
    hide_top_toolbar: false,
    hide_legend: false,
    save_image: true,
    calendar: false,
    support_host: "https://www.tradingview.com"
  }).replaceAll("<", "\\u003c");

  const escapedSymbol = escapeHtml(symbol);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #0f1318;
      }

      .tradingview-widget-container {
        width: 100%;
        height: 100%;
      }

      .tradingview-widget-container__widget {
        width: 100%;
        height: calc(100% - 32px);
      }

      .tradingview-widget-copyright {
        display: flex;
        height: 32px;
        align-items: center;
        gap: 4px;
        padding: 0 10px;
        box-sizing: border-box;
        border-top: 1px solid #252b34;
        color: #8f99a8;
        font: 12px Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .tradingview-widget-copyright a {
        color: #8bb5ff;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <div class="tradingview-widget-copyright">
        <a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">${escapedSymbol} 图表</a>
        <span>由 TradingView 提供</span>
      </div>
      <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>
        ${config}
      </script>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function errorMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return localizeErrorMessage(message);
}

function localizeErrorMessage(message: string): string {
  const labels: Record<string, string> = {
    "Request failed": "请求失败",
    "Login required": "请先登录",
    "Unauthorized": "未授权",
    "unauthorized": "未授权",
    "Numeric fields must be valid numbers": "数字字段必须填写有效数值",
    "数字字段必须填写有效数值": "数字字段必须填写有效数值",
    'Live start requires confirmPhrase "START LIVE"': '实盘启动需要确认短语 "START LIVE"',
    "invalid TradingView webhook secret": "TradingView webhook 密钥无效",
    "API route not found": "API 路由不存在",
    "Request body must be an object": "请求内容必须是对象",
    "request body must be an object": "请求内容必须是对象",
    "market is required": "市场为必填项",
    "direction must be long or short": "方向必须是做多或做空",
    "lowerPrice must be positive": "区间下限必须大于 0",
    "upperPrice must be positive": "区间上限必须大于 0",
    "upperPrice must be greater than lowerPrice": "区间上限必须大于区间下限",
    "gridCount must be an integer >= 2": "网格数量必须是大于等于 2 的整数",
    "marginPerGrid must be positive": "单格保证金必须大于 0",
    "leverage must be >= 1": "杠杆必须大于等于 1",
    "takeProfitPrice must be positive": "止盈价必须大于 0",
    "stopLossPrice must be positive": "止损价必须大于 0",
    "currentPrice must be positive": "当前价格必须大于 0",
    "currentPrice must be inside the grid range for live start": "当前价格必须在网格区间内",
    "takeProfitPrice must be above currentPrice for long grids": "做多网格的止盈价必须高于当前价格",
    "stopLossPrice must be below currentPrice for long grids": "做多网格的止损价必须低于当前价格",
    "takeProfitPrice must be below currentPrice for short grids": "做空网格的止盈价必须低于当前价格",
    "stopLossPrice must be above currentPrice for short grids": "做空网格的止损价必须高于当前价格"
  };
  if (labels[message]) return labels[message];
  if (message === "running live strategies must be stopped before editing grid parameters") return "运行中的实盘策略必须先停止，才能修改网格参数";
  if (message.includes("; ")) return message.split("; ").map(localizeErrorMessage).join("；");
  if (message.includes("not found")) return message.replace("not found", "未找到");
  if (message.includes("must be a number")) return message.replace("must be a number", "必须是数字");
  if (message.includes("must be an integer")) return message.replace("must be an integer", "必须是整数");
  if (message.includes("is required")) return message.replace("is required", "为必填项");
  return message;
}
