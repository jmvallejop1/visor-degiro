function calculatePositions() {
    const positions = new Map();

    const trades = allTransactions.filter((t) => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('compra') || d.includes('venta');
    });

    trades.sort((a, b) => parseDateTime(a.fecha, a.hora) - parseDateTime(b.fecha, b.hora));

    trades.forEach((t, index) => {
        const parsed = parseTradeFromDescripcion(t.descripcion || '');
        if (!parsed || parsed.price == null || !parsed.quantity) return;

        const key = (t.isin && t.isin.trim()) ? t.isin.trim() : (t.producto || parsed.product || '').trim();
        if (!key) return;

        const currency = parsed.currency || t.moneda1 || t.moneda2 || 'EUR';
        const productName = (t.producto || parsed.product || key || '').trim();
        const isin = (t.isin || '').trim();

        if (!positions.has(key)) {
            positions.set(key, {
                shares: 0,           // Total de acciones que tengo
                totalCost: 0,        // Coste total de las acciones que tengo
                currency,
                history: [],
                lots: [],            // Solo para FIFO: array de {shares, price}
                productName,
                isin
            });
        }

        const pos = positions.get(key);
        pos.currency = currency;
        if (productName) {
            pos.productName = productName;
        }
        if (isin) {
            pos.isin = isin;
        }

        const qty = parsed.quantity;
        const price = parsed.price;
        const action = parsed.action;

        if (action === 'compra') {
            // ===== COMPRA =====
            // FIFO: Guardar el lote
            pos.lots.push({ shares: qty, price });

            // Actualizar totales
            pos.shares += qty;
            pos.totalCost += price * qty;

            // Media de la posición DESPUÉS de la compra
            const avgPosition = pos.shares > 0 ? pos.totalCost / pos.shares : 0;

            pos.history.push({
                idOrden: (t.idOrden || '').trim() || null,
                date: t.fecha,
                hora: t.hora || null,
                action,
                price,
                currency,
                quantity: qty,
                avgSale: null,           // No aplica en compras
                avgPosition: avgPosition, // Media de la posición después de comprar
                profitLoss: null,
                index,
                requestedQuantity: qty
            });
            return;
        }

        if (action !== 'venta') {
            return;
        }

        // ===== VENTA =====
        // ===== MÉTODO FIFO =====
        let remaining = qty;
        let soldShares = 0;
        let totalCostOfSoldShares = 0;

        console.log(`[VENTA FIFO] ${t.fecha} - Vendiendo ${qty} acciones @ ${price}`);
        console.log(`[VENTA FIFO] Lotes disponibles ANTES:`, JSON.parse(JSON.stringify(pos.lots)));

        // Consumir lotes desde el más antiguo
        const lotsToRemove = [];
        for (let i = 0; i < pos.lots.length && remaining > 0; i++) {
            const lot = pos.lots[i];
            const consume = Math.min(remaining, lot.shares);

            console.log(`[VENTA FIFO] Consumiendo ${consume} acciones del lote ${i} (precio: ${lot.price}, disponibles: ${lot.shares})`);

            soldShares += consume;
            totalCostOfSoldShares += consume * lot.price;

            lot.shares -= consume;
            remaining -= consume;

            if (lot.shares <= 1e-12) {
                lotsToRemove.push(i);
            }
        }

        console.log(`[VENTA FIFO] Total vendido: ${soldShares} acciones por un coste de ${totalCostOfSoldShares}`);
        console.log(`[VENTA FIFO] Media Venta: ${totalCostOfSoldShares / soldShares}`);

        // Eliminar lotes vacíos y recalcular totales a partir de los lotes restantes
        for (let i = lotsToRemove.length - 1; i >= 0; i--) {
            pos.lots.splice(lotsToRemove[i], 1);
        }

        console.log(`[VENTA FIFO] Lotes disponibles DESPUÉS:`, JSON.parse(JSON.stringify(pos.lots)));

        pos.shares = pos.lots.reduce((sum, lot) => sum + lot.shares, 0);
        pos.totalCost = pos.lots.reduce((sum, lot) => sum + lot.shares * lot.price, 0);

        if (pos.shares <= 1e-12) {
            pos.shares = 0;
            pos.totalCost = 0;
        }

        const avgSale = soldShares > 0 ? totalCostOfSoldShares / soldShares : 0;
        const avgPosition = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
        const profitLoss = soldShares > 0 ? (price - avgSale) * soldShares : null;

        console.log(`[VENTA FIFO] Resultado - avgSale: ${avgSale}, avgPosition: ${avgPosition}, profitLoss: ${profitLoss}\n`);

        pos.history.push({
            idOrden: (t.idOrden || '').trim() || null,
            date: t.fecha,
            hora: t.hora || null,
            action,
            price,
            currency,
            quantity: soldShares,
            avgSale: avgSale,
            avgPosition: avgPosition,
            profitLoss: profitLoss,
            index,
            requestedQuantity: soldShares
        });
    });

    return positions;
}

