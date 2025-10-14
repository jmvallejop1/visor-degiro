// Página de Dividendos: agrupa entradas que pertenecen al mismo pago de dividendo
// Estrategia de agrupación:
// - Detecta líneas relacionadas por: producto/isin + fechaValor (o fecha) + idOrden (si está)
// - Suma bruto (positivos con palabra "dividendo"), retención (negativos con "retención/withholding")
// - Gestiona divisas: se agrupa por evento y por divisa (moneda1 efectiva de la variación)

let allTransactions = [];
let groups = [];
let filteredGroups = [];
let baseCurrency = 'EUR';

// DOM
const dividendsBody = document.getElementById('dividendsBody');
const searchProduct = document.getElementById('searchProduct');
const filterMonth = document.getElementById('filterMonth');
const clearFiltersBtn = document.getElementById('clearFilters');
const toggleCurrencyTableBtn = document.getElementById('toggleCurrencyTable');
const toggleDividendsTableBtn = document.getElementById('toggleDividendsTable');
const toggleProductTableBtn = document.getElementById('toggleProductTable');
const groupCount = document.getElementById('groupCount');

searchProduct.addEventListener('input', applyFilters);
filterMonth.addEventListener('change', applyFilters);
clearFiltersBtn.addEventListener('click', () => {
  searchProduct.value = '';
  filterMonth.value = '';
  // currency filter removed
  filteredGroups = [...groups];
  render();
});
if (toggleCurrencyTableBtn) toggleCurrencyTableBtn.addEventListener('click', () => toggleSection('currencyTable', toggleCurrencyTableBtn));
if (toggleDividendsTableBtn) toggleDividendsTableBtn.addEventListener('click', () => toggleSection('dividendsTable', toggleDividendsTableBtn));
if (toggleProductTableBtn) toggleProductTableBtn.addEventListener('click', () => toggleSection('productTable', toggleProductTableBtn));

// Intentar cargar datos desde localStorage (persistidos por el dashboard)
tryLoadFromLocalStorage();

function tryLoadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('degiro.transactions.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        allTransactions = parsed;
        // Asegurar índices para trazabilidad en esta sesión
        allTransactions.forEach((t, i) => { if (t && typeof t === 'object') t._idx = i; });
        buildGroups();
  // currency filter removed
        filteredGroups = [...groups];
        render();
      }
    }
  } catch (e) {
    console.warn('No se pudo cargar localStorage:', e);
  }
}

function mapRow(row) {
  return {
    // fecha/fechaValor pueden venir como Date (si cellDates=true), como número (serial Excel)
    // o como string. Normalizamos a YYYY-MM-DD cuando sea posible.
    fecha: parseDateToISO(row[0]),
    hora: s(row[1]),
    fechaValor: parseDateToISO(row[2]),
    producto: s(row[3]),
    isin: s(row[4]),
    descripcion: s(row[5]),
    tipo: s(row[6]),
    moneda1: s(row[7]),
    variacion: parseAmount(row[8]),
    moneda2: s(row[9]),
    saldo: parseAmount(row[10]),
    idOrden: s(row[11])
  };
}

