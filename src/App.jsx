import React, { useEffect, useMemo, useState } from "react";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

/***********************************
 * Dynamic Report Builder (UI Revamp + Calculated Fields)
 * - Preserves full functionality: RAW + CALCULATED (DATE_DIFF, ARITH, CONCAT)
 * - Adds polished UI (Tailwind), sticky headers, nicer buttons (no external icon pkg)
 ***********************************/

/************ Utilities ************/
const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
const fmtDate = (v) => {
  if (!v) return "";
  const d = toDate(v);
  if (!d || isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
};
const dateDiff = (a, b, unit = "days") => {
  const d1 = toDate(a);
  const d2 = toDate(b);
  if (!d1 || !d2 || isNaN(d1) || isNaN(d2)) return null;
  const ms = d2 - d1;
  if (unit === "hours") return Math.round(ms / (1000 * 60 * 60));
  return Math.round(ms / (1000 * 60 * 60 * 24));
};

/************ Demo dataset ************/
const BASE_FIELDS = [
  { key: "orderId", label: "Order ID", dataType: "string", source: "system" },
  { key: "buyerName", label: "Buyer Name", dataType: "string", source: "system" },
  { key: "orderDate", label: "Order Date", dataType: "date", source: "system" },
  { key: "dispatchDate", label: "Dispatch Date", dataType: "date", source: "system" },
  { key: "leadTimeDays", label: "Lead Time (days)", dataType: "number", source: "system" },
  { key: "status", label: "Status", dataType: "string", source: "system" },
  { key: "awbNumber", label: "AWB Number", dataType: "string", source: "system" },
  { key: "exFactory", label: "Ex-Factory", dataType: "date", source: "system" },
  { key: "style", label: "Style", dataType: "string", source: "system" },
];

const BUYERS = ["Zara", "Ann Taylor", "H&M", "Uniqlo", "Gap", "Target"];
const STATUSES = ["Open", "In Production", "Ready", "Dispatched", "Closed"];
const randFrom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const makeDummyOrders = (n = 28) => {
  const base = new Date();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const orderDate = addDays(base, -Math.floor(Math.random() * 60));
    const lead = Math.floor(Math.random() * 30) + 1;
    const dispatchDate = addDays(orderDate, lead);
    const exFactory = addDays(orderDate, Math.floor(Math.random() * 20));
    rows.push({
      orderId: `ORD-${String(1000 + i)}`,
      buyerName: randFrom(BUYERS),
      orderDate: fmtDate(orderDate),
      dispatchDate: fmtDate(dispatchDate),
      leadTimeDays: lead,
      status: randFrom(STATUSES),
      awbNumber: Math.random() > 0.6 ? `AWB${100000 + i}` : "",
      exFactory: fmtDate(exFactory),
      style: `STY-${String(10 + (i % 7))}`,
    });
  }
  return rows;
};

/************ Local storage ************/
const STORAGE_KEY = "report_builder_user_fields_v2";
const loadUserFields = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); } catch { return []; }
};
const saveUserFields = (fields) => localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));

/************ Calculated engine ************/
const computeValue = (row, def) => {
  if (def.kind !== "calculated") return undefined;
  const { calc } = def;
  switch (calc.op) {
    case "DATE_DIFF":
      return dateDiff(row[calc.fromField], row[calc.toField], calc.unit || "days");
    case "ARITH": {
      const val = (node) => node?.type === "field" ? Number(row[node.value]) : Number(node?.value);
      const left = val(calc.left);
      const right = val(calc.right);
      if ([left, right].some((v) => v === null || Number.isNaN(v))) return null;
      switch (calc.operator) {
        case "+": return left + right;
        case "-": return left - right;
        case "*": return left * right;
        case "/": return right === 0 ? null : left / right;
        default: return null;
      }
    }
    case "CONCAT":
      return (calc.parts || []).map((p) => (p.type === "field" ? (row[p.value] ?? "") : (p.value ?? ""))).join("");
    default:
      return undefined;
  }
};

const buildPreviewRows = (rows, fieldsAll) => rows.map((r) => {
  const out = { ...r };
  for (const f of fieldsAll) {
    if (f.kind === "calculated") out[f.key] = computeValue(r, f);
    else if (f.kind === "raw" && !(f.key in out)) out[f.key] = f.defaultValue ?? null;
  }
  return out;
});