// --------------------
// Datos y carga inicial
// --------------------

// Variables globales
let allTransactions = [];
let filteredTransactions = [];
let currentPositions = new Map();

// Elementos del DOM
const dashboard = document.getElementById('dashboard');
const transactionsBody = document.getElementById('transactionsBody');
const searchProduct = document.getElementById('searchProduct');
const filterMonth = document.getElementById('filterMonth');
const clearFiltersBtn = document.getElementById('clearFilters');
const transactionCount = document.getElementById('transactionCount');
const filterChipsContainer = document.getElementById('filterChips');
const simProductSelect = document.getElementById('simProduct');
const simSharesInput = document.getElementById('simShares');
const simPriceInput = document.getElementById('simPrice');
const simulateSaleBtn = document.getElementById('simulateSale');
const simulationResultBox = document.getElementById('simulationResult');
const simBreakdownCheckbox = document.getElementById('simBreakdown');

if (filterChipsContainer) {
    filterChipsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip');
        if (!btn) return;
        const isActive = btn.classList.contains('active');
        filterChipsContainer.querySelectorAll('.chip').forEach((chip) => chip.classList.remove('active'));
        if (!isActive) {
            btn.classList.add('active');
        }
        if (filterChipsContainer.querySelectorAll('.chip.active').length === 0) {
            filterChipsContainer.classList.add('no-selection');
        } else {
            filterChipsContainer.classList.remove('no-selection');
        }
        applyFilters();
    });
}

// Event Listeners
if (searchProduct) searchProduct.addEventListener('input', applyFilters);
if (filterMonth) filterMonth.addEventListener('change', applyFilters);
if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);
if (simProductSelect) simProductSelect.addEventListener('change', handleSimulatorSelectionChange);
if (simulateSaleBtn) simulateSaleBtn.addEventListener('click', (event) => {
    event.preventDefault();
    runSimulation();
});
if (simBreakdownCheckbox) simBreakdownCheckbox.addEventListener('change', () => {
    // rerun to show/hide breakdown if user toggles after a simulation
    const lastProduct = simProductSelect ? simProductSelect.value : null;
    if (lastProduct) {
        // only rerun if there's a last selection and inputs are present
        runSimulation();
    }
});

// Cargar desde localStorage al iniciar
window.addEventListener('DOMContentLoaded', loadFromStorage);

function loadFromStorage() {
    let stored = null;
    try {
        stored = localStorage.getItem('degiro.transactions.v1');
    } catch (_) {}

    if (stored) {
        try {
            allTransactions = JSON.parse(stored);
            filteredTransactions = [...allTransactions];
            displayDashboard();
        } catch (e) {
            console.error('Error loading from localStorage:', e);
        }
    }
}

function parseAmount(str) {
    if (str === null || str === undefined || str === '') return 0;
    if (typeof str === 'number') return str;
    str = String(str).trim();
    return parseFloat(str.replace(/\./g, '').replace(',', '.').replace(/"/g, '')) || 0;
}

function formatAmount(amount) {
    return new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(amount);
}

function formatShares(amount) {
    return new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4
    }).format(amount || 0);
}

