// Página de Dividendos: agrupa entradas que pertenecen al mismo pago de dividendo
// Estrategia de agrupación:
// - Detecta líneas relacionadas por: producto/isin + fechaValor (o fecha) + idOrden (si está)
// - Suma bruto (positivos con palabra "dividendo"), retención (negativos con "retención/withholding")
// - Gestiona divisas: se agrupa por evento y por divisa (moneda1 efectiva de la variación)

let allTransactions = [];
let groups = [];
let filteredGroups = [];
let baseCurrency = 'EUR';
let holdingsTimeline = new Map();
let productYearMap = new Map();
let globalDividendTotals = { base: 0, perCurrency: {} };
let productYearBarChart = null;
let annualYieldChart = null;

// DOM
const searchProduct = document.getElementById('searchProduct');
const filterMonth = document.getElementById('filterMonth');
const clearFiltersBtn = document.getElementById('clearFilters');
const toggleCurrencyTableBtn = document.getElementById('toggleCurrencyTable');
const toggleProductTableBtn = document.getElementById('toggleProductTable');
const productYearSelect = document.getElementById('productYearSelect');
const productYearBody = document.getElementById('productYearBody');
const productTotalNetEl = document.getElementById('productTotalNet');
const productYearsCountEl = document.getElementById('productYearsCount');
const productCurrentSharesEl = document.getElementById('productCurrentShares');
const globalTotalNetEl = document.getElementById('globalTotalNet');
const globalTotalsByCurrencyEl = document.getElementById('globalTotalsByCurrency');
const annualYieldCanvas = document.getElementById('annualYieldChart');
const annualYieldYearSelect = document.getElementById('annualYieldYearSelect');
const annualYieldEmptyEl = document.getElementById('annualYieldEmpty');

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
if (toggleProductTableBtn) toggleProductTableBtn.addEventListener('click', () => toggleSection('productTable', toggleProductTableBtn));
if (productYearSelect) productYearSelect.addEventListener('change', (event) => {
  renderProductYearDetails(event.target.value);
});
if (annualYieldYearSelect) annualYieldYearSelect.addEventListener('change', (event) => {
  renderAnnualYieldComparison(productYearMap, event.target.value);
});

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
        allTransactions.forEach(normalizeTransactionCurrency);
    try { localStorage.setItem('degiro.transactions.v1', JSON.stringify(allTransactions)); } catch (_) {}
        buildGroups();
        holdingsTimeline = buildHoldingsTimeline(allTransactions);
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

function formatNumber(n, opts = { minimumFractionDigits: 0, maximumFractionDigits: 2 }) {
  return new Intl.NumberFormat('es-ES', opts).format(n);
}

function formatPercent(value, fractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return `0.${'0'.repeat(fractionDigits)}%`;
  return `${Number(value).toFixed(fractionDigits)}%`;
}