function mapValues(values) {
  const g = i => (values[i] ? values[i].replace(/"/g, '').trim() : '');
  return {
    fecha: parseDateToISO(g(0)),
    hora: g(1),
    fechaValor: parseDateToISO(g(2)),
    producto: g(3),
    isin: g(4),
    descripcion: g(5),
    tipo: g(6),
    moneda1: g(7),
    variacion: parseAmount(g(8) || '0'),
    moneda2: g(9),
    saldo: parseAmount(g(10) || '0'),
    idOrden: g(11)
  };
}

// Convierte distintos tipos de entrada de fecha a YYYY-MM-DD cuando es posible.
function parseDateToISO(v) {
  if (v === null || v === undefined || v === '') return '';
  // Si ya es un objeto Date
  if (v instanceof Date && !isNaN(v)) {
    return v.toISOString().slice(0, 10);
  }
  // Si es número: posible serial Excel
  if (typeof v === 'number') {
    const d = excelSerialToJSDate(v);
    if (d && !isNaN(d)) return d.toISOString().slice(0, 10);
    return String(v);
  }
  // Si viene como string, limpiamos y soportamos varios separadores y formatos comunes
  const s = String(v).trim();
  // Formatos esperados: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, YYYY-MM-DD, ISO full, etc.
  const ddmmyyyy = /^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/;
  const m1 = s.match(ddmmyyyy);
  if (m1) {
    const [, dd, mm, yyyy] = m1;
    return `${yyyy}-${mm}-${dd}`;
  }
  // Ya puede venir como YYYY-MM-DD or ISO timestamp
  const isoLike = /^(\d{4})-(\d{2})-(\d{2})/;
  const m2 = s.match(isoLike);
  if (m2) return m2[0];
  // Intentar Date parse como último recurso
  const parsed = new Date(s);
  if (!isNaN(parsed)) return parsed.toISOString().slice(0, 10);
  return s;
}

// Convierte serial Excel a Date JS. Basado en la convención que Excel usa (serial 25569 -> 1970-01-01)
function excelSerialToJSDate(serial) {
  // serial may include fractional days
  const utcDays = Math.floor(serial - 25569);
  const fractional = serial - Math.floor(serial);
  const utcValue = (serial - 25569) * 86400 * 1000;
  const date = new Date(Math.round(utcValue));
  return date;
}

function s(v) { return v ? String(v).trim() : ''; }

function parseAmount(str) {
  if (str === null || str === undefined || str === '') return 0;
  if (typeof str === 'number') return str;
  str = String(str).trim();
  return parseFloat(str.replace(/[.]/g, '').replace(',', '.').replace(/"/g, '')) || 0;
}

function formatAmount(n, opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 }) {
  return new Intl.NumberFormat('es-ES', opts).format(n);
}

function persistToLocalStorage() {
  try {
    localStorage.setItem('degiro.transactions.v1', JSON.stringify(allTransactions));
  } catch (_) {}
}

// Construir grupos de dividendos
function buildGroups() {
  // 1) Clasificadores: solo Dividendo y Retención del dividendo; ignorar resto
  const desc = t => (t.descripcion || '').toLowerCase();
  const isDividend = t => {
    const d = desc(t);
    return d.includes('dividendo') && !(d.includes('retención del dividendo') || d.includes('retencion del dividendo'));
  };
  const isWithholding = t => {
    const d = desc(t);
    return d.includes('retención del dividendo') || d.includes('retencion del dividendo');
  };

  // 2) Clave del evento: fecha valor + ISIN/producto + idOrden (si hay)
  const keyFor = t => {
    const fv = normalizeDateKey(t.fechaValor || t.fecha);
    const product = (t.producto || '').toUpperCase();
    const isin = (t.isin || '').toUpperCase();
    const order = (t.idOrden || '').toUpperCase();
    return `${fv}|${isin || product}|${order}`;
  };

  // 3) Única pasada: dividendos/retenciones -> construir grupos
  const groupMap = new Map();
  for (const t of allTransactions) {
    if (!(isDividend(t) || isWithholding(t))) continue;
    const key = keyFor(t);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        fecha: t.fecha,
        fechaValor: t.fechaValor,
        producto: t.producto,
        isin: t.isin,
        orderId: t.idOrden || '',
        lines: [],
        perCurrency: {}, // { USD: { gross, withholding } }
        gross: 0,
        withholding: 0,
        net: 0
      });
    }
    const g = groupMap.get(key);
    g.lines.push(t);

    const amount = t.variacion || 0;
    const ccy = (t.moneda1 || t.moneda2 || 'EUR').toUpperCase();
    if (!g.perCurrency[ccy]) g.perCurrency[ccy] = { gross: 0, withholding: 0 };

    if (isDividend(t)) {
      g.gross += Math.max(0, amount);
      g.perCurrency[ccy].gross += Math.max(0, amount);
    }
    if (isWithholding(t)) {
      const w = Math.abs(amount);
      g.withholding += w;
      g.perCurrency[ccy].withholding += w;
    }
  }
  // 4) Cálculo de netos
  for (const g of groupMap.values()) {
    if (g.gross === 0) {
      const netLike = g.lines.find(l => (l.descripcion || '').toLowerCase().includes('dividendo') && l.variacion > 0);
      g.net = netLike ? (netLike.variacion - g.withholding) : (g.gross - g.withholding);
    } else {
      g.net = g.gross - g.withholding;
    }

    // Si no se fijó por emparejamiento de FX, usar fallback en base
    if (!g.netBaseApprox || g.netBaseApprox === 0) {
      const baseMovs = g.lines.filter(l => {
        const c = (l.moneda1 || l.moneda2 || '').toUpperCase();
        if (c !== baseCurrency) return false;
        return isDividend(l) || isWithholding(l) || isFxIncome(l) || isFxWithdrawal(l);
      });
      const sumBase = baseMovs.reduce((acc, l) => acc + (l.variacion || 0), 0);
      if (sumBase !== 0) {
        g.netBaseApprox = sumBase;
      } else {
        const currencies = Object.keys(g.perCurrency);
        g.netBaseApprox = (currencies.length === 1 && currencies[0] === baseCurrency) ? g.net : 0;
      }
    }
  }

  groups = Array.from(groupMap.values()).sort((a, b) => compareDateKeyDesc(a, b));
}