function parseDateTime(fecha, hora) {
    if (!fecha) return new Date(0);

    const parts = fecha.split('-');
    if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        const [hours = '0', minutes = '0', seconds = '0'] = (hora || '').split(':');
        return new Date(
            Number(yyyy),
            Number(mm) - 1,
            Number(dd),
            Number(hours),
            Number(minutes),
            Number(seconds)
        );
    }

    return new Date(fecha);
}

function displayDashboard() {
    if (dashboard) {
        dashboard.style.display = 'block';
    }
    displayTransactionsTable();
}

function parseTradeFromDescripcion(descripcion) {
    if (!descripcion) return null;
    let text = descripcion.trim();

    // Caso ESCISIÓN
    if (/^escis/i.test(text)) {
        const colonIndex = text.indexOf(':');
        if (colonIndex !== -1) {
            text = text.substring(colonIndex + 1).trim();
        }
    }

    const firstSpace = text.indexOf(' ');
    if (firstSpace === -1) return null;
    const action = text.substring(0, firstSpace).toLowerCase();

    if (action !== 'compra' && action !== 'venta') return null;

    const rest1 = text.substring(firstSpace + 1).trim();
    const qtyMatch = rest1.match(/^(\d+)/);
    if (!qtyMatch) return null;
    const quantity = parseInt(qtyMatch[1], 10);

    const afterQty = rest1.substring(qtyMatch[0].length).trim();
    const atIndex = afterQty.indexOf('@');
    if (atIndex === -1) return null;
    const product = afterQty.substring(0, atIndex).trim();

    const afterAt = afterQty.substring(atIndex + 1);
    const parenIndex = afterAt.indexOf('(');
    const pricePart = (parenIndex === -1 ? afterAt : afterAt.substring(0, parenIndex)).trim();
    const priceNumMatch = pricePart.match(/([0-9]+(?:[\.,][0-9]+)?)/);
    const currencyMatch = pricePart.match(/\b([A-Z]{3})\b/);
    const priceStr = priceNumMatch ? priceNumMatch[1] : null;
    const currency = currencyMatch ? currencyMatch[1] : '';
    const price = priceStr ? parseAmount(priceStr) : null;

    return { action, quantity, product, price, currency };
}

function findSaleHistoryEntry(position, trans, parsed, markUsed = true) {
    if (!position || !Array.isArray(position.history)) return null;

    const clean = (value) => (value || '').trim();
    const targetId = clean(trans.idOrden);
    const targetDate = trans.fecha;
    const targetTime = clean(trans.hora);
    const targetQty = parsed.quantity;
    const tolerance = 1e-6;

    const markAndReturn = (entry) => {
        if (entry && markUsed) {
            entry.used = true;
        }
        return entry || null;
    };

    if (targetId) {
        const byId = position.history.find(h => !h.used && h.action === 'venta' && clean(h.idOrden) === targetId);
        if (byId) return markAndReturn(byId);
    }

    if (targetDate) {
        const byDate = position.history.find(h => !h.used && h.action === 'venta' &&
            h.date === targetDate &&
            (!targetTime || !h.hora || clean(h.hora) === targetTime) &&
            h.requestedQuantity === targetQty &&
            Math.abs((h.price || 0) - (parsed.price || 0)) < tolerance
        );
        if (byDate) return markAndReturn(byDate);
    }

    const fallback = position.history.find(h => !h.used && h.action === 'venta');
    return markAndReturn(fallback);
}