function formatAmountWithCurrency(value, currency) {
  const formatted = formatAmount(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

function normalizeCurrencyCode(code) {
  const upper = (code || '').toUpperCase();
  if (!upper) return '';
  if (upper === 'GBX') return 'GBP';
  return upper;
}

function normalizeCurrencyAmount(code, amount) {
  const normalizedCode = normalizeCurrencyCode(code);
  if ((code || '').toUpperCase() === 'GBX') {
    const numeric = typeof amount === 'number' ? amount : parseFloat(amount);
    const converted = !Number.isNaN(numeric) ? numeric / 100 : amount;
    return { code: normalizedCode, amount: converted };
  }
  return { code: normalizedCode, amount };
}

function normalizeTransactionCurrency(transaction) {
  if (!transaction || typeof transaction !== 'object') return;

  if ('moneda1' in transaction) {
    const result = normalizeCurrencyAmount(transaction.moneda1, transaction.variacion);
    transaction.moneda1 = result.code;
    if (typeof result.amount === 'number' && !Number.isNaN(result.amount)) {
      transaction.variacion = result.amount;
    }
  }

  if ('moneda2' in transaction) {
    const result = normalizeCurrencyAmount(transaction.moneda2, transaction.saldo);
    transaction.moneda2 = result.code;
    if (typeof result.amount === 'number' && !Number.isNaN(result.amount)) {
      transaction.saldo = result.amount;
    }
  }
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
    const ccy = normalizeCurrencyCode(t.moneda1 || t.moneda2 || 'EUR');
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
        const c = normalizeCurrencyCode(l.moneda1 || l.moneda2 || '');
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
  renderCurrencySummary();
  renderProductSummary();
  refreshYearlyAnalysis(groups);
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
    const c = normalizeCurrencyCode(t.moneda2 || t.moneda1 || '');
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
  const acc = new Map();
  for (const g of filteredGroups) {
    if (!g) continue;
    const key = buildProductKey(g.isin, g.producto);
    if (!key || key === '|') continue;

    if (!acc.has(key)) {
      acc.set(key, {
        key,
        producto: g.producto || '',
        isin: g.isin || '',
        eventsCount: 0,
        ccy: null,
        gross: 0,
        withh: 0,
        net: 0,
        events: []
      });
    }

  const item = acc.get(key);

    const currencies = Object.keys(g.perCurrency || {});
    if (!item.ccy) {
      item.ccy = currencies.length ? currencies[0] : null;
    }

    const activeCurrency = item.ccy || currencies[0] || baseCurrency;
    const values = g.perCurrency && activeCurrency && g.perCurrency[activeCurrency]
      ? g.perCurrency[activeCurrency]
      : { gross: g.gross || 0, withholding: g.withholding || 0 };

    const gross = values.gross || 0;
    const withh = values.withholding || 0;
    const net = gross - withh;

    item.gross += gross;
    item.withh += withh;
    item.net += net;

    const eventDate = g.fechaValor || g.fecha || '';
    const eventDateKey = normalizeDateKey(eventDate) || '';
    const eventDateObj = toDateTime(eventDate || g.fecha, '', true);
    const costInfo = getCostOnDate(key, eventDateObj);

    item.events.push({
      date: eventDate || '-',
      dateKey: eventDateKey,
      gross,
      withholding: withh,
      net,
      currency: activeCurrency,
      cost: costInfo.cost || 0,
      costCurrency: costInfo.currency || activeCurrency
    });
  }

  const rows = Array.from(acc.values());
  rows.forEach((item) => {
    item.ccy = item.ccy || (item.events[0] ? item.events[0].currency : '') || baseCurrency;
    item.eventsCount = item.events.length;
    item.events.sort((a, b) => {
      const ak = a.dateKey || '';
      const bk = b.dateKey || '';
      if (ak === bk) return 0;
      return ak < bk ? 1 : -1; // más recientes primero
    });
  });

  return rows.sort((a, b) => (b.net - a.net));
}

function renderProductSummary() {
  const tbody = document.getElementById('productBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const rows = buildProductSummary();
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No hay dividendos para mostrar con los filtros actuales.</td></tr>';
    return;
  }

  rows.forEach((product, index) => {
    const tr = document.createElement('tr');
    tr.classList.add('product-row');
    const rowKey = `${product.key || 'product'}-${index}`;
    tr.dataset.key = rowKey;

    const netClass = product.net >= 0 ? 'positive' : 'negative';
    const currency = product.ccy || '';

    tr.innerHTML = `
      <td class="expand-cell"><span class="expand-icon">▶</span></td>
      <td>${product.producto || '-'}</td>
      <td><small>${product.isin || '-'}</small></td>
      <td>${product.eventsCount}</td>
      <td>${currency || '-'}</td>
      <td class="amount positive">${formatAmountWithCurrency(product.gross, currency)}</td>
      <td class="amount negative">${formatAmountWithCurrency(-product.withh, currency)}</td>
      <td class="amount ${netClass}">${formatAmountWithCurrency(product.net, currency)}</td>
    `;

    tr.addEventListener('click', () => {
      const existing = tbody.querySelector(`tr[data-details-for="${rowKey}"]`);
      const icon = tr.querySelector('.expand-icon');
      if (existing) {
        existing.remove();
        if (icon) icon.style.transform = 'rotate(0deg)';
        return;
      }

      const detailsRow = createProductDetailsRow(rowKey, product);
      tr.insertAdjacentElement('afterend', detailsRow);
      if (icon) icon.style.transform = 'rotate(90deg)';
    });

    tbody.appendChild(tr);
  });
}

function createProductDetailsRow(rowKey, product) {
  const detailsTr = document.createElement('tr');
  detailsTr.classList.add('details-row');
  detailsTr.dataset.detailsFor = rowKey;

  const events = product.events || [];
  let innerHTML = '';

  if (!events.length) {
    innerHTML = '<div class="empty-state" style="padding: 1rem 0;">Sin eventos registrados para este producto.</div>';
  } else {
    const rows = events.map((event) => {
      const netClass = event.net >= 0 ? 'positive' : 'negative';
      const costDisplay = event.cost > 0 ? formatAmountWithCurrency(event.cost, event.costCurrency || event.currency) : '-';
      const grossDisplay = formatAmountWithCurrency(event.gross, event.currency);
      const withhDisplay = formatAmountWithCurrency(-event.withholding, event.currency);
      const netDisplay = formatAmountWithCurrency(event.net, event.currency);

      return `
        <tr>
          <td>${event.date}</td>
          <td class="amount">${costDisplay}</td>
          <td class="amount positive">${grossDisplay}</td>
          <td class="amount negative">${withhDisplay}</td>
          <td class="amount ${netClass}">${netDisplay}</td>
        </tr>
      `;
    }).join('');

    innerHTML = `
      <div class="details-wrapper">
        <table class="inner-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Coste posiciones</th>
              <th>Dividendo bruto</th>
              <th>Retención</th>
              <th>Dividendo neto</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  detailsTr.innerHTML = `<td colspan="8">${innerHTML}</td>`;
  return detailsTr;
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

function refreshYearlyAnalysis(sourceGroups = groups) {
  if (!productYearSelect || !productYearBody) return;
  const currentSelection = productYearSelect.value || '';
  const { map, globalTotals } = buildYearlyDividends(sourceGroups || []);
  productYearMap = map;
  globalDividendTotals = globalTotals;
  populateProductSelector(currentSelection);
  renderGlobalTotals();
  renderProductYearDetails(productYearSelect.value || '');
  const selectedYear = updateAnnualYieldYearOptions(productYearMap);
  renderAnnualYieldComparison(productYearMap, selectedYear);
}

function buildYearlyDividends(sourceGroups = []) {
  const map = new Map();
  const totalsByCurrency = {};
  let totalBase = 0;

  for (const g of sourceGroups) {
    if (!g) continue;
    const key = buildProductKey(g.isin, g.producto);
    if (!key || key === '|') continue;

    const currencies = Object.keys(g.perCurrency || {});
    const mainCurrency = currencies.length ? currencies[0] : baseCurrency;
    const currencyValues = g.perCurrency && g.perCurrency[mainCurrency] ? g.perCurrency[mainCurrency] : null;
    const gross = currencyValues ? (currencyValues.gross || 0) : (g.gross || 0);
    const withholding = currencyValues ? (currencyValues.withholding || 0) : (g.withholding || 0);
    const net = gross - withholding;
    const netBase = typeof g.netBaseApprox === 'number' ? g.netBaseApprox : 0;

    const dateKey = normalizeDateKey(g.fechaValor || g.fecha);
    const year = dateKey ? dateKey.slice(0, 4) : '';
    if (!year) continue;

    if (!map.has(key)) {
      map.set(key, {
        key,
        product: g.producto || '',
        isin: g.isin || '',
        currency: mainCurrency,
        costCurrency: '',
        totalNet: 0,
        totalNetBase: 0,
        years: new Map()
      });
    }

    const productEntry = map.get(key);
    if (!productEntry.currency && mainCurrency) {
      productEntry.currency = mainCurrency;
    }

    if (!productEntry.years.has(year)) {
      productEntry.years.set(year, { net: 0, gross: 0, withholding: 0, netBase: 0, events: 0, shareSamples: [], costSamples: [] });
    }

    const yearEntry = productEntry.years.get(year);
    yearEntry.net += net;
    yearEntry.gross += gross;
    yearEntry.withholding += withholding;
    yearEntry.netBase += netBase;
    yearEntry.events += 1;

    const eventDate = toDateTime(g.fechaValor || g.fecha, '', true);
    const shares = getSharesOnDate(key, eventDate);
    yearEntry.shareSamples.push(shares);

    const costInfo = getCostOnDate(key, eventDate);
    yearEntry.costSamples.push(costInfo.cost || 0);
    if (!productEntry.costCurrency && costInfo.currency) {
      productEntry.costCurrency = costInfo.currency;
    }
    if (!productEntry.currency && costInfo.currency) {
      productEntry.currency = costInfo.currency;
    }
    if (!productEntry.costCurrency) {
      productEntry.costCurrency = productEntry.currency || mainCurrency;
    }

    productEntry.totalNet += net;
    productEntry.totalNetBase += netBase;

    totalsByCurrency[mainCurrency] = (totalsByCurrency[mainCurrency] || 0) + net;
    totalBase += netBase;
  }

  for (const entry of map.values()) {
    const timelineEntry = holdingsTimeline.get(entry.key);
    if (!timelineEntry || !Array.isArray(timelineEntry.snapshots) || !timelineEntry.snapshots.length) {
      continue;
    }

    let minYear = Infinity;
    let maxYear = -Infinity;
    for (const snapshot of timelineEntry.snapshots) {
      if (!snapshot || !(snapshot.date instanceof Date) || Number.isNaN(snapshot.date.getTime())) continue;
      const year = snapshot.date.getFullYear();
      if (!Number.isFinite(year)) continue;
      if (year < minYear) minYear = year;
      if (year > maxYear) maxYear = year;
    }

    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear)) {
      continue;
    }

    for (let year = minYear; year <= maxYear; year++) {
      const checkDate = new Date(year, 11, 31, 23, 59, 59);
      const shares = getSharesOnDate(entry.key, checkDate);
      if (!shares || !Number.isFinite(shares) || Math.abs(shares) < 1e-6) {
        continue;
      }

      const yearKey = String(year);
  const costInfo = getCostOnDate(entry.key, checkDate);
  const costValue = costInfo && Number.isFinite(costInfo.cost) ? costInfo.cost : 0;
      const target = entry.years.get(yearKey);

      if (!target) {
        entry.years.set(yearKey, {
          net: 0,
          gross: 0,
          withholding: 0,
          netBase: 0,
          events: 0,
          shareSamples: Number.isFinite(shares) ? [shares] : [],
          costSamples: costValue > 0 ? [costValue] : []
        });
      } else {
        if (!Array.isArray(target.shareSamples)) target.shareSamples = [];
        if (!target.shareSamples.length && Number.isFinite(shares)) {
          target.shareSamples.push(shares);
        }
        if (!Array.isArray(target.costSamples)) target.costSamples = [];
        if (costValue > 0 && !target.costSamples.some((val) => Math.abs(val - costValue) < 1e-6)) {
          target.costSamples.push(costValue);
        }
      }

      if (!entry.costCurrency && costInfo && costInfo.currency) {
        entry.costCurrency = costInfo.currency;
      }
      if (!entry.currency && costInfo && costInfo.currency) {
        entry.currency = costInfo.currency;
      }
    }
  }

  return {
    map,
    globalTotals: {
      perCurrency: totalsByCurrency,
      base: totalBase
    }
  };
}

function populateProductSelector(previousSelection = '') {
  if (!productYearSelect) return;
  const entries = Array.from(productYearMap.values()).sort((a, b) => (a.product || '').localeCompare(b.product || ''));
  productYearSelect.innerHTML = '<option value="">-- Elige un producto --</option>';

  entries.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.key;
    const parts = [];
  if (entry.product) parts.push(entry.product);
  if (entry.isin) parts.push(entry.isin);
  if (entry.currency) parts.push(entry.currency);
  option.textContent = parts.join(' - ') || entry.key;
    productYearSelect.appendChild(option);
  });

  if (previousSelection && productYearMap.has(previousSelection)) {
    productYearSelect.value = previousSelection;
  } else if (entries.length > 0) {
    productYearSelect.value = entries[0].key;
  } else {
    productYearSelect.value = '';
  }
}

function renderGlobalTotals() {
  if (globalTotalNetEl) {
    const base = globalDividendTotals.base || 0;
    const hasBase = Math.abs(base) > 1e-6;
    globalTotalNetEl.textContent = hasBase
      ? `${formatAmount(base)} ${baseCurrency}`
      : 'Sin datos';
  }

  if (globalTotalsByCurrencyEl) {
    const entries = Object.entries(globalDividendTotals.perCurrency || {});
    if (!entries.length) {
      globalTotalsByCurrencyEl.textContent = 'Sin datos';
    } else {
      const parts = entries
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([ccy, amount]) => `${formatAmount(amount)} ${ccy}`);
      globalTotalsByCurrencyEl.textContent = parts.join(' | ');
    }
  }
}

function renderProductYearDetails(key) {
  if (!productYearBody) return;

  if (productYearBarChart) {
    try { productYearBarChart.destroy(); } catch (_) {}
    productYearBarChart = null;
  }

  if (!key || !productYearMap.has(key)) {
    productYearBody.innerHTML = '<tr><td colspan="6" class="empty-state">Selecciona un producto para ver el detalle anual.</td></tr>';
    if (productTotalNetEl) productTotalNetEl.textContent = '-';
    if (productYearsCountEl) productYearsCountEl.textContent = '0';
    if (productCurrentSharesEl) productCurrentSharesEl.textContent = '-';
    return;
  }

  const entry = productYearMap.get(key);
  const years = Array.from(entry.years.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (!years.length) {
    productYearBody.innerHTML = '<tr><td colspan="6" class="empty-state">Sin dividendos para este producto.</td></tr>';
    if (productTotalNetEl) productTotalNetEl.textContent = '-';
    if (productYearsCountEl) productYearsCountEl.textContent = '0';
    if (productCurrentSharesEl) {
      const currentShares = getCurrentShares(key);
      productCurrentSharesEl.textContent = formatNumber(currentShares, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
    }
    return;
  }

  const totalNet = entry.totalNet || 0;
  const rows = [];
  const barLabels = [];
  const netValues = [];
  const withholdingValues = [];

  for (const [year, data] of years) {
    const samples = (data.shareSamples || []).filter((n) => typeof n === 'number' && !Number.isNaN(n));
    let avgShares = 0;
    if (samples.length) {
      avgShares = samples.reduce((sum, val) => sum + val, 0) / samples.length;
    } else {
      avgShares = getSharesOnDate(key, toDateTime(`${year}-12-31`, '', true));
    }
    avgShares = Number.isFinite(avgShares) ? avgShares : 0;

    const costSamples = (data.costSamples || []).filter((n) => typeof n === 'number' && !Number.isNaN(n) && n > 0);
    const avgCost = costSamples.length ? (costSamples.reduce((sum, val) => sum + val, 0) / costSamples.length) : 0;
    const dividendPerShare = avgShares > 0 ? data.net / avgShares : 0;
    const netClass = data.net >= 0 ? 'positive' : 'negative';
    const netDisplay = `${formatAmount(data.net)} ${entry.currency || ''}`.trim();
    const sharesDisplay = avgShares ? formatNumber(avgShares, { minimumFractionDigits: 0, maximumFractionDigits: 4 }) : '-';
    const dividendDisplay = dividendPerShare ? `${formatAmount(dividendPerShare)} ${entry.currency || ''}`.trim() : '-';
    const costDisplayCurrency = entry.costCurrency || entry.currency || '';
    const costDisplay = avgCost ? `${formatAmount(avgCost)} ${costDisplayCurrency}`.trim() : '-';
    const yieldValue = avgCost > 0 ? (data.net / avgCost) * 100 : 0;
    const yieldDisplay = avgCost > 0 ? `${yieldValue.toFixed(2)}%` : '-';
    const yieldClass = avgCost > 0 ? (yieldValue >= 0 ? 'positive' : 'negative') : '';

    rows.push(`
      <tr>
        <td>${year}</td>
        <td class="amount ${netClass}">${netDisplay}</td>
        <td class="amount">${costDisplay}</td>
        <td class="amount ${yieldClass}">${yieldDisplay}</td>
        <td>${sharesDisplay}</td>
        <td>${dividendDisplay}</td>
      </tr>
    `);

    barLabels.push(year);
    netValues.push(data.net);
  const retained = Math.max(data.withholding || 0, 0);
  withholdingValues.push(retained);
  }

  productYearBody.innerHTML = rows.join('');

  if (productTotalNetEl) {
    const totalDisplay = `${formatAmount(totalNet)} ${entry.currency || ''}`.trim();
    productTotalNetEl.textContent = totalDisplay;
  }
  if (productYearsCountEl) {
    productYearsCountEl.textContent = String(years.length);
  }
  if (productCurrentSharesEl) {
    const currentShares = getCurrentShares(key);
    productCurrentSharesEl.textContent = formatNumber(currentShares, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
  }

  if (barLabels.length && typeof Chart !== 'undefined') {
    const barCtx = document.getElementById('productYearBar');
    if (barCtx) {
      const dividendCurrency = entry.currency || '';
      productYearBarChart = new Chart(barCtx, {
        type: 'bar',
        data: {
          labels: barLabels,
          datasets: [
            {
              label: 'Dividendo neto',
              data: netValues,
              backgroundColor: '#0ea5e9',
              stack: 'dividends',
              borderRadius: 6,
              order: 1
            },
            {
              label: 'Retención',
              data: withholdingValues,
              backgroundColor: '#f97316',
              stack: 'dividends',
              borderRadius: 6,
              order: 1
            }
          ]
        },
        options: {
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => `${context.dataset.label}: ${formatAmount(context.raw)} ${dividendCurrency}`
              }
            }
          },
          scales: {
            y: {
              stacked: true,
              ticks: {
                callback: (value) => `${formatAmount(value)} ${dividendCurrency}`
              }
            }
          }
        }
      });
    }
  }
}

function updateAnnualYieldYearOptions(map) {
  if (!annualYieldYearSelect) return '';

  const yearsSet = new Set();
  if (map && map.size) {
    for (const entry of map.values()) {
      if (!entry || !entry.years) continue;
      for (const [year, info] of entry.years.entries()) {
        const avgShares = computeAverageCost(info.shareSamples || []);
        if (!avgShares || !Number.isFinite(avgShares) || Math.abs(avgShares) < 1e-6) continue;
        yearsSet.add(year);
      }
    }
  }

  const sortedYears = Array.from(yearsSet).sort();
  const previousValue = annualYieldYearSelect.value;

  annualYieldYearSelect.innerHTML = '<option value="">-- Elige un año --</option>';
  sortedYears.forEach((year) => {
    const option = document.createElement('option');
    option.value = year;
    option.textContent = year;
    annualYieldYearSelect.appendChild(option);
  });

  annualYieldYearSelect.disabled = sortedYears.length === 0;

  let nextValue = '';
  if (previousValue && sortedYears.includes(previousValue)) {
    nextValue = previousValue;
  } else if (sortedYears.length) {
    nextValue = sortedYears[sortedYears.length - 1];
  }

  if (nextValue) {
    annualYieldYearSelect.value = nextValue;
  } else {
    annualYieldYearSelect.value = '';
  }

  return annualYieldYearSelect.value || '';
}

function setAnnualYieldEmptyState(show) {
  if (annualYieldEmptyEl) {
    annualYieldEmptyEl.style.display = show ? 'block' : 'none';
  }
  if (annualYieldCanvas) {
    annualYieldCanvas.style.visibility = show ? 'hidden' : 'visible';
  }
}

function renderAnnualYieldComparison(map, year) {
  if (!annualYieldCanvas) return;

  if (annualYieldChart) {
    try { annualYieldChart.destroy(); } catch (_) {}
    annualYieldChart = null;
  }

  if (!map || !map.size || !year) {
    setAnnualYieldEmptyState(true);
    return;
  }

  const palette = ['#1d4ed8', '#16a34a', '#f97316', '#7c3aed', '#dc2626', '#0ea5e9', '#fb7185', '#14b8a6', '#f59e0b', '#6366f1'];
  const rows = [];

  for (const entry of map.values()) {
    if (!entry || !entry.years) continue;
    const yearEntry = entry.years.get(year);
    if (!yearEntry) continue;

    const avgShares = computeAverageCost(yearEntry.shareSamples || []);
    if (!avgShares || !Number.isFinite(avgShares) || Math.abs(avgShares) < 1e-6) continue;

    const avgCost = computeAverageCost(yearEntry.costSamples || []);
    let yieldPercent = 0;
    if (avgCost && Number.isFinite(avgCost) && Math.abs(avgCost) > 1e-6) {
      yieldPercent = Number((yearEntry.net / avgCost) * 100);
      if (!Number.isFinite(yieldPercent)) {
        yieldPercent = 0;
      }
    }

    const label = entry.product ? entry.product : 'Producto sin nombre';
    rows.push({ label, value: yieldPercent });
  }

  if (!rows.length) {
    setAnnualYieldEmptyState(true);
    return;
  }

  rows.sort((a, b) => b.value - a.value);

  const labels = rows.map((row) => row.label);
  const data = rows.map((row) => row.value);
  const backgroundColors = labels.map((_, idx) => palette[idx % palette.length]);

  setAnnualYieldEmptyState(false);

  annualYieldChart = new Chart(annualYieldCanvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: `Rentabilidad ${year}`,
          data,
          backgroundColor: backgroundColors,
          borderRadius: 8,
          maxBarThickness: 64
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const productLabel = context.label || '';
              const value = context.parsed.y;
              if (value === null || value === undefined) return productLabel;
              return `${productLabel}: ${formatPercent(value, 2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `${Number(value).toFixed(1)}%`
          },
          title: {
            display: true,
            text: 'Rentabilidad anual'
          }
        },
        x: {
          ticks: {
            autoSkip: false,
            maxRotation: 45,
            minRotation: 0
          },
          title: {
            display: true,
            text: 'Producto'
          }
        }
      }
    }
  });
}