function normalizeDateKey(d) {
  if (!d) return '';
  // Soporta formatos comunes: DD-MM-YYYY, YYYY-MM-DD, DD/MM/YYYY
  const s = String(d).trim();
  let dd, mm, yyyy;
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
    [dd, mm, yyyy] = s.split('-');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    [dd, mm, yyyy] = s.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s; // ya podría venir como ISO-like
}

function compareDateKeyDesc(a, b) {
  const ak = normalizeDateKey(a.fechaValor || a.fecha);
  const bk = normalizeDateKey(b.fechaValor || b.fecha);
  return ak < bk ? 1 : ak > bk ? -1 : 0;
}

function render() {
  dividendsBody.innerHTML = '';
  let sumGross = 0, sumWithholding = 0, sumNet = 0;

  filteredGroups.forEach(g => {
    sumGross += g.gross;
    sumWithholding += g.withholding;
    sumNet += g.net;

    const tr = document.createElement('tr');
    const netClass = (g.net || 0) >= 0 ? 'positive' : 'negative';
    
    // Obtener la divisa principal (la primera o la única)
    const currencies = Object.keys(g.perCurrency);
    const mainCurrency = currencies.length > 0 ? currencies[0] : 'EUR';
    
    // Si hay múltiples divisas, mostrar el formato compuesto
    let currencyDisplay = mainCurrency;
    if (currencies.length > 1) {
      currencyDisplay = currencies.join(', ');
    }
    
    tr.innerHTML = `
      <td>${g.fechaValor || g.fecha || '-'}</td>
      <td><strong>${g.producto || '-'}</strong></td>
      <td>${currencyDisplay}</td>
      <td class="amount positive">${formatAmount(g.gross)} ${mainCurrency}</td>
      <td class="amount negative">-${formatAmount(g.withholding)} ${mainCurrency}</td>
      <td class="amount ${netClass}">${formatAmount(g.net)} ${mainCurrency}</td>
    `;
    dividendsBody.appendChild(tr);
  });

  groupCount.textContent = `${filteredGroups.length} eventos`;

  renderCurrencySummary();
  renderProductSummary();
}

function applyFilters() {
  const term = (searchProduct.value || '').toLowerCase();
  const monthStr = filterMonth.value; // YYYY-MM
  // no currency filtering

  filteredGroups = groups.filter(g => {
    const matchesTerm = !term ||
      (g.producto || '').toLowerCase().includes(term) ||
      (g.isin || '').toLowerCase().includes(term);
    const matchesMonth = !monthStr || monthMatches(g.fechaValor || g.fecha, monthStr);
    return matchesTerm && matchesMonth;
  });
  render();
}

function monthMatches(dateStr, monthStr) {
  if (!dateStr) return false;
  // monthStr: YYYY-MM. Consideramos formatos DD-MM-YYYY, YYYY-MM-DD
  const norm = normalizeDateKey(dateStr); // YYYY-MM-DD preferido
  return norm.startsWith(monthStr);
}

// currency filter removed