function displayTransactionsTable() {
    if (!transactionsBody) return;
    transactionsBody.innerHTML = '';
    
    const positions = calculatePositions();
    currentPositions = positions;

    // Filtrar compras y ventas
    const onlyBuySell = filteredTransactions.filter(t => {
        const d = (t.descripcion || '').toLowerCase();
        return d.includes('compra') || d.includes('venta');
    });

    // Agrupar por producto/ISIN
    const groupedByProduct = new Map();
    
    onlyBuySell.forEach(trans => {
        const parsed = parseTradeFromDescripcion(trans.descripcion || '');
        if (!parsed) return;
        
        const key = (trans.isin && trans.isin.trim()) ? trans.isin.trim() : (trans.producto || parsed.product || '').trim();
        if (!key) return;
        
        if (!groupedByProduct.has(key)) {
            groupedByProduct.set(key, {
                producto: trans.producto || parsed.product || key,
                isin: trans.isin,
                compras: [],
                ventas: []
            });
        }
        
        const group = groupedByProduct.get(key);
        const tradeData = {
            fecha: trans.fecha,
            parsed: parsed,
            trans: trans
        };
        
        if (parsed.action === 'compra') {
            group.compras.push(tradeData);
        } else if (parsed.action === 'venta') {
            group.ventas.push(tradeData);
        }
    });

    let totalTransactions = 0;

    groupedByProduct.forEach((group, key) => {
        if (group.ventas.length === 0) return;

        const position = positions.get(key);
        if (position && Array.isArray(position.history)) {
            position.history.forEach((entry) => {
                if (entry && typeof entry === 'object') {
                    delete entry.used;
                }
            });
        }

        const totalOps = group.compras.length + group.ventas.length;
        const currency = position?.currency ||
            group.ventas[0]?.parsed.currency ||
            group.compras[0]?.parsed.currency ||
            group.ventas[0]?.trans.moneda1 ||
            'EUR';
        const currentShares = position?.shares || 0;
        const avgPosition = currentShares > 0 && position ? position.totalCost / currentShares : 0;
        const totalCost = position?.totalCost || 0;
        const productLabel = position?.productName || group.producto || key;
        const isinLabel = position?.isin || group.isin || '-';

        const summaryRow = document.createElement('tr');
        summaryRow.className = 'product-summary';
        summaryRow.style.cursor = 'pointer';
        summaryRow.style.background = '#e0f2fe';

        summaryRow.innerHTML = `
            <td><span class="toggle-icon" style="display: inline-block; width: 1.25rem;">▶</span> <strong>${productLabel}</strong></td>
            <td><small style="color: #6b7280;">${isinLabel || '-'}</small></td>
            <td>${totalOps} operaciones</td>
            <td><span class="badge" style="background: #3b82f6;">Resumen</span></td>
            <td style="text-align: center;">${formatShares(currentShares)}</td>
            <td style="text-align: right;">${avgPosition > 0 ? `<strong>${formatAmount(avgPosition)}</strong> ${currency}` : '-'}</td>
            <td style="text-align: right;">${currentShares > 0 ? `<strong>${formatAmount(totalCost)}</strong> ${currency}` : '-'}</td>
            <td style="text-align: right;">-</td>
            <td style="text-align: right;">${avgPosition > 0 ? `<strong>${formatAmount(avgPosition)}</strong> ${currency}` : '<span style="color: #6b7280;">Sin acciones</span>'}</td>
            <td style="text-align: right;">-</td>
        `;

        const detailsRow = document.createElement('tr');
        detailsRow.className = 'product-details';
        detailsRow.style.display = 'none';

        const detailsCell = document.createElement('td');
        detailsCell.colSpan = 10;
        detailsCell.style.padding = '0';
        detailsCell.style.background = '#ffffff';

        const innerTable = document.createElement('table');
        innerTable.style.width = '100%';
        innerTable.style.borderCollapse = 'collapse';
        innerTable.innerHTML = `
            <thead>
                <tr style="background:#f3f4f6;">
                    <th style="padding:0.5rem; text-align:left;">Producto</th>
                    <th style="padding:0.5rem; text-align:left;">ISIN</th>
                    <th style="padding:0.5rem;">Fecha</th>
                    <th style="padding:0.5rem;">Tipo</th>
                    <th style="padding:0.5rem; text-align:center;">Acciones</th>
                    <th style="padding:0.5rem; text-align:right;">Precio/Acción</th>
                    <th style="padding:0.5rem; text-align:right;">Total</th>
                    <th style="padding:0.5rem; text-align:right;">Media Venta</th>
                    <th style="padding:0.5rem; text-align:right;">Media Posición</th>
                    <th style="padding:0.5rem; text-align:right;">Ganancia/Pérdida</th>
                </tr>
            </thead>
        `;

        const innerBody = document.createElement('tbody');

        const allOperations = [
            ...group.compras.map(c => ({ ...c, type: 'compra' })),
            ...group.ventas.map(v => ({ ...v, type: 'venta' }))
        ].sort((a, b) => {
            const dateA = parseDateTime(a.fecha, a.trans.hora);
            const dateB = parseDateTime(b.fecha, b.trans.hora);
            return dateA - dateB;
        });

        allOperations.forEach((operation) => {
            const parsed = operation.parsed;
            const trans = operation.trans;
            const isCompra = operation.type === 'compra';
            const row = document.createElement('tr');
            row.style.background = isCompra ? '#f8fafc' : '#fef2f2';

            if (isCompra) {
                const total = parsed.price * parsed.quantity;
                let avgPositionCell = '-';
                if (position && position.history.length > 0) {
                    const historyEntry = position.history.find(h =>
                        !h.used &&
                        h.action === 'compra' &&
                        h.date === operation.fecha &&
                        h.quantity === parsed.quantity &&
                        Math.abs((h.price || 0) - parsed.price) < 0.01
                    );

                    if (historyEntry) {
                        historyEntry.used = true;
                        if (historyEntry.avgPosition > 0) {
                            avgPositionCell = `<strong>${formatAmount(historyEntry.avgPosition)}</strong> ${parsed.currency}`;
                        }
                    }
                }

                row.innerHTML = `
                    <td style="padding:0.5rem;">${productLabel}</td>
                    <td style="padding:0.5rem; color:#6b7280;">${isinLabel || '-'}</td>
                    <td style="padding:0.5rem;">${operation.fecha}</td>
                    <td style="padding:0.5rem;"><span class="badge" style="background: #10b981;">Compra</span></td>
                    <td style="padding:0.5rem; text-align:center;">${formatShares(parsed.quantity)}</td>
                    <td style="padding:0.5rem; text-align:right;"><strong>${formatAmount(parsed.price)}</strong> ${parsed.currency}</td>
                    <td style="padding:0.5rem; text-align:right;"><strong>${formatAmount(total)}</strong> ${parsed.currency}</td>
                    <td style="padding:0.5rem; text-align:right;">-</td>
                    <td style="padding:0.5rem; text-align:right;">${avgPositionCell}</td>
                    <td style="padding:0.5rem; text-align:right;">-</td>
                `;
            } else {
                let avgSaleCell = '-';
                let avgPositionCell = '-';
                let profitLossCell = '-';
                let saleQuantity = parsed.quantity;

                if (position && position.history.length > 0) {
                    const historyEntry = findSaleHistoryEntry(position, trans, parsed);
                    if (historyEntry) {
                        const saleCurrency = historyEntry.currency || parsed.currency || trans.moneda1 || trans.moneda2 || 'EUR';
                        saleQuantity = historyEntry.quantity || saleQuantity;

                        if (historyEntry.avgSale > 0) {
                            avgSaleCell = `<strong>${formatAmount(historyEntry.avgSale)}</strong> ${saleCurrency}`;
                        }

                        if (historyEntry.avgPosition > 0) {
                            avgPositionCell = `<strong>${formatAmount(historyEntry.avgPosition)}</strong> ${saleCurrency}`;
                        } else if (historyEntry.avgPosition === 0) {
                            avgPositionCell = '<span style="color: #6b7280;">Sin acciones</span>';
                        }

                        if (historyEntry.profitLoss != null) {
                            const profitLoss = historyEntry.profitLoss;
                            const profitSymbol = profitLoss >= 0 ? '+' : '';
                            const profitClass = profitLoss >= 0 ? 'positive' : 'negative';
                            profitLossCell = `
                                <div class="amount ${profitClass}" style="font-weight: 700; font-size: 1.05rem;">
                                    ${profitSymbol}${formatAmount(profitLoss)} ${saleCurrency}
                                </div>
                            `;
                        }
                    }
                }

                const total = parsed.price * saleQuantity;

                row.innerHTML = `
                    <td style="padding:0.5rem;">${productLabel}</td>
                    <td style="padding:0.5rem; color:#6b7280;">${isinLabel || '-'}</td>
                    <td style="padding:0.5rem;">${operation.fecha}</td>
                    <td style="padding:0.5rem;"><span class="badge" style="background: #ef4444;">Venta</span></td>
                    <td style="padding:0.5rem; text-align:center;">${formatShares(saleQuantity)}</td>
                    <td style="padding:0.5rem; text-align:right;"><strong>${formatAmount(parsed.price)}</strong> ${parsed.currency}</td>
                    <td style="padding:0.5rem; text-align:right;"><strong>${formatAmount(total)}</strong> ${parsed.currency}</td>
                    <td style="padding:0.5rem; text-align:right;">${avgSaleCell}</td>
                    <td style="padding:0.5rem; text-align:right;">${avgPositionCell}</td>
                    <td style="padding:0.5rem; text-align:right;">${profitLossCell}</td>
                `;
            }

            innerBody.appendChild(row);
            totalTransactions++;
        });

        innerTable.appendChild(innerBody);
        detailsCell.appendChild(innerTable);
        detailsRow.appendChild(detailsCell);

        summaryRow.addEventListener('click', () => {
            const isHidden = detailsRow.style.display === 'none';
            detailsRow.style.display = isHidden ? 'table-row' : 'none';
            const icon = summaryRow.querySelector('.toggle-icon');
            if (icon) {
                icon.textContent = isHidden ? '▼' : '▶';
            }
        });

        transactionsBody.appendChild(summaryRow);
        transactionsBody.appendChild(detailsRow);
    });
    
    if (transactionCount) {
        transactionCount.textContent = `${totalTransactions} operaciones`;
    }

    updateSimulatorOptions();
}