function buildHoldingsTimeline(transactions) {
  const timeline = new Map();
  if (!Array.isArray(transactions) || !transactions.length) return timeline;

  const events = [];
  for (const t of transactions) {
    if (!t || !t.descripcion) continue;
    const parsed = parseTradeFromDescripcion(t.descripcion || '');
    if (!parsed || !parsed.quantity) continue;

    const key = buildProductKey(t.isin, t.producto || parsed.product);
    if (!key || key === '|') continue;

    const date = toDateTime(t.fechaValor || t.fecha, t.hora, false);
    const delta = parsed.action === 'compra' ? parsed.quantity : -parsed.quantity;
  const tradeCurrency = normalizeCurrencyCode(parsed.currency || (t.moneda1 ? t.moneda1.trim() : '') || (t.moneda2 ? t.moneda2.trim() : ''));
    events.push({
      key,
      date,
      delta,
      quantity: parsed.quantity,
      price: parsed.price,
      currency: tradeCurrency
    });
  }

  events.sort((a, b) => a.date - b.date);

  for (const event of events) {
    if (!timeline.has(event.key)) {
      timeline.set(event.key, { snapshots: [], lots: [], currency: event.currency || '' });
    }
    const entry = timeline.get(event.key);
    if (!entry.currency && event.currency) {
      entry.currency = event.currency;
    }

    entry.lots = entry.lots || [];

    if (event.delta > 0) {
      const lotCost = (typeof event.price === 'number' && !Number.isNaN(event.price))
        ? event.price * event.delta
        : 0;
      entry.lots.push({ shares: event.delta, cost: lotCost });
    } else if (event.delta < 0 && entry.lots.length) {
      let remaining = Math.abs(event.delta);
      for (const lot of entry.lots) {
        if (remaining <= 0) break;
        if (!lot.shares || lot.shares <= 0) continue;
        const consume = Math.min(remaining, lot.shares);
        const proportion = consume / lot.shares;
        lot.cost -= lot.cost * proportion;
        lot.shares -= consume;
        remaining -= consume;
      }
      entry.lots = entry.lots.filter((lot) => (lot.shares || 0) > 1e-6);
    }

    const totalShares = entry.lots.reduce((sum, lot) => sum + (lot.shares || 0), 0);
    const totalCost = entry.lots.reduce((sum, lot) => sum + (lot.cost || 0), 0);

    entry.snapshots.push({ date: event.date, shares: totalShares, cost: totalCost });
  }

  return timeline;
}