function detectBaseCurrency(transactions) {
  // Heurística: moneda2 (saldo) más frecuente; si no, moneda1 más frecuente
  const count = {};
  for (const t of transactions) {
    const c = (t.moneda2 || t.moneda1 || '').toUpperCase();
    if (!c) continue;
    count[c] = (count[c] || 0) + 1;
  }
  let best = null, max = 0;
  for (const [c, n] of Object.entries(count)) {
    if (n > max) { max = n; best = c; }
  }
  return best;
}

// Resumen por divisa
function buildCurrencySummary() {
  const acc = {}; // { EUR: {gross, withh} }
  for (const g of groups) {
    for (const [ccy, v] of Object.entries(g.perCurrency)) {
      if (!acc[ccy]) acc[ccy] = { gross: 0, withh: 0 };
      acc[ccy].gross += (v.gross || 0);
      acc[ccy].withh += (v.withholding || 0);
    }
  }
  return Object.entries(acc).map(([ccy, v]) => ({
    ccy,
    gross: v.gross,
    withh: v.withh,
    net: v.gross - v.withh
  })).sort((a, b) => a.ccy.localeCompare(b.ccy));
}

function renderCurrencySummary() {
  const tbody = document.getElementById('currencyBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = buildCurrencySummary();
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const netClass = r.net >= 0 ? 'positive' : 'negative';
    tr.innerHTML = `
      <td>${r.ccy}</td>
      <td class="amount positive">${formatAmount(r.gross)} ${r.ccy}</td>
      <td class="amount negative">-${formatAmount(r.withh)} ${r.ccy}</td>
      <td class="amount ${netClass}">${formatAmount(r.net)} ${r.ccy}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Resumen por producto
function buildProductSummary() {
  // { key: { producto, isin, events, ccy, gross, withh, net } }
  // Ahora trabaja con filteredGroups en lugar de groups
  const acc = new Map();
  for (const g of filteredGroups) {
    const key = `${(g.isin || '').toUpperCase()}|${(g.producto || '').toUpperCase()}`;
    if (!acc.has(key)) {
      acc.set(key, {
        producto: g.producto || '',
        isin: g.isin || '',
        events: 0,
        ccy: null,
        gross: 0,
        withh: 0,
        net: 0
      });
    }
    const item = acc.get(key);
    item.events += 1;
    // Como cada producto paga siempre en la misma divisa, elegimos la primera encontrada
    if (!item.ccy) {
      const ccy = Object.keys(g.perCurrency)[0] || null;
      item.ccy = ccy;
    }
    // Agregamos en la (única) divisa del producto
    if (item.ccy) {
      const v = g.perCurrency[item.ccy] || { gross: 0, withholding: 0 };
      item.gross += (v.gross || 0);
      item.withh += (v.withholding || 0);
      item.net += ((v.gross || 0) - (v.withholding || 0));
    } else {
      // Fallback: si no detecta ccy, cae al neto del evento
      item.net += g.net;
    }
  }
  return Array.from(acc.values()).sort((a, b) => (b.net - a.net));
}

function renderProductSummary() {
  const tbody = document.getElementById('productBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = buildProductSummary();
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const netClass = r.net >= 0 ? 'positive' : 'negative';
    tr.innerHTML = `
      <td>${r.producto || '-'}</td>
      <td><small>${r.isin || '-'}</small></td>
      <td>${r.events}</td>
      <td>${r.ccy || '-'}</td>
      <td class="amount positive">${formatAmount(r.gross)} ${r.ccy || ''}</td>
      <td class="amount negative">-${formatAmount(r.withh)} ${r.ccy || ''}</td>
      <td class="amount ${netClass}">${formatAmount(r.net)} ${r.ccy || ''}</td>
    `;
    tbody.appendChild(tr);
  });
}

function toggleSection(tableId, btn) {
  const table = document.getElementById(tableId);
  if (!table || !btn) return;
  const wrapper = table.closest('.table-wrapper');
  const isHidden = wrapper.style.display === 'none';
  wrapper.style.display = isHidden ? '' : 'none';
  btn.setAttribute('aria-expanded', String(isHidden));
  btn.textContent = isHidden ? '▼' : '▼';
}