function applyFilters() {
    const searchTerm = (searchProduct?.value || '').toLowerCase();
    let typeFilter = '';
    const activeChip = document.querySelector('#filterChips .chip.active');
    if (activeChip) {
        typeFilter = (activeChip.getAttribute('data-value') || '').toLowerCase();
    }
    const monthFilter = filterMonth ? filterMonth.value : '';

    filteredTransactions = allTransactions.filter(trans => {
        const matchesSearch = !searchTerm || 
            (trans.producto || '').toLowerCase().includes(searchTerm) ||
            (trans.descripcion || '').toLowerCase().includes(searchTerm);
        
        let matchesType = true;
        if (typeFilter) {
            matchesType = (trans.descripcion || '').toLowerCase().includes(typeFilter);
        }
        let matchesMonth = true;
        if (monthFilter) {
            const formattedMonth = convertMonthFormat(monthFilter);
            matchesMonth = formattedMonth ? (trans.fecha || '').includes(formattedMonth) : true;
        }

        return matchesSearch && matchesType && matchesMonth;
    });

    displayTransactionsTable();
}

function convertMonthFormat(monthStr) {
    if (!monthStr) return '';
    const [year, month] = monthStr.split('-');
    if (!year || !month) return '';
    return `${month}-${year}`;
}