function parseTradeFromDescripcion(descripcion) {
  if (!descripcion) return null;
  let text = descripcion.trim();

  if (/^escis/i.test(text)) {
    const idx = text.indexOf(':');
    if (idx !== -1) {
      text = text.substring(idx + 1).trim();
    }
  }

  const firstSpace = text.indexOf(' ');
  if (firstSpace === -1) return null;
  const action = text.substring(0, firstSpace).toLowerCase();
  if (action !== 'compra' && action !== 'venta') return null;

  const rest = text.substring(firstSpace + 1).trim();
  const qtyMatch = rest.match(/^([0-9]+)/);
  if (!qtyMatch) return null;
  const quantity = parseInt(qtyMatch[1], 10);

  const afterQty = rest.substring(qtyMatch[0].length).trim();
  const atIndex = afterQty.indexOf('@');
  if (atIndex === -1) return null;
  const product = afterQty.substring(0, atIndex).trim();

  const afterAt = afterQty.substring(atIndex + 1);
  const parenIndex = afterAt.indexOf('(');
  const pricePart = (parenIndex === -1 ? afterAt : afterAt.substring(0, parenIndex)).trim();
  const priceNumMatch = pricePart.match(/([0-9]+(?:[\.,][0-9]+)?)/);
  const priceStr = priceNumMatch ? priceNumMatch[1] : null;
  const price = priceStr ? parseAmount(priceStr) : null;
  const currencyMatch = pricePart.match(/\b([A-Z]{3})\b/);
  let currency = currencyMatch ? currencyMatch[1] : '';
  let normalizedPrice = price;

  if (currency && currency.toUpperCase() === 'GBX') {
    currency = 'GBP';
    if (normalizedPrice !== null && !Number.isNaN(normalizedPrice)) {
      normalizedPrice = normalizedPrice / 100;
    }
  }

  return { action, quantity, product, price: normalizedPrice, currency };
}

