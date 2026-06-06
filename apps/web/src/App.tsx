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

  const selectedStatusClass = selected ? `status status-${selected.status}` : "status";
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
    setSelected(status.strategy);
    setPreview(status.preview);
    setAudit(status.audit);
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
      const payload: CreateStrategyPayload = {
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
      const created = await createStrategy(payload);
      setSelected(created.strategy);
      setPreview(created.preview);
      await refreshStrategies(created.strategy.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      setPreview(await previewStrategy(selected.id, toNumber(form.currentPrice)));
      await selectStrategy(selected.id);
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
      const result = await startStrategy(selected.id, executionMode, confirmPhrase || undefined);
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
            Admin Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
          </label>
          {error ? <div className="error-line">{error}</div> : null}
          <button className="primary" disabled={busy} type="submit">
            <LogIn size={16} />
            Login
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
        <button className="ghost full" onClick={() => void refreshStrategies()} disabled={busy} title="Refresh">
          <RefreshCw size={16} />
          Refresh
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
            <div className={selectedStatusClass}>{selected?.status ?? "new"}</div>
            <h2>{selected?.name ?? "New Strategy"}</h2>
          </div>
          <div className="topbar-actions">
            <button className="ghost icon" onClick={handlePreview} disabled={!selected || busy} title="Preview">
              <RefreshCw size={17} />
            </button>
            <button className="primary icon-text" onClick={handleStart} disabled={!selected || busy} title="Start">
              <Play size={17} />
              Start
            </button>
            <button className="danger icon-text" onClick={() => void handleStop(true)} disabled={!selected || busy} title="Emergency Stop">
              <ShieldAlert size={17} />
              Stop
            </button>
          </div>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="grid-layout">
          <form className="panel config-panel" onSubmit={handleCreate}>
            <div className="panel-title">
              <h3>Config</h3>
              <button className="primary icon-text" disabled={busy} type="submit" title="Save">
                <Save size={16} />
                Save
              </button>
            </div>

            <div className="field-grid">
              <Field label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <Field label="Market" value={form.market} onChange={(value) => setForm({ ...form, market: value })} />
              <Field label="Product ID" value={form.productId} onChange={(value) => setForm({ ...form, productId: value })} />
              <label>
                Network
                <select value={form.network} onChange={(event) => setForm({ ...form, network: event.target.value as "mainnet" | "testnet" })}>
                  <option value="mainnet">Mainnet</option>
                  <option value="testnet">Testnet</option>
                </select>
              </label>
            </div>

            <div className="segmented">
              <button type="button" className={form.direction === "long" ? "selected" : ""} onClick={() => setForm({ ...form, direction: "long" })}>
                Long
              </button>
              <button type="button" className={form.direction === "short" ? "selected" : ""} onClick={() => setForm({ ...form, direction: "short" })}>
                Short
              </button>
            </div>

            <div className="field-grid numeric">
              <Field label="Lower" value={form.lowerPrice} onChange={(value) => setForm({ ...form, lowerPrice: value })} />
              <Field label="Upper" value={form.upperPrice} onChange={(value) => setForm({ ...form, upperPrice: value })} />
              <Field label="Grids" value={form.gridCount} onChange={(value) => setForm({ ...form, gridCount: value })} />
              <Field label="Margin/Grid" value={form.marginPerGrid} onChange={(value) => setForm({ ...form, marginPerGrid: value })} />
              <Field label="Leverage" value={form.leverage} onChange={(value) => setForm({ ...form, leverage: value })} />
              <Field label="Current" value={form.currentPrice} onChange={(value) => setForm({ ...form, currentPrice: value })} />
              <Field label="Take Profit" value={form.takeProfitPrice} onChange={(value) => setForm({ ...form, takeProfitPrice: value })} />
              <Field label="Stop Loss" value={form.stopLossPrice} onChange={(value) => setForm({ ...form, stopLossPrice: value })} />
            </div>

            <label className="check-row">
              <input type="checkbox" checked={form.postOnly} onChange={(event) => setForm({ ...form, postOnly: event.target.checked })} />
              Post-only
            </label>

            <div className="metric-strip">
              <Metric label="Total Margin" value={formatMoney(totalMargin)} />
              <Metric label="Max Notional" value={formatMoney(totalMargin * (Number(form.leverage) || 0))} />
            </div>
          </form>

          <section className="panel action-panel">
            <div className="panel-title">
              <h3>Execution</h3>
              <Wifi size={17} />
            </div>
            <div className="segmented">
              <button type="button" className={executionMode === "dry-run" ? "selected" : ""} onClick={() => setExecutionMode("dry-run")}>
                Dry-run
              </button>
              <button type="button" className={executionMode === "live" ? "selected" : ""} onClick={() => setExecutionMode("live")}>
                Live
              </button>
            </div>
            <label>
              Confirm
              <input value={confirmPhrase} onChange={(event) => setConfirmPhrase(event.target.value)} placeholder={executionMode === "live" ? "START LIVE" : ""} />
            </label>
            <div className="button-row">
              <button className="primary icon-text" disabled={!selected || busy} onClick={handleStart}>
                <Play size={16} />
                Start
              </button>
              <button className="ghost icon-text" disabled={!selected || busy} onClick={() => void handleStop(false)}>
                <Square size={16} />
                Stop
              </button>
            </div>
          </section>

          <section className="panel preview-panel">
            <div className="panel-title">
              <h3>Preview</h3>
              {preview?.risk.warnings.length ? <AlertTriangle size={17} className="warn-icon" /> : <Check size={17} className="ok-icon" />}
            </div>
            {preview ? (
              <>
                <div className="metric-strip">
                  <Metric label="Entries" value={String(preview.risk.activeEntryOrders)} />
                  <Metric label="Margin Risk" value={formatMoney(preview.risk.marginAtRisk)} />
                  <Metric label="Max Exposure" value={formatMoney(preview.risk.maxNotionalExposure)} />
                  <Metric label="Step" value={formatPrice(preview.risk.priceStep)} />
                </div>
                {preview.risk.warnings.length ? (
                  <div className="warning-list">
                    {preview.risk.warnings.map((warning) => (
                      <span key={warning}>{warning}</span>
                    ))}
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Side</th>
                        <th>Price</th>
                        <th>Amount</th>
                        <th>Notional</th>
                        <th>Intent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.orders.map((order) => (
                        <tr key={order.clientOrderId}>
                          <td className={order.side}>{order.side}</td>
                          <td>{formatPrice(order.price)}</td>
                          <td>{order.amountBase.toFixed(6)}</td>
                          <td>{formatMoney(order.notional)}</td>
                          <td>{order.intent}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="empty-state">No preview</div>
            )}
          </section>

          <section className="panel audit-panel">
            <div className="panel-title">
              <h3>Audit</h3>
            </div>
            <div className="audit-list">
              {audit.map((event) => (
                <div key={event.id} className={`audit-row ${event.level}`}>
                  <span>{event.type}</span>
                  <p>{event.message}</p>
                  <time>{new Date(event.createdAt).toLocaleString()}</time>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
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

function toNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Numeric fields must be valid numbers");
  return parsed;
}

function formatMoney(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