function clearFilters() {
    searchProduct.value = '';
    filterMonth.value = '';
    const chips = document.querySelectorAll('#filterChips .chip');
    chips.forEach((c) => c.classList.remove('active'));
    if (filterChipsContainer) {
        filterChipsContainer.classList.add('no-selection');
    }
    filteredTransactions = [...allTransactions];
    displayTransactionsTable();
}

function updateSimulatorOptions() {
    if (!simProductSelect) return;

    const entries = Array.from(currentPositions.entries())
        .filter(([, pos]) => pos && pos.shares > 0)
        .sort((a, b) => {
            const nameA = (a[1].productName || a[0] || '').toLowerCase();
            const nameB = (b[1].productName || b[0] || '').toLowerCase();
            return nameA.localeCompare(nameB, 'es');
        });

    const previousSelection = simProductSelect.value;
    simProductSelect.innerHTML = '';

    if (entries.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Sin posiciones disponibles';
        simProductSelect.appendChild(option);
        simProductSelect.disabled = true;
        if (simSharesInput) {
            simSharesInput.value = '';
            simSharesInput.disabled = true;
        }
        if (simPriceInput) {
            simPriceInput.value = '';
            simPriceInput.disabled = true;
        }
        if (simulateSaleBtn) {
            simulateSaleBtn.disabled = true;
        }
        setSimulationResultMessage('No hay posiciones con acciones disponibles para simular.', 'info');
        return;
    }

    simProductSelect.disabled = false;
    if (simSharesInput) simSharesInput.disabled = false;
    if (simPriceInput) simPriceInput.disabled = false;
    if (simulateSaleBtn) simulateSaleBtn.disabled = false;

    entries.forEach(([key, pos]) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = `${pos.productName || key} (${formatShares(pos.shares)} acc.)`;
        option.dataset.currency = pos.currency || 'EUR';
        simProductSelect.appendChild(option);
    });

    const restoredEntry = entries.find(([key]) => key === previousSelection) || entries[0];
    simProductSelect.value = restoredEntry[0];
    setSimulatorDefaults(restoredEntry[1]);
    setSimulationResultMessage('Configura los parámetros y pulsa "Simular" para ver el resultado estimado.', 'info');
}