/************ Small UI helpers ************/
const Section = ({ title, children, right }) => (
  <div className="bg-white rounded-2xl shadow-md p-5 border border-gray-200 flex flex-col">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
      {right}
    </div>
    <div className="flex-1">{children}</div>
  </div>
);

const Pill = ({ children, color = "gray" }) => (
  <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-${color}-100 text-${color}-700 border border-${color}-200`}>{children}</span>
);

const Label = ({ children }) => (
  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">{children}</label>
);

const TextInput = (props) => (
  <input {...props} className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition ${props.className||""}`} />
);

const Select = (props) => (
  <select {...props} className={`w-full border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition ${props.className||""}`} />
);

const IconButton = ({ onClick, children, className }) => (
  <button onClick={onClick} className={`px-2 py-1 rounded-md border hover:bg-gray-50 ${className||""}`}>{children}</button>
);

/************ Main Component ************/
export default function App() {
  const [orders] = useState(() => makeDummyOrders());
  const [userFields, setUserFields] = useState(loadUserFields());
  const [selectedKeys, setSelectedKeys] = useState(() => BASE_FIELDS.map((f) => f.key));

  // Form for creating fields
  const [form, setForm] = useState({
    key: "",
    label: "",
    kind: "calculated", // "raw" | "calculated"
    dataType: "string", // string | number | date
    defaultValue: "",
    calc: {
      op: "DATE_DIFF", // DATE_DIFF | ARITH | CONCAT
      fromField: "orderDate",
      toField: "dispatchDate",
      unit: "days",
      left: { type: "field", value: "leadTimeDays" },
      operator: "+",
      right: { type: "const", value: 0 },
      parts: [ { type: "field", value: "buyerName" }, { type: "const", value: " - " }, { type: "field", value: "style" } ],
    },
  });

  const allFields = useMemo(() => [
    ...BASE_FIELDS.map((f) => ({ ...f, kind: "raw" })),
    ...userFields,
  ], [userFields]);

  const previewRows = useMemo(() => buildPreviewRows(orders, allFields), [orders, allFields]);
  const visibleFields = useMemo(() => allFields.filter((f) => selectedKeys.includes(f.key)), [allFields, selectedKeys]);

  useEffect(() => { saveUserFields(userFields); }, [userFields]);

  const toggleSelect = (key) => setSelectedKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  const handleCreate = () => {
    if (!form.key || !form.label) return alert("Please provide key and label");
    if (allFields.find((f) => f.key === form.key)) return alert("Field key already exists");
    const cleaned = JSON.parse(JSON.stringify(form));
    setUserFields((prev) => [...prev, { ...cleaned, source: "user" }]);
    setForm((f) => ({
      ...f,
      key: "",
      label: "",
    }));
  };

  const removeUserField = (key) => {
    if (!window.confirm(`Delete field ${key}?`)) return;
    setUserFields((prev) => prev.filter((f) => f.key !== key));
    setSelectedKeys((prev) => prev.filter((k) => k !== key));
  };

  /************ Export ************/
  const exportRows = useMemo(() => previewRows.map((r) => Object.fromEntries(visibleFields.map((f) => [f.label || f.key, r[f.key] ?? ""]))), [previewRows, visibleFields]);

  const exportCSV = () => {
    const headers = Object.keys(exportRows[0] || {});
    const csv = [headers.join(",")].concat(exportRows.map((row) => headers.map((h) => JSON.stringify(row[h] ?? "")).join(","))).join("\n");
    saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `orders_${Date.now()}.csv`);
  };

  const exportXLSX = () => {
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([out], { type: "application/octet-stream" }), `orders_${Date.now()}.xlsx`);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape" });
    doc.text("Orders Report", 14, 12);
    const head = [visibleFields.map((f) => f.label || f.key)];
    const body = previewRows.map((r) => visibleFields.map((f) => String(r[f.key] ?? "")));
    doc.autoTable({ head, body, startY: 16, styles: { fontSize: 8 } });
    doc.save(`orders_${Date.now()}.pdf`);
  };

  /************ Formula summary ************/
  const formulaSummary = useMemo(() => {
    if (form.kind !== "calculated") return "Raw field";
    const c = form.calc || {};
    if (c.op === "DATE_DIFF") {
      return `DATEDIFF(${c.unit || "days"}, ${c.fromField || "?"}, ${c.toField || "?"})`;
    }
    if (c.op === "ARITH") {
      const fmt = (n) => n?.type === "field" ? `FIELD:${n.value || "?"}` : (typeof n?.value === "number" ? n.value : Number(n?.value||0));
      return `ARITH(${fmt(c.left)} ${c.operator || "+"} ${fmt(c.right)})`;
    }
    if (c.op === "CONCAT") {
      return `CONCAT(${(c.parts||[]).map((p) => p.type === "field" ? `FIELD:${p.value}` : JSON.stringify(p.value||"" )).join(", ")})`;
    }
    return "Calculated";
  }, [form]);

  /************ Sub-forms for calculated ops ************/
  const FieldSelect = ({ value, onChange, includeUser = true }) => (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {[...BASE_FIELDS, ...(includeUser ? userFields : [])].map((f) => (
        <option key={f.key} value={f.key}>{f.label}</option>
      ))}
    </Select>
  );

  const ConcatPartEditor = ({ part, onChange, onRemove }) => (
    <div className="flex items-center gap-2">
      <Select value={part.type} onChange={(e) => onChange({ ...part, type: e.target.value })} className="w-28">
        <option value="field">Field</option>
        <option value="const">Text</option>
      </Select>
      {part.type === "field" ? (
        <FieldSelect value={part.value || BASE_FIELDS[0].key} onChange={(v) => onChange({ ...part, value: v })} />
      ) : (
        <TextInput value={part.value || ""} onChange={(e) => onChange({ ...part, value: e.target.value })} placeholder="Text" />
      )}
      <IconButton onClick={onRemove} className="text-red-600 border-red-200">🗑</IconButton>
    </div>
  );

  /************ Render ************/
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Dynamic Report Builder</h1>
          <div className="flex gap-2 text-sm text-gray-500"><span>Orders dataset</span><span>•</span><span>{BASE_FIELDS.length + userFields.length} fields</span></div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Create Field */}
          <Section title="Create a New Field" right={<Pill color="blue">Custom</Pill>}>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Key</Label>
                  <TextInput placeholder="unique_key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>Label</Label>
                  <TextInput placeholder="Display label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Type</Label>
                  <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                    <option value="raw">Raw</option>
                    <option value="calculated">Calculated</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Data Type</Label>
                  <Select value={form.dataType} onChange={(e) => setForm({ ...form, dataType: e.target.value })}>
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Default (for Raw)</Label>
                  <TextInput value={form.defaultValue} onChange={(e) => setForm({ ...form, defaultValue: e.target.value })} placeholder="optional" />
                </div>
              </div>

              {form.kind === "calculated" && (
                <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
                  <div className="space-y-1">
                    <Label>Operation</Label>
                    <Select value={form.calc.op} onChange={(e) => setForm({ ...form, calc: { ...form.calc, op: e.target.value } })}>
                      <option value="DATE_DIFF">Date Difference</option>
                      <option value="ARITH">Arithmetic</option>
                      <option value="CONCAT">Concatenate</option>
                    </Select>
                  </div>

                  {form.calc.op === "DATE_DIFF" && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>From Field</Label>
                        <FieldSelect value={form.calc.fromField} onChange={(v) => setForm({ ...form, calc: { ...form.calc, fromField: v } })} />
                      </div>
                      <div className="space-y-1">
                        <Label>To Field</Label>
                        <FieldSelect value={form.calc.toField} onChange={(v) => setForm({ ...form, calc: { ...form.calc, toField: v } })} />
                      </div>
                      <div className="space-y-1">
                        <Label>Unit</Label>
                        <Select value={form.calc.unit} onChange={(e) => setForm({ ...form, calc: { ...form.calc, unit: e.target.value } })}>
                          <option value="days">Days</option>
                          <option value="hours">Hours</option>
                        </Select>
                      </div>
                    </div>
                  )}

                  {form.calc.op === "ARITH" && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <Label>Left Operand</Label>
                        <div className="flex gap-2">
                          <Select value={form.calc.left?.type} onChange={(e) => setForm({ ...form, calc: { ...form.calc, left: { ...form.calc.left, type: e.target.value } } })} className="w-28">
                            <option value="field">Field</option>
                            <option value="const">Const</option>
                          </Select>
                          {form.calc.left?.type === "field" ? (
                            <FieldSelect value={form.calc.left?.value} onChange={(v) => setForm({ ...form, calc: { ...form.calc, left: { type: "field", value: v } } })} />
                          ) : (
                            <TextInput type="number" value={form.calc.left?.value ?? 0} onChange={(e) => setForm({ ...form, calc: { ...form.calc, left: { type: "const", value: Number(e.target.value) } } })} />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>Operator</Label>
                        <Select value={form.calc.operator} onChange={(e) => setForm({ ...form, calc: { ...form.calc, operator: e.target.value } })}>
                          <option value="+">+</option>
                          <option value="-">-</option>
                          <option value="*">*</option>
                          <option value="/">/</option>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Right Operand</Label>
                        <div className="flex gap-2">
                          <Select value={form.calc.right?.type} onChange={(e) => setForm({ ...form, calc: { ...form.calc, right: { ...form.calc.right, type: e.target.value } } })} className="w-28">
                            <option value="field">Field</option>
                            <option value="const">Const</option>
                          </Select>
                          {form.calc.right?.type === "field" ? (
                            <FieldSelect value={form.calc.right?.value} onChange={(v) => setForm({ ...form, calc: { ...form.calc, right: { type: "field", value: v } } })} />
                          ) : (
                            <TextInput type="number" value={form.calc.right?.value ?? 0} onChange={(e) => setForm({ ...form, calc: { ...form.calc, right: { type: "const", value: Number(e.target.value) } } })} />
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {form.calc.op === "CONCAT" && (
                    <div className="space-y-2">
                      <div className="flex flex-col gap-2">
                        {(form.calc.parts || []).map((p, i) => (
                          <ConcatPartEditor key={i} part={p}
                            onChange={(np) => setForm({ ...form, calc: { ...form.calc, parts: form.calc.parts.map((x, idx) => idx === i ? np : x) } })}
                            onRemove={() => setForm({ ...form, calc: { ...form.calc, parts: form.calc.parts.filter((_, idx) => idx !== i) } })}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <IconButton onClick={() => setForm({ ...form, calc: { ...form.calc, parts: [...(form.calc.parts||[]), { type: "field", value: BASE_FIELDS[0].key }] } })}>
                          ➕ Add Field
                        </IconButton>
                        <IconButton onClick={() => setForm({ ...form, calc: { ...form.calc, parts: [...(form.calc.parts||[]), { type: "const", value: " " }] } })}>
                          🔤 Add Text
                        </IconButton>
                      </div>
                    </div>
                  )}

                  <div className="text-xs text-blue-700 bg-blue-100/70 border border-blue-200 rounded-md px-2 py-1">Formula: {formulaSummary}</div>
                </div>
              )}

              <button onClick={handleCreate} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow-md">➕ Add Field</button>
            </div>
          </Section>

          {/* Fields list */}
          <Section title="Fields in Dataset" right={<Pill>{allFields.length}</Pill>}>
            <div className="max-h-[420px] overflow-auto divide-y">
              {allFields.map((f) => (
                <div key={f.key} className="py-2 flex items-center justify-between gap-2 hover:bg-gray-50 px-2 rounded-lg transition">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedKeys.includes(f.key)} onChange={() => toggleSelect(f.key)} />
                    <span className="text-sm font-medium">{f.label}</span>
                    {f.kind === "calculated" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-200">calc</span>}
                  </label>
                  {f.source === "user" && (
                    <button onClick={() => removeUserField(f.key)} className="px-2 py-1 text-xs rounded-md bg-red-100 text-red-600 hover:bg-red-200 transition">🗑 Delete</button>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {/* Export */}
          <Section title="Export & Actions" right={<Pill color="green">Ready</Pill>}>
            <div className="flex flex-col gap-3">
              <button onClick={exportCSV} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 transition shadow">📄 CSV</button>
              <button onClick={exportXLSX} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 transition shadow">📊 Excel</button>
              <button onClick={exportPDF} className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition shadow">📕 PDF</button>
            </div>
          </Section>
        </div>

        {/* Preview */}
        <Section title="Preview (Live)">
          <div className="overflow-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-200 sticky top-0">
                  {visibleFields.map((f) => (
                    <th key={f.key} className="text-left px-3 py-2 font-semibold whitespace-nowrap">{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, idx) => (
                  <tr key={idx} className="odd:bg-white even:bg-gray-50 hover:bg-blue-50 transition">
                    {visibleFields.map((f) => (
                      <td key={f.key} className="px-3 py-2 whitespace-nowrap">{f.dataType === "date" ? fmtDate(row[f.key]) : String(row[f.key] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}