function buildProductKey(isin, product) {
  const isinPart = (isin || '').trim().toUpperCase();
  const productPart = (product || '').trim().toUpperCase();
  return `${isinPart}|${productPart}`;
}

function toDateTime(fecha, hora, endOfDay = false) {
  const iso = parseDateToISO(fecha);
  if (!iso) return new Date(0);
  let time = normaliseTimeComponent(hora);
  if (!time) {
    time = endOfDay ? '23:59:59' : '00:00:00';
  }
  const date = new Date(`${iso}T${time}`);
  return Number.isNaN(date.getTime()) ? new Date(iso) : date;
}

function normaliseTimeComponent(hora) {
  if (!hora) return '';
  const raw = String(hora).trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length === 1) return `${padTime(parts[0])}:00:00`;
  if (parts.length === 2) return `${padTime(parts[0])}:${padTime(parts[1])}:00`;
  return `${padTime(parts[0])}:${padTime(parts[1])}:${padTime(parts[2])}`;
}

function padTime(value) {
  return String(value ?? '0').padStart(2, '0');
}

function getSharesOnDate(key, date) {
  const entry = holdingsTimeline.get(key);
  if (!entry || !Array.isArray(entry.snapshots)) return 0;
  let shares = 0;
  for (const snapshot of entry.snapshots) {
    if (snapshot.date <= date) {
      shares = snapshot.shares;
    } else {
      break;
    }
  }
  return shares;
}

function getCostOnDate(key, date) {
  const entry = holdingsTimeline.get(key);
  if (!entry || !Array.isArray(entry.snapshots)) {
    return { cost: 0, currency: entry && entry.currency ? entry.currency : '' };
  }
  let cost = 0;
  for (const snapshot of entry.snapshots) {
    if (snapshot.date <= date) {
      cost = snapshot.cost || 0;
    } else {
      break;
    }
  }
  return { cost, currency: entry.currency || '' };
}

function computeAverageCost(samples = []) {
  const values = samples.filter((n) => typeof n === 'number' && !Number.isNaN(n) && Math.abs(n) > 1e-6);
  if (!values.length) return 0;
  const total = values.reduce((sum, val) => sum + val, 0);
  return total / values.length;
}

function getCurrentShares(key) {
  const entry = holdingsTimeline.get(key);
  if (!entry || !Array.isArray(entry.snapshots) || !entry.snapshots.length) return 0;
  return entry.snapshots[entry.snapshots.length - 1].shares || 0;
}