function handleSimulatorSelectionChange() {
    if (!simProductSelect) return;
    const selectedKey = simProductSelect.value;
    const selectedPosition = currentPositions.get(selectedKey);
    setSimulatorDefaults(selectedPosition);
    setSimulationResultMessage('Configura los parámetros y pulsa "Simular" para ver el resultado estimado.', 'info');
}

function setSimulatorDefaults(position) {
    if (!simSharesInput || !simPriceInput) return;

    if (!position || !position.shares) {
        simSharesInput.value = '';
        simSharesInput.removeAttribute('max');
        simPriceInput.value = '';
        return;
    }

    simSharesInput.value = toInputValue(position.shares, 4);
    simSharesInput.setAttribute('max', position.shares);
    simSharesInput.setAttribute('min', '0');
    simSharesInput.setAttribute('step', '0.0001');

    if (!simPriceInput.value) {
        simPriceInput.value = '';
    }
}

function runSimulation() {
    if (!simProductSelect || !simSharesInput || !simPriceInput || !simulationResultBox) return;

    const key = simProductSelect.value;
    if (!key) {
        setSimulationResultMessage('Selecciona un producto para simular la venta.', 'error');
        return;
    }

    const position = currentPositions.get(key);
    if (!position || position.shares <= 0) {
        setSimulationResultMessage('No hay acciones disponibles para este producto.', 'error');
        return;
    }

    const quantity = parseFloat(simSharesInput.value);
    const price = parseFloat(simPriceInput.value);

    if (!isFinite(quantity) || quantity <= 0) {
        setSimulationResultMessage('Introduce una cantidad de acciones válida para vender.', 'error');
        return;
    }

    if (quantity - position.shares > 1e-6) {
        setSimulationResultMessage('No tienes suficientes acciones para vender esa cantidad.', 'error');
        return;
    }

    if (!isFinite(price) || price <= 0) {
        setSimulationResultMessage('Introduce un precio de venta válido.', 'error');
        return;
    }

    const sourceLots = Array.isArray(position.lots) ? position.lots : [];
    const lotsCopy = sourceLots.map(lot => ({ ...lot }));
    let remaining = quantity;
    let soldShares = 0;
    let totalCost = 0;

    for (const lot of lotsCopy) {
        if (remaining <= 0) break;
        const consume = Math.min(remaining, lot.shares);
        soldShares += consume;
        totalCost += consume * lot.price;
        lot.shares -= consume;
        remaining -= consume;
    }

    if (soldShares + 1e-6 < quantity) {
        setSimulationResultMessage('No hay suficientes acciones disponibles para completar la venta.', 'error');
        return;
    }

    const costBasis = soldShares > 0 ? totalCost / soldShares : 0;
    const costAmount = totalCost; // coste total de las acciones vendidas (acciones vendidos * coste medio FIFO)
    const profitLoss = (price - costBasis) * soldShares;
    const proceeds = price * soldShares;

    const remainingShares = lotsCopy.reduce((sum, lot) => sum + lot.shares, 0);
    const remainingCost = lotsCopy.reduce((sum, lot) => sum + lot.shares * lot.price, 0);
    const remainingAvg = remainingShares > 0 ? remainingCost / remainingShares : 0;

    const currency = position.currency || 'EUR';
    const profitColor = profitLoss >= 0 ? '#16a34a' : '#dc2626';

    const resultHtml = `
        <div><strong>${position.productName || key}</strong></div>
        <div style="margin-top:0.4rem;">Acciones vendidas: <strong>${formatShares(soldShares)}</strong></div>
    <div>Coste medio FIFO de lo vendido: <strong>${formatAmount(costBasis)}</strong> ${currency}</div>
    <div>Coste total de las acciones vendidas: <strong>${formatAmount(costAmount)}</strong> ${currency}</div>
    <div>Importe de la venta: <strong>${formatAmount(price)}</strong> ${currency} × ${formatShares(soldShares)} = <strong>${formatAmount(proceeds)}</strong> ${currency}</div>
        <div>Ganancia/Pérdida estimada: <strong style="color:${profitColor};">${profitLoss >= 0 ? '+' : ''}${formatAmount(profitLoss)}</strong> ${currency}</div>
        <div style="margin-top:0.4rem;">Acciones restantes: <strong>${formatShares(remainingShares)}</strong></div>
        ${remainingShares > 0
            ? `<div>Precio medio estimado tras la simulación: <strong>${formatAmount(remainingAvg)}</strong> ${currency}</div>`
            : '<div>Sin acciones restantes tras la venta.</div>'}
    `;

    // Si el usuario pide desglose por lotes, construir una tabla con lotes consumidos
    if (simBreakdownCheckbox && simBreakdownCheckbox.checked) {
        const consumed = [];
        let qtyLeft = quantity;
        for (const lot of Array.isArray(position.lots) ? position.lots : []) {
            if (qtyLeft <= 0) break;
            const take = Math.min(qtyLeft, lot.shares);
            if (take > 0) {
                consumed.push({ shares: take, price: lot.price, cost: take * lot.price });
                qtyLeft -= take;
            }
        }

        if (consumed.length > 0) {
            let breakdownHtml = '<hr style="margin:0.5rem 0; border:none; border-top:1px solid #e6eef9;" />';
            breakdownHtml += '<div style="margin-top:0.5rem; font-weight:700;">Desglose por lotes consumidos:</div>';
            breakdownHtml += '<table style="width:100%; margin-top:0.5rem; border-collapse:collapse; font-size:0.95rem;">';
            breakdownHtml += '<thead><tr style="color:#475569;"><th style="text-align:left; padding:0.25rem 0.5rem;">Cantidad</th><th style="text-align:left; padding:0.25rem 0.5rem;">Precio</th><th style="text-align:right; padding:0.25rem 0.5rem;">Coste</th></tr></thead>';
            breakdownHtml += '<tbody>';
            consumed.forEach(row => {
                breakdownHtml += `<tr><td style="padding:0.25rem 0.5rem;">${formatShares(row.shares)}</td><td style="padding:0.25rem 0.5rem;">${formatAmount(row.price)}</td><td style="padding:0.25rem 0.5rem; text-align:right;">${formatAmount(row.cost)}</td></tr>`;
            });
            breakdownHtml += '</tbody></table>';
            // Añadir al final del HTML
            setSimulationResultMessage(resultHtml + breakdownHtml, 'success');
            return;
        }
    }

    setSimulationResultMessage(resultHtml, 'success');
}

function setSimulationResultMessage(message, tone = 'info') {
    if (!simulationResultBox) return;
    const color = tone === 'error' ? '#b91c1c' : '#1f2937';
    simulationResultBox.style.color = color;
    simulationResultBox.innerHTML = message;
}

function toInputValue(value, decimals = 4) {
    if (value == null) return '';
    const factor = Math.pow(10, decimals);
    return (Math.round(value * factor) / factor).toString();
}